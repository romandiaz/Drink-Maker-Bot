#!/bin/sh
# Drink Maker Bot — NetworkManager dispatcher script for captive portal.
#
# Fires on every NM connection state change. Acts only when the "Hotspot"
# connection comes up or down; everything else (eth0, home WiFi) is ignored.
#
# Pairs with /etc/NetworkManager/dnsmasq-shared.d/captive.conf, which
# handles the DNS hijack at the shared-mode dnsmasq layer. This script
# handles the iptables side: redirect AP-client port 80 to the kiosk on
# port 3000, and DROP forwarding so phones can't reach the wider internet
# through the Pi (single-purpose appliance).
#
# Install path: /etc/NetworkManager/dispatcher.d/99-drinkbot-captive
# Must be owned by root:root, mode 755 (executable).

set -e

INTERFACE="$1"
ACTION="$2"

# CONNECTION_ID is set by NM and contains the connection's user-facing name.
[ "${CONNECTION_ID:-}" = "Hotspot" ] || exit 0

KIOSK_PORT=3000
CHAIN=DRINKBOT_CAPTIVE

case "$ACTION" in
  up)
    # Custom chain for the upstream-block rules so teardown is surgical.
    iptables -N "$CHAIN" 2>/dev/null || true
    iptables -F "$CHAIN"
    iptables -A "$CHAIN" -j DROP

    # Delete-before-add so a repeated `up` (no intervening `down`) doesn't
    # stack duplicate rules. The chain DROP above is already idempotent via
    # the flush; PREROUTING/FORWARD are not, so clear them first.
    iptables -t nat -D PREROUTING -i "$INTERFACE" -p tcp --dport 80 \
      -j REDIRECT --to-port "$KIOSK_PORT" 2>/dev/null || true
    iptables -D FORWARD -i "$INTERFACE" -j "$CHAIN" 2>/dev/null || true
    iptables -D FORWARD -o "$INTERFACE" -j "$CHAIN" 2>/dev/null || true

    # Funnel HTTP from AP clients to the kiosk.
    iptables -t nat -A PREROUTING -i "$INTERFACE" -p tcp --dport 80 \
      -j REDIRECT --to-port "$KIOSK_PORT"

    # Block forwarding both ways for the AP interface — NM's `shared` mode
    # would otherwise NAT clients out through eth0, defeating the captive
    # portal and giving guests internet on a rented machine.
    iptables -I FORWARD -i "$INTERFACE" -j "$CHAIN"
    iptables -I FORWARD -o "$INTERFACE" -j "$CHAIN"
    ;;
  down)
    iptables -t nat -D PREROUTING -i "$INTERFACE" -p tcp --dport 80 \
      -j REDIRECT --to-port "$KIOSK_PORT" 2>/dev/null || true
    iptables -D FORWARD -i "$INTERFACE" -j "$CHAIN" 2>/dev/null || true
    iptables -D FORWARD -o "$INTERFACE" -j "$CHAIN" 2>/dev/null || true
    iptables -F "$CHAIN" 2>/dev/null || true
    iptables -X "$CHAIN" 2>/dev/null || true
    ;;
esac

exit 0
