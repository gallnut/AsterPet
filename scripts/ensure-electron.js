const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

async function extractElectron(zipPath, destination, electronRequire) {
  const nodeMajor = Number(process.versions.node.split('.')[0]);

  if (nodeMajor < 26) {
    const extract = electronRequire('extract-zip');
    await extract(zipPath, { dir: destination });
    return;
  }

  if (process.platform === 'win32') {
    execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      'Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force',
      zipPath,
      destination,
    ], { stdio: 'inherit' });
    return;
  }

  execFileSync('unzip', ['-o', zipPath, '-d', destination], { stdio: 'ignore' });
}

async function main() {
  const electronPackagePath = require.resolve('electron/package.json');
  const electronDirectory = path.dirname(electronPackagePath);
  const electronRequire = createRequire(electronPackagePath);
  const electronPackage = electronRequire('./package.json');
  const executableName = process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron';
  const executablePath = path.join(electronDirectory, 'dist', executableName);
  const pathFile = path.join(electronDirectory, 'path.txt');

  if (fs.existsSync(executablePath) && fs.existsSync(pathFile)) {
    return;
  }

  const { downloadArtifact } = electronRequire('@electron/get');
  const zipPath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.arch,
    checksums: electronRequire('./checksums.json'),
  });

  await extractElectron(zipPath, path.join(electronDirectory, 'dist'), electronRequire);
  await fs.promises.writeFile(pathFile, executableName);
  console.log(`Electron ${electronPackage.version} binary is ready.`);
}

const keepAlive = setInterval(() => {}, 1000);

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
