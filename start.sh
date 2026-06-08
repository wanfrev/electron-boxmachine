#!/bin/bash
# K11 Boxing - Launcher para Raspberry Pi (Node.js + Firefox Kiosko)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== K11 Boxing - Iniciando ==="

# 1. Construir UI si no existe el dist
if [ ! -f "ui/dist/index.html" ]; then
  echo "Construyendo UI..."
  npm run build
fi

# 2. Matar instancias previas
pkill -f "node electron/main.js" 2>/dev/null || true
pkill -f "firefox.*kiosk.*localhost:8000" 2>/dev/null || true
sleep 1

# 3. Iniciar servidor Node (cerebro)
echo "Iniciando servidor Node en puerto 8000..."
node electron/main.js &
NODE_PID=$!

# 4. Esperar a que el servidor esté listo
echo "Esperando al servidor..."
for i in $(seq 1 10); do
  if curl -s http://localhost:8000/api/state >/dev/null 2>&1; then
    echo "Servidor listo."
    break
  fi
  if [ "$i" -eq 10 ]; then
    echo "ERROR: El servidor no respondió"
    kill $NODE_PID 2>/dev/null
    exit 1
  fi
  sleep 0.5
done

# 5. Abrir Firefox en modo kiosko (ojos)
echo "Abriendo Firefox en modo kiosko..."
firefox --kiosk http://localhost:8000 &
FIREFOX_PID=$!

echo ""
echo "K11 Boxing corriendo"
echo "  Servidor Node PID: $NODE_PID"
echo "  Firefox PID: $FIREFOX_PID"
echo ""
echo "Presiona Ctrl+C para cerrar"

# 6. Esperar y limpiar al salir
trap "echo 'Cerrando...'; kill $NODE_PID $FIREFOX_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait
