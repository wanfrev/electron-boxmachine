const http = require('http');
const https = require('https');
const fs = require('fs');
const {
  IOT_BACKEND_URL,
  MACHINE_ID,
  IOT_PING_INTERVAL_MS,
  IOT_RETRY_INTERVAL_MS,
  IOT_OFFLINE_FILE,
  PIN_ENERGIA,
  WDT_ENABLED,
  WDT_FEED_INTERVAL_MS,
  WDT_DEVICE,
  POWER_SENSOR_DEBOUNCE_MS,
} = require('./config');

class IotReporter {
  constructor(logFn) {
    this.log = logFn || console.log;
    this.queue = [];
    this.online = false;
    this.pingTimer = null;
    this.retryTimer = null;
    this.powerSensor = null;
    this.wdtFd = null;
    this.wdtTimer = null;
    this.lastPowerState = null;
    this.lastPowerChangeMs = 0;
    this._loadQueue();
    this._initPowerSensor();
    this._initWatchdog();
    this._startHeartbeat();
    this._reportPowerOn();
  }

  stop() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.wdtTimer) clearInterval(this.wdtTimer);
    if (this.wdtFd) {
      try { fs.writeSync(this.wdtFd, 'V'); fs.closeSync(this.wdtFd); } catch {}
      this.wdtFd = null;
    }
    if (this.powerSensor) {
      try { this.powerSensor.unexport(); } catch {}
      this.powerSensor = null;
    }
    if (this.lastPowerState === true) {
      this._reportPowerOff();
    }
  }

  _initPowerSensor() {
    try {
      const Gpio = require('onoff').Gpio;
      this.powerSensor = new Gpio(PIN_ENERGIA, 'in', 'both', {
        debounceTimeout: POWER_SENSOR_DEBOUNCE_MS,
      });
      const initial = this.powerSensor.readSync();
      this.lastPowerState = (initial === 0);
      this.log('[IOT] Sensor energia GPIO%d: maquina %s',
        PIN_ENERGIA, this.lastPowerState ? 'ENCENDIDA' : 'APAGADA');

      this.powerSensor.watch((err, value) => {
        if (err) return;
        const isOn = (value === 0);
        if (isOn === this.lastPowerState) return;
        this.lastPowerState = isOn;
        this.lastPowerChangeMs = Date.now();
        if (this.lastPowerState) {
          this._reportPowerOn();
        } else {
          this._reportPowerOff();
        }
      });
    } catch (e) {
      this.powerSensor = null;
      this.log('[IOT] Sensor energia GPIO no disponible: %s', e.message);
    }
  }

  _initWatchdog() {
    if (!WDT_ENABLED) return;
    try {
      this.wdtFd = fs.openSync(WDT_DEVICE, 'w');
      this.wdtTimer = setInterval(() => {
        try {
          fs.writeSync(this.wdtFd, '1');
        } catch {
          this.log('[IOT] Error alimentando WDT');
        }
      }, WDT_FEED_INTERVAL_MS);
      this.log('[IOT] Hardware Watchdog activado (%s cada %dms)',
        WDT_DEVICE, WDT_FEED_INTERVAL_MS);
    } catch (e) {
      this.wdtFd = null;
      this.log('[IOT] Watchdog no disponible: %s. Ejecuta sudo modprobe bcm2835_wdt', e.message);
    }
  }

  reportCoin() {
    const id = `${Date.now()}_C`;
    this._enqueue('MONEDA', 1, id);
  }

  reportPunch(score) {
    const id = `${Date.now()}_G`;
    this._enqueue('GOLPE', score, id);
  }

  _enqueue(eventType, cantidad, id_unico) {
    const payload = { eventType, cantidad, id_unico };
    if (this.online && this.machineValidated) {
      this._send(payload);
    } else {
      this.queue.push(payload);
      this._saveQueue();
      this.log('[IOT] Sin conexion, evento encolado: %s', eventType);
    }
  }

  _send(payload, retries = 3) {
    const data = {
      machineId: MACHINE_ID,
      event: payload.eventType,
      cantidad: payload.cantidad,
    };
    if (payload.id_unico) {
      data.id_unico = payload.id_unico;
    }
    const body = JSON.stringify(data);

    const url = new URL(IOT_BACKEND_URL);
    const proto = url.protocol === 'https:' ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 8000,
    };

    const attempt = (remaining) => {
      return new Promise((resolve) => {
        const req = proto.request(options, (res) => {
          let respData = '';
          res.on('data', (chunk) => { respData += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              this.online = true;
              this.log('[IOT] Enviado: %s cantidad=%s', payload.eventType, payload.cantidad);
              resolve(true);
            } else if (res.statusCode === 409 && payload.eventType === 'MONEDA') {
              this.online = true;
              this.log('[IOT] Duplicado ignorado por backend: %s', payload.id_unico);
              resolve(true);
            } else {
              this.online = false;
              this.log('[IOT] Backend respondio: %s', res.statusCode);
              if (remaining > 0) {
                setTimeout(() => attempt(remaining - 1).then(resolve), 1000);
              } else {
                resolve(false);
              }
            }
          });
        });

        req.on('error', () => {
          this.online = false;
          if (remaining > 0) {
            setTimeout(() => attempt(remaining - 1).then(resolve), 1000);
          } else {
            resolve(false);
          }
        });

        req.on('timeout', () => {
          req.destroy();
          this.online = false;
          if (remaining > 0) {
            setTimeout(() => attempt(remaining - 1).then(resolve), 1000);
          } else {
            resolve(false);
          }
        });

        req.write(body);
        req.end();
      });
    };

    return attempt(retries);
  }

  async _flushQueue() {
    while (this.queue.length > 0) {
      const payload = this.queue[0];
      const ok = await this._send(payload);
      if (ok) {
        this.queue.shift();
        this._saveQueue();
      } else {
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  _startHeartbeat() {
    this.machineValidated = false;
    this.pingTimer = setInterval(() => {
      if (!this.machineValidated) {
        this._validateMachine();
        return;
      }
      this._send({
        eventType: 'PING',
        cantidad: 0,
      });
      if (this.online && this.queue.length > 0) {
        this._flushQueue();
      }
    }, IOT_PING_INTERVAL_MS);

    if (this.queue.length > 0) {
      this._scheduleRetry();
    }
  }

  async _validateMachine() {
    const powerEvent = this.lastPowerState === true ? 'ENCENDIDO' : 'APAGADO';
    const ok = await this._send({
      eventType: powerEvent,
      cantidad: 0,
    });
    if (ok) {
      this.machineValidated = true;
      this.log('[IOT] Maquina validada en backend (%s), flush de cola...', powerEvent);
      this._flushQueue();
    }
  }

  _scheduleRetry() {
    if (this.retryTimer) return;
    const tick = async () => {
      if (this.queue.length === 0) {
        this.retryTimer = null;
        return;
      }
      if (this.online) {
        await this._flushQueue();
      }
      if (this.queue.length > 0) {
        this.retryTimer = setTimeout(tick, IOT_RETRY_INTERVAL_MS);
      } else {
        this.retryTimer = null;
      }
    };
    this.retryTimer = setTimeout(tick, IOT_RETRY_INTERVAL_MS);
  }

  _reportPowerOn() {
    if (this.lastPowerState === null) this.lastPowerState = true;
    this.machineValidated = false;
    this._send({
      eventType: 'ENCENDIDO',
      cantidad: 0,
    });
  }

  _reportPowerOff() {
    this.machineValidated = false;
    this.lastPowerState = false;
    this._send({
      eventType: 'APAGADO',
      cantidad: 0,
    });
  }

  _loadQueue() {
    try {
      if (fs.existsSync(IOT_OFFLINE_FILE)) {
        const content = fs.readFileSync(IOT_OFFLINE_FILE, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.eventType && parsed.cantidad !== undefined && parsed.id_unico) {
              this.queue.push(parsed);
            }
          } catch {}
        }
        if (this.queue.length > 0) {
          this.log('[IOT] Cargados %d eventos pendientes del disco', this.queue.length);
        }
      }
    } catch {}
  }

  _saveQueue() {
    try {
      const lines = this.queue.map((p) => JSON.stringify(p)).join('\n') + '\n';
      fs.writeFileSync(IOT_OFFLINE_FILE, lines, 'utf-8');
    } catch {}
  }
}

module.exports = { IotReporter };
