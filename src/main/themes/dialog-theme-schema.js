const COLOR_TOKENS = new Set([
  "surface", "surfaceElevated", "surfaceBorder", "text", "mutedText", "accent", "accentHover",
  "danger", "dangerSurface", "inputSurface", "controlSurface", "controlHover", "scrollThumb"
]);
const NUMBER_TOKENS = new Set(["radiusCard", "radiusControl", "radiusOption"]);
const STRING_TOKENS = new Set(["fontFamily", "shadow"]);
const COLOR_PATTERN = /^(#[\da-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%a-z-]+\)|transparent)$/i;
const FONT_PATTERN = /^[\w\s,"'-]+$/;
const SHADOW_PATTERN = /^(none|[-\d. pxrgba(),#%]+)$/i;

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim() || value.length > 120) throw new Error(`主题字段 ${field} 无效`);
  return value.trim();
}

function validateDialogTheme(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("主题清单必须是对象");
  if (input.format !== "asterpet.dialog-theme/v1") throw new Error("不支持的对话主题格式");
  const id = requireString(input.id, "id");
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) throw new Error("主题 id 只能包含小写字母、数字、点、横线和下划线");
  const tokens = {};
  for (const [key, value] of Object.entries(input.tokens || {})) {
    if (COLOR_TOKENS.has(key)) {
      if (typeof value !== "string" || value.length > 80 || !COLOR_PATTERN.test(value.trim())) throw new Error(`主题颜色 ${key} 无效`);
      tokens[key] = value.trim();
    } else if (NUMBER_TOKENS.has(key)) {
      if (!Number.isFinite(value) || value < 0 || value > 48) throw new Error(`主题尺寸 ${key} 无效`);
      tokens[key] = value;
    } else if (STRING_TOKENS.has(key)) {
      const text = requireString(value, key);
      if (key === "fontFamily" && !FONT_PATTERN.test(text)) throw new Error("主题字体配置无效");
      if (key === "shadow" && !SHADOW_PATTERN.test(text)) throw new Error("主题阴影配置无效");
      tokens[key] = text;
    }
  }
  return {
    format: input.format,
    id,
    name: requireString(input.name, "name"),
    version: requireString(input.version || "1.0.0", "version"),
    author: requireString(input.author || "Unknown", "author"),
    tokens,
    layout: {
      density: ["compact", "comfortable"].includes(input.layout?.density) ? input.layout.density : "comfortable",
      tail: ["speech", "none"].includes(input.layout?.tail) ? input.layout.tail : "speech"
    }
  };
}

module.exports = { validateDialogTheme };
