#define _GNU_SOURCE

#include <dlfcn.h>
#include <errno.h>
#include <linux/input-event-codes.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>
#include <wayland-client-protocol.h>

#include "include/wayland-bridge.h"
#include "include/wayland-bridge-internal.h"

sendmsg_fn real_sendmsg;
static recvmsg_fn real_recvmsg;
static close_fn real_close;
static ConnectionState connections[MAX_CONNECTIONS];
static pthread_mutex_t state_mutex = PTHREAD_MUTEX_INITIALIZER;
static bool bridge_shutting_down;
uint32_t captured_connection_count;
uint32_t captured_pointer_count;
uint32_t captured_toplevel_count;
uint32_t pointer_button_count;
uint32_t native_move_count;
uint32_t native_window_menu_count;
static uint32_t native_input_region_count;
uint32_t compositor_region_count;
uint32_t region_add_count;
uint32_t surface_input_region_count;
uint32_t pet_surface_input_region_count;
uint32_t pet_surface_null_region_count;
uint32_t region_rect_counts[MAX_OBJECTS];

static ConnectionState *find_connection(int fd);
static bool apply_pending_input_region(ConnectionState *state);

void wayland_resolve_symbols(void) {
  if (!real_sendmsg) real_sendmsg = (sendmsg_fn)dlvsym(RTLD_NEXT, "sendmsg", "GLIBC_2.2.5");
  if (!real_recvmsg) real_recvmsg = (recvmsg_fn)dlvsym(RTLD_NEXT, "recvmsg", "GLIBC_2.2.5");
  if (!real_close) real_close = (close_fn)dlvsym(RTLD_NEXT, "close", "GLIBC_2.2.5");
}

static ConnectionState *find_connection(int fd) {
  for (size_t index = 0; index < MAX_CONNECTIONS; index++) {
    if (connections[index].used && connections[index].fd == fd) return &connections[index];
  }
  return NULL;
}

static ConnectionState *create_connection(int fd, uint32_t registry_id) {
  for (size_t index = 0; index < MAX_CONNECTIONS; index++) {
    if (connections[index].used) continue;
    memset(&connections[index], 0, sizeof(connections[index]));
    connections[index].used = true;
    connections[index].fd = fd;
    connections[index].registry_id = registry_id;
    if (registry_id < MAX_OBJECTS) connections[index].object_types[registry_id] = OBJECT_REGISTRY;
    captured_connection_count++;
    return &connections[index];
  }
  return NULL;
}

static uint32_t detect_registry_id(const uint8_t *data, size_t length) {
  size_t offset = 0;
  while (offset + 8 <= length) {
    uint32_t object_id = read_uint32(data + offset);
    uint32_t size_opcode = read_uint32(data + offset + 4);
    uint32_t size = size_opcode >> 16;
    uint32_t opcode = size_opcode & 0xffff;
    if (size < 8 || size % 4 != 0 || offset + size > length) return 0;
    if (object_id == 1 && opcode == WL_DISPLAY_GET_REGISTRY && size == 12) {
      return read_uint32(data + offset + 8);
    }
    offset += size;
  }
  return 0;
}

static void set_bound_object_type(ConnectionState *state, const uint8_t *payload,
                                  size_t payload_length) {
  if (payload_length < 16) return;
  uint32_t string_length = read_uint32(payload + 4);
  uint32_t padded_length = (string_length + 3) & ~3u;
  if (!string_length || 12u + padded_length + 4u > payload_length) return;
  const char *interface_name = (const char *)(payload + 8);
  if (interface_name[string_length - 1] != '\0') return;
  uint32_t new_id = read_uint32(payload + 12 + padded_length);
  if (new_id >= MAX_OBJECTS) return;
  if (strcmp(interface_name, "wl_seat") == 0) {
    state->object_types[new_id] = OBJECT_SEAT;
  } else if (strcmp(interface_name, "wl_compositor") == 0) {
    state->object_types[new_id] = OBJECT_COMPOSITOR;
  } else if (strcmp(interface_name, "xdg_wm_base") == 0) {
    state->object_types[new_id] = OBJECT_XDG_WM_BASE;
  }
}

