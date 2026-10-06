const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const projectRoot = path.resolve(__dirname, "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function packageJson(packageName, resolver = require) {
  const absolutePath = resolver.resolve(`${packageName}/package.json`);
  return readJson(path.relative(projectRoot, absolutePath));
}

function licenseValue(metadata) {
  if (typeof metadata.license === "string") return metadata.license;
  if (metadata.license && typeof metadata.license.type === "string") return metadata.license.type;
  if (Array.isArray(metadata.licenses)) return metadata.licenses.map(item => item.type).join(" OR ");
  return "";
}

function assert(condition, message) {
  if (!condition) throw new Error(`License check failed: ${message}`);
}

const spinePlayerRequire = createRequire(require.resolve("@esotericsoftware/spine-player/package.json"));
const spineWebglRequire = createRequire(spinePlayerRequire.resolve("@esotericsoftware/spine-webgl/package.json"));
const expectedPackages = [
  ["electron", "MIT"],
  ["extract-zip", "BSD-2-Clause"],
  ["@esotericsoftware/spine-player", "LicenseRef-LICENSE"],
  ["@esotericsoftware/spine-core", "LicenseRef-LICENSE", spineWebglRequire],
  ["@esotericsoftware/spine-webgl", "LicenseRef-LICENSE", spinePlayerRequire]
];

for (const [name, expectedLicense, resolver] of expectedPackages) {
  const metadata = packageJson(name, resolver);
  assert(licenseValue(metadata) === expectedLicense, `${name} declares ${licenseValue(metadata) || "no license"}, expected ${expectedLicense}`);
}

const requiredFiles = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md",
  "licenses/ELECTRON-LICENSE.txt",
  "licenses/EXTRACT-ZIP-LICENSE.txt",
  "licenses/SPINE-RUNTIMES-LICENSE.txt"
];
for (const relativePath of requiredFiles) {
  const absolutePath = path.join(projectRoot, relativePath);
  assert(fs.statSync(absolutePath).isFile(), `${relativePath} is missing`);
}

const spineLicense = fs.readFileSync(path.join(projectRoot, "licenses/SPINE-RUNTIMES-LICENSE.txt"), "utf8");
assert(spineLicense.includes("Spine Runtimes License Agreement"), "Spine runtime license text is incomplete");
assert(spineLicense.includes("Esoteric Software LLC"), "Spine runtime copyright notice is missing");

const electronLicense = fs.readFileSync(path.join(projectRoot, "licenses/ELECTRON-LICENSE.txt"), "utf8");
assert(electronLicense.includes("Permission is hereby granted"), "Electron MIT license text is incomplete");

const notices = fs.readFileSync(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
assert(notices.includes("independently confirm") && notices.includes("Spine Runtime"), "Spine redistribution warning is missing");

console.log("License policy checks passed");
