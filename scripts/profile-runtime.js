const fs = require("node:fs");

const port = Number(process.env.ELECTRON_REMOTE_DEBUGGING_PORT || process.argv[2] || 19222);
const duration = Math.max(5000, Number(process.env.ASTERPET_PROFILE_DURATION_MS || process.argv[3]) || 60000);
const interval = Math.max(1000, Number(process.env.ASTERPET_PROFILE_INTERVAL_MS || process.argv[4]) || 5000);
const outputPath = process.env.ASTERPET_PROFILE_OUTPUT || process.argv[5];

async function connect(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let requestId = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result || {});
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++requestId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

function metricsObject(metrics) {
  return Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
}

async function main() {
  const [version, targets] = await Promise.all([
    fetch(`http://127.0.0.1:${port}/json/version`).then(response => response.json()),
    fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  ]);
  const pageTarget = targets.find(target => target.type === "page");
  if (!version.webSocketDebuggerUrl || !pageTarget?.webSocketDebuggerUrl) throw new Error("AsterPet DevTools targets unavailable");
  const browser = await connect(version.webSocketDebuggerUrl);
  const page = await connect(pageTarget.webSocketDebuggerUrl);
  await page.send("Performance.enable");
  const startedAt = Date.now();
  let previousProcesses;
  let previousAt = startedAt;
  const samples = [];

  while (Date.now() - startedAt <= duration) {
    const sampledAt = Date.now();
    const [processResult, performanceResult] = await Promise.all([
      browser.send("SystemInfo.getProcessInfo"),
      page.send("Performance.getMetrics")
    ]);
    const processes = new Map(processResult.processInfo.map(process => [process.id, process]));
    const elapsedSeconds = Math.max(0.001, (sampledAt - previousAt) / 1000);
    const processCpu = {};
    if (previousProcesses) {
      for (const [pid, process] of processes) {
        const previous = previousProcesses.get(pid);
        if (!previous) continue;
        const key = process.type || String(pid);
        processCpu[key] = Number(((process.cpuTime - previous.cpuTime) / elapsedSeconds * 100).toFixed(2));
      }
    }
    const metrics = metricsObject(performanceResult.metrics || []);
    const sample = {
      elapsedSeconds: Number(((sampledAt - startedAt) / 1000).toFixed(1)),
      processCpu,
      jsHeapUsedMb: Number(((metrics.JSHeapUsedSize || 0) / 1024 / 1024).toFixed(2)),
      jsHeapTotalMb: Number(((metrics.JSHeapTotalSize || 0) / 1024 / 1024).toFixed(2)),
      documents: metrics.Documents || 0,
      nodes: metrics.Nodes || 0,
      frames: metrics.Frames || 0,
      eventListeners: metrics.JSEventListeners || 0
    };
    samples.push(sample);
    console.log(JSON.stringify(sample));
    previousProcesses = processes;
    previousAt = sampledAt;
    if (Date.now() - startedAt >= duration) break;
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(samples, null, 2)}\n`);
  page.close();
  browser.close();
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
