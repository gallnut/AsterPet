const LAYER_FORMAT = "asterpet.layers/v1";
const LAYER_ROLES = new Set([
  "background",
  "prop",
  "effect",
  "clothing",
  "equipment",
  "interface",
  "character",
  "internal"
]);

function assertStringArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label} 必须是非空字符串数组`);
  }
  return value;
}

function validateLayerMetadata(layers, label = "场景 layers") {
  if (layers === undefined) return undefined;
  if (!layers || typeof layers !== "object" || Array.isArray(layers)) throw new Error(`${label} 必须是对象`);
  const usesStandardFormat = layers.format !== undefined || layers.groups !== undefined
    || layers.characterSlots !== undefined || layers.internalSlots !== undefined;
  if (!usesStandardFormat) return layers;
  if (layers.format !== LAYER_FORMAT) throw new Error(`${label}.format 应为 ${LAYER_FORMAT}`);

  const characterSlots = assertStringArray(layers.characterSlots, `${label}.characterSlots`);
  const internalSlots = assertStringArray(layers.internalSlots, `${label}.internalSlots`);
  if (!Array.isArray(layers.groups)) throw new Error(`${label}.groups 必须是数组`);

  const owners = new Map();
  const claimSlots = (slots, owner) => {
    for (const slot of slots) {
      const previous = owners.get(slot);
      if (previous) throw new Error(`${label} 中 slot “${slot}” 同时属于 ${previous} 和 ${owner}`);
      owners.set(slot, owner);
    }
  };
  claimSlots(characterSlots, "characterSlots");
  claimSlots(internalSlots, "internalSlots");

  const groupIds = new Set();
  for (const [index, group] of layers.groups.entries()) {
    const groupLabel = `${label}.groups[${index}]`;
    if (!group || typeof group !== "object" || Array.isArray(group)) throw new Error(`${groupLabel} 必须是对象`);
    if (typeof group.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(group.id)) {
      throw new Error(`${groupLabel}.id 只能包含小写字母、数字和短横线`);
    }
    if (groupIds.has(group.id)) throw new Error(`${label} 中分组 ID 重复：${group.id}`);
    groupIds.add(group.id);
    if (typeof group.label !== "string" || !group.label.trim()) throw new Error(`${groupLabel}.label 不能为空`);
    if (group.role !== undefined && !LAYER_ROLES.has(group.role)) throw new Error(`${groupLabel}.role 不受支持：${group.role}`);
    if (group.defaultVisible !== undefined && typeof group.defaultVisible !== "boolean") {
      throw new Error(`${groupLabel}.defaultVisible 必须是布尔值`);
    }
    const slots = assertStringArray(group.slots, `${groupLabel}.slots`);
    if (slots.length === 0 && typeof group.pattern !== "string") throw new Error(`${groupLabel} 必须提供 slots 或 pattern`);
    if (group.pattern !== undefined) {
      if (typeof group.pattern !== "string" || !group.pattern) throw new Error(`${groupLabel}.pattern 必须是非空字符串`);
      try {
        new RegExp(group.pattern, "i");
      } catch (error) {
        throw new Error(`${groupLabel}.pattern 不是有效正则：${error.message}`);
      }
    }
    claimSlots(slots, `分组 ${group.id}`);
  }
  assertStringArray(layers.defaultVisibleSlots, `${label}.defaultVisibleSlots`);
  if (layers.defaultPropsVisible !== undefined && typeof layers.defaultPropsVisible !== "boolean") {
    throw new Error(`${label}.defaultPropsVisible 必须是布尔值`);
  }
  return layers;
}

module.exports = { LAYER_FORMAT, validateLayerMetadata };
