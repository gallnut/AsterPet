const fs = require("fs");
const os = require("os");
const path = require("path");
const { packager } = require("@electron/packager");

const platform = process.argv[2] || process.platform;
const arch = process.env.ASTERPET_ARCH || process.arch;
const electronVersion = require("electron/package.json").version;

function findCachedElectronZipDirectory() {
  if (process.env.ASTERPET_ELECTRON_ZIP_DIR) return process.env.ASTERPET_ELECTRON_ZIP_DIR;
  const cacheRoot = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "electron");
  const archiveName = `electron-v${electronVersion}-${platform}-${arch}.zip`;
  try {
    for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const directory = path.join(cacheRoot, entry.name);
      if (fs.existsSync(path.join(directory, archiveName))) return directory;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return undefined;
}

const electronZipDir = findCachedElectronZipDirectory();

packager({
  dir: path.join(__dirname, ".."),
  name: "AsterPet",
  platform,
  arch,
  ...(electronZipDir ? { electronZipDir } : {}),
  ...(platform === "darwin" ? {
    appBundleId: "com.asterpet.desktop",
    appCategoryType: "public.app-category.entertainment"
  } : {}),
  out: path.join(__dirname, "..", "dist"),
  tmpdir: false,
  overwrite: true,
  asar: true,
  prune: true,
  afterExtract: [async ({ buildPath }) => {
    const defaultAppAsar = path.join(buildPath, "resources", "default_app.asar");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await require("fs").promises.unlink(defaultAppAsar);
        break;
      } catch (error) {
        if (error.code === "ENOENT") break;
        if (error.code !== "EBUSY" || attempt === 19) throw error;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }],
  ignore: [
    /^\/assets(?:\/|$)/,
    /^\/content(?:\/|$)/,
    /^\/build(?:\/|$)/,
    /^\/dist(?:\/|$)/,
    /^\/packaging(?:\/|$)/,
    /^\/resources\/scenes\/(?!layer-rules\.json$)/,
    /^\/\.cg-test-/,
    /^\/\.test-user-data(?:\/|$)/,
    /^\/\.package-test-cache(?:\/|$)/,
    /^\/\.packager-tmp(?:\/|$)/,
    /^\/local-packages(?:\/|$)/,
    /^\/startup\.log$/,
    /^\/test-.*\.png$/,
    /^\/node\.cmd$/
  ]
}).then(paths => {
  const projectRoot = path.join(__dirname, "..");
  for (const output of paths) {
    fs.cpSync(path.join(projectRoot, "licenses"), path.join(output, "licenses"), { recursive: true });
    for (const name of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
      fs.copyFileSync(path.join(projectRoot, name), path.join(output, name));
    }
    if (platform === "linux") {
      const bridgeName = "wayland-drag-bridge.node";
      const bridgeLibraryName = "wayland-interpose.so";
      const fontconfigDirectory = path.join(output, "fontconfig");
      const bridgePath = path.join(output, bridgeName);
      const bridgeLibraryPath = path.join(output, bridgeLibraryName);
      const binaryPath = path.join(output, "AsterPet.bin");
      const launcherPath = path.join(output, "AsterPet");
      fs.copyFileSync(path.join(projectRoot, "build", "native", bridgeName), bridgePath);
      fs.copyFileSync(path.join(projectRoot, "build", "native", bridgeLibraryName), bridgeLibraryPath);
      fs.mkdirSync(fontconfigDirectory, { recursive: true });
      fs.copyFileSync(path.join(projectRoot, "resources", "fontconfig", "fonts.conf"), path.join(fontconfigDirectory, "fonts.conf"));
      fs.renameSync(launcherPath, binaryPath);
      fs.writeFileSync(launcherPath, `#!/bin/sh
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export ASTERPET_WAYLAND_BRIDGE="$APP_DIR/${bridgeName}"
export LD_PRELOAD="$APP_DIR/${bridgeLibraryName}\${LD_PRELOAD:+:$LD_PRELOAD}"
FONTCONFIG_CACHE_HOME="\${XDG_CACHE_HOME:-$HOME/.cache}/asterpet"
FONTCONFIG_ROOT="$FONTCONFIG_CACHE_HOME/fontconfig-root"
mkdir -p "$FONTCONFIG_ROOT/etc/fonts" "$FONTCONFIG_ROOT/usr/share" "$FONTCONFIG_ROOT/usr/local/share" "$FONTCONFIG_ROOT/var/cache"
cp "$APP_DIR/fontconfig/fonts.conf" "$FONTCONFIG_ROOT/etc/fonts/fonts.conf"
ln -sfn /usr/share/fonts "$FONTCONFIG_ROOT/usr/share/fonts"
ln -sfn /usr/local/share/fonts "$FONTCONFIG_ROOT/usr/local/share/fonts"
ln -sfn /home "$FONTCONFIG_ROOT/home"
ln -sfn /var/cache/fontconfig "$FONTCONFIG_ROOT/var/cache/fontconfig"
export FONTCONFIG_SYSROOT="$FONTCONFIG_ROOT"
export FONTCONFIG_FILE=/etc/fonts/fonts.conf
export FONTCONFIG_PATH=/etc/fonts
if [ -z "$ELECTRON_OZONE_PLATFORM_HINT" ]; then
  if [ "$XDG_SESSION_TYPE" = "wayland" ] && [ -n "$WAYLAND_DISPLAY" ]; then
    export ELECTRON_OZONE_PLATFORM_HINT=wayland
  else
    export ELECTRON_OZONE_PLATFORM_HINT=x11
  fi
fi
exec "$APP_DIR/AsterPet.bin" "$@"
`);
      fs.chmodSync(launcherPath, 0o755);
    }
    process.stdout.write(`${output}\n`);
  }
}).catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
