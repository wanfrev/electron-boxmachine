# K11 Boxing - Máquina Arcade de Boxeo

Arquitectura **Node.js nativo + Chromium Kiosk** sobre **FullPageOS** para Raspberry Pi 3 B+.

Sin Electron, sin Python. Máxima fluidez, mínimo consumo de RAM, OTA updates.

---

## Requisitos

- Raspberry Pi 3 B+ (ARMv7l)
- FullPageOS v2024+ flasheada en la SD
- Cable HDMI para monitor de 32"
- Monedero mecánico (pin GPIO 22) o modo teclado
- Sensores de impacto (pines GPIO 5 y 6)

---

## Instalación en FullPageOS (rápida)

```bash
# 1. Desde tu PC, copias el proyecto a la Pi
scp -r maquina_nueva pi@192.168.x.x:/home/pi/k11-boxing

# 2. SSH a la Pi
ssh pi@192.168.x.x

# 3. Ejecutas el setup
cd /home/pi/k11-boxing
chmod +x setup-fullpageos.sh
./setup-fullpageos.sh

# 4. Reiniciás
sudo reboot
```

Al reiniciar:
1. El servidor Node.js arranca automáticamente en `http://localhost:8000`
2. FullPageOS abre Chromium en pantalla completa apuntando a `http://localhost:8000`
3. La máquina está operativa

---

## Arquitectura

```
Raspberry Pi 3 B+
├── systemd: k11-boxing.service
│   └── Node.js (server.js)        ← Cerebro del juego
│       ├── GPIO (onoff)           ← Monedero + sensores
│       ├── HTTP server (8000)      ← Sirve UI + API REST
│       ├── SSE events              ← Estado en tiempo real
│       └── OTA updater             ← Actualización remota
│
└── FullPageOS
    └── Chromium --kiosk            ← Renderiza UI Svelte
        └── http://localhost:8000   ← Conexión local
```

### APIs del servidor

| Endpoint | Método | Descripción |
|---|---|---|
| `/api/state` | GET | Estado actual del juego |
| `/api/coin` | POST | Insertar crédito |
| `/api/pera-abajo` | POST | Señal de pera en reposo |
| `/api/punch` | POST | Golpe simulado (body: `{score}`) |
| `/api/events` | GET | SSE stream en tiempo real |
| `/api/info` | GET | Info del sistema (versión, PID, uptime) |
| `/api/update` | POST | OTA update (body: `{"url": "..."}`) |

### Estados del juego

`attract` → `waiting` → `countdown` → `ready` → `animating` → `result`

---

## Modo desarrollo (desde PC)

```bash
cd maquina_nueva

# Instalar dependencias
npm install
cd ui && npm install && cd ..

# Terminal 1: Servidor Node
npm run dev:server

# Terminal 2: Vite hot-reload
npm run dev
```

Vite proxy automático: `/api/*` → `http://localhost:8000`.

Teclas en desarrollo: `C/M` = moneda, `Espacio` = golpe, `Q` = salir.

---

## Actualización remota (OTA)

### Desde la API (recomendado)

Cualquier máquina puede recibir un update via HTTP:

```bash
curl -X POST http://<ip-maquina>:8000/api/update \
  -H "Content-Type: application/json" \
  -d '{"url": "https://tu-cdn.com/k11-v2.1.0.tar.gz"}'
```

El servidor descarga el `.tar.gz`, extrae los archivos, los aplica y reinicia el servicio.

### Manual vía SSH

```bash
./update-fullpageos.sh https://tu-cdn.com/k11-v2.1.0.tar.gz
```

### Estructura del .tar.gz de actualización

```
k11-v2.1.0.tar.gz
├── dist/              → reemplaza ui/dist/
├── server/            → reemplaza server/*.js
├── server.js          → reemplaza server.js (root)
└── package.json       → reemplaza package.json
```

### FullPageOS + read-only filesystem

El updater detecta automáticamente si el filesystem está en modo read-only (por defecto en FullPageOS) y lo remonta RW durante la actualización. Al finalizar lo restaura a RO.

---

## Configuración de FullPageOS

El `setup-fullpageos.sh` configura automáticamente la URL en `/boot/fullpageos.txt`:

```
FULLPAGEOS_URL=http://localhost:8000
```

Si necesitás cambiarla manualmente:

```bash
sudo nano /boot/fullpageos.txt
# Cambiar la línea: FULLPAGEOS_URL=http://localhost:8000
sudo reboot
```

---

## Gestión del servicio

```bash
sudo systemctl status k11-boxing   # Estado
sudo systemctl restart k11-boxing  # Reiniciar
sudo journalctl -u k11-boxing -f   # Logs en vivo
```

---

## GPIO (pines físicos)

| Pin | Señal | Edge | Debounce |
|-----|-------|------|----------|
| 22  | Monedero | Rising | 500ms |
| 5   | Sensor inferior (pera en reposo) | Both | 10ms |
| 6   | Sensor superior (impacto) | Both | 10ms |

Detectan el tiempo de recorrido del puñal entre reposo e impacto y lo convierten en puntaje vía tabla de interpolación.

---

## Disclaimer

Este es un proyecto comercial privado. No incluye garantía ni soporte.
# svelte-k11boxmachine
# svelte-k11boxmachine
