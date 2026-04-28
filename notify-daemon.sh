#!/usr/bin/env bash
# pi-notify-daemon
#
# Reads sound file paths from a FIFO and plays them.
# Run this ON THE HOST (outside any namespace) before starting Pi:
#
#   ~/.pi/agent/extensions/notification/notify-daemon.sh &
#
# The daemon auto-exits if the FIFO is removed (e.g. session cleanup).

set -euo pipefail

# Resolve to the directory this script lives in
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIFO="${SCRIPT_DIR}/.notify-fifo"

# ---------------------------------------------------------------------------
# Audio player detection (ordered by preference)
# ---------------------------------------------------------------------------
detect_player() {
  for cmd in pw-play paplay aplay afplay; do
    if command -v "$cmd" &>/dev/null; then
      echo "$cmd"
      return
    fi
  done
  echo ""
}

PLAYER="$(detect_player)"

if [[ -z "$PLAYER" ]]; then
  echo "[pi-notify] ERROR: No audio player found (tried pw-play, paplay, aplay, afplay)" >&2
  exit 1
fi

echo "[pi-notify] Using player: $PLAYER"
echo "[pi-notify] Listening on: $FIFO"

# ---------------------------------------------------------------------------
# Ensure FIFO exists
# ---------------------------------------------------------------------------
if [[ -e "$FIFO" ]] && [[ ! -p "$FIFO" ]]; then
  # Exists but is not a FIFO — remove it
  rm -f "$FIFO"
fi

if [[ ! -e "$FIFO" ]]; then
  mkfifo "$FIFO"
  echo "[pi-notify] Created FIFO: $FIFO"
fi

# ---------------------------------------------------------------------------
# Main loop: read paths from FIFO, play each one
# ---------------------------------------------------------------------------
while true; do
  # This blocks until a writer opens the FIFO
  if ! read -r sound_file <"$FIFO"; then
    # EOF — writer closed. Loop to wait for next writer.
    continue
  fi

  # Skip empty lines
  [[ -z "$sound_file" ]] && continue

  if [[ ! -f "$sound_file" ]]; then
    echo "[pi-notify] File not found: $sound_file" >&2
    continue
  fi

  # Play the sound at 2x volume.
  # pw-play and paplay both accept --volume (linear multiplier).
  # For other players, fall back to no volume flag.
  case "$PLAYER" in
    pw-play|paplay)
      "$PLAYER" --volume=2.0 "$sound_file" &>/dev/null &
      ;;
    *)
      "$PLAYER" "$sound_file" &>/dev/null &
      ;;
  esac
done
