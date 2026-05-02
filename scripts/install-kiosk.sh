#!/usr/bin/env bash
#
# install-kiosk.sh — set up a Raspberry Pi 3 B+ running Pi OS Lite as a
# fullscreen Chromium kiosk for the Bartender Kiosk app.
#
# Run on a fresh Pi OS Lite (32-bit) install, as the regular user (not root):
#
#   git clone <repo> ~/bartender-kiosk
#   cd ~/bartender-kiosk
#   bash scripts/install-kiosk.sh
#
# After it finishes, reboot. The Pi will auto-login on tty1, start X, and
# launch Chromium against the Node backend on http://localhost:3000.

set -euo pipefail

# ---------- pre-flight ----------------------------------------------------

if [[ $EUID -eq 0 ]]; then
  echo "Run as the regular pi user, not root. The script will sudo when needed." >&2
  exit 1
fi

if ! command -v sudo >/dev/null; then
  echo "sudo is required." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
KIOSK_USER="$USER"
KIOSK_HOME="$HOME"

if [[ ! -f "$REPO_DIR/package.json" ]]; then
  echo "Could not find package.json at $REPO_DIR — run this from inside the repo." >&2
  exit 1
fi

cat <<EOF
About to set up this Pi as a Bartender Kiosk:
  user:   $KIOSK_USER
  repo:   $REPO_DIR
  url:    http://localhost:3000

Changes:
  - apt update + install X, openbox, chromium-browser, unclutter, node 20
  - add $KIOSK_USER to dialout (serial access)
  - npm install in repo
  - systemd service: bartender-kiosk.service (backend)
  - console autologin on tty1
  - write ~/.bash_profile, ~/.xinitrc, ~/.config/openbox/autostart
  - disable screen blanking

EOF
read -r -p "Continue? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ---------- apt packages --------------------------------------------------

echo "==> Updating apt and installing packages..."
sudo apt-get update
sudo apt-get install -y \
  xserver-xorg \
  xinit \
  x11-xserver-utils \
  openbox \
  chromium-browser \
  unclutter \
  git \
  curl \
  ca-certificates

# ---------- node.js 20 ----------------------------------------------------

NEED_NODE=1
if command -v node >/dev/null; then
  CURRENT_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$CURRENT_MAJOR" -ge 20 ]]; then
    echo "==> Node $(node -v) already installed — skipping."
    NEED_NODE=0
  fi
fi

if [[ $NEED_NODE -eq 1 ]]; then
  echo "==> Installing Node.js 20 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# ---------- serial group --------------------------------------------------

if ! id -nG "$KIOSK_USER" | grep -qw dialout; then
  echo "==> Adding $KIOSK_USER to dialout group..."
  sudo usermod -aG dialout "$KIOSK_USER"
fi

# ---------- npm install ---------------------------------------------------

echo "==> Running npm install in $REPO_DIR..."
( cd "$REPO_DIR" && npm install --omit=dev )

# ---------- systemd service for the backend ------------------------------

echo "==> Installing bartender-kiosk.service..."
NODE_BIN="$(command -v node)"
sudo tee /etc/systemd/system/bartender-kiosk.service >/dev/null <<EOF
[Unit]
Description=Bartender Kiosk backend
After=network.target

[Service]
Type=simple
User=$KIOSK_USER
WorkingDirectory=$REPO_DIR
ExecStart=$NODE_BIN src/server/index.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bartender-kiosk.service

# ---------- console autologin on tty1 ------------------------------------

echo "==> Enabling console autologin on tty1..."
# B2 = console autologin in raspi-config
if command -v raspi-config >/dev/null; then
  sudo raspi-config nonint do_boot_behaviour B2
else
  # Fallback if raspi-config isn't present (non-Pi OS). Build the override
  # manually.
  sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
  sudo tee /etc/systemd/system/getty@tty1.service.d/autologin.conf >/dev/null <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KIOSK_USER --noclear %I \$TERM
EOF
  sudo systemctl daemon-reload
fi

# ---------- disable screen blanking --------------------------------------

if command -v raspi-config >/dev/null; then
  # do_blanking 1 = disable (counter-intuitive; matches raspi-config semantics)
  sudo raspi-config nonint do_blanking 1 || true
fi

# ---------- ~/.bash_profile: auto-startx on tty1 -------------------------

BASH_PROFILE="$KIOSK_HOME/.bash_profile"
if [[ -f "$BASH_PROFILE" ]] && ! grep -q "# bartender-kiosk autostart" "$BASH_PROFILE"; then
  cp "$BASH_PROFILE" "$BASH_PROFILE.bak.$(date +%s)"
fi
cat > "$BASH_PROFILE" <<'EOF'
# bartender-kiosk autostart
# Start X automatically when logging in on tty1 (the kiosk console).
if [[ -z "${DISPLAY:-}" && "$(tty)" = "/dev/tty1" ]]; then
  exec startx -- -nocursor
fi
EOF

# ---------- ~/.xinitrc ----------------------------------------------------

XINITRC="$KIOSK_HOME/.xinitrc"
if [[ -f "$XINITRC" ]] && ! grep -q "# bartender-kiosk" "$XINITRC"; then
  cp "$XINITRC" "$XINITRC.bak.$(date +%s)"
fi
cat > "$XINITRC" <<'EOF'
# bartender-kiosk
exec openbox-session
EOF

# ---------- openbox autostart --------------------------------------------

OPENBOX_DIR="$KIOSK_HOME/.config/openbox"
mkdir -p "$OPENBOX_DIR"
AUTOSTART="$OPENBOX_DIR/autostart"
if [[ -f "$AUTOSTART" ]] && ! grep -q "# bartender-kiosk" "$AUTOSTART"; then
  cp "$AUTOSTART" "$AUTOSTART.bak.$(date +%s)"
fi
cat > "$AUTOSTART" <<'EOF'
# bartender-kiosk
# Disable screen blanking and DPMS while X is running.
xset s off
xset s noblank
xset -dpms

# Hide the cursor (touchscreen).
unclutter -idle 0 -root &

# Wait for the backend to be reachable, then launch Chromium in kiosk mode.
# The systemd unit starts the backend in parallel; this loop just avoids a
# brief "site can't be reached" flash on cold boot.
until curl -sf http://localhost:3000 >/dev/null; do
  sleep 0.5
done

chromium-browser \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-translate \
  --disable-features=TranslateUI \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --no-first-run \
  --check-for-update-interval=31536000 \
  --autoplay-policy=no-user-gesture-required \
  --disable-gpu \
  http://localhost:3000 &
EOF

# ---------- done ----------------------------------------------------------

cat <<EOF

Done. Reboot to start the kiosk:

  sudo reboot

Useful commands afterwards:
  systemctl status bartender-kiosk     # backend status
  journalctl -u bartender-kiosk -f     # backend logs
  sudo systemctl restart bartender-kiosk

If the dialout group was just added, the backend service already runs as
$KIOSK_USER with the new group on next boot — no manual re-login needed.
EOF