static void parse_outgoing_message(ConnectionState *state, const uint8_t *message, uint32_t size) {
  uint32_t object_id = read_uint32(message);
  uint32_t opcode = read_uint32(message + 4) & 0xffff;
  const uint8_t *payload = message + 8;
  size_t payload_length = size - 8;
  if (object_id >= MAX_OBJECTS) return;
  ObjectType object_type = state->object_types[object_id];
  if (object_type == OBJECT_REGISTRY && opcode == WL_REGISTRY_BIND) {
    set_bound_object_type(state, payload, payload_length);
  } else if (object_type == OBJECT_COMPOSITOR
             && opcode == WL_COMPOSITOR_CREATE_SURFACE && payload_length >= 4) {
    uint32_t surface_id = read_uint32(payload);
    if (surface_id < MAX_OBJECTS) state->object_types[surface_id] = OBJECT_SURFACE;
  } else if (object_type == OBJECT_COMPOSITOR
             && opcode == WL_COMPOSITOR_CREATE_REGION && payload_length >= 4) {
    uint32_t region_id = read_uint32(payload);
    if (region_id < MAX_OBJECTS) state->object_types[region_id] = OBJECT_REGION;
    compositor_region_count++;
  } else if (object_type == OBJECT_REGION && opcode == WL_REGION_ADD) {
    region_add_count++;
    if (object_id < MAX_OBJECTS) region_rect_counts[object_id]++;
  } else if (object_type == OBJECT_SURFACE && opcode == WL_SURFACE_SET_INPUT_REGION) {
    surface_input_region_count++;
    uint32_t region_id = payload_length >= 4 ? read_uint32(payload) : 0;
    uint32_t pet_surface_id = state->pet_toplevel_id
      ? state->related_objects[state->pet_toplevel_id] : 0;
    if (object_id == pet_surface_id) {
      pet_surface_input_region_count++;
      if (!region_id) pet_surface_null_region_count++;
      state->last_pet_region_id = region_id;
    }
  } else if (!bridge_shutting_down && object_type == OBJECT_REGION && opcode == WL_REGION_DESTROY) {
    if (object_id == state->last_pet_region_id) state->pending_input_region_id = object_id;
  } else if (object_type == OBJECT_SEAT && opcode == WL_SEAT_GET_POINTER && payload_length >= 4) {
    uint32_t pointer_id = read_uint32(payload);
    if (pointer_id < MAX_OBJECTS) {
      state->object_types[pointer_id] = OBJECT_POINTER;
      state->related_objects[pointer_id] = object_id;
      captured_pointer_count++;
    }
  } else if (object_type == OBJECT_XDG_WM_BASE
             && opcode == XDG_WM_BASE_GET_XDG_SURFACE && payload_length >= 8) {
    uint32_t xdg_surface_id = read_uint32(payload);
    if (xdg_surface_id < MAX_OBJECTS) {
      state->object_types[xdg_surface_id] = OBJECT_XDG_SURFACE;
      state->related_objects[xdg_surface_id] = read_uint32(payload + 4);
    }
  } else if (object_type == OBJECT_XDG_SURFACE
             && opcode == XDG_SURFACE_GET_TOPLEVEL && payload_length >= 4) {
    uint32_t toplevel_id = read_uint32(payload);
    if (toplevel_id < MAX_OBJECTS) {
      state->object_types[toplevel_id] = OBJECT_XDG_TOPLEVEL;
      state->related_objects[toplevel_id] = state->related_objects[object_id];
      if (!state->pet_toplevel_id) state->pet_toplevel_id = toplevel_id;
      captured_toplevel_count++;
    }
  }
}

static void parse_outgoing(ConnectionState *state) {
  size_t offset = 0;
  while (offset + 8 <= state->outgoing_length) {
    uint32_t size = read_uint32(state->outgoing + offset + 4) >> 16;
    if (size < 8 || size % 4 != 0) {
      state->outgoing_length = 0;
      return;
    }
    if (offset + size > state->outgoing_length) break;
    parse_outgoing_message(state, state->outgoing + offset, size);
    offset += size;
  }
  if (offset) {
    memmove(state->outgoing, state->outgoing + offset, state->outgoing_length - offset);
    state->outgoing_length -= offset;
  }
}

