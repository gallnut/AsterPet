const http = require("node:http");

function isLoopbackHost(host) {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function resolveControlHost(environment) {
  const requested = environment.DESKTOP_PET_CONTROL_HOST || "127.0.0.1";
  if (isLoopbackHost(requested) || environment.DESKTOP_PET_CONTROL_ALLOW_REMOTE === "1") return requested;
  return "127.0.0.1";
}

class ControlServer {
  constructor({ externalAi, windows, log, environment = process.env }) {
    this.externalAi = externalAi;
    this.windows = windows;
    this.log = log;
    this.environment = environment;
    this.retryCount = 0;
    this.server = undefined;
  }

  start() {
    const requestedHost = this.environment.DESKTOP_PET_CONTROL_HOST || "127.0.0.1";
    const host = resolveControlHost(this.environment);
    if (host !== requestedHost) {
      this.log(`Control server refused non-loopback host ${requestedHost}; set DESKTOP_PET_CONTROL_ALLOW_REMOTE=1 to opt in`);
    }
    const port = Number(this.environment.DESKTOP_PET_CONTROL_PORT || 18741);
    this.server = http.createServer((request, response) => this.handle(request, response));
    this.server.listen(port, host, () => {
      this.retryCount = 0;
      this.log(`Control server listening at http://${host}:${port}`);
    });
    this.server.on("error", error => {
      this.log(`Control server error: ${error.stack || error}`);
      if (error.code !== "EADDRINUSE" || this.retryCount >= 10) return;
      this.retryCount += 1;
      this.server = undefined;
      setTimeout(() => this.start(), 600);
    });
  }

  handle(request, response) {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type"
      });
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      this.send(response, 200, { ok: true, ...this.externalAi.currentAgentState, ...this.windows.getStatusSnapshot() });
      return;
    }
    const postRoute = request.method === "POST" && ["/state", "/action"].includes(request.url);
    if (!postRoute) {
      this.send(response, 404, { ok: false, error: "not_found" });
      return;
    }
    let body = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      body += chunk;
      if (body.length > 65536) request.destroy();
    });
    request.on("end", () => {
      try {
        const payload = JSON.parse(body || "{}");
        if (request.url === "/action") {
          const action = typeof payload.action === "string" ? payload.action.trim() : "";
          if (!action) {
            this.send(response, 400, { ok: false, error: "action_required" });
            return;
          }
          if (action.length > 128) {
            this.send(response, 400, { ok: false, error: "action_too_long" });
            return;
          }
          if (!this.windows.playAction(action)) {
            this.send(response, 503, { ok: false, error: "pet_window_unavailable" });
            return;
          }
          this.send(response, 200, { ok: true, action });
          return;
        }
        if (typeof payload.state !== "string" || !payload.state.trim()) {
          this.send(response, 400, { ok: false, error: "state_required" });
          return;
        }
        this.externalAi.setAgentState(payload);
        this.send(response, 200, { ok: true });
      } catch {
        this.send(response, 400, { ok: false, error: "invalid_json" });
      }
    });
  }

  send(response, statusCode, body) {
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*"
    });
    response.end(JSON.stringify(body));
  }

  stop() {
    this.server?.close();
  }
}

module.exports = { ControlServer, isLoopbackHost, resolveControlHost };
