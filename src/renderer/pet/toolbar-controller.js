(function registerToolbarController() {
  class ToolbarController {
    constructor({ desktopPet, elements, getScene, getActiveSceneId, onPackagesChanged, setToolsVisible, setMousePassthrough, playAnimation, changeScale, getAnimationNames, selectAppearance }) {
      this.desktopPet = desktopPet;
      this.elements = elements;
      this.getScene = getScene;
      this.getActiveSceneId = getActiveSceneId;
      this.onPackagesChanged = onPackagesChanged;
      this.setToolsVisible = setToolsVisible;
      this.setMousePassthrough = setMousePassthrough;
      this.playAnimation = playAnimation;
      this.changeScale = changeScale;
      this.getAnimationNames = getAnimationNames;
      this.selectAppearance = selectAppearance;
      this.packages = [];
    }

    closePanels(except) {
      for (const panel of [this.elements.propsPanel, this.elements.scenePanel, this.elements.packagesPanel, this.elements.aiPanel]) {
        if (panel !== except) panel.hidden = true;
      }
    }

    async toggleAiPanel() {
      const { aiPanel, aiMessage, aiEndpoint, aiDriver, dialogTheme } = this.elements;
      this.closePanels(aiPanel);
      if (!aiPanel.hidden) {
        aiPanel.hidden = true;
        return;
      }
      aiMessage.classList.remove("error");
      aiMessage.textContent = "正在读取配置…";
      aiPanel.hidden = false;
      try {
        const [settings, themes] = await Promise.all([
          this.desktopPet.getExternalAiSettings(), this.desktopPet.getDialogThemes()
        ]);
        aiDriver.replaceChildren(...settings.drivers.map(driver => new Option(driver.name, driver.id)));
        aiDriver.value = settings.driverId;
        aiEndpoint.value = settings.config.endpoint || "";
        aiEndpoint.placeholder = settings.config.defaultEndpoint || "";
        dialogTheme.replaceChildren(...themes.themes.map(theme => new Option(`${theme.name} · ${theme.author}`, theme.id)));
        dialogTheme.value = themes.currentId;
        aiMessage.textContent = `${settings.driver.name} 是当前外部 AI Driver。`;
        aiEndpoint.focus();
      } catch (error) {
        aiMessage.classList.add("error");
        aiMessage.textContent = error.message;
      }
    }

    async saveAiSettings() {
      const { aiMessage, aiEndpoint, aiDriver, dialogTheme } = this.elements;
      aiMessage.classList.remove("error");
      aiMessage.textContent = "正在保存配置…";
      const result = await this.desktopPet.setExternalAiDriverConfig({
        driverId: aiDriver.value,
        config: { endpoint: aiEndpoint.value }
      });
      if (!result.ok) {
        aiMessage.classList.add("error");
        aiMessage.textContent = result.error;
        aiEndpoint.focus();
        return;
      }
      const themeResult = await this.desktopPet.selectDialogTheme(dialogTheme.value);
      if (!themeResult.ok) {
        aiMessage.classList.add("error");
        aiMessage.textContent = themeResult.error;
        return;
      }
      aiEndpoint.value = result.config.endpoint;
      aiMessage.textContent = "外部 AI 与对话皮肤已保存。";
    }

    async importDialogTheme() {
      const { aiMessage, dialogTheme } = this.elements;
      const result = await this.desktopPet.importDialogTheme();
      if (result?.canceled) return;
      if (!result?.ok) {
        aiMessage.classList.add("error");
        aiMessage.textContent = result?.error || "皮肤导入失败";
        return;
      }
      const themes = await this.desktopPet.getDialogThemes();
      dialogTheme.replaceChildren(...themes.themes.map(theme => new Option(`${theme.name} · ${theme.author}`, theme.id)));
      dialogTheme.value = themes.currentId;
      aiMessage.classList.remove("error");
      aiMessage.textContent = `已导入并启用：${result.theme.name}`;
    }

    async importPackage() {
      const { status } = this.elements;
      this.closePanels();
      status.hidden = false;
      status.textContent = "正在导入人物包…";
      const result = await this.desktopPet.importCharacterPackage();
      if (result?.canceled) {
        status.hidden = Boolean(this.getScene());
        return;
      }
      if (!result?.installed?.length) {
        status.textContent = `人物包导入失败：${result?.failed?.[0]?.error || result?.error || "没有导入成功的文件"}`;
        return;
      }
      const addedScenes = result.installed.reduce((total, item) => total + item.addedScenes, 0);
      const skippedScenes = result.installed.reduce((total, item) => total + item.skippedScenes, 0);
      status.textContent = `已更新 ${result.installed.length} 个人物：新增 ${addedScenes} 个场景，跳过 ${skippedScenes} 个重复场景`;
      await this.onPackagesChanged?.();
      if (!result.sceneId) return;
      void this.desktopPet.updateUiState({ selectedScene: result.sceneId });
      this.desktopPet.switchScene(result.sceneId);
    }

    async refreshPackages() {
      const { packagesList, packageDelete, packageSelectAll, packagesMessage } = this.elements;
      const packages = await this.desktopPet.getPackages();
      this.packages = packages;
      packagesList.replaceChildren();
      packageSelectAll.checked = false;
      packageSelectAll.indeterminate = false;
      packageDelete.disabled = true;
      packagesMessage.textContent = packages.length ? "" : "暂无人物资源包，请先导入。";
      for (const packageInfo of packages) {
        const row = document.createElement("label");
        row.className = "package-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.packageId = packageInfo.id;
        checkbox.disabled = !packageInfo.canDelete;
        checkbox.addEventListener("change", () => this.updatePackageSelectionState());
        const details = document.createElement("span");
        details.className = "package-details";
        const title = document.createElement("strong");
        title.textContent = packageInfo.title || packageInfo.id;
        const meta = document.createElement("small");
        meta.textContent = `${packageInfo.id} · ${packageInfo.scenes?.length || 0} 个场景${packageInfo.canDelete ? "" : " · 内置"}`;
        details.append(title, meta);
        row.append(checkbox, details);
        packagesList.append(row);
      }
    }

    updatePackageSelectionState() {
      const { packagesList, packageDelete, packageSelectAll } = this.elements;
      const checkboxes = [...packagesList.querySelectorAll("input[type=checkbox]")];
      const enabled = checkboxes.filter(checkbox => !checkbox.disabled);
      const selected = enabled.filter(checkbox => checkbox.checked);
      packageDelete.disabled = selected.length === 0;
      packageSelectAll.checked = enabled.length > 0 && selected.length === enabled.length;
      packageSelectAll.indeterminate = selected.length > 0 && selected.length < enabled.length;
    }

    async deletePackages() {
      const { packagesList, packageDelete, packagesMessage } = this.elements;
      const packageIds = [...packagesList.querySelectorAll("input[type=checkbox]:checked")].map(input => input.dataset.packageId);
      if (packageIds.length === 0) return;
      if (!window.confirm(`确定删除选中的 ${packageIds.length} 个人物资源包吗？`)) return;
      packageDelete.disabled = true;
      packagesMessage.textContent = "正在删除…";
      const result = await this.desktopPet.deletePackages({ packageIds, activeSceneId: this.getActiveSceneId?.() });
      await this.onPackagesChanged?.();
      await this.refreshPackages();
      const failed = result.failed || [];
      packagesMessage.textContent = failed.length
        ? `已删除 ${result.removed.length} 个，${failed.length} 个失败：${failed[0].error}`
        : `已删除 ${result.removed.length} 个资源包。`;
    }

    bindScrollablePanel(panel) {
      panel.addEventListener("pointerenter", () => this.setMousePassthrough(false));
      panel.addEventListener("pointermove", () => this.setMousePassthrough(false));
      panel.addEventListener("wheel", event => {
        event.preventDefault();
        event.stopPropagation();
        const multiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 20
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? panel.clientHeight
            : 1;
        panel.scrollTop += event.deltaY * multiplier;
      }, { capture: true, passive: false });
    }

    centerActiveScene() {
      const { scenePanel } = this.elements;
      const activeScene = scenePanel.querySelector(".scene-option.active");
      if (!activeScene) return;
      const activeGroup = activeScene.closest(".scene-group");
      if (activeGroup) activeGroup.open = true;
      const panelRect = scenePanel.getBoundingClientRect();
      const activeRect = activeScene.getBoundingClientRect();
      scenePanel.scrollTop += activeRect.top - panelRect.top
        - (scenePanel.clientHeight - activeRect.height) / 2;
    }

    bind() {
      const elements = this.elements;
      elements.animationSelect.addEventListener("change", () => this.playAnimation(elements.animationSelect.value));
      elements.appearanceSelect.addEventListener("change", () => this.selectAppearance(elements.appearanceSelect.value));
      elements.propsToggle.addEventListener("click", () => {
        this.closePanels(elements.propsPanel);
        elements.propsPanel.hidden = !elements.propsPanel.hidden;
        if (!elements.propsPanel.hidden) requestAnimationFrame(() => elements.layerSearchInput.focus());
      });
      elements.sceneToggle.addEventListener("click", () => {
        this.closePanels(elements.scenePanel);
        elements.scenePanel.hidden = !elements.scenePanel.hidden;
        if (!elements.scenePanel.hidden) {
          requestAnimationFrame(() => requestAnimationFrame(() => this.centerActiveScene()));
        }
      });
      elements.aiSettings.addEventListener("click", () => this.toggleAiPanel());
      elements.windowMenu.hidden = !this.desktopPet.nativeWayland;
      elements.windowMenu.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (!this.desktopPet.openWindowMenu()) {
          elements.status.hidden = false;
          elements.status.textContent = "GNOME 窗口菜单暂时不可用，请直接按下此按钮，不要拖动";
        }
      });
      elements.aiSave.addEventListener("click", () => this.saveAiSettings());
      elements.aiCancel.addEventListener("click", () => { elements.aiPanel.hidden = true; });
      elements.importDialogTheme.addEventListener("click", () => this.importDialogTheme());
      elements.aiEndpoint.addEventListener("keydown", event => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        void this.saveAiSettings();
      });
      elements.chatToggle.addEventListener("click", () => {
        this.desktopPet.openLauncher();
        this.setToolsVisible(false);
      });
      elements.importPackage.addEventListener("click", () => this.importPackage());
      elements.packagesToggle.addEventListener("click", async () => {
        this.closePanels(elements.packagesPanel);
        elements.packagesPanel.hidden = !elements.packagesPanel.hidden;
        if (!elements.packagesPanel.hidden) {
          elements.packagesMessage.textContent = "正在读取资源包…";
          try { await this.refreshPackages(); } catch (error) { elements.packagesMessage.textContent = error.message; }
        }
      });
      elements.packageImport.addEventListener("click", () => this.importPackage());
      elements.packageDelete.addEventListener("click", () => this.deletePackages());
      elements.packageSelectAll.addEventListener("change", () => {
        for (const checkbox of elements.packagesList.querySelectorAll("input[type=checkbox]:not(:disabled)")) checkbox.checked = elements.packageSelectAll.checked;
        this.updatePackageSelectionState();
      });
      for (const panel of [elements.propsPanel, elements.scenePanel, elements.packagesPanel, elements.aiPanel]) this.bindScrollablePanel(panel);
      elements.previous.addEventListener("click", () => {
        const names = this.getAnimationNames();
        const index = (elements.animationSelect.selectedIndex - 1 + names.length) % names.length;
        elements.animationSelect.selectedIndex = index;
        this.playAnimation(names[index]);
      });
      elements.next.addEventListener("click", () => {
        const names = this.getAnimationNames();
        const index = (elements.animationSelect.selectedIndex + 1) % names.length;
        elements.animationSelect.selectedIndex = index;
        this.playAnimation(names[index]);
      });
      elements.zoomOut.addEventListener("click", () => this.changeScale(-0.05));
      elements.zoomIn.addEventListener("click", () => this.changeScale(0.05));
      elements.minimize.addEventListener("click", () => this.desktopPet.minimize());
      elements.close.addEventListener("click", () => this.desktopPet.close());
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.ToolbarController = ToolbarController;
})();
