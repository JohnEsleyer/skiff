#!/usr/bin/env bash
set -eo pipefail

echo "==> Skiff Ubuntu Installer"

if [ "$EUID" -ne 0 ]; then
  echo "[!] Please run as root (or with sudo): sudo ./install.sh"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN_PATH=""

# 1. Locate the built binary
if [ -f "$SCRIPT_DIR/build/bin/skiff" ]; then
  BIN_PATH="$SCRIPT_DIR/build/bin/skiff"
elif [ -f "$SCRIPT_DIR/skiff" ]; then
  BIN_PATH="$SCRIPT_DIR/skiff"
else
  echo "[!] No compiled 'skiff' binary found."
  echo "    Please build it first on this machine:"
  echo "      wails build"
  exit 1
fi

echo "--> Installing binary to /usr/local/bin/skiff..."
install -m 755 "$BIN_PATH" /usr/local/bin/skiff

echo "--> Installing desktop application icon..."
mkdir -p /usr/share/icons/hicolor/scalable/apps
if [ -f "$SCRIPT_DIR/build/appicon.svg" ]; then
  install -m 644 "$SCRIPT_DIR/build/appicon.svg" /usr/share/icons/hicolor/scalable/apps/skiff.svg
elif [ -f "$SCRIPT_DIR/frontend/public/icon.svg" ]; then
  install -m 644 "$SCRIPT_DIR/frontend/public/icon.svg" /usr/share/icons/hicolor/scalable/apps/skiff.svg
elif [ -f "$SCRIPT_DIR/build/linux/skiff.svg" ]; then
  install -m 644 "$SCRIPT_DIR/build/linux/skiff.svg" /usr/share/icons/hicolor/scalable/apps/skiff.svg
fi

echo "--> Installing desktop launcher..."
mkdir -p /usr/share/applications
install -m 644 "$SCRIPT_DIR/skiff.desktop" /usr/share/applications/skiff.desktop

echo "--> Refreshing system icon and desktop database..."
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true
fi
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications 2>/dev/null || true
fi

echo "==> Done! Skiff is now installed. Launch it from your Ubuntu application menu or by running 'skiff'."
