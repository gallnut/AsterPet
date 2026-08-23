(function registerLauncherView() {
  class LauncherView {
    constructor({ desktopPet, embedded, questions, actions, pager, stop, button, resize, getScale }) {
      this.desktopPet = desktopPet;
      this.embedded = embedded;
      this.questions = questions;
      this.actions = actions;
      this.pager = pager;
      this.stop = stop;
      this.button = button;
      this.resize = resize;
      this.getScale = getScale;
      this.selectCounter = 0;
      this.selects = new Map();
      desktopPet.onPopoverSelected(({ selectId, value }) => this.selects.get(selectId)?.selectValue(value, true));
      document.addEventListener("pointerdown", event => {
        if (!event.target.closest(".launcher-select")) this.closeMenus();
      }, true);
    }

    createSelect(items, valueKey, labelFor) {
      const select = document.createElement("div");
      select.className = "launcher-select";
      const selectId = `launcher-select-${++this.selectCounter}`;
      this.selects.set(selectId, select);
      const trigger = this.button("");
      trigger.className = "launcher-select-trigger";
      const triggerIcon = document.createElement("span");
      triggerIcon.className = "launcher-select-icon";
      const triggerLabel = document.createElement("span");
      triggerLabel.className = "launcher-select-label";
      trigger.append(triggerIcon, triggerLabel);
      const menu = document.createElement("div");
      menu.className = "launcher-select-menu";
      menu.hidden = true;
      let selectedValue = "";
      let disabled = false;
      let availableItems = [];
      const updateTrigger = item => {
        triggerLabel.textContent = item ? labelFor(item) : "暂无可用选项";
      };
      select.setItems = nextItems => {
        availableItems = nextItems;
        menu.replaceChildren();
        selectedValue = nextItems[0]?.[valueKey] || "";
        updateTrigger(nextItems[0]);
        for (const item of nextItems) {
          const value = item[valueKey] || "";
          const choice = this.button(labelFor(item), () => {
            selectedValue = value;
            updateTrigger(item);
            menu.hidden = true;
            select.classList.remove("open");
            select.onchange?.();
            this.resize();
          });
          choice.className = "launcher-select-option";
          menu.append(choice);
        }
      };
      select.selectValue = (value, notify = false) => {
        const item = availableItems.find(entry => (entry[valueKey] || "") === value);
        if (!item) return;
        selectedValue = value;
        updateTrigger(item);
        if (notify) select.onchange?.();
      };
      Object.defineProperty(select, "value", { get: () => selectedValue });
      Object.defineProperty(select, "disabled", {
        get: () => disabled,
        set: value => {
          disabled = Boolean(value);
          trigger.disabled = disabled;
          select.classList.toggle("disabled", disabled);
        }
      });
      trigger.onclick = () => {
        if (disabled || availableItems.length === 0) return;
        if (this.embedded) {
          const opening = menu.hidden;
          this.closeMenus();
          menu.hidden = !opening;
          select.classList.toggle("open", opening);
          this.resize();
          return;
        }
        const scale = this.getScale();
        const rect = trigger.getBoundingClientRect();
        this.desktopPet.openPopover({
          selectId,
          x: Math.round(window.screenX + rect.left),
          y: Math.round(window.screenY + rect.top),
          width: Math.max(rect.width, Math.min(270 * scale, Math.max(...availableItems.map(item => (labelFor(item).length * 8 + 32) * scale)))),
          height: rect.height,
          scale,
          placement: select.classList.contains("launcher-session-tab") || select.closest(".launcher-setup") ? "below" : "above",
          items: availableItems.map(item => ({ value: item[valueKey] || "", label: labelFor(item) }))
        });
      };
      select.append(trigger, menu);
      select.setItems(items);
      return select;
    }

    closeMenus() {
      if (!this.embedded) this.desktopPet.closePopover();
      for (const opened of document.querySelectorAll(".launcher-select.open")) {
        opened.classList.remove("open");
        opened.querySelector(".launcher-select-menu").hidden = true;
      }
    }

    deactivate() {
      document.querySelector(".launcher-session-tab")?.remove();
      this.questions.classList.remove("launcher-active");
      this.selects.clear();
    }

    render(interaction) {
      document.querySelector(".launcher-session-tab")?.remove();
      this.selects.clear();
      this.questions.classList.add("launcher-active");
      this.questions.replaceChildren();
      this.actions.replaceChildren();
      this.pager.hidden = true;
      let prepared = { sessionId: interaction.sessionId, models: interaction.models, permissions: interaction.permissions };
      const sessionItems = interaction.sessions.filter(session => !session.blank).slice(0, 8).map(session => ({
        id: session.sessionId,
        name: session.projections?.values?.title || "未命名会话"
      }));
      const currentIndex = sessionItems.findIndex(item => item.id === interaction.sessionId);
      if (currentIndex > 0) sessionItems.unshift(sessionItems.splice(currentIndex, 1)[0]);
      const mode = this.createSelect([...sessionItems, { id: "new", name: "新建会话" }], "id", item => item.name);
      mode.selectValue(interaction.initialMode || "new");
      const workspace = this.createSelect([{ workspaceId: "", title: "默认工作目录" }, ...interaction.workspaces], "workspaceId", item => item.title);
      workspace.classList.add("workspace-selector");
      const presetItems = [...interaction.presets].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
      const preset = this.createSelect(presetItems, "id", item => `${item.name || item.id}${item.trust === "user" ? "（用户配置）" : ""}`);
      preset.classList.add("preset-selector");
      let routes = [];
      const model = this.createSelect([], "key", item => item.name);
      const permissionLabel = item => item.value === "danger-full-access"
        ? "Full access"
        : (item.name || item.value).replace(/(^|-)([a-z])/g, (_match, separator, letter) => `${separator ? " " : ""}${letter.toUpperCase()}`);
      const permissionOptions = (interaction.permissions?.options || []).filter(item => item.value !== "custom");
      const permission = this.createSelect(permissionOptions, "value", permissionLabel);
      if (interaction.permissions?.currentValue) permission.selectValue(interaction.permissions.currentValue);
      permission.hidden = permissionOptions.length === 0;
      const prompt = document.createElement("textarea");
      prompt.placeholder = "输入想对 LLM 说的话…";
      prompt.rows = 2;
      prompt.wrap = "soft";
      const resizePrompt = () => {
        prompt.style.height = "auto";
        prompt.style.height = `${Math.min(prompt.scrollHeight, Math.max(72, 128 * this.getScale()))}px`;
        this.resize();
      };
      prompt.addEventListener("input", resizePrompt);
      prompt.addEventListener("pointerdown", () => this.closeMenus());
      prompt.addEventListener("focus", () => this.closeMenus());
      const updateModels = models => {
        routes = models.groups.flatMap(group => group.models.map(item => ({ key: `${group.id}\u0000${item.id}`, provider: group.id, model: item.id, name: item.name })));
        model.setItems(routes);
        const currentKey = models.current ? `${models.current.provider}\u0000${models.current.model}` : "";
        if (currentKey) model.selectValue(currentKey);
      };
      const refresh = async () => {
        const generation = ++refresh.generation;
        const isNew = mode.value === "new";
        const nextPrepared = await this.desktopPet.prepareConversation({
          ...(!isNew ? { sessionId: mode.value } : {}),
          ...(isNew && workspace.value ? { workspaceId: workspace.value } : {}),
          ...(isNew && preset.value ? { agentPreset: preset.value } : {})
        });
        if (generation !== refresh.generation || !mode.isConnected) return;
        prepared = nextPrepared;
        updateModels(prepared.models);
        const nextPermissionOptions = (prepared.permissions?.options || []).filter(item => item.value !== "custom");
        permission.setItems(nextPermissionOptions);
        permission.hidden = nextPermissionOptions.length === 0;
        if (prepared.permissions?.currentValue) permission.selectValue(prepared.permissions.currentValue);
      };
      refresh.generation = 0;
      const refreshNewConversation = () => {
        if (mode.value !== "new") mode.selectValue("new");
        return refresh();
      };
      mode.onchange = refresh;
      workspace.onchange = refreshNewConversation;
      preset.onchange = refreshNewConversation;
      updateModels(prepared.models);
      mode.classList.add("launcher-session-tab");
      document.querySelector(".head").insertBefore(mode, this.stop);
      const setup = document.createElement("div");
      setup.className = "launcher-form launcher-setup";
      setup.append(workspace, preset);
      const controls = document.createElement("div");
      controls.className = "launcher-controls";
      controls.append(permission, model);
      const form = document.createElement("div");
      form.className = "launcher-form launcher-composer";
      form.append(prompt, controls);
      const risk = document.createElement("div");
      risk.className = "launcher-risk";
      risk.hidden = true;
      const riskText = document.createElement("div");
      riskText.textContent = "Full access 可访问工作区之外的文件并执行高风险操作。";
      const riskActions = document.createElement("div");
      riskActions.className = "launcher-risk-actions";
      const send = async (fullAccessConfirmed = false) => {
        if (!prompt.value.trim()) return;
        const route = routes.find(item => item.key === model.value);
        if (!route) return;
        const selectedPermission = permission.hidden ? "" : permission.value;
        if (selectedPermission === "danger-full-access" && selectedPermission !== prepared.permissions?.currentValue && !fullAccessConfirmed) {
          risk.hidden = false;
          this.resize();
          return;
        }
        await this.desktopPet.startConversation({
          sessionId: prepared.sessionId,
          provider: route.provider,
          model: route.model,
          permission: selectedPermission,
          currentPermission: prepared.permissions?.currentValue,
          prompt: prompt.value.trim()
        });
      };
      riskActions.append(
        this.button("取消", () => { risk.hidden = true; this.resize(); }),
        this.button("确认启用", () => send(true), "primary")
      );
      risk.append(riskText, riskActions);
      form.append(risk);
      this.questions.append(setup, form);
      prompt.onkeydown = event => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        send();
      };
      this.resize();
      prompt.focus();
    }

    renderError(interaction) {
      this.deactivate();
      this.questions.replaceChildren();
      this.actions.replaceChildren();
      this.pager.hidden = true;
      const message = document.createElement("div");
      message.className = "launcher-error";
      message.textContent = interaction.message;
      this.questions.append(message);
      this.actions.append(this.button("重试", () => this.desktopPet.openLauncher(), "primary"));
      this.resize();
    }
  }

  window.AsterPet = window.AsterPet || {};
  window.AsterPet.LauncherView = LauncherView;
})();
