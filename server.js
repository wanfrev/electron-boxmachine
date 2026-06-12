const http = require('http');
const fs = require('fs');
const path = require('path');
const {
  PIN_MONEDERO, PIN_SENSOR_ABAJO, PIN_SENSOR_ARRIBA,
  DEBOUNCE_COIN_MS, MAX_PUNCH_WINDOW_MS, MIN_PUNCH_DT_US,
  STATE_ATTRACT, STATE_WAITING, STATE_COUNTDOWN, STATE_READY,
  STATE_ANIMATING, STATE_RESULT,
  COUNTDOWN_DURATION_MS, ANIMATION_DURATION_MS, RESULT_DISPLAY_MS,
  READY_TIMEOUT_MS, RECORDS_FILE, DEFAULT_RECORDS,
} = require('./server/config');
const { calcularPuntaje } = require('./server/scoring');
const { applyUpdate } = require('./server/updater');

const PORT = 8000;
const DIST_DIR = path.join(__dirname, 'ui', 'dist');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

function log(msg, ...args) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  if (args.length > 0) {
    try { msg = msg.replace(/%[ds]/g, () => args.shift()); } catch {}
  }
  console.log(`[${ts}] ${msg}`);
}

class HardwareInput {
  constructor(eventCallback) {
    this.eventCallback = eventCallback;
    this.golpeArmado = false;
    this.tInicioGolpe = 0;
    this.peraAbajoLatch = false;
    this.ultimoCoinMs = 0;
    this.gpio = null;
    this._initGPIO();
  }

  _initGPIO() {
    try {
      const Gpio = require('onoff').Gpio;
      const coin = new Gpio(PIN_MONEDERO, 'in', 'rising', { debounceTimeout: DEBOUNCE_COIN_MS });
      const abajo = new Gpio(PIN_SENSOR_ABAJO, 'in', 'both', { debounceTimeout: 10 });
      const arriba = new Gpio(PIN_SENSOR_ARRIBA, 'in', 'both', { debounceTimeout: 10 });

      coin.watch((err) => {
        if (!err) this._onCoin();
      });
      abajo.watch((err, value) => {
        if (err) return;
        if (value === 1) this._onPosiblePeraAbajo();
        else this._onPeraIniciaSubida();
      });
      arriba.watch((err, value) => {
        if (err) return;
        if (value === 1) this._onPosiblePeraAbajo();
        else this._onPeraGolpeaTope();
      });

      this.gpio = { coin, abajo, arriba };
      log('GPIO listo. Pines: COIN=%d, ABAJO=%d, ARRIBA=%d',
          PIN_MONEDERO, PIN_SENSOR_ABAJO, PIN_SENSOR_ARRIBA);
    } catch (e) {
      this.gpio = null;
      log('GPIO no disponible (%s). Usando solo API HTTP.', e.message);
    }
  }

  get hardwareConectado() { return this.gpio !== null; }

  stop() {
    if (this.gpio) {
      Object.values(this.gpio).forEach(pin => {
        try { pin.unexport(); } catch {}
      });
      this.gpio = null;
    }
  }

  armarGolpe() {
    this.golpeArmado = true;
    this.tInicioGolpe = 0;
    log('Golpe armado');
  }

  cancelarGolpe() {
    this.golpeArmado = false;
    this.tInicioGolpe = 0;
    this.peraAbajoLatch = false;
  }

  handleKey(key) {
    if (key === 'c' || key === 'm') {
      this._onCoin();
    } else if (key === ' ') {
      if (this.golpeArmado) {
        const score = Math.floor(Math.random() * 700) + 300;
        log('Golpe simulado por teclado: score=%d', score);
        this._emit('punch', { score });
      } else {
        log('Pera abajo simulada por teclado');
        this._emit('pera_abajo');
      }
    }
    if (key === 'q') this._emit('quit');
  }

  _emit(eventType, kwargs = {}) {
    try { this.eventCallback(eventType, kwargs); } catch {}
  }

  _onCoin() {
    const ahoraMs = Date.now();
    if ((ahoraMs - this.ultimoCoinMs) < DEBOUNCE_COIN_MS) return;
    if (this.gpio && this.gpio.coin.readSync() === 1) return;
    this.ultimoCoinMs = ahoraMs;
    log('Moneda detectada');
    this._emit('coin');
  }

  _onPosiblePeraAbajo() {
    if (!this.gpio) return;
    if (this.gpio.abajo.readSync() !== 1 || this.gpio.arriba.readSync() !== 1) {
      this.peraAbajoLatch = false;
      return;
    }
    if (this.peraAbajoLatch) return;
    this.peraAbajoLatch = true;
    log('Pera abajo (ambos sensores)');
    this._emit('pera_abajo');
  }

