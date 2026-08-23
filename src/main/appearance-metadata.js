const APPEARANCE_FORMAT = "asterpet.appearance/v1";

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(value)) {
    throw new Error(`${label} 只能包含小写字母、数字、点、下划线和短横线`);
  }
  return value;
}

function assertLabel(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} 不能为空`);
  return value.trim();
}

function validateAppearanceMetadata(appearance, label = "场景 appearance") {
  if (appearance === undefined) return undefined;
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
    throw new Error(`${label} 必须是对象`);
  }
  if (appearance.format !== APPEARANCE_FORMAT) {
    throw new Error(`${label}.format 应为 ${APPEARANCE_FORMAT}`);
  }
  const id = assertIdentifier(appearance.id, `${label}.id`);
  const normalized = {
    format: APPEARANCE_FORMAT,
    id,
    label: assertLabel(appearance.label, `${label}.label`)
  };
  if (appearance.variant !== undefined) {
    if (!appearance.variant || typeof appearance.variant !== "object" || Array.isArray(appearance.variant)) {
      throw new Error(`${label}.variant 必须是对象`);
    }
    normalized.variant = {
      id: assertIdentifier(appearance.variant.id, `${label}.variant.id`),
      label: assertLabel(appearance.variant.label, `${label}.variant.label`)
    };
  }
  if (appearance.variants === undefined) {
    if (appearance.defaultVariant !== undefined) throw new Error(`${label}.defaultVariant 需要 variants`);
    return normalized;
  }
  if (normalized.variant) throw new Error(`${label}.variant 不能与 variants 同时使用`);
  if (!Array.isArray(appearance.variants) || appearance.variants.length === 0) {
    throw new Error(`${label}.variants 必须是非空数组`);
  }
  const variantIds = new Set();
  const skinNames = new Set();
  normalized.variants = appearance.variants.map((variant, index) => {
    const variantLabel = `${label}.variants[${index}]`;
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      throw new Error(`${variantLabel} 必须是对象`);
    }
    const variantId = assertIdentifier(variant.id, `${variantLabel}.id`);
    if (variantIds.has(variantId)) throw new Error(`${label} 中变体 ID 重复：${variantId}`);
    variantIds.add(variantId);
    if (typeof variant.skin !== "string" || !variant.skin.trim()) throw new Error(`${variantLabel}.skin 不能为空`);
    if (skinNames.has(variant.skin)) throw new Error(`${label} 中 Spine skin 重复：${variant.skin}`);
    skinNames.add(variant.skin);
    return {
      id: variantId,
      label: assertLabel(variant.label, `${variantLabel}.label`),
      skin: variant.skin
    };
  });
  if (appearance.defaultVariant !== undefined) {
    normalized.defaultVariant = assertIdentifier(appearance.defaultVariant, `${label}.defaultVariant`);
    if (!variantIds.has(normalized.defaultVariant)) {
      throw new Error(`${label}.defaultVariant 未出现在 variants 中：${normalized.defaultVariant}`);
    }
  }
  return normalized;
}

module.exports = { APPEARANCE_FORMAT, validateAppearanceMetadata };
