#!/usr/bin/env bash
#
# install-network.sh — set up the Pi's network plumbing for the admin
# Network tab and the captive portal AP mode.
#
# Run once after install-kiosk.sh, on the Pi, as the regular user:
#
#   bash scripts/install-network.sh
#
# Idempotent — safe to re-run after editing the source config files.
#
# What it installs:
#   - sudoers rule:  $USER ALL=(ALL) NOPASSWD: /usr/bin/nmcli
#       So the backend can run nmcli for the admin Network tab without a
#       password prompt. Without this, every write call from the tab fails.
#   - dnsmasq hijack config in /etc/NetworkManager/dnsmasq-shared.d/
#       Loaded by NM's shared-mode dnsmasq when Hotspot is active. Resolves
#       every DNS query to the Pi's AP IP (10.42.0.1).
#   - NM dispatcher script in /etc/NetworkManager/dispatcher.d/
#       Adds an iptables redirect (port 80 -> 3000) and DROPs forwarding
#       when Hotspot comes up. Tears them down when it goes off.

set -euo pipefail

if [[ $EUID -eq 0 ]]; then
  echo "Run as the regular pi user, not root. The script will sudo when needed." >&2
  exit 1
fi

if ! command -v sudo >/dev/null; then
  echo "sudo is required." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIOSK_USER="$USER"

cat <<EOF
About to install network setup for $KIOSK_USER:
  - /etc/sudoers.d/nmcli-kiosk            (NOPASSWD nmcli)
  - /etc/NetworkManager/dnsmasq-shared.d/captive.conf   (DNS hijack)
  - /etc/NetworkManager/dispatcher.d/99-drinkbot-captive (iptables)

EOF

read -r -p "Continue? [y/N] " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 1; }

# 0) iptables — Debian 13 (Trixie) ships nftables as the kernel default and
# does not install the `iptables` command by itself. Our dispatcher script
# shells out to `iptables`, so without this package the rules silently never
# install (REDIRECT and FORWARD DROP both quietly missing). The package on
# Trixie is `iptables-nft`, a thin compat shim over nftables — same syntax,
# rules end up in the nftables backend the kernel already uses.
if ! command -v iptables >/dev/null; then
  sudo apt-get install -y iptables
  echo "  ✓ installed iptables (nftables-backed)"
else
  echo "  ✓ iptables already present"
fi

# 1) sudoers — let the kiosk user run nmcli without a password.
SUDOERS_FILE="/etc/sudoers.d/nmcli-kiosk"
echo "$KIOSK_USER ALL=(ALL) NOPASSWD: /usr/bin/nmcli" \
  | sudo tee "$SUDOERS_FILE" >/dev/null
sudo chmod 440 "$SUDOERS_FILE"
echo "  ✓ wrote $SUDOERS_FILE"

# 2) DNS hijack via NM's shared-mode dnsmasq.
sudo install -d -m 755 /etc/NetworkManager/dnsmasq-shared.d
sudo install -m 644 -o root -g root \
  "$SCRIPT_DIR/dnsmasq-captive.conf" \
  /etc/NetworkManager/dnsmasq-shared.d/captive.conf
echo "  ✓ installed dnsmasq-shared.d/captive.conf"

# 3) iptables dispatcher script. Must be executable and root-owned.
sudo install -d -m 755 /etc/NetworkManager/dispatcher.d
sudo install -m 755 -o root -g root \
  "$SCRIPT_DIR/nm-dispatcher-captive.sh" \
  /etc/NetworkManager/dispatcher.d/99-drinkbot-captive
echo "  ✓ installed dispatcher.d/99-drinkbot-captive"

# Reload NM dispatcher hooks. Not strictly required (they're picked up on
# the next state change) but makes a fresh install testable immediately.
sudo systemctl reload NetworkManager 2>/dev/null || true

cat <<'EOF'

Done. Next:
  1. From the touchscreen, open admin (PIN) → Network tab.
     If you previously hit a "sudo not configured" error, refresh — it's gone.
  2. Tap Host. Within a couple of seconds wlan0 should be broadcasting
     "DrinkBot" (default password: drinkbot — change it from the Network tab).
  3. On a phone, join "DrinkBot". iOS should auto-pop a captive browser
     pointed at the kiosk. Android shows a "sign in to network" notification.
  4. Tap Client to switch back to your home WiFi.

Diagnostics if something looks off:
  journalctl -u NetworkManager -f       # watch NM events / dispatcher errors
  sudo iptables -t nat -L PREROUTING -n  # confirm the port-80 redirect
  pgrep -af 'dnsmasq.*shared'            # confirm hijack dnsmasq is running

EOF
