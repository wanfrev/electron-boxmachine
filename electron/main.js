const {
  app, BrowserWindow, ipcMain
} = require('electron');
const path = require('path');
const fs = require('fs');
const {
  PIN_MONEDERO, PIN_SENSOR_ABAJO, PIN_SENSOR_ARRIBA,
  DEBOUNCE_COIN_MS, MAX_PUNCH_WINDOW_MS, MIN_PUNCH_DT_US,
  STATE_ATTRACT, STATE_WAITING, STATE_COUNTDOWN, STATE_READY,
  STATE_ANIMATING, STATE_RESULT,
  COUNTDOWN_DURATION_MS, ANIMATION_DURATION_MS, RESULT_DISPLAY_MS,
  READY_TIMEOUT_MS, RECORDS_FILE, DEFAULT_RECORDS,
} = require('./config');
const { calcularPuntaje } = require('./scoring');

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev');

if (process.platform === 'linux' && !isDev) {
  app.commandLine.appendSwitch('no-sandbox');
}

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
      log('GPIO no disponible (%s). Usando IPC teclado.', e.message);
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
    this.mainWindow = null;
    this._loadRecords();
  }

  setWindow(win) {
    this.mainWindow = win;
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

  _onHwEvent(eventType, kwargs) {
    if (eventType === 'coin') this._onCoin();
    else if (eventType === 'pera_abajo') this._onPeraAbajo();
    else if (eventType === 'punch') this._onPunch(kwargs.score || 0);
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
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send('state-update', this._buildPayload());
      } catch {}
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

let game = null;

function createWindow() {
  const mainWindow = new BrowserWindow({
    fullscreen: true,
    kiosk: !isDev,
    autoHideMenuBar: true,
    frame: isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'bottom' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'ui', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    game = null;
  });

  return mainWindow;
}

function setupIPC(win) {
  ipcMain.on('coin-input', () => {
    if (game) game.handleCoin();
  });

  ipcMain.on('punch-ready', () => {
    if (game) game.handlePunchReady();
  });

  ipcMain.on('punch-simulated', (_event, score) => {
    if (game) game.handleSimulatedPunch(score);
  });

  ipcMain.handle('get-state', () => {
    return game ? game.getState() : null;
  });

  ipcMain.on('key-input', (_event, key) => {
    if (game) game.handleKey(key);
  });
}

app.whenReady().then(() => {
  log('K11 Boxing - Iniciando...');

  game = new Game();
  const win = createWindow();
  game.setWindow(win);
  setupIPC(win);
  game.start();
});

app.on('window-all-closed', () => {
  if (game) game.stop();
  app.quit();
});

app.on('before-quit', () => {
  if (game) game.stop();
});
