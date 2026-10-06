#include <node_api.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include <X11/Xlib.h>
#include <X11/extensions/shape.h>

static Display *display;
static Display *workspace_display;
static uv_poll_t workspace_poll;
static bool workspace_watching;
static napi_env workspace_env;
static napi_ref workspace_callback;
static napi_async_context workspace_context;
static Atom desktop_atom;
static napi_value result(napi_env env, bool applied);

static void workspace_events(uv_poll_t *poll, int status, int events) {
  (void)poll;
  if (status < 0 || !(events & UV_READABLE) || !workspace_display) return;
  bool changed = false;
  while (XPending(workspace_display)) {
    XEvent event;
    XNextEvent(workspace_display, &event);
    if (event.type == PropertyNotify && event.xproperty.atom == desktop_atom) changed = true;
  }
  if (!changed || !workspace_callback) return;
  napi_handle_scope scope;
  if (napi_open_handle_scope(workspace_env, &scope) != napi_ok) return;
  napi_value callback, receiver, ignored;
  napi_get_reference_value(workspace_env, workspace_callback, &callback);
  napi_get_global(workspace_env, &receiver);
  napi_make_callback(workspace_env, workspace_context, receiver, callback, 0, NULL, &ignored);
  napi_close_handle_scope(workspace_env, scope);
}

static napi_value watch_workspace_changes(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value callback, resource, name;
  napi_valuetype type;
  napi_get_cb_info(env, info, &count, &callback, NULL, NULL);
  if (count != 1 || napi_typeof(env, callback, &type) != napi_ok || type != napi_function
      || workspace_watching) return result(env, false);
  if (!workspace_display) workspace_display = XOpenDisplay(NULL);
  if (!workspace_display) return result(env, false);
  uv_loop_t *loop;
  if (napi_get_uv_event_loop(env, &loop) != napi_ok) return result(env, false);
  desktop_atom = XInternAtom(workspace_display, "_NET_CURRENT_DESKTOP", False);
  XSelectInput(workspace_display, DefaultRootWindow(workspace_display), PropertyChangeMask);
  XFlush(workspace_display);
  if (uv_poll_init(loop, &workspace_poll, ConnectionNumber(workspace_display)) < 0) return result(env, false);
  workspace_env = env;
  napi_create_reference(env, callback, 1, &workspace_callback);
  napi_create_object(env, &resource);
  napi_create_string_utf8(env, "AsterPet workspace visibility", NAPI_AUTO_LENGTH, &name);
  napi_async_init(env, resource, name, &workspace_context);
  if (uv_poll_start(&workspace_poll, UV_READABLE, workspace_events) < 0) {
    uv_close((uv_handle_t *)&workspace_poll, NULL);
    napi_delete_reference(env, workspace_callback); workspace_callback = NULL;
    napi_async_destroy(env, workspace_context); workspace_context = NULL;
    return result(env, false);
  }
  uv_unref((uv_handle_t *)&workspace_poll);
  workspace_watching = true;
  return result(env, true);
}

static napi_value result(napi_env env, bool applied) {
  napi_value value;
  napi_get_boolean(env, applied, &value);
  return value;
}

static bool integer(napi_env env, napi_value object, const char *name, int32_t *value) {
  napi_value property;
  return napi_get_named_property(env, object, name, &property) == napi_ok
    && napi_get_value_int32(env, property, value) == napi_ok;
}

static napi_value set_input_region(napi_env env, napi_callback_info info) {
  size_t count = 2, handle_length;
  napi_value args[2];
  void *handle;
  bool is_array = false;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  if (count != 2 || napi_get_buffer_info(env, args[0], &handle, &handle_length) != napi_ok
      || handle_length < sizeof(uint32_t) || napi_is_array(env, args[1], &is_array) != napi_ok || !is_array) return result(env, false);
  uint32_t xid;
  memcpy(&xid, handle, sizeof(xid));
  if (!xid) return result(env, false);
  if (!display) {
    display = XOpenDisplay(NULL);
    int event, error, major, minor;
    if (!display) return result(env, false);
    if (!XShapeQueryExtension(display, &event, &error)
        || !XShapeQueryVersion(display, &major, &minor) || major < 1 || (major == 1 && minor < 1)) {
      XCloseDisplay(display); display = NULL;
      return result(env, false);
    }
  }
  uint32_t length = 0;
  napi_get_array_length(env, args[1], &length);
  if (length > 4096) return result(env, false);
  XRectangle *rects = calloc(length ? length : 1, sizeof(*rects));
  if (!rects) return result(env, false);
  int used = 0;
  for (uint32_t index = 0; index < length; index++) {
    napi_value item;
    int32_t x, y, width, height;
    if (napi_get_element(env, args[1], index, &item) != napi_ok
        || !integer(env, item, "x", &x) || !integer(env, item, "y", &y)
        || !integer(env, item, "width", &width) || !integer(env, item, "height", &height)
        || x < 0 || y < 0 || x > INT16_MAX || y > INT16_MAX
        || width <= 0 || height <= 0 || width > UINT16_MAX || height > UINT16_MAX) continue;
    rects[used++] = (XRectangle){x, y, width, height};
  }
  // ShapeInput affects hit testing only; the visual window is never clipped.
  XShapeCombineRectangles(display, xid, ShapeInput, 0, 0, rects, used, ShapeSet, Unsorted);
  XFlush(display);
  free(rects);
  return result(env, true);
}

static void cleanup(void *unused) {
  (void)unused;
  if (display) XCloseDisplay(display);
  display = NULL;
  if (workspace_watching) {
    uv_poll_stop(&workspace_poll);
    uv_close((uv_handle_t *)&workspace_poll, NULL);
    workspace_watching = false;
  }
  if (workspace_display) XCloseDisplay(workspace_display);
  workspace_display = NULL;
  if (workspace_callback) napi_delete_reference(workspace_env, workspace_callback);
  if (workspace_context) napi_async_destroy(workspace_env, workspace_context);
  workspace_callback = NULL; workspace_context = NULL;
}

NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "setInputRegion", NAPI_AUTO_LENGTH, set_input_region, NULL, &function);
  napi_set_named_property(env, exports, "setInputRegion", function);
  napi_create_function(env, "watchWorkspaceChanges", NAPI_AUTO_LENGTH, watch_workspace_changes, NULL, &function);
  napi_set_named_property(env, exports, "watchWorkspaceChanges", function);
  napi_add_env_cleanup_hook(env, cleanup, NULL);
  return exports;
}
