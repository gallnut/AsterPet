const fs = require("node:fs");
const path = require("node:path");

function replaceSymlink(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  try {
    const currentTarget = fs.readlinkSync(linkPath);
    if (currentTarget === target) return;
    fs.unlinkSync(linkPath);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "EINVAL") throw error;
    if (error.code === "EINVAL") fs.rmSync(linkPath, { recursive: true, force: true });
  }
  fs.symlinkSync(target, linkPath);
}

function prepareFontconfigRuntime({ root, configSource }) {
  const configDirectory = path.join(root, "etc", "fonts");
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.copyFileSync(configSource, path.join(configDirectory, "fonts.conf"));
  replaceSymlink("/usr/share/fonts", path.join(root, "usr", "share", "fonts"));
  replaceSymlink("/usr/local/share/fonts", path.join(root, "usr", "local", "share", "fonts"));
  replaceSymlink("/home", path.join(root, "home"));
  replaceSymlink("/var/cache/fontconfig", path.join(root, "var", "cache", "fontconfig"));
  return {
    FONTCONFIG_SYSROOT: root,
    FONTCONFIG_FILE: "/etc/fonts/fonts.conf",
    FONTCONFIG_PATH: "/etc/fonts"
  };
}

module.exports = { prepareFontconfigRuntime };
