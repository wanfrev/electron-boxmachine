# K11 Boxing - Manual de Instalacion Completo

Guia paso a paso para configurar una Raspberry Pi 3 B+ con FullPageOS desde cero.

---

## Requisitos

- Raspberry Pi 3 B+ con FullPageOS (basada en Raspbian 11 Bullseye)
- Cable HDMI para el monitor/TV
- Teclado USB (para la configuracion inicial)
- El proyecto K11 Boxing en tu PC

---

## 1. Conectar via SSH a la Raspberry Pi

Desde tu PC, conectate a la Pi:

```bash
ssh pi@<IP-DE-LA-PI>
```

Contrasena por defecto: `raspberry` (o la que hayas configurado).

Si no sabes la IP, conecta un teclado y monitor a la Pi y ejecuta:

```bash
hostname -I
```

---

## 2. Preparar el filesystem (lectura/escritura)

FullPageOS tiene el filesystem en modo read-only por defecto. Hay que remontarlo como escritura:

```bash
sudo mount -o remount,rw /
```

**Importante:** cada vez que reinicies y necesites instalar algo, repeti este paso.

---

## 3. Copiar el proyecto desde tu PC a la Pi

Desde **tu PC** (Windows PowerShell):

```bash
scp -r ui/dist pi@<IP>:/home/pi/k11-boxing/ui/dist
scp server.js package.json records.txt pi@<IP>:/home/pi/k11-boxing/
scp -r server pi@<IP>:/home/pi/k11-boxing/
scp k11-boxing.service pi@<IP>:/home/pi/k11-boxing/
```

Si la carpeta no existe, creala primero en la Pi:

```bash
mkdir -p /home/pi/k11-boxing/ui/dist /home/pi/k11-boxing/server
```

---

## 4. Instalar Node.js y npm (si no estan o falta npm)

Verificar versiones actuales:

```bash
node -v
npm -v
which node
```

Si `npm` no existe o la version de Node es muy vieja, instalar Node.js 20.x:

```bash
sudo mount -o remount,rw /
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
sudo apt-get update
sudo apt-get install nodejs -y
```

Verificar:

```bash
node -v   # Debe mostrar v20.x.x
npm -v    # Debe mostrar 10.x.x
```

---

## 5. Crear symlink de Node.js para systemd

El servicio systemd espera Node en `/usr/local/bin/node`. Si `which node` dice `/usr/bin/node`:

```bash
sudo ln -sf /usr/bin/node /usr/local/bin/node
```

Si dice otro path, ajustalo:

```bash
sudo ln -sf $(which node) /usr/local/bin/node
```

---

## 6. Instalar dependencias del proyecto

```bash
cd /home/pi/k11-boxing
npm install
```

El warning de `onoff` al fallar es normal si no hay headers de kernel. Es opcional y no afecta al juego (usa teclado como fallback).

---

## 7. Instalar servicios systemd

### 7a. Servicio del servidor Node.js

```bash
sudo cp /home/pi/k11-boxing/k11-boxing.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable k11-boxing
sudo systemctl start k11-boxing
```

Verificar que arranco:

```bash
sudo systemctl status k11-boxing
curl -s http://localhost:8000/api/info
```

Debe devolver JSON con `"name":"k11-boxing"`.

**Si falla con `status=200/CHDIR`**: verifica que la carpeta sea `/home/pi/k11-boxing`.

**Si falla con `status=203/EXEC`**: el symlink de Node.js no esta bien (revisa paso 5).

**Si falla con `MODULE_NOT_FOUND`**: falta `server.js` en `/home/pi/k11-boxing/` (revisa paso 3).

### 7b. Servicio del kiosko Chromium

Crear el archivo de servicio:

```bash
sudo tee /etc/systemd/system/k11-kiosk.service << 'EOF'
[Unit]
Description=K11 Kiosk Chromium
After=network-online.target k11-boxing.service
Wants=network-online.target k11-boxing.service

[Service]
Type=simple
User=pi
Environment=DISPLAY=:0
ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/chromium-browser --kiosk --no-sandbox http://localhost:8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable k11-kiosk
sudo systemctl start k11-kiosk
```

---

## 8. Actualizar Chromium (si es viejo)

```bash
sudo apt-get update
sudo apt-get install -y chromium-browser
chromium-browser --version
```

Debe ser version 126 o superior. Si la version 98 o anterior, va a crashear.

---

## 9. Limpiar /boot/fullpageos.txt

Asegurate de que solo tenga la URL correcta:

```bash
echo "FULLPAGEOS_URL=http://localhost:8000" | sudo tee /boot/fullpageos.txt
cat /boot/fullpageos.txt
```

No debe tener lineas extra como `http://localhost:8080`.

---

## 10. Rotar pantalla (si el monitor esta en vertical)

Editar `/boot/config.txt`:

```bash
sudo mount -o remount,rw /boot
echo "display_rotate=1" | sudo tee -a /boot/config.txt
```

- `display_rotate=1` = 90 grados (clockwise)
- `display_rotate=3` = 270 grados (counter-clockwise)

Para pantalla HDMI usar:

```bash
echo "display_hdmi_rotate=1" | sudo tee -a /boot/config.txt
```

---

## 11. Reiniciar y verificar

```bash
sudo reboot
```

Al reiniciar, la maquina debe:
1. Mostrar Chromium en pantalla completa con la UI de K11 Boxing
2. Responder al teclado: `C` = moneda, `Espacio` = golpe

Si algo falla, los comandos de diagnostico son:

```bash
# Estado de los servicios
sudo systemctl status k11-boxing
sudo systemctl status k11-kiosk

# Logs del servidor
sudo journalctl -u k11-boxing -n 30 --no-pager

# Logs del kiosko
sudo journalctl -u k11-kiosk -n 10 --no-pager

# Verificar que el servidor responde
curl -s http://localhost:8000/api/info

# Verificar que el HTML se sirve
curl -s http://localhost:8000/ | head -5
```

---

## Resumen de comandos rapidos

```bash
# Remontar filesystem RW
sudo mount -o remount,rw /

# Reiniciar servicios
sudo systemctl restart k11-boxing
sudo systemctl restart k11-kiosk

# Lanzar Chromium manualmente (para debug)
pkill -9 chromium 2>/dev/null
DISPLAY=:0 chromium-browser --kiosk --no-sandbox http://localhost:8000 &

# Ver IP de la maquina
hostname -I
```

---

## Archivos que deben existir en la Pi

```
/home/pi/k11-boxing/
├── server.js              ← Servidor principal
├── package.json           ← Dependencias npm
├── records.txt            ← Records guardados
├── k11-boxing.service     ← Servicio systemd del server
├── server/
│   ├── config.js
│   ├── scoring.js
│   └── updater.js
└── ui/
    └── dist/
        ├── index.html
        ├── k11icon.webp
        ├── k11icon.png
        ├── fonts/
        │   ├── aAtmospheric.ttf
        │   └── Acumin-Variable-Concept.woff2
        └── assets/
            ├── index-*.js
            └── index-*.css
```
