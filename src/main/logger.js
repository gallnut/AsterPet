const fs = require("node:fs");
const path = require("node:path");

function createLogger(asterPetHome) {
  const logPath = path.join(asterPetHome, "logs", "asterpet.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, "");

  return message => {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  };
}

module.exports = { createLogger };
