#ifndef ASTERPET_WAYLAND_BRIDGE_H
#define ASTERPET_WAYLAND_BRIDGE_H

#include <stdbool.h>
#include <stdint.h>
#include <sys/uio.h>

typedef struct {
  int32_t x;
  int32_t y;
  int32_t width;
  int32_t height;
} WaylandInputRect;

typedef struct {
  uint32_t connections;
  uint32_t pointers;
  uint32_t toplevels;
  uint32_t pointer_buttons;
  uint32_t native_moves;
  uint32_t native_window_menus;
  uint32_t native_input_regions;
  uint32_t compositor_regions;
  uint32_t region_adds;
  uint32_t surface_input_regions;
  uint32_t pet_surface_input_regions;
  uint32_t pet_surface_null_regions;
} WaylandBridgeDebugState;

uint32_t wayland_read_uint32(const uint8_t *data);
size_t wayland_copy_iovecs(const struct iovec *iovecs, size_t iovec_count,
                           size_t byte_count, uint8_t *output, size_t capacity);
size_t wayland_write_iovecs(const uint8_t *data, size_t length,
                            struct iovec *iovecs, size_t iovec_count);
void wayland_append_bytes(uint8_t *buffer, size_t *buffer_length, size_t capacity,
                          const uint8_t *data, size_t length);
void wayland_append_iovecs(uint8_t *buffer, size_t *buffer_length, size_t capacity,
                           const struct iovec *iovecs, size_t iovec_count, size_t byte_count);
bool wayland_bridge_set_input_region(const WaylandInputRect *rects, uint32_t rect_count);
void wayland_bridge_shutdown(void);
bool wayland_bridge_begin_move(void);
bool wayland_bridge_request_window_menu(void);
WaylandBridgeDebugState wayland_bridge_debug_state(void);

#define read_uint32 wayland_read_uint32
#define copy_iovecs wayland_copy_iovecs
#define write_iovecs wayland_write_iovecs
#define append_bytes(buffer, length, data, count) wayland_append_bytes(buffer, length, BUFFER_CAPACITY, data, count)
#define append_iovecs(buffer, length, iovecs, count, bytes) wayland_append_iovecs(buffer, length, BUFFER_CAPACITY, iovecs, count, bytes)

#endif
