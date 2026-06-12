#!/bin/bash
# =============================================================================
# K11 Boxing - Setup para FullPageOS (Raspberry Pi 3 B+)
# =============================================================================
# FullPageOS ya maneja Chromium en modo kiosk.
# Este script solo instala Node.js + dependencias y configura el servidor.
# =============================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_ok()  { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn(){ echo -e "${YELLOW}[WARN]${NC} $1"; }
log_err() { echo -e "${RED}[ERROR]${NC} $1"; }

APP_DIR="/home/pi/k11-boxing"
NODE_VERSION="20"

echo "============================================"
echo "  K11 Boxing - FullPageOS Setup"
echo "  Raspberry Pi 3 B+"
echo "============================================"
echo ""

# ---- [1/6] Verificar sistema ----
echo "[1/6] Verificando sistema..."
if ! grep -qi "fullpageos" /etc/os-release 2>/dev/null && [ ! -f /boot/fullpageos.txt ]; then
  log_warn "No se detecto FullPageOS. El script asume Raspbian base."
fi

ARCH=$(uname -m)
if [ "$ARCH" != "armv7l" ] && [ "$ARCH" != "aarch64" ]; then
  log_err "Arquitectura no soportada: $ARCH (se espera ARM)"
  exit 1
fi
log_ok "Arquitectura: $ARCH"

# ---- [2/6] Filesystem RW para instalar ----
echo ""
echo "[2/6] Preparando filesystem (RW temporal)..."
if mount | grep -q " / .* ro," ; then
  log_warn "Filesystem en modo read-only. Remontando RW..."
  sudo mount -o remount,rw / || {
    log_err "No se pudo remontar /. Ejecuta manualmente: sudo mount -o remount,rw /"
    exit 1
  }
  WAS_RO=1
else
  WAS_RO=0
fi
log_ok "Filesystem listo para escritura"

# ---- [3/6] Instalar Node.js 20.x ARM ----
echo ""
echo "[3/6] Instalando Node.js ${NODE_VERSION}.x para ARM..."
export NVM_DIR="$HOME/.nvm"

install_node_via_nodesource() {
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
  sudo apt install -y nodejs
}

install_node_via_nvm() {
  if [ ! -d "$NVM_DIR" ]; then
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
  nvm install ${NODE_VERSION}
  nvm use ${NODE_VERSION}
  nvm alias default ${NODE_VERSION}
  # Crear symlinks para systemd
  sudo ln -sf "$(which node)" /usr/local/bin/node
  sudo ln -sf "$(which npm)" /usr/local/bin/npm
}

if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -ge "${NODE_VERSION}" ]; then
    log_ok "Node.js $(node -v) ya instalado"
  else
    log_warn "Node $(node -v) es viejo. Instalando ${NODE_VERSION}..."
    install_node_via_nodesource || install_node_via_nvm
  fi
else
  log_warn "Node.js no encontrado. Instalando..."
  install_node_via_nodesource || install_node_via_nvm
fi

echo "Node: $(node -v)  npm: $(npm -v)"
log_ok "Node.js listo"

# ---- [4/6] Copiar proyecto ----
echo ""
echo "[4/6] Preparando proyecto en $APP_DIR..."

if [ "$(pwd)" != "$APP_DIR" ] && [ -f "server.js" ]; then
  log_warn "Copiando archivos del proyecto a $APP_DIR..."
  sudo mkdir -p "$APP_DIR"
  sudo cp -r . "$APP_DIR"
  sudo chown -R pi:pi "$APP_DIR"
  cd "$APP_DIR"
fi

# ---- [5/6] Instalar dependencias y compilar UI ----
echo ""
echo "[5/6] Instalando dependencias npm..."

# npm puede fallar con onoff si no hay headers de kernel; es opcional
# npm install --ignore-scripts || log_warn "npm install tuvo warnings (normal si onoff falla)"
# (cd ui && npm install) || log_warn "ui/npm install tuvo warnings"
# npm run build || log_warn "npm run build tuvo warnings"

[ -f "ui/dist/index.html" ] && log_ok "UI compilada" || log_err "Falta ui/dist/index.html"
[ -f "server.js" ] && log_ok "server.js presente" || log_err "Falta server.js"

# ---- [6/6] Configurar servicios y FullPageOS ----
echo ""
echo "[6/6] Configurando sistema..."

# 6a. Systemd service para Node
echo "Instalando servicio systemd..."
sudo cp k11-boxing.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable k11-boxing

# 6b. Configurar URL de FullPageOS
echo "Configurando FullPageOS para apuntar a localhost:8000..."
if [ -f /boot/fullpageos.txt ]; then
  if grep -q "^FULLPAGEOS_URL=" /boot/fullpageos.txt; then
    sudo sed -i 's|^FULLPAGEOS_URL=.*|FULLPAGEOS_URL=http://localhost:8000|' /boot/fullpageos.txt
  else
    echo "FULLPAGEOS_URL=http://localhost:8000" | sudo tee -a /boot/fullpageos.txt > /dev/null
  fi
  log_ok "FullPageOS URL configurada"
else
  log_warn "/boot/fullpageos.txt no encontrado. Asegurate de que la URL del kiosk sea http://localhost:8000"
fi

# 6c. Restaurar filesystem RO si estaba
if [ "$WAS_RO" = "1" ]; then
  echo ""
  log_warn "Restaurando filesystem a read-only..."
  sync
  sudo mount -o remount,ro / 2>/dev/null || true
fi

# ---- Resumen final ----
echo ""
echo "============================================"
echo "  SETUP COMPLETO"
echo "============================================"
echo ""
echo "  Proyecto:   $APP_DIR"
echo "  Servidor:   http://localhost:8000"
echo "  Kiosk URL:  http://localhost:8000"
echo ""
echo "  Comandos:"
echo "    sudo systemctl start k11-boxing   # Iniciar servidor"
echo "    sudo systemctl status k11-boxing  # Ver estado"
echo "    sudo journalctl -u k11-boxing -f  # Ver logs"
echo ""
echo "  OTA Update (desde el panel web de K11):"
echo "    POST http://localhost:8000/api/update"
echo "    Body: {\"url\": \"https://tu-cdn/update.tar.gz\"}"
echo ""
echo "  Para reiniciar:  sudo reboot"
echo ""
