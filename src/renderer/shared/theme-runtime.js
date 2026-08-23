(function registerDialogThemeRuntime() {
  const CSS_VARIABLES = {
    fontFamily: "--theme-font-family", surface: "--theme-surface", surfaceElevated: "--theme-surface-elevated",
    surfaceBorder: "--theme-surface-border", text: "--theme-text", mutedText: "--theme-muted-text",
    accent: "--theme-accent", accentHover: "--theme-accent-hover", danger: "--theme-danger",
    dangerSurface: "--theme-danger-surface", inputSurface: "--theme-input-surface",
    controlSurface: "--theme-control-surface", controlHover: "--theme-control-hover",
    scrollThumb: "--theme-scroll-thumb", radiusCard: "--theme-radius-card",
    radiusControl: "--theme-radius-control", radiusOption: "--theme-radius-option", shadow: "--theme-shadow"
  };
  const LENGTH_TOKENS = new Set(["radiusCard", "radiusControl", "radiusOption"]);

  function applyDialogTheme(theme) {
    if (!theme?.tokens) return;
    for (const [token, value] of Object.entries(theme.tokens)) {
      const variable = CSS_VARIABLES[token];
      if (!variable) continue;
      document.documentElement.style.setProperty(variable, LENGTH_TOKENS.has(token) ? `${value}px` : String(value));
    }
    document.body.dataset.theme = theme.id;
    document.body.dataset.themeDensity = theme.layout?.density || "comfortable";
    document.body.dataset.themeTail = theme.layout?.tail || "speech";
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.applyDialogTheme = applyDialogTheme;
})();
