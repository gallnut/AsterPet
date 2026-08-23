class DialogThemeService {
  constructor({ repository, settings, log, onChanged }) {
    this.repository = repository;
    this.settings = settings;
    this.log = log;
    this.onChanged = onChanged;
    const preferred = settings.read().dialogThemeId || "aster-dark";
    this.current = repository.get(preferred) || repository.list()[0];
    if (!this.current) throw new Error("No valid dialog theme is installed");
  }

  getState() {
    return { currentId: this.current.id, current: this.current, themes: this.repository.list() };
  }

  select(id) {
    const theme = this.repository.get(id);
    if (!theme) return { ok: false, error: `未找到对话皮肤：${id}` };
    this.current = theme;
    this.settings.update({ dialogThemeId: id });
    this.onChanged(theme);
    return { ok: true, theme };
  }

  async import(archivePath) {
    try {
      const theme = await this.repository.importArchive(archivePath);
      this.log(`Dialog theme imported: ${theme.id}`);
      return this.select(theme.id);
    } catch (error) {
      this.log(`Dialog theme import failed: ${error.stack || error}`);
      return { ok: false, error: error.message };
    }
  }
}

module.exports = { DialogThemeService };
