#!/bin/bash
set -e

echo "=== K11 Boxing - Setup para Raspberry Pi 3 B+ ==="

echo ""
echo "[1/5] Actualizando sistema..."
sudo apt update && sudo apt upgrade -y

echo ""
echo "[2/5] Instalando Node.js 20.x para ARMv7..."
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
  sudo apt install -y nodejs
fi
echo "Node: $(node -v)  npm: $(npm -v)"

echo ""
echo "[3/5] Instalando Firefox ESR..."
if ! command -v firefox &>/dev/null; then
  sudo apt install -y firefox-esr
fi

echo ""
echo "[4/5] Instalando dependencias npm..."
npm install

echo ""
echo "[5/5] Compilando UI de Svelte..."
npm run build

echo ""
echo "=== Setup completo ==="
echo ""
echo "Para iniciar la máquina:"
echo "  ./start.sh"
echo ""
echo "Para auto-inicio en boot:"
echo "  sudo cp k11-boxing.service /etc/systemd/system/"
echo "  sudo systemctl enable k11-boxing"
echo "  sudo systemctl start k11-boxing"
