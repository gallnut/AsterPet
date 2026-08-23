#include <node_api.h>
#include <stdlib.h>

#include "include/wayland-bridge.h"

static bool get_int32_property(napi_env env, napi_value object, const char *name, int32_t *value) {
  napi_value property;
  if (napi_get_named_property(env, object, name, &property) != napi_ok) return false;
  return napi_get_value_int32(env, property, value) == napi_ok;
}

static napi_value boolean_result(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value set_input_region(napi_env env, napi_callback_info info) {
  size_t argument_count = 1;
  napi_value arguments[1];
  napi_get_cb_info(env, info, &argument_count, arguments, NULL, NULL);
  bool is_array = false;
  if (argument_count != 1 || napi_is_array(env, arguments[0], &is_array) != napi_ok || !is_array) {
    return boolean_result(env, false);
  }
  uint32_t length = 0;
  napi_get_array_length(env, arguments[0], &length);
  if (length > 4096) length = 4096;
  WaylandInputRect *rects = calloc(length, sizeof(*rects));
  if (!rects) return boolean_result(env, false);
  uint32_t rect_count = 0;
  for (uint32_t index = 0; index < length; index++) {
    napi_value item;
    if (napi_get_element(env, arguments[0], index, &item) != napi_ok) continue;
    WaylandInputRect rect;
    if (!get_int32_property(env, item, "x", &rect.x)
        || !get_int32_property(env, item, "y", &rect.y)
        || !get_int32_property(env, item, "width", &rect.width)
        || !get_int32_property(env, item, "height", &rect.height)
        || rect.width <= 0 || rect.height <= 0) continue;
    rects[rect_count++] = rect;
  }
  const bool applied = wayland_bridge_set_input_region(rects, rect_count);
  free(rects);
  return boolean_result(env, applied);
}

static napi_value begin_move(napi_env env, napi_callback_info info) {
  (void)info;
  return boolean_result(env, wayland_bridge_begin_move());
}

static napi_value request_window_menu(napi_env env, napi_callback_info info) {
  (void)info;
  return boolean_result(env, wayland_bridge_request_window_menu());
}

static void set_uint32_property(napi_env env, napi_value object, const char *name, uint32_t value) {
  napi_value property;
  napi_create_uint32(env, value, &property);
  napi_set_named_property(env, object, name, property);
}

static napi_value debug_state(napi_env env, napi_callback_info info) {
  (void)info;
  const WaylandBridgeDebugState state = wayland_bridge_debug_state();
  napi_value result;
  napi_create_object(env, &result);
  set_uint32_property(env, result, "connections", state.connections);
  set_uint32_property(env, result, "pointers", state.pointers);
  set_uint32_property(env, result, "toplevels", state.toplevels);
  set_uint32_property(env, result, "pointerButtons", state.pointer_buttons);
  set_uint32_property(env, result, "nativeMoves", state.native_moves);
  set_uint32_property(env, result, "nativeWindowMenus", state.native_window_menus);
  set_uint32_property(env, result, "nativeInputRegions", state.native_input_regions);
  set_uint32_property(env, result, "compositorRegions", state.compositor_regions);
  set_uint32_property(env, result, "regionAdds", state.region_adds);
  set_uint32_property(env, result, "surfaceInputRegions", state.surface_input_regions);
  set_uint32_property(env, result, "petSurfaceInputRegions", state.pet_surface_input_regions);
  set_uint32_property(env, result, "petSurfaceNullRegions", state.pet_surface_null_regions);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "beginMove", NAPI_AUTO_LENGTH, begin_move, NULL, &function);
  napi_set_named_property(env, exports, "beginMove", function);
  napi_create_function(env, "requestWindowMenu", NAPI_AUTO_LENGTH, request_window_menu, NULL, &function);
  napi_set_named_property(env, exports, "requestWindowMenu", function);
  napi_create_function(env, "setInputRegion", NAPI_AUTO_LENGTH, set_input_region, NULL, &function);
  napi_set_named_property(env, exports, "setInputRegion", function);
  napi_create_function(env, "debugState", NAPI_AUTO_LENGTH, debug_state, NULL, &function);
  napi_set_named_property(env, exports, "debugState", function);
  return exports;
}