static uint32_t find_pet_toplevel(ConnectionState *state, uint32_t surface_id) {
  uint32_t toplevel_id = state->pet_toplevel_id;
  if (toplevel_id && toplevel_id < MAX_OBJECTS
      && state->related_objects[toplevel_id] == surface_id) return toplevel_id;
  return 0;
}

static bool show_native_window_menu(ConnectionState *state) {
  wayland_resolve_symbols();
  if (!real_sendmsg) return false;
  uint32_t toplevel_id = find_pet_toplevel(state, state->focused_surface_id);
  uint32_t pointer_id = state->active_pointer_id;
  if (!toplevel_id || pointer_id >= MAX_OBJECTS || !state->pressed_serial
      || !state->left_button_pressed) return false;
  uint32_t seat_id = state->related_objects[pointer_id];
  if (!seat_id) return false;
  uint32_t request[6] = {
    toplevel_id,
    (24u << 16) | XDG_TOPLEVEL_SHOW_WINDOW_MENU,
    seat_id,
    state->pressed_serial,
    (uint32_t)(state->pointer_x >> 8),
    (uint32_t)(state->pointer_y >> 8)
  };
  struct iovec iovec = { .iov_base = request, .iov_len = sizeof(request) };
  struct msghdr message = {0};
  message.msg_iov = &iovec;
  message.msg_iovlen = 1;
  ssize_t sent = real_sendmsg(state->fd, &message, MSG_DONTWAIT | MSG_NOSIGNAL);
  if (sent != (ssize_t)sizeof(request)) return false;
  state->pressed_serial = 0;
  state->move_armed = false;
  state->move_started = true;
  native_window_menu_count++;
  return true;
}

static void start_native_move(ConnectionState *state) {
  uint32_t toplevel_id = find_pet_toplevel(state, state->focused_surface_id);
  uint32_t pointer_id = state->active_pointer_id;
  if (!toplevel_id || pointer_id >= MAX_OBJECTS || !state->pressed_serial) return;
  uint32_t seat_id = state->related_objects[pointer_id];
  if (!seat_id) return;
  uint32_t request[4] = {
    toplevel_id,
    (16u << 16) | XDG_TOPLEVEL_MOVE,
    seat_id,
    state->pressed_serial
  };
  struct iovec iovec = { .iov_base = request, .iov_len = sizeof(request) };
  struct msghdr message = {0};
  message.msg_iov = &iovec;
  message.msg_iovlen = 1;
  ssize_t sent = real_sendmsg(state->fd, &message, MSG_DONTWAIT | MSG_NOSIGNAL);
  if (sent != (ssize_t)sizeof(request)) return;
  state->pressed_serial = 0;
  state->move_armed = false;
  state->move_started = true;
  native_move_count++;
}

static void parse_pointer_event(ConnectionState *state, uint32_t pointer_id,
                                uint32_t opcode, const uint8_t *payload,
                                size_t payload_length) {
  if (opcode == WL_POINTER_ENTER && payload_length >= 16) {
    state->focused_surface_id = read_uint32(payload + 4);
    state->pointer_x = (int32_t)read_uint32(payload + 8);
    state->pointer_y = (int32_t)read_uint32(payload + 12);
  } else if (opcode == WL_POINTER_LEAVE && payload_length >= 8) {
    if (state->focused_surface_id == read_uint32(payload + 4)) state->focused_surface_id = 0;
  } else if (opcode == WL_POINTER_MOTION && payload_length >= 12) {
    state->pointer_x = (int32_t)read_uint32(payload + 4);
    state->pointer_y = (int32_t)read_uint32(payload + 8);
    if (state->left_button_pressed && state->move_armed && !state->move_started
        && state->active_pointer_id == pointer_id) {
      int32_t delta_x = state->pointer_x - state->press_x;
      int32_t delta_y = state->pointer_y - state->press_y;
      if (delta_x >= 1024 || delta_x <= -1024 || delta_y >= 1024 || delta_y <= -1024) {
        start_native_move(state);
      }
    }
  } else if (opcode == WL_POINTER_BUTTON && payload_length >= 16) {
    uint32_t button = read_uint32(payload + 8);
    uint32_t button_state = read_uint32(payload + 12);
    if (button != BTN_LEFT) return;
    pointer_button_count++;
    if (button_state == WL_POINTER_BUTTON_PRESSED) {
      state->active_pointer_id = pointer_id;
      state->pressed_serial = read_uint32(payload);
      state->press_x = state->pointer_x;
      state->press_y = state->pointer_y;
      state->left_button_pressed = true;
      state->move_armed = false;
      state->move_started = false;
    } else if (button_state == WL_POINTER_BUTTON_RELEASED) {
      state->left_button_pressed = false;
      state->move_armed = false;
      state->pressed_serial = 0;
    }
  }
}

