const assert = require('node:assert/strict');
const { detectDesktopEnvironment } = require('../src/main/platform/detect-environment');
const { configurePlatform } = require('../src/main/platform');
const { WindowManager } = require('../src/main/window-manager');
const gnome = { XDG_CURRENT_DESKTOP: 'GNOME', XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' };
assert.equal(detectDesktopEnvironment(gnome, 'linux').displayProtocol, 'x11');
assert.equal(detectDesktopEnvironment({ ...gnome, ELECTRON_OZONE_PLATFORM_HINT: 'wayland' }, 'linux').displayProtocol, 'wayland');
assert.equal(detectDesktopEnvironment({ ...gnome, DISPLAY: '' }, 'linux').displayProtocol, 'wayland');
assert.equal(detectDesktopEnvironment({ ...gnome, XDG_CURRENT_DESKTOP: 'KDE' }, 'linux').displayProtocol, 'wayland');
if (process.platform === 'linux') {
  const switches = new Map();
  const environment = { ...gnome };
  const app = { commandLine: { getSwitchValue: name => switches.get(name) || '', appendSwitch: (name, value) => switches.set(name, value) } };
  const configured = configurePlatform(app, process.cwd(), environment);
  assert.equal(configured.nativeWayland, false);
  assert.equal(switches.get('ozone-platform'), 'x11');
  assert.equal(environment.ELECTRON_OZONE_PLATFORM_HINT, 'x11');
}
let bounds = { x: 200, y: 100, width: 600, height: 800 };
const manager = new WindowManager({ nativeWayland: false, log() {}, screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 24, width: 1920, height: 1056 } }] } });
manager.petWindow = { getBounds: () => bounds, setBounds: value => { bounds = value; } };
manager.startDrag({ x: 300, y: 400 });
manager.moveDrag({ x: 300, y: 100 });
assert.equal(bounds.y, -200, 'moving the real window above the screen must retain its negative coordinate');
manager.moveDrag({ x: 300, y: -1000 });
assert.equal(bounds.y, 24 - 800 + 48, 'keep a small retrievable strip when dragging far offscreen');
manager.endDrag();
if (process.platform === 'linux') {
  let input;
  manager.x11Bridge = { setInputRegion: (handle, rects) => { input = { handle, rects }; return true; } };
  const handle = Buffer.from([1, 0, 0, 0]);
  manager.petWindow.getNativeWindowHandle = () => handle;
  manager.petWindow.getContentBounds = () => ({ width: 600, height: 800 });
  manager.petWindow.setIgnoreMouseEvents = () => { throw Error('Linux must not disable the entire window when the pointer leaves'); };
  manager.petWindow.setShape = () => { throw Error('X11 input regions must not clip the visual window'); };
  manager.setMousePassthrough(true);
  manager.setMousePassthrough(false);
  const pet = { x: 200, y: 100, width: 60, height: 80 };
  const toolbar = { x: 20, y: 700, width: 500, height: 80 };
  manager.setInputShape({ petRects: [pet], controlRects: [toolbar], rects: [pet, toolbar] });
  assert.equal(input.handle, handle);
  assert.deepEqual(input.rects, [pet, toolbar], 'native input region must include both the pet and toolbar');
}
console.log('Window backend and offscreen drag checks passed');
{
  let toolsBounds = { x: 670, y: 378, width: 580, height: 896 };
  const tools = new WindowManager({ nativeWayland: false, log() {}, screen: {} });
  tools.petContentWidth = 580;
  tools.petContentHeight = 896;
  tools.petWindow = { getBounds: () => toolsBounds, setBounds: value => { toolsBounds = value; }, isDestroyed: () => false };
  tools.positionStatusWindow = () => {};
  tools.syncEmbeddedStatusWindow = () => {};
  tools.setToolbarVisible(true);
  assert.deepEqual(toolsBounds, { x: 350, y: 378, width: 900, height: 1018 }, 'tools must reserve space outside the pet pane while retaining its desktop origin');
  tools.setToolbarVisible(false);
  assert.deepEqual(toolsBounds, { x: 670, y: 378, width: 580, height: 896 }, 'closing tools must restore the original pet window');
  for (let i = 0; i < 3; i++) { tools.setToolbarVisible(true); tools.setToolbarVisible(false); }
  assert.deepEqual(toolsBounds, { x: 670, y: 378, width: 580, height: 896 }, 'tool toggling must not accumulate position drift');
  tools.setToolbarVisible(true);
  tools.resizePet({ baseWidth: 580, baseHeight: 896, scale: 1.5 });
  assert.deepEqual(toolsBounds, { x: 205, y: -70, width: 1190, height: 1466 }, 'resizing must center the pet pane and preserve its bottom while retaining utility space');
  const waylandTools = new WindowManager({ nativeWayland: true, log() {}, screen: {} });
  waylandTools.petWindow = { getBounds: () => { throw Error('Wayland tools must use the embedded layout'); } };
  waylandTools.syncEmbeddedStatusWindow = () => {};
  waylandTools.setToolbarVisible(true);
}
console.log('Utility reserve and pet pane position checks passed');

{
  const events = [];
  const window = (name, { minimized = false, visible = true } = {}) => ({
    isDestroyed: () => false, isMinimized: () => minimized, isVisible: () => visible,
    restore() { minimized = false; events.push(`${name}:restore`); },
    hide() { visible = false; events.push(`${name}:hide`); },
    showInactive() { visible = true; events.push(`${name}:show`); },
    setVisibleOnAllWorkspaces(value) { assert.equal(value, true); },
    moveTop() { events.push(`${name}:raise`); }, focus() { events.push(`${name}:focus`); },
    webContents: { invalidate() {} }
  });
  const windows = new WindowManager({ nativeWayland: false, screen: {}, log() {} });
  windows.petWindow = window('pet'); windows.statusWindow = window('status', { visible: false });
  windows.popoverWindow = window('popover', { minimized: true });
  windows.positionStatusWindow = () => {};
  windows.refreshVisibleWindows();
  assert.ok(events.includes('pet:show'));
  assert.ok(!events.some(e => /status|popover|focus/.test(e)), 'workspace refresh does not unhide auxiliary windows, restore minimization or steal focus');
  events.length = 0;
  windows.petWindow = window('pet', { minimized: true });
  windows.refreshVisibleWindows(); assert.deepEqual(events, [], 'intentional minimization is preserved');
  windows.showPet();
  assert.ok(events.indexOf('pet:restore') < events.indexOf('pet:show'));
  assert.ok(events.includes('pet:focus'), 'explicit recall restores and focuses the existing instance');
}
console.log('Workspace visibility and explicit recall checks passed');
