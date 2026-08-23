const fs = require("node:fs");

const tracePath = process.argv[2];
if (!tracePath) {
  console.error("Usage: node scripts/analyze-chromium-trace.js <trace.json>");
  process.exit(1);
}

const trace = JSON.parse(fs.readFileSync(tracePath, "utf8"));
const events = Array.isArray(trace) ? trace : trace.traceEvents;
const processNames = new Map();
const threadNames = new Map();

for (const event of events) {
  if (event.ph !== "M") continue;
  if (event.name === "process_name") processNames.set(event.pid, event.args?.name || "unknown");
  if (event.name === "thread_name") threadNames.set(`${event.pid}:${event.tid}`, event.args?.name || "unknown");
}

const totals = new Map();
for (const event of events) {
  if (event.ph !== "X" || !event.dur) continue;
  const processName = processNames.get(event.pid) || String(event.pid);
  const threadName = threadNames.get(`${event.pid}:${event.tid}`) || String(event.tid);
  const key = `${processName}\t${threadName}\t${event.name}`;
  const entry = totals.get(key) || { processName, threadName, name: event.name, count: 0, duration: 0 };
  entry.count += 1;
  entry.duration += event.dur;
  totals.set(key, entry);
}

const rows = [...totals.values()]
  .sort((left, right) => right.duration - left.duration)
  .slice(0, Math.max(1, Number(process.env.ASTERPET_TRACE_TOP) || 60));

console.log(`Trace: ${tracePath}`);
console.log("duration_ms\tcount\tprocess\tthread\tevent");
for (const row of rows) {
  console.log(`${(row.duration / 1000).toFixed(1)}\t${row.count}\t${row.processName}\t${row.threadName}\t${row.name}`);
}