static void parse_incoming_message(ConnectionState *state, const uint8_t *message, uint32_t size) {
  uint32_t object_id = read_uint32(message);
  uint32_t opcode = read_uint32(message + 4) & 0xffff;
  const uint8_t *payload = message + 8;
  size_t payload_length = size - 8;
  if (object_id == 1 && opcode == WL_DISPLAY_DELETE_ID && payload_length >= 4) {
    uint32_t deleted_id = read_uint32(payload);
    if (deleted_id < MAX_OBJECTS) {
      state->object_types[deleted_id] = OBJECT_UNKNOWN;
      state->related_objects[deleted_id] = 0;
      region_rect_counts[deleted_id] = 0;
    }
    return;
  }
  if (object_id < MAX_OBJECTS && state->object_types[object_id] == OBJECT_POINTER) {
    parse_pointer_event(state, object_id, opcode, payload, payload_length);
  }
}

static void parse_incoming(ConnectionState *state) {
  size_t offset = 0;
  while (offset + 8 <= state->incoming_length) {
    uint32_t size = read_uint32(state->incoming + offset + 4) >> 16;
    if (size < 8 || size % 4 != 0) {
      state->incoming_length = 0;
      return;
    }
    if (offset + size > state->incoming_length) break;
    parse_incoming_message(state, state->incoming + offset, size);
    offset += size;
  }
  if (offset) {
    memmove(state->incoming, state->incoming + offset, state->incoming_length - offset);
    state->incoming_length -= offset;
  }
}

static bool capture_input_region_id(ConnectionState *state, uint32_t region_id) {
  uint32_t compositor_id = 0;
  for (uint32_t object_id = 1; object_id < MAX_OBJECTS; object_id++) {
    if (state->object_types[object_id] == OBJECT_COMPOSITOR) {
      compositor_id = object_id;
      break;
    }
  }
  if (!compositor_id || !region_id || !real_sendmsg) return false;
  uint32_t request[3] = {
    compositor_id,
    (12u << 16) | WL_COMPOSITOR_CREATE_REGION,
    region_id
  };
  struct iovec iovec = { .iov_base = request, .iov_len = sizeof(request) };
  struct msghdr message = {0};
  message.msg_iov = &iovec;
  message.msg_iovlen = 1;
  ssize_t sent = real_sendmsg(state->fd, &message, MSG_NOSIGNAL);
  if (sent != (ssize_t)sizeof(request)) return false;
  state->input_region_id = region_id;
  state->pending_input_region_id = 0;
  region_rect_counts[region_id] = 0;
  apply_pending_input_region(state);
  return true;
}

static size_t filter_incoming_delete_id(ConnectionState *state, uint8_t *bytes, size_t length) {
  if (bridge_shutting_down) return length;
  size_t read_offset = 0;
  size_t write_offset = 0;
  while (read_offset + 8 <= length) {
    uint32_t object_id = read_uint32(bytes + read_offset);
    uint32_t size_opcode = read_uint32(bytes + read_offset + 4);
    uint32_t size = size_opcode >> 16;
    uint32_t opcode = size_opcode & 0xffff;
    if (size < 8 || size % 4 != 0 || read_offset + size > length) break;
    bool remove = false;
    if (object_id == 1 && opcode == WL_DISPLAY_DELETE_ID && size >= 12) {
      uint32_t deleted_id = read_uint32(bytes + read_offset + 8);
      if (deleted_id == state->pending_input_region_id && !state->input_region_id) {
        remove = capture_input_region_id(state, deleted_id);
      } else if (deleted_id == state->pending_input_region_id) {
        state->pending_input_region_id = 0;
      }
    }
    if (!remove) {
      if (write_offset != read_offset) memmove(bytes + write_offset, bytes + read_offset, size);
      write_offset += size;
    }
    read_offset += size;
  }
  if (read_offset < length) {
    memmove(bytes + write_offset, bytes + read_offset, length - read_offset);
    write_offset += length - read_offset;
  }
  return write_offset;
}

