(function registerAppearanceVariants(root) {
  function inferSceneLabel(metadata = {}, sceneId = "") {
    if (metadata.appearance?.label) return metadata.appearance.label;
    const title = String(metadata.title || "").trim();
    const characterTitle = String(metadata.characterTitle || "").trim();
    if (!title) return sceneId;
    const normalizedCharacter = characterTitle.toLocaleLowerCase();
    const parts = title.split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
    const distinct = parts.filter(part => {
      if (!characterTitle) return true;
      const normalizedPart = part.toLocaleLowerCase();
      return normalizedPart !== normalizedCharacter && !normalizedPart.includes(normalizedCharacter);
    });
    if (distinct[0]) return distinct[0].replace(/(?:\s*[·_-]?\s*)(?:v|ver|version)\s*\d+\s*$/i, "").trim();
    if (characterTitle && title.startsWith(characterTitle)) {
      const remainder = title.slice(characterTitle.length).trim();
      if (remainder) return remainder.replace(/(?:\s*[·_-]?\s*)(?:v|ver|version)\s*\d+\s*$/i, "").trim();
    }
    return title.replace(/(?:\s*[·_-]?\s*)(?:v|ver|version)\s*\d+\s*$/i, "").trim();
  }

  function familyIdFor(sceneId, metadata = {}) {
    const label = inferSceneLabel(metadata, sceneId);
    const appearanceKey = metadata.appearance?.id
      ? `appearance:${metadata.appearance.id}`
      : `legacy:${label.toLocaleLowerCase()}`;
    return [metadata.packageId || metadata.characterId || "other", metadata.characterId || "other", metadata.category || "character", appearanceKey]
      .map(value => encodeURIComponent(value))
      .join(":");
  }

  function resolveSceneFamilies(sceneCatalog = {}) {
    const families = new Map();
    for (const [sceneId, metadata = {}] of Object.entries(sceneCatalog)) {
      const familyId = familyIdFor(sceneId, metadata);
      let family = families.get(familyId);
      if (!family) {
        family = {
          id: familyId,
          characterId: metadata.characterId || "其他",
          characterLabel: metadata.characterTitle || metadata.characterId || "其他",
          category: metadata.category || "character",
          label: inferSceneLabel(metadata, sceneId),
          entries: []
        };
        families.set(familyId, family);
      }
      family.entries.push({ sceneId, metadata });
    }
    for (const family of families.values()) {
      family.entries.sort((left, right) => left.sceneId.localeCompare(right.sceneId, undefined, { numeric: true }));
    }
    return [...families.values()];
  }

  function findSceneFamily(sceneId, sceneCatalog) {
    return resolveSceneFamilies(sceneCatalog).find(family => family.entries.some(entry => entry.sceneId === sceneId));
  }

  function declaredSkinVariants(metadata = {}) {
    return Array.isArray(metadata.appearance?.variants) ? metadata.appearance.variants : [];
  }

  function resolveAppearanceVariants({ sceneId, sceneCatalog, availableSkinNames = [], selectedSkin }) {
    const family = findSceneFamily(sceneId, sceneCatalog);
    if (!family) return { options: [], selectedId: undefined, familyId: undefined };

    if (family.entries.length > 1) {
      const options = family.entries.map(({ sceneId: candidateSceneId, metadata }, index) => ({
        id: `scene:${candidateSceneId}`,
        driver: "scene",
        familyId: family.id,
        sceneId: candidateSceneId,
        variantId: metadata.appearance?.variant?.id || candidateSceneId,
        label: metadata.appearance?.variant?.label || `变体 ${index + 1}`
      }));
      return {
        familyId: family.id,
        options,
        selectedId: options.find(option => option.sceneId === sceneId)?.id || options[0]?.id
      };
    }

    const [{ metadata }] = family.entries;
    const configured = declaredSkinVariants(metadata);
    const configuredBySkin = new Map(configured.map(variant => [variant.skin, variant]));
    const options = availableSkinNames.length > 0
      ? availableSkinNames.map(skin => {
        const declared = configuredBySkin.get(skin);
        return {
          id: `skin:${sceneId}:${skin}`,
          driver: "spine-skin",
          familyId: family.id,
          sceneId,
          skin,
          variantId: declared?.id || skin,
          label: declared?.label || skin
        };
      })
      : [{
        id: `scene:${sceneId}`,
        driver: "scene",
        familyId: family.id,
        sceneId,
        variantId: metadata.appearance?.variant?.id || sceneId,
        label: metadata.appearance?.variant?.label || family.label
      }];
    const configuredDefaultId = metadata.appearance?.defaultVariant;
    const configuredDefault = options.find(option => option.variantId === configuredDefaultId);
    const effectiveSkin = selectedSkin || configuredDefault?.skin;
    const selected = options.find(option => option.driver !== "spine-skin" || option.skin === effectiveSkin) || options[0];
    return {
      familyId: family.id,
      options,
      selectedId: selected?.id,
      defaultSkin: configuredDefault?.skin || options[0]?.skin
    };
  }

  root.AsterPet = root.AsterPet || {};
  root.AsterPet.resolveSceneFamilies = resolveSceneFamilies;
  root.AsterPet.resolveAppearanceVariants = resolveAppearanceVariants;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { inferSceneLabel, resolveSceneFamilies, resolveAppearanceVariants };
  }
})(typeof window === "undefined" ? globalThis : window);