  _onPeraIniciaSubida() {
    this.peraAbajoLatch = false;
    if (!this.golpeArmado) return;
    if (this.gpio && this.gpio.arriba.readSync() !== 1) {
      this.cancelarGolpe();
      return;
    }
    this.tInicioGolpe = performance.now();
    log('Pera inicia subida - temporizador iniciado');
  }

  _onPeraGolpeaTope() {
    if (!this.golpeArmado || this.tInicioGolpe <= 0) return;

    const dt = (performance.now() - this.tInicioGolpe) / 1000;
    const dtUs = dt * 1_000_000;

    if (dtUs < MIN_PUNCH_DT_US) {
      log('Golpe ignorado: dt=%dus < minimo', dtUs);
      this.cancelarGolpe();
      return;
    }
    if (dt > (MAX_PUNCH_WINDOW_MS / 1000)) {
      log('Golpe ignorado: dt=%.3fs > ventana=%dms', dt, MAX_PUNCH_WINDOW_MS);
      this.cancelarGolpe();
      return;
    }

    this.cancelarGolpe();
    const score = calcularPuntaje(dt);
    log('Golpe! tiempo=%.3fs score=%d', dt, score);
    this._emit('punch', { score });
  }
}

class Game {
  constructor() {
    this.state = STATE_ATTRACT;
    this.credits = 0;
    this.score = 0;
    this.newRecord = false;
    this.records = [...DEFAULT_RECORDS];
    this.timers = new Set();
    this.hardware = null;
    this.sseClients = new Set();
    this._loadRecords();
  }

  start() {
    this.hardware = new HardwareInput((eventType, kwargs) => {
      this._onHwEvent(eventType, kwargs);
    });
    this._broadcastState();
  }

  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.hardware) this.hardware.stop();
    this._saveRecords();
  }

  getState() {
    return this._buildPayload();
  }

  handleCoin() {
    this._onCoin();
  }

  handlePunchReady() {
    this._onPeraAbajo();
  }

  handleSimulatedPunch(score) {
    this._onPunch(score);
  }

  handleKey(key) {
    if (this.hardware) this.hardware.handleKey(key);
  }

  addSSEClient(res) {
    this.sseClients.add(res);
    res.on('close', () => this.sseClients.delete(res));
  }

  _onHwEvent(eventType, kwargs) {
    if (eventType === 'coin') this._onCoin();
    else if (eventType === 'pera_abajo') this._onPeraAbajo();
    else if (eventType === 'punch') this._onPunch(kwargs.score || 0);
    else if (eventType === 'quit') this._onQuit();
  }

  _onQuit() {
    log('Evento quit recibido - cerrando...');
    this.stop();
    process.exit(0);
  }

  _onCoin() {
    if (this.state === STATE_ATTRACT || this.state === STATE_RESULT) {
      this._cancelTimers();
    }
    this.credits += 1;
    log('Credito insertado. Total: %d', this.credits);
    if (this.state === STATE_ATTRACT || this.state === STATE_RESULT) {
      this._setState(STATE_WAITING);
    } else {
      this._broadcastState();
    }
  }

  _onPeraAbajo() {
    if (this.state === STATE_WAITING && this.credits > 0) {
      if (this.hardware) this.hardware.cancelarGolpe();
      this._setState(STATE_COUNTDOWN);
      this._schedule(() => this._onCountdownDone(), COUNTDOWN_DURATION_MS);
    }
  }

  _onPunch(score) {
    if (this.state !== STATE_READY || this.credits <= 0) {
      if (this.hardware) this.hardware.cancelarGolpe();
      return;
    }
    this.credits -= 1;
    this.score = score;
    log('Puntaje: %d. Creditos restantes: %d', score, this.credits);
    this._setState(STATE_ANIMATING);
    this._schedule(() => this._onAnimDone(), ANIMATION_DURATION_MS);
  }

  _onCountdownDone() {
    if (this.hardware) this.hardware.armarGolpe();
    this._setState(STATE_READY);
    this._schedule(() => this._onReadyTimeout(), READY_TIMEOUT_MS);
  }

  _onReadyTimeout() {
    if (this.hardware) this.hardware.cancelarGolpe();
    this._setState(STATE_WAITING);
  }

  _onAnimDone() {
    const isNew = this.records.length === 0 || this.score > this.records[0];
    if (isNew) {
      this.records.push(this.score);
      this.records.sort((a, b) => b - a);
      this.records = this.records.slice(0, 3);
      this._saveRecords();
      log('Nuevo record: %d', this.score);
    }
    this.newRecord = isNew;
    this._setState(STATE_RESULT);
    this._schedule(() => this._onResultDone(), RESULT_DISPLAY_MS);
  }

  _onResultDone() {
    if (this.credits > 0) {
      this._setState(STATE_WAITING);
    } else {
      this._setState(STATE_ATTRACT);
    }
  }

  _setState(newState) {
    const old = this.state;
    this.state = newState;
    log('Estado: %s -> %s (credits=%d)', old, newState, this.credits);
    this._broadcastState();
  }

  _broadcastState() {
    const payload = this._buildPayload();
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.sseClients) {
      try { res.write(data); } catch {}
    }
  }

  _buildPayload() {
    const payload = {
      state: this.state,
      credits: this.credits,
      records: this.records,
    };
    if (this.state === STATE_ANIMATING || this.state === STATE_RESULT) {
      payload.score = this.score;
    }
    if (this.state === STATE_RESULT) {
      payload.newRecord = this.newRecord;
    }
    return payload;
  }

  _schedule(fn, delayMs) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, delayMs);
    this.timers.add(t);
  }

  _cancelTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  _loadRecords() {
    try {
      if (fs.existsSync(RECORDS_FILE)) {
        const content = fs.readFileSync(RECORDS_FILE, 'utf-8');
        const lines = content.split('\n').filter(l => /^\d+$/.test(l.trim())).map(l => parseInt(l.trim(), 10));
        if (lines.length === 3) {
          this.records = lines;
          return;
        }
      }
    } catch {}
    this.records = [...DEFAULT_RECORDS];
  }

  _saveRecords() {
    try {
      fs.writeFileSync(RECORDS_FILE, this.records.map(r => `${r}`).join('\n') + '\n', 'utf-8');
    } catch {}
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
  });
}

