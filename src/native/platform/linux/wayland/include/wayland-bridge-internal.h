#ifndef ASTERPET_WAYLAND_BRIDGE_INTERNAL_H
#define ASTERPET_WAYLAND_BRIDGE_INTERNAL_H

#include <stdbool.h>
#include <stdint.h>
#include <sys/socket.h>

#define MAX_CONNECTIONS 8
#define MAX_OBJECTS 4096
#define BUFFER_CAPACITY 65536
#define WL_DISPLAY_GET_REGISTRY 1
#define WL_DISPLAY_DELETE_ID 1
#define WL_REGISTRY_BIND 0
#define WL_SEAT_GET_POINTER 0
#define XDG_WM_BASE_GET_XDG_SURFACE 2
#define XDG_SURFACE_GET_TOPLEVEL 1
#define XDG_TOPLEVEL_SHOW_WINDOW_MENU 4
#define XDG_TOPLEVEL_MOVE 5
#define WL_POINTER_ENTER 0
#define WL_POINTER_LEAVE 1
#define WL_POINTER_MOTION 2
#define WL_POINTER_BUTTON 3
#define WL_POINTER_BUTTON_RELEASED 0
#define WL_POINTER_BUTTON_PRESSED 1

typedef ssize_t (*sendmsg_fn)(int, const struct msghdr *, int);
typedef ssize_t (*recvmsg_fn)(int, struct msghdr *, int);
typedef int (*close_fn)(int);

typedef enum {
  OBJECT_UNKNOWN,
  OBJECT_REGISTRY,
  OBJECT_COMPOSITOR,
  OBJECT_SURFACE,
  OBJECT_REGION,
  OBJECT_SEAT,
  OBJECT_POINTER,
  OBJECT_XDG_WM_BASE,
  OBJECT_XDG_SURFACE,
  OBJECT_XDG_TOPLEVEL
} ObjectType;

typedef struct {
  bool used;
  int fd;
  uint32_t registry_id;
  uint8_t object_types[MAX_OBJECTS];
  uint32_t related_objects[MAX_OBJECTS];
  uint32_t pet_toplevel_id;
  uint32_t focused_surface_id;
  uint32_t active_pointer_id;
  uint32_t pressed_serial;
  int32_t pointer_x;
  int32_t pointer_y;
  int32_t press_x;
  int32_t press_y;
  bool left_button_pressed;
  bool move_armed;
  bool move_started;
  uint32_t input_region_id;
  uint32_t last_pet_region_id;
  uint32_t pending_input_region_id;
  WaylandInputRect pending_rects[4096];
  uint32_t pending_rect_count;
  uint8_t incoming[BUFFER_CAPACITY];
  size_t incoming_length;
  uint8_t outgoing[BUFFER_CAPACITY];
  size_t outgoing_length;
  uint8_t scratch[BUFFER_CAPACITY];
} ConnectionState;

extern sendmsg_fn real_sendmsg;
extern uint32_t captured_connection_count;
extern uint32_t captured_pointer_count;
extern uint32_t captured_toplevel_count;
extern uint32_t pointer_button_count;
extern uint32_t native_move_count;
extern uint32_t native_window_menu_count;
extern uint32_t compositor_region_count;
extern uint32_t region_add_count;
extern uint32_t surface_input_region_count;
extern uint32_t pet_surface_input_region_count;
extern uint32_t pet_surface_null_region_count;
extern uint32_t region_rect_counts[MAX_OBJECTS];

void wayland_resolve_symbols(void);
uint32_t wayland_protocol_detect_registry_id(const uint8_t *data, size_t length);
void wayland_protocol_parse_outgoing(ConnectionState *state);
void wayland_protocol_parse_incoming(ConnectionState *state);
size_t wayland_protocol_filter_delete_id(ConnectionState *state, uint8_t *bytes, size_t length);
uint32_t wayland_protocol_find_pet_toplevel(ConnectionState *state, uint32_t surface_id);
bool wayland_protocol_show_window_menu(ConnectionState *state);

#endif
