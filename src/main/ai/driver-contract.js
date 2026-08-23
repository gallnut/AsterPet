const REQUIRED_METHODS = [
  "getMetadata", "getConfig", "configure", "start", "stop", "respond", "cancel",
  "getLauncherData", "prepareConversation", "startConversation"
];

function assertExternalAiDriver(driver) {
  if (!driver || typeof driver !== "object") throw new TypeError("External AI driver must be an object");
  for (const method of REQUIRED_METHODS) {
    if (typeof driver[method] !== "function") throw new TypeError(`External AI driver is missing ${method}()`);
  }
  const metadata = driver.getMetadata();
  if (!metadata?.id || !metadata?.name) throw new TypeError("External AI driver metadata requires id and name");
  return driver;
}

module.exports = { assertExternalAiDriver };
