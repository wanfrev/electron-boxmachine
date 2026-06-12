const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');

function log(msg, ...args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (args.length > 0) {
    try { msg = msg.replace(/%[ds]/g, () => args.shift()); } catch {}
  }
  console.log(`[${ts}] [UPDATER] ${msg}`);
}

function fsIsReadOnly() {
  try {
    const testFile = path.join(__dirname, '..', '.write-test');
    fs.writeFileSync(testFile, 'x');
    fs.unlinkSync(testFile);
    return false;
  } catch {
    return true;
  }
}

function remountRW() {
  try {
    execSync('sudo mount -o remount,rw /', { stdio: 'pipe' });
    log('Filesystem remontado RW');
  } catch (e) {
    log('No se pudo remontar RW: %s', e.message);
    throw e;
  }
}

function remountRO() {
  try {
    execSync('sync');
    execSync('sudo mount -o remount,ro /', { stdio: 'pipe' });
    log('Filesystem remontado RO');
  } catch (e) {
    log('Aviso: no se pudo restaurar RO: %s', e.message);
  }
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function extractTarGz(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' });
}

function restartService() {
  try {
    execSync('sudo systemctl restart k11-boxing', { stdio: 'pipe' });
    log('Servicio k11-boxing reiniciado via systemd');
  } catch {
    log('systemctl fallo. Reiniciando proceso a mano...');
    const appDir = path.join(__dirname, '..');
    const args = process.argv.slice(1);
    spawn(process.execPath, args, {
      cwd: appDir,
      detached: true,
      stdio: 'inherit',
    });
    process.exit(0);
  }
}

async function applyUpdate(updateUrl) {
  const appDir = path.join(__dirname, '..');
  const tmpDir = path.join('/tmp', 'k11-update');
  const archivePath = path.join(tmpDir, 'update.tar.gz');

  log('Iniciando actualizacion desde: %s', updateUrl);

  const wasRO = fsIsReadOnly();
  if (wasRO) {
    log('Filesystem read-only detectado. Remontando RW...');
    remountRW();
  }

  try {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });

    log('Descargando actualizacion...');
    await downloadFile(updateUrl, archivePath);

    log('Extrayendo archivos...');
    const extractDir = path.join(tmpDir, 'extracted');
    extractTarGz(archivePath, extractDir);

    log('Aplicando actualizacion...');

    const srcDist = path.join(extractDir, 'dist');
    if (fs.existsSync(srcDist)) {
      const uiDist = path.join(appDir, 'ui', 'dist');
      if (fs.existsSync(uiDist)) {
        fs.rmSync(uiDist, { recursive: true, force: true });
      }
      fs.cpSync(srcDist, uiDist, { recursive: true });
      log('UI dist actualizada.');
    }

    const srcServer = path.join(extractDir, 'server');
    if (fs.existsSync(srcServer)) {
      const destServer = path.join(appDir, 'server');
      const files = fs.readdirSync(srcServer);
      for (const file of files) {
        const src = path.join(srcServer, file);
        const dest = path.join(destServer, file);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
      }
      log('server/ actualizado.');
    }

    const srcServerJs = path.join(extractDir, 'server.js');
    if (fs.existsSync(srcServerJs)) {
      fs.copyFileSync(srcServerJs, path.join(appDir, 'server.js'));
      log('server.js actualizado.');
    }

    const srcPackageJson = path.join(extractDir, 'package.json');
    if (fs.existsSync(srcPackageJson)) {
      fs.copyFileSync(srcPackageJson, path.join(appDir, 'package.json'));
      log('package.json actualizado.');
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    log('Archivos temporales limpiados.');

    if (wasRO) {
      sync();
      remountRO();
    }

    log('Actualizacion aplicada. Reiniciando servicio...');
    restartService();

  } catch (err) {
    log('Error en actualizacion: %s', err.message);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    if (wasRO) {
      try { remountRO(); } catch {}
    }
    throw err;
  }
}

module.exports = { applyUpdate };
