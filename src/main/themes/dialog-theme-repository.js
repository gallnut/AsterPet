const fs = require("node:fs");
const path = require("node:path");
const extract = require("extract-zip");
const { validateDialogTheme } = require("./dialog-theme-schema");

class DialogThemeRepository {
  constructor({ projectRoot, asterPetHome, log }) {
    this.builtInRoot = path.join(projectRoot, "resources", "dialog-themes");
    this.userRoot = path.join(asterPetHome, "dialog-themes");
    this.log = log;
  }

  readTheme(manifestPath, source) {
    try {
      return { ...validateDialogTheme(JSON.parse(fs.readFileSync(manifestPath, "utf8"))), source };
    } catch (error) {
      this.log(`Unable to load dialog theme ${manifestPath}: ${error.message}`);
      return undefined;
    }
  }

  scan(root, source) {
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => this.readTheme(path.join(root, entry.name, "theme.json"), source))
        .filter(Boolean);
    } catch (error) {
      if (error.code !== "ENOENT") this.log(`Unable to scan dialog themes: ${error.message}`);
      return [];
    }
  }

  list() {
    const themes = new Map();
    for (const theme of this.scan(this.builtInRoot, "built-in")) themes.set(theme.id, theme);
    for (const theme of this.scan(this.userRoot, "user")) themes.set(theme.id, theme);
    return [...themes.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  get(id) {
    return this.list().find(theme => theme.id === id);
  }

  async importArchive(archivePath) {
    fs.mkdirSync(this.userRoot, { recursive: true });
    const stagingRoot = fs.mkdtempSync(path.join(this.userRoot, ".import-"));
    try {
      await extract(archivePath, { dir: stagingRoot });
      const manifests = [];
      const visit = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) visit(target);
          else if (entry.isFile() && entry.name === "theme.json") manifests.push(target);
        }
      };
      visit(stagingRoot);
      if (manifests.length !== 1) throw new Error("主题包必须且只能包含一个 theme.json");
      const theme = validateDialogTheme(JSON.parse(fs.readFileSync(manifests[0], "utf8")));
      const sourceDirectory = path.dirname(manifests[0]);
      const destination = path.join(this.userRoot, theme.id);
      const replacement = `${destination}.installing-${process.pid}`;
      fs.rmSync(replacement, { recursive: true, force: true });
      fs.cpSync(sourceDirectory, replacement, { recursive: true });
      fs.rmSync(destination, { recursive: true, force: true });
      fs.renameSync(replacement, destination);
      return { ...theme, source: "user" };
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

module.exports = { DialogThemeRepository };
