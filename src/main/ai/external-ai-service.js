const { assertExternalAiDriver } = require("./driver-contract");

class ExternalAiService {
  constructor({ settings, drivers, log, onContext, onAgentState }) {
    this.settings = settings;
    this.log = log;
    this.onContext = onContext;
    this.onAgentState = onAgentState;
    this.drivers = new Map(drivers.map(driver => {
      assertExternalAiDriver(driver);
      return [driver.getMetadata().id, driver];
    }));
    const saved = settings.read();
    const selectedId = saved.externalAi?.driverId || "dsh";
    this.driver = this.drivers.get(selectedId) || this.drivers.values().next().value;
    if (!this.driver) throw new Error("At least one external AI driver is required");
    const legacyConfig = saved.harnessBaseUrl ? { endpoint: saved.harnessBaseUrl } : undefined;
    try {
      this.driver.configure(saved.externalAi?.config || legacyConfig || this.driver.getConfig());
    } catch (error) {
      this.log(`Invalid saved external AI configuration: ${error.message}`);
      this.driver.configure(this.driver.getConfig());
    }
    this.currentAgentState = { state: "idle", source: "startup", timestamp: Date.now() };
    this.activeTaskTitle = "等待任务";
    this.pendingInteraction = undefined;
    this.launcherInteraction = undefined;
    this.activeSessionId = undefined;
    this.terminalStateTimer = undefined;
  }

  getContext() {
    const metadata = this.driver.getMetadata();
    return {
      ...this.currentAgentState,
      driver: metadata,
      sessionId: this.currentAgentState.sessionId || this.activeSessionId,
      title: this.currentAgentState.title || this.activeTaskTitle,
      interaction: this.pendingInteraction || this.launcherInteraction
    };
  }

  publishContext() {
    this.onContext(this.getContext());
  }

  getSettings() {
    const metadata = this.driver.getMetadata();
    const config = this.driver.getConfig();
    return {
      driverId: metadata.id,
      driver: metadata,
      drivers: [...this.drivers.values()].map(driver => driver.getMetadata()),
      config,
      url: config.endpoint,
      defaultUrl: config.defaultEndpoint
    };
  }