ssize_t sendmsg(int fd, const struct msghdr *message, int flags) {
  wayland_resolve_symbols();
  if (!real_sendmsg) return -1;
  ssize_t result = real_sendmsg(fd, message, flags);
  if (result <= 0 || !message || !message->msg_iov) return result;
  pthread_mutex_lock(&state_mutex);
  ConnectionState *state = find_connection(fd);
  if (!state) {
    uint8_t header[64];
    size_t copied = copy_iovecs(message->msg_iov, message->msg_iovlen,
                                (size_t)result, header, sizeof(header));
    uint32_t registry_id = detect_registry_id(header, copied);
    if (registry_id) state = create_connection(fd, registry_id);
  }
  if (state) {
    append_iovecs(state->outgoing, &state->outgoing_length,
                  message->msg_iov, message->msg_iovlen, (size_t)result);
    parse_outgoing(state);
  }
  pthread_mutex_unlock(&state_mutex);
  return result;
}

ssize_t recvmsg(int fd, struct msghdr *message, int flags) {
  wayland_resolve_symbols();
  if (!real_recvmsg) return -1;
  ssize_t result = real_recvmsg(fd, message, flags);
  if (result <= 0 || !message || !message->msg_iov) return result;
  pthread_mutex_lock(&state_mutex);
  ConnectionState *state = find_connection(fd);
  if (state) {
    size_t copied = copy_iovecs(message->msg_iov, message->msg_iovlen,
                                (size_t)result, state->scratch, sizeof(state->scratch));
    copied = filter_incoming_delete_id(state, state->scratch, copied);
    write_iovecs(state->scratch, copied, message->msg_iov, message->msg_iovlen);
    append_bytes(state->incoming, &state->incoming_length, state->scratch, copied);
    parse_incoming(state);
    result = (ssize_t)copied;
  }
  pthread_mutex_unlock(&state_mutex);
  if (result == 0) {
    errno = EAGAIN;
    return -1;
  }
  return result;
}

int close(int fd) {
  wayland_resolve_symbols();
  pthread_mutex_lock(&state_mutex);
  ConnectionState *state = find_connection(fd);
  if (state) memset(state, 0, sizeof(*state));
  pthread_mutex_unlock(&state_mutex);
  return real_close ? real_close(fd) : -1;
}

static bool send_native_input_region(ConnectionState *state,
                                     const WaylandInputRect *rects, uint32_t rect_count) {
  uint32_t compositor_id = 0;
  for (uint32_t object_id = 1; object_id < MAX_OBJECTS; object_id++) {
    if (state->object_types[object_id] == OBJECT_COMPOSITOR) {
      compositor_id = object_id;
      break;
    }
  }
  uint32_t surface_id = state->pet_toplevel_id
    ? state->related_objects[state->pet_toplevel_id] : 0;
  if (!compositor_id || !surface_id || !rect_count) return false;

  uint32_t region_id = state->input_region_id;
  if (!region_id) return false;
  size_t word_count = 6 + (size_t)rect_count * 6 + 3;
  uint32_t *request = calloc(word_count, sizeof(*request));
  if (!request) return false;
  size_t word = 0;
  request[word++] = region_id;
  request[word++] = (24u << 16) | WL_REGION_SUBTRACT;
  request[word++] = 0;
  request[word++] = 0;
  request[word++] = 100000;
  request[word++] = 100000;
  for (uint32_t index = 0; index < rect_count; index++) {
    request[word++] = region_id;
    request[word++] = (24u << 16) | WL_REGION_ADD;
    request[word++] = (uint32_t)rects[index].x;
    request[word++] = (uint32_t)rects[index].y;
    request[word++] = (uint32_t)rects[index].width;
    request[word++] = (uint32_t)rects[index].height;
  }
  request[word++] = surface_id;
  request[word++] = (12u << 16) | WL_SURFACE_SET_INPUT_REGION;
  request[word++] = region_id;

  struct iovec iovec = { .iov_base = request, .iov_len = word * sizeof(*request) };
  struct msghdr message = {0};
  message.msg_iov = &iovec;
  message.msg_iovlen = 1;
  ssize_t sent = real_sendmsg(state->fd, &message, MSG_NOSIGNAL);
  free(request);
  if (sent != (ssize_t)iovec.iov_len) return false;
  native_input_region_count++;
  return true;
}

