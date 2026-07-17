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
  - systemd service: bartender-kiosk.service (backend; auto-detects Arduino)
  - console autologin on tty1
  - write ~/.bash_profile, ~/.xinitrc, ~/.config/openbox/autostart
  - disable screen blanking

EOF
read -r -p "Continue? [y/N] " reply
[[ "$reply" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }

# ---------- apt packages --------------------------------------------------

echo "==> Updating apt and installing packages..."
sudo apt-get update

# Pi OS Bookworm shipped `chromium-browser`; Trixie renamed it to `chromium`
# (and the binary too). `apt-cache policy` reports the install candidate;
# transitional/virtual packages report "(none)" and we treat that as missing.
candidate() {
  apt-cache policy "$1" 2>/dev/null | awk '/Candidate:/ { print $2; exit }'
}

CHROMIUM_PKG=
if c=$(candidate chromium-browser) && [[ -n "$c" && "$c" != "(none)" ]]; then
  CHROMIUM_PKG=chromium-browser
elif c=$(candidate chromium) && [[ -n "$c" && "$c" != "(none)" ]]; then
  CHROMIUM_PKG=chromium
fi

if [[ -z "$CHROMIUM_PKG" ]]; then
  echo "Neither chromium-browser nor chromium has an installation candidate." >&2
  echo "Diagnostics follow — please share these if you need help:" >&2
  echo "--- apt-cache policy chromium-browser ---" >&2
  apt-cache policy chromium-browser >&2 || true
  echo "--- apt-cache policy chromium ---" >&2
  apt-cache policy chromium >&2 || true
  exit 1
fi
echo "    using chromium package: $CHROMIUM_PKG"

sudo apt-get install -y \
  xserver-xorg \
  xinit \
  x11-xserver-utils \
  openbox \
  "$CHROMIUM_PKG" \
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

# ---------- detect Arduino serial port -----------------------------------
#
# Detection here only decides real-hardware vs. mock mode — it does NOT
# pin a device path. When an Arduino-family device is present we bake
# SERIAL_PORT=auto: the backend scans USB descriptors at runtime and binds
# to the first matching VID, so the board re-enumerating under a different
# /dev path (a known quirk of CH340/FTDI clones across reboots) just works
# without re-running this script. An explicit path is baked in only when
# several serial devices are present and the operator picks one, since
# 'auto' can't disambiguate. Pass SERIAL_PORT in the environment to skip
# detection (unattended re-installs).

echo "==> Detecting Arduino serial port..."
DETECTED_SERIAL_PORT=""

if [[ -n "${SERIAL_PORT:-}" ]]; then
  echo "    SERIAL_PORT preset in environment: $SERIAL_PORT"
  DETECTED_SERIAL_PORT="$SERIAL_PORT"
else
  serial_candidates=()
  for dev in /dev/ttyACM* /dev/ttyUSB*; do
    [[ -e "$dev" ]] && serial_candidates+=("$dev")
  done

  case ${#serial_candidates[@]} in
    0)
      echo "    No serial device found at /dev/ttyACM* or /dev/ttyUSB*."
      echo "    Default 'auto' lets the backend detect the Arduino by USB VID"
      echo "    at runtime (recommended — board can be plugged in later)."
      read -r -p "    Path / 'auto' / 'skip' [auto]: " manual
      if [[ -z "$manual" || "$manual" == "auto" ]]; then
        DETECTED_SERIAL_PORT="auto"
      elif [[ "$manual" =~ ^[Ss](kip)?$ ]]; then
        DETECTED_SERIAL_PORT=""
      else
        DETECTED_SERIAL_PORT="$manual"
      fi
      ;;
    1)
      echo "    Found: ${serial_candidates[0]}"
      echo "    Using SERIAL_PORT=auto — the backend re-detects this board by"
      echo "    USB VID at runtime, surviving re-enumeration to another path."
      DETECTED_SERIAL_PORT="auto"
      ;;
    *)
      echo "    Multiple serial devices found:"
      i=1
      for c in "${serial_candidates[@]}"; do
        echo "      $i) $c"
        ((i++))
      done
      echo "      s) skip (mock mode)"
      while true; do
        read -r -p "    Pick [1-${#serial_candidates[@]} or s]: " pick
        if [[ "$pick" =~ ^[Ss]$ ]]; then
          DETECTED_SERIAL_PORT=""; break
        elif [[ "$pick" =~ ^[0-9]+$ ]] && (( pick >= 1 && pick <= ${#serial_candidates[@]} )); then
          DETECTED_SERIAL_PORT="${serial_candidates[$((pick-1))]}"; break
        else
          echo "    Invalid choice."
        fi
      done
      ;;
  esac
fi

if [[ "$DETECTED_SERIAL_PORT" == "auto" ]]; then
  echo "    Backend will use real hardware (runtime USB VID detection)"
elif [[ -n "$DETECTED_SERIAL_PORT" ]]; then
  echo "    Backend will use real hardware on $DETECTED_SERIAL_PORT"
else
  echo "    Backend will run in mock mode (no serial port set)"
fi

# ---------- addressable LED strip (optional) -----------------------------
#
# WS2812/SK6812 on GPIO21 (PCM, physical pin 40) is driven straight from the
# Pi via the rpi-ws281x DMA library. That needs the native binding and the
# backend running as root (the DMA path uses /dev/mem). GPIO21 uses the PCM
# peripheral rather than PWM, so the Pi's onboard audio keeps working — no
# audio changes needed (that's why pin 40 is preferred over GPIO18/pin 12).
# Enabling LEDs flips the service to run as root — a deliberate trade for this
# single-purpose appliance. Pass LED_STRIP in the environment (e.g.
# LED_STRIP=ws2812) to skip the prompt on unattended installs.

echo "==> Addressable LED strip..."
ENABLE_LEDS=""
if [[ -n "${LED_STRIP:-}" ]]; then
  echo "    LED_STRIP preset in environment: $LED_STRIP"
  ENABLE_LEDS="$LED_STRIP"
else
  read -r -p "    Enable WS2812 LED strip on GPIO21 / pin 40 (runs backend as root)? [y/N]: " led_ans
  [[ "$led_ans" =~ ^[Yy] ]] && ENABLE_LEDS="ws2812"
fi

LED_ENV_LINE=""
LED_SERVICE_USER="$KIOSK_USER"
if [[ -n "$ENABLE_LEDS" ]]; then
  echo "    Installing rpi-ws281x native binding..."
  # Deliberately NOT in package.json: it's a Linux/Pi-only native module, so
  # listing it would break `npm install` on cross-platform dev machines.
  # --no-save keeps package.json portable; this script is the record that the
  # binding belongs on the Pi. A build failure is non-fatal — leds.js falls
  # back to its mock sink, so the kiosk still boots.
  ( cd "$REPO_DIR" && npm install --no-save rpi-ws281x-v2 ) \
    || echo "    WARNING: rpi-ws281x-v2 build failed — LEDs will run in mock mode."
  LED_ENV_LINE="Environment=LED_STRIP=$ENABLE_LEDS"
  LED_SERVICE_USER="root"
  echo "    LEDs enabled on GPIO21: service will run as root with LED_STRIP=$ENABLE_LEDS."
fi

# ---------- systemd service for the backend ------------------------------

echo "==> Installing bartender-kiosk.service..."
NODE_BIN="$(command -v node)"
SERIAL_ENV_LINE=""
if [[ -n "$DETECTED_SERIAL_PORT" ]]; then
  SERIAL_ENV_LINE="Environment=SERIAL_PORT=$DETECTED_SERIAL_PORT"
fi

# ExecStart points at scripts/run-server.sh, not node directly. The wrapper
# keeps a node instance alive in a loop so the in-app Restart button (which
# exits node cleanly) triggers a fast respawn without bouncing through
# systemd's StartLimitBurst rate limit. systemd's Restart=always is kept as a
# backstop for the unusual case where the wrapper itself dies.
chmod +x "$REPO_DIR/scripts/run-server.sh"

sudo tee /etc/systemd/system/bartender-kiosk.service >/dev/null <<EOF
[Unit]
Description=Bartender Kiosk backend
After=network.target

[Service]
Type=simple
User=$LED_SERVICE_USER
WorkingDirectory=$REPO_DIR
Environment=NODE_BIN=$NODE_BIN
ExecStart=/usr/bin/env bash $REPO_DIR/scripts/run-server.sh
Restart=always
RestartSec=3
Environment=NODE_ENV=production
$SERIAL_ENV_LINE
$LED_ENV_LINE

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

# Bookworm calls it chromium-browser; Trixie calls it chromium.
if command -v chromium-browser >/dev/null; then
  CHROMIUM=chromium-browser
else
  CHROMIUM=chromium
fi

# Wait for the backend to be reachable, then launch Chromium in kiosk mode.
# The systemd unit starts the backend in parallel; this loop just avoids a
# brief "site can't be reached" flash on cold boot.
until curl -sf http://localhost:3000 >/dev/null; do
  sleep 0.5
done

"$CHROMIUM" \
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
