const { mapDshEnvelope } = require("./dsh-event-mapper");
const { normalizeDshEndpoint } = require("./dsh-url");

class DshDriver {
  constructor({ config, defaultEndpoint, log }) {
    this.log = log;
    this.defaultEndpoint = normalizeDshEndpoint(defaultEndpoint);
    this.config = this.normalizeConfig(config);
    this.sockets = new Map();
    this.stopping = true;
    this.connectionGeneration = 0;
    this.emit = () => {};
  }

  getMetadata() {
    return { id: "dsh", name: "DeepSeek Harness", description: "通过 DSH 会话与事件接口驱动桌宠", configurable: true };
  }

  normalizeConfig(config = {}) {
    return { endpoint: normalizeDshEndpoint(config.endpoint || this.defaultEndpoint) };
  }

  getConfig() {
    return { ...this.config, defaultEndpoint: this.defaultEndpoint };
  }

  configure(config) {
    this.config = this.normalizeConfig(config);
    return this.getConfig();
  }

  start(emit) {
    this.emit = typeof emit === "function" ? emit : () => {};
    this.stopping = false;
    const generation = ++this.connectionGeneration;
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    void this.connectLoop("mux", "/api/events.mux", generation);
    void this.connectLoop("host", "/api/events.host", generation);
  }

  stop() {
    this.stopping = true;
    this.connectionGeneration += 1;
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
  }

  async connectLoop(streamName, pathname, generation) {
    const websocketUrl = new URL(pathname, this.config.endpoint);
    websocketUrl.protocol = websocketUrl.protocol === "https:" ? "wss:" : "ws:";
    while (!this.stopping && generation === this.connectionGeneration) {
      await new Promise(resolve => {
        const socket = new WebSocket(websocketUrl);
        this.sockets.set(streamName, socket);
        socket.addEventListener("open", () => this.log(`External AI driver connected (${streamName}): ${websocketUrl}`));
        socket.addEventListener("message", event => {
          try {
            for (const mapped of mapDshEnvelope(JSON.parse(String(event.data)))) this.emit(mapped);
          } catch (error) {
            this.log(`DSH event frame: ${error}`);
          }
        });
        socket.addEventListener("error", () => this.log(`DSH ${streamName} event stream websocket error`));
        socket.addEventListener("close", () => {
          if (this.sockets.get(streamName) === socket) this.sockets.delete(streamName);
          resolve();
        }, { once: true });
      });
      if (!this.stopping && generation === this.connectionGeneration) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  async post(pathname, body) {
    const response = await fetch(`${this.config.endpoint}${pathname}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`DSH HTTP ${response.status}`);
    return response.json();
  }

  async rpc(method, payload = {}) {
    const rpcId = `asterpet-${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await this.post(`/api/${method}`, { type: "client-request", rpcId, method, payload });
    if (!response.result?.ok) throw new Error(response.result?.error?.message || `${method} failed`);
    return response.result.value;
  }

  async respond(interaction, response) {
    const value = interaction.kind === "approval"
      ? { sessionId: interaction.sessionId, approvalId: interaction.approvalId, outcome: response.outcome }
      : { sessionId: interaction.sessionId, answer: { answers: response.answers } };
    return this.post("/api/respond", {
      type: "client-response", rpcId: interaction.rpcId, result: { ok: true, value }
    });
  }

  async cancel(sessionId) {
    const rpcId = `asterpet-cancel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const result = await this.post("/api/session.cancel", {
      type: "client-request", rpcId, method: "session.cancel", payload: { sessionId }
    });
    return result.result;
  }

  async getLauncherData(activeSessionId) {
    const [workspaces, presets, sessions] = await Promise.all([
      this.rpc("workspace.list"), this.rpc("agentPreset.list"), this.rpc("session.list")
    ]);
    let sessionId = activeSessionId || sessions.items?.find(session => session.blank)?.sessionId;
    if (!sessionId) sessionId = (await this.rpc("session.create", {})).sessionId;
    const activeSession = sessions.items?.find(session => session.sessionId === activeSessionId);
    const [models, history] = await Promise.all([
      this.rpc("session.models", { sessionId }), this.rpc("session.history", { sessionId, maxMessages: 1 })
    ]);
    return {
      workspaces: workspaces.items || [], presets: (presets.presets || []).filter(preset => !preset.broken),
      sessions: sessions.items || [], initialMode: activeSession && !activeSession.blank ? activeSession.sessionId : "new",
      sessionId, models, permissions: history.projections?.values?.permissions
    };
  }

  async ensureSession(request) {
    if (request.sessionId) return request.sessionId;
    const created = await this.rpc("session.create", {
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      ...(request.agentPreset ? { agentPreset: request.agentPreset } : {})
    });
    return created.sessionId;
  }

  async prepareConversation(request) {
    const sessionId = await this.ensureSession(request);
    const [models, history] = await Promise.all([
      this.rpc("session.models", { sessionId }), this.rpc("session.history", { sessionId, maxMessages: 1 })
    ]);
    return { sessionId, models, permissions: history.projections?.values?.permissions };
  }

  async startConversation(request) {
    const sessionId = await this.ensureSession(request);
    if (request.provider && request.model) {
      await this.rpc("session.selectModel", { sessionId, provider: request.provider, model: request.model });
    }
    if (request.permission && request.permission !== request.currentPermission) {
      await this.rpc("session.prompt", {
        sessionId, mode: "queue", content: [{ type: "text", text: `/permission ${request.permission}` }]
      });
    }
    await this.rpc("session.prompt", {
      sessionId, mode: "queue", content: [{ type: "text", text: request.prompt }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    return { accepted: true, sessionId };
  }
}

module.exports = { DshDriver };
