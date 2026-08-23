#include <string.h>

#include "include/wayland-bridge.h"

uint32_t wayland_read_uint32(const uint8_t *data) {
  uint32_t value;
  memcpy(&value, data, sizeof(value));
  return value;
}

size_t wayland_copy_iovecs(const struct iovec *iovecs, size_t iovec_count,
                           size_t byte_count, uint8_t *output, size_t capacity) {
  size_t copied = 0;
  for (size_t index = 0; index < iovec_count && copied < byte_count && copied < capacity; index++) {
    size_t available = iovecs[index].iov_len;
    if (available > byte_count - copied) available = byte_count - copied;
    if (available > capacity - copied) available = capacity - copied;
    memcpy(output + copied, iovecs[index].iov_base, available);
    copied += available;
  }
  return copied;
}

size_t wayland_write_iovecs(const uint8_t *data, size_t length,
                            struct iovec *iovecs, size_t iovec_count) {
  size_t written = 0;
  for (size_t index = 0; index < iovec_count && written < length; index++) {
    size_t available = iovecs[index].iov_len;
    if (available > length - written) available = length - written;
    memcpy(iovecs[index].iov_base, data + written, available);
    written += available;
  }
  return written;
}

void wayland_append_bytes(uint8_t *buffer, size_t *buffer_length, size_t capacity,
                          const uint8_t *data, size_t length) {
  if (length > capacity - *buffer_length) {
    *buffer_length = 0;
    if (length > capacity) return;
  }
  memcpy(buffer + *buffer_length, data, length);
  *buffer_length += length;
}

void wayland_append_iovecs(uint8_t *buffer, size_t *buffer_length, size_t capacity,
                           const struct iovec *iovecs, size_t iovec_count, size_t byte_count) {
  if (byte_count > capacity - *buffer_length) {
    *buffer_length = 0;
    if (byte_count > capacity) return;
  }
  *buffer_length += wayland_copy_iovecs(iovecs, iovec_count, byte_count,
                                        buffer + *buffer_length, capacity - *buffer_length);
}
