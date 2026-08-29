const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto")
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const distDirectory = path.join(projectRoot, "dist");
const packageInfo = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const arch = process.env.ASTERPET_ARCH || process.arch;
const electronVersion = packageInfo.devDependencies.electron;
const electronArchiveName = `electron-v${electronVersion}-darwin-${arch}.zip`;
const electronZipDirectory = path.join(projectRoot, "build", "electron-zips");
const electronZipPath = path.join(electronZipDirectory, electronArchiveName);
const appPath = path.join(distDirectory, `AsterPet-darwin-${arch}`, "AsterPet.app");
const stagingDirectory = path.join(distDirectory, `.asterpet-dmg-${process.pid}`);
const dmgPath = path.join(distDirectory, `AsterPet-${packageInfo.version}-mac-${arch}.dmg`);

function run(command, args) {
    const result = spawnSync(command, args, { cwd: projectRoot, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status || 1);
}

function fileSha256(filePath) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function ensureElectronArchive() {
    const checksums = JSON.parse(fs.readFileSync(require.resolve("electron/checksums.json"), "utf8"));
    const expectedChecksums = checksums[electronArchiveName];
    if (!expectedChecksums) throw new Error(`Missing checksums for ${electronArchiveName}`);

    fs.mkdirSync(electronZipDirectory, { recursive: true });
    const temporaryPath = `${electronZipPath}.${process.pid}.download`;
    fs.rmSync(temporaryPath, { force: true });
    const proxy = process.env.GLOBAL_AGENT_HTTPS_PROXY || process.env.GLOBAL_AGENT_HTTP_PROXY;
    const args = [
        "--fail",
        "--location",
        "--retry", "3",
        "--output", temporaryPath,
        `https://github.com/electron/electron/releases/download/v${electronVersion}/${electronArchiveName}`
    ];
    if (proxy) args.unshift("--proxy", proxy);
    run("curl", args);
    const actualChecksum = fileSha256(temporaryPath);
    if (actualChecksum !== expectedChecksums) {
        fs.rmSync(temporaryPath, { force: true });
        throw new Error(`Checksum mismatch for ${electronArchiveName}`);
    }
    fs.renameSync(temporaryPath, electronZipPath);
}

if (process.platform !== "darwin") {
    throw new Error("The macOS installer must be build on macOS.");
}

ensureElectronArchive();
process.env.ASTERPET_ELECTRON_ZIP_DIR = electronZipDirectory;
fs.mkdirSync(distDirectory, { recursive: true });
run(process.execPath, [path.join(__dirname, "pack.js"), "darwin"]);

if (!fs.existsSync(appPath)) throw new Error(`Packaged app was not found: ${appPath}`);

run("codesign", ["--force", "--deep", "--sign", "-", appPath]);

fs.rmSync(stagingDirectory, { recursive: true, force: true });
fs.mkdirSync(stagingDirectory, { recursive: true });
try {
    const stagedAppPath = path.join(stagingDirectory, "AsterPet.app");
    run("ditto", [appPath, stagedAppPath]);
    run("codesign", ["--verify", "--deep", "--strict", stagedAppPath]);
    fs.symlinkSync("/Applications", path.join(stagingDirectory, "Applications"));
    fs.rmSync(dmgPath, { force: true });
    run("hdiutil", [
        "create",
        "-volname", "AsterPet",
        "-srcfolder", stagingDirectory,
        "-format", "UDZO",
        "-ov",
        dmgPath
    ]);
} finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
}

process.stdout.write(`macOS app: ${appPath}\n`);
process.stdout.write(`macOS installer: ${dmgPath}\n`);