function serveStatic(urlPath, res) {
  const filePath = urlPath === '/' || urlPath === ''
    ? path.join(DIST_DIR, 'index.html')
    : path.join(DIST_DIR, urlPath);

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      const indexFile = path.join(DIST_DIR, 'index.html');
      fs.readFile(indexFile, (err2, indexContent) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexContent);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

const game = new Game();
game.start();

function handleAPIRoute(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(game.getState()));
    return true;
  }

  if (pathname === '/api/coin' && req.method === 'POST') {
    game.handleCoin();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(game.getState()));
    return true;
  }

  if (pathname === '/api/pera-abajo' && req.method === 'POST') {
    game.handlePunchReady();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(game.getState()));
    return true;
  }

  if (pathname === '/api/punch' && req.method === 'POST') {
    parseBody(req).then(body => {
      const score = body.score || Math.floor(Math.random() * 700) + 300;
      game.handleSimulatedPunch(score);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(game.getState()));
    });
    return true;
  }

  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify(game.getState())}\n\n`);
    game.addSSEClient(res);
    return true;
  }

  if (pathname === '/api/info' && req.method === 'GET') {
    const info = {
      name: 'k11-boxing',
      version: require('./package.json').version,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptime: process.uptime(),
      hardwareConectado: game.hardware ? game.hardware.hardwareConectado : false,
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info));
    return true;
  }

  if (pathname === '/api/update' && req.method === 'POST') {
    parseBody(req).then(body => {
      const updateUrl = body.url;
      if (!updateUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Falta el parametro url' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'updating', message: 'Aplicando actualizacion...' }));
      applyUpdate(updateUrl).catch(err => {
        log('Error en OTA update: %s', err.message);
      });
    });
    return true;
  }

  return false;
}

function keyboardLoop() {
  if (!process.stdin.isTTY) return;
  const readline = require('readline');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on('keypress', (str, key) => {
    if (!str) return;
    const ch = str.toLowerCase();
    if (ch === 'c' || ch === 'm') {
      game.handleCoin();
    } else if (ch === ' ') {
      game.handleKey(' ');
    } else if (ch === 'q') {
      log('Tecla Q presionada - cerrando...');
      game.stop();
      process.exit(0);
    }
  });
}

const server = http.createServer((req, res) => {
  if (handleAPIRoute(req, res)) return;
  serveStatic(req.url, res);
});

server.listen(PORT, '0.0.0.0', () => {
  log('K11 Boxing corriendo en http://localhost:%d', PORT);
  log('Presiona C/M para moneda, SPACE para golpe, Q para salir');
  keyboardLoop();
});

process.on('SIGINT', () => {
  log('Apagando...');
  game.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('Apagando...');
  game.stop();
  process.exit(0);
});
