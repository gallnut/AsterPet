# Native Wayland platform package

- `wayland-interpose.c`: socket interception, protocol state and native Wayland requests.
- `wayland-buffer.c`: bounded byte/iovec utilities.
- `addon.c`: N-API boundary only.
- `include/wayland-bridge.h`: stable contract shared by the protocol core and addon.
- `include/wayland-bridge-internal.h`: internal protocol state and inter-module contract.

Desktop-environment policy stays in `src/main/platform`; this package only implements Wayland protocol capabilities.
