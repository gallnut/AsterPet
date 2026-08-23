const fs = require("node:fs");

const port = Number(process.env.ELECTRON_REMOTE_DEBUGGING_PORT || process.argv[2] || 19222);
const duration = Math.max(1000, Number(process.env.ASTERPET_TRACE_DURATION_MS || process.argv[3]) || 10000);
const outputPath = process.env.ASTERPET_TRACE_OUTPUT || process.argv[4] || "/tmp/asterpet-trace.json";
const categories = [
  "-*",
  "benchmark",
  "blink",
  "cc",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-v8.cpu_profiler",
  "gpu",
  "input",
  "renderer.scheduler",
  "toplevel",
  "viz",
  "wayland"
].join(",");

async function main() {
  const versionResponse = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!versionResponse.ok) throw new Error(`DevTools endpoint returned ${versionResponse.status}`);
  const { webSocketDebuggerUrl } = await versionResponse.json();
  if (!webSocketDebuggerUrl) throw new Error("DevTools websocket URL unavailable");
  const socket = new WebSocket(webSocketDebuggerUrl);
  let requestId = 0;
  const pending = new Map();
  let tracingComplete;
  const traceFinished = new Promise(resolve => { tracingComplete = resolve; });

  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result || {});
      return;
    }
    if (message.method === "Tracing.tracingComplete") tracingComplete(message.params);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send("Tracing.start", {
    categories,
    options: "record-as-much-as-possible",
    transferMode: "ReturnAsStream"
  });
  await new Promise(resolve => setTimeout(resolve, duration));
  await send("Tracing.end");
  const { stream } = await traceFinished;
  if (!stream) throw new Error("Tracing stream unavailable");
  const output = fs.createWriteStream(outputPath);
  while (true) {
    const result = await send("IO.read", { handle: stream, size: 1024 * 1024 });
    output.write(result.base64Encoded ? Buffer.from(result.data, "base64") : result.data);
    if (result.eof) break;
  }
  await send("IO.close", { handle: stream });
  await new Promise(resolve => output.end(resolve));
  socket.close();
  console.log(outputPath);
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