static bool apply_pending_input_region(ConnectionState *state) {
  if (!state->pending_rect_count) return false;
  if (!send_native_input_region(state, state->pending_rects, state->pending_rect_count)) return false;
  state->pending_rect_count = 0;
  return true;
}

bool wayland_bridge_set_input_region(const WaylandInputRect *rects, uint32_t rect_count) {
  if (bridge_shutting_down) return false;
  bool applied = false;
  bool queued = false;
  pthread_mutex_lock(&state_mutex);
  wayland_resolve_symbols();
  for (size_t connection_index = 0; connection_index < MAX_CONNECTIONS; connection_index++) {
    ConnectionState *state = &connections[connection_index];
    if (!state->used || !state->pet_toplevel_id) continue;
    if (real_sendmsg && send_native_input_region(state, rects, rect_count)) {
      state->pending_rect_count = 0;
      applied = true;
      break;
    }
    if (rect_count <= 4096) {
      memcpy(state->pending_rects, rects, rect_count * sizeof(*rects));
      state->pending_rect_count = rect_count;
      queued = true;
    }
  }
  pthread_mutex_unlock(&state_mutex);
  return applied || queued;
}

bool wayland_bridge_begin_move(void) {
  if (bridge_shutting_down) return false;
  bool armed = false;
  pthread_mutex_lock(&state_mutex);
  for (size_t index = 0; index < MAX_CONNECTIONS && !armed; index++) {
    ConnectionState *state = &connections[index];
    if (!state->used || !state->left_button_pressed || !state->pressed_serial) continue;
    if (!find_pet_toplevel(state, state->focused_surface_id)) continue;
    state->move_armed = true;
    armed = true;
  }
  pthread_mutex_unlock(&state_mutex);
  return armed;
}

bool wayland_bridge_request_window_menu(void) {
  if (bridge_shutting_down) return false;
  bool opened = false;
  pthread_mutex_lock(&state_mutex);
  for (size_t index = 0; index < MAX_CONNECTIONS && !opened; index++) {
    if (connections[index].used) opened = show_native_window_menu(&connections[index]);
  }
  pthread_mutex_unlock(&state_mutex);
  return opened;
}

void wayland_bridge_shutdown(void) {
  pthread_mutex_lock(&state_mutex);
  bridge_shutting_down = true;
  for (size_t index = 0; index < MAX_CONNECTIONS; index++) {
    ConnectionState *state = &connections[index];
    state->pending_rect_count = 0;
    state->pending_input_region_id = 0;
  }
  pthread_mutex_unlock(&state_mutex);
}

WaylandBridgeDebugState wayland_bridge_debug_state(void) {
  WaylandBridgeDebugState result;
  pthread_mutex_lock(&state_mutex);
  result.connections = captured_connection_count;
  result.pointers = captured_pointer_count;
  result.toplevels = captured_toplevel_count;
  result.pointer_buttons = pointer_button_count;
  result.native_moves = native_move_count;
  result.native_window_menus = native_window_menu_count;
  result.native_input_regions = native_input_region_count;
  result.compositor_regions = compositor_region_count;
  result.region_adds = region_add_count;
  result.surface_input_regions = surface_input_region_count;
  result.pet_surface_input_regions = pet_surface_input_region_count;
  result.pet_surface_null_regions = pet_surface_null_region_count;
  pthread_mutex_unlock(&state_mutex);
  return result;
}
