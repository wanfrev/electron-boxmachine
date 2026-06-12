#!/bin/bash
# =============================================================================
# K11 Boxing - OTA Update Script para FullPageOS
# =============================================================================
# Uso:  ./update-fullpageos.sh https://tu-cdn.com/k11-update.tar.gz
# Este script puede ejecutarse manualmente o desde un cronjob diario.
# =============================================================================
set -e

UPDATE_URL="${1:-}"

if [ -z "$UPDATE_URL" ]; then
  echo "Uso: $0 <URL_DEL_UPDATE.tar.gz>"
  echo ""
  echo "Ejemplo:"
  echo "  $0 https://cdn.k11boxing.com/releases/v2.1.0.tar.gz"
  exit 1
fi

APP_DIR="/home/pi/k11-boxing"
TMP_DIR="/tmp/k11-update"
ARCHIVE="$TMP_DIR/update.tar.gz"
WAS_RO=0

echo "=== K11 OTA Update ==="
echo "URL: $UPDATE_URL"
echo ""

# 1. Montar RW si es necesario
echo "[1/5] Preparando filesystem..."
if mount | grep -q " / .* ro," ; then
  echo "  Filesystem RO -> remontando RW..."
  sudo mount -o remount,rw /
  WAS_RO=1
else
  echo "  Filesystem ya es RW"
fi

# 2. Descargar
echo "[2/5] Descargando actualizacion..."
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
curl -fSL --connect-timeout 30 --max-time 120 -o "$ARCHIVE" "$UPDATE_URL" || {
  echo "ERROR: No se pudo descargar $UPDATE_URL"
  [ "$WAS_RO" = "1" ] && sudo mount -o remount,ro /
  exit 1
}
echo "  Descargado: $(du -h "$ARCHIVE" | cut -f1)"

# 3. Extraer
echo "[3/5] Extrayendo..."
EXTRACT_DIR="$TMP_DIR/extracted"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$ARCHIVE" -C "$EXTRACT_DIR"
echo "  Extraido en $EXTRACT_DIR"

# 4. Aplicar a la carpeta del proyecto
echo "[4/5] Aplicando archivos..."

# UI dist
if [ -d "$EXTRACT_DIR/dist" ]; then
  rm -rf "$APP_DIR/ui/dist"
  cp -r "$EXTRACT_DIR/dist" "$APP_DIR/ui/dist"
  echo "  ui/dist actualizado"
fi

# server/
if [ -d "$EXTRACT_DIR/server" ]; then
  cp "$EXTRACT_DIR/server"/*.js "$APP_DIR/server/" 2>/dev/null || true
  echo "  server/ actualizado"
fi

# server.js y package.json (root)
[ -f "$EXTRACT_DIR/server.js" ] && cp "$EXTRACT_DIR/server.js" "$APP_DIR/" && echo "  server.js actualizado"
[ -f "$EXTRACT_DIR/package.json" ] && cp "$EXTRACT_DIR/package.json" "$APP_DIR/" && echo "  package.json actualizado"

# 5. Limpiar y reiniciar
echo "[5/5] Limpiando y reiniciando servicio..."
rm -rf "$TMP_DIR"

sync
[ "$WAS_RO" = "1" ] && sudo mount -o remount,ro /

sudo systemctl restart k11-boxing

echo ""
echo "=== Update completo ==="
echo "Servicio reiniciado. Verificar con:"
echo "  sudo systemctl status k11-boxing"
echo "  sudo journalctl -u k11-boxing -f"