  setDriverConfig({ driverId = this.driver.getMetadata().id, config = {} }) {
    try {
      const nextDriver = this.drivers.get(driverId);
      if (!nextDriver) throw new Error(`未知的外部 AI Driver：${driverId}`);
      const normalized = nextDriver.configure(config);
      if (nextDriver !== this.driver) this.driver.stop();
      this.driver = nextDriver;
      this.settings.update({ externalAi: { driverId, config: { endpoint: normalized.endpoint } } });
      this.resetContext("ai-settings");
      this.driver.start(event => this.handleDriverEvent(event));
      this.log(`External AI driver configured: ${driverId}`);
      return { ok: true, driverId, config: normalized };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  setUrl(value) {
    const result = this.setDriverConfig({ driverId: "dsh", config: { endpoint: value } });
    return result.ok ? { ok: true, url: result.config.endpoint } : result;
  }

  resetContext(source) {
    clearTimeout(this.terminalStateTimer);
    this.terminalStateTimer = undefined;
    this.activeSessionId = undefined;
    this.activeTaskTitle = "等待任务";
    this.pendingInteraction = undefined;
    this.launcherInteraction = undefined;
    this.currentAgentState = { state: "idle", source, timestamp: Date.now() };
    this.publishContext();
  }

  setAgentState(payload) {
    this.applyAgentState(payload);
  }

  applyAgentState(payload) {
    const state = typeof payload.state === "string" ? payload.state.trim() : "idle";
    if (!state) return;
    const sessionId = payload.sessionId || this.activeSessionId;
    if (this.currentAgentState.state === state
      && this.currentAgentState.sessionId === sessionId
      && this.currentAgentState.detail === payload.detail) return;
    clearTimeout(this.terminalStateTimer);
    this.terminalStateTimer = undefined;
    if (payload.sessionId) this.activeSessionId = payload.sessionId;
    this.currentAgentState = { ...payload, state, sessionId, timestamp: payload.timestamp || Date.now() };
    this.onAgentState(this.currentAgentState);
    this.publishContext();
    this.log(`Agent state: ${JSON.stringify(this.currentAgentState)}`);
    if (["success", "error", "cancelled"].includes(state)) {
      const holdMs = state === "error" ? 5000 : 2800;
      this.terminalStateTimer = setTimeout(() => {
        this.terminalStateTimer = undefined;
        if (this.currentAgentState.state !== state) return;
        this.currentAgentState = {
          state: "idle", source: payload.source || "external-ai", sessionId: this.activeSessionId,
          timestamp: Date.now()
        };
        this.onAgentState(this.currentAgentState);
        this.publishContext();
      }, holdMs);
    }
  }

  handleDriverEvent(event) {
    let changed = false;
    if (event.type === "agent-state") {
      this.applyAgentState(event);
      return;
    }
    if (event.type === "agent-running") {
      if (this.pendingInteraction?.sessionId === event.sessionId) return;
      if (event.running) {
        this.applyAgentState({ state: "thinking", sessionId: event.sessionId, source: event.source, detail: "正在思考" });
      } else if (event.sessionId === this.activeSessionId
        && !["success", "error", "cancelled", "blocked", "waiting"].includes(this.currentAgentState.state)) {
        this.applyAgentState({ state: "idle", sessionId: event.sessionId, source: event.source });
      }
      return;
    }
    if (event.type === "session-selected" && event.sessionId !== this.activeSessionId) {
      this.activeSessionId = event.sessionId;
      changed = true;
    } else if (event.type === "user-message" && event.title !== this.activeTaskTitle) {
      this.activeTaskTitle = event.title;
      changed = true;
    } else if (event.type === "interaction-requested") {
      if (event.interaction.sessionId) this.activeSessionId = event.interaction.sessionId;
      this.pendingInteraction = event.interaction;
      changed = true;
    } else if (event.type === "interaction-resolved") {
      const matches = (event.approvalId && this.pendingInteraction?.approvalId === event.approvalId)
        || (event.rpcId && this.pendingInteraction?.rpcId === event.rpcId);
      if (matches) {
        this.pendingInteraction = undefined;
        changed = true;
        if (this.currentAgentState.state === "waiting") {
          this.applyAgentState({
            state: "thinking", sessionId: this.activeSessionId, source: "interaction-resolved", detail: "正在继续处理"
          });
          return;
        }
      }
    }
    if (changed) this.publishContext();
  }

  start() {
    this.driver.start(event => this.handleDriverEvent(event));
  }

  connectEvents() {
    this.start();
  }

  async respond(response) {
    const interaction = this.pendingInteraction;
    if (!interaction || response?.rpcId !== interaction.rpcId) return { accepted: false, reason: "not-pending" };
    const receipt = await this.driver.respond(interaction, response);
    if (receipt.accepted) {
      this.pendingInteraction = undefined;
      this.applyAgentState({
        state: "thinking",
        sessionId: interaction.sessionId || this.activeSessionId,
        source: "interaction-response",
        detail: "正在继续处理"
      });
    }
    return receipt;
  }

  cancel(sessionId) {
    const target = sessionId || this.currentAgentState.sessionId || this.activeSessionId;
    if (!target) return Promise.resolve({ accepted: false, reason: "no-session" });
    return this.driver.cancel(target);
  }

  async openLauncher() {
    const metadata = this.driver.getMetadata();
    try {
      const data = await this.driver.getLauncherData(this.activeSessionId);
      this.launcherInteraction = {
        kind: "launcher", rpcId: `launcher-${Date.now()}`, title: "开始与外部 AI 对话", driver: metadata, ...data
      };
      this.publishContext();
      return { accepted: true };
    } catch (error) {
      const endpoint = this.driver.getConfig().endpoint;
      this.launcherInteraction = {
        kind: "launcher-error", rpcId: `launcher-error-${Date.now()}`,
        title: `无法连接 ${metadata.name}`,
        message: `无法连接 ${endpoint || metadata.name}，请确认服务已启动且当前设备可以访问该地址。`,
        driver: metadata
      };
      this.publishContext();
      this.log(`Open external AI launcher failed: ${error.stack || error}`);
      return { accepted: false, error: error.message };
    }
  }

  closeLauncher() {
    this.launcherInteraction = undefined;
    this.publishContext();
    return { accepted: true };
  }

  prepareConversation(request) {
    return this.driver.prepareConversation(request);
  }

  async startConversation(request) {
    const result = await this.driver.startConversation(request);
    this.activeSessionId = result.sessionId;
    this.launcherInteraction = undefined;
    this.publishContext();
    return result;
  }

  stop() {
    clearTimeout(this.terminalStateTimer);
    this.terminalStateTimer = undefined;
    this.driver.stop();
  }
}

module.exports = { ExternalAiService };
