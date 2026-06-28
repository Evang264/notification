# Pi Notification Sound Extension

Plays a notification sound when the agent finishes its response (all tool calls complete, waiting for user input).

Each Pi session is assigned a sound round-robin from a pool of 4, so concurrent sessions get distinct, predictable sounds.

## Sounds

| Sound | File |
|-------|------|
| ✓ Task complete | `complete.oga` |
| 🔔 Classic bell | `bell.oga` |
| 💬 New message | `message-new-instant.oga` |
| ℹ️ Info dialog | `dialog-information.oga` |

Assigned round-robin: the 1st session gets task complete, 2nd gets classic bell, 3rd gets new message, 4th gets info dialog, 5th wraps back to task complete, and so on.

All sourced from `/usr/share/sounds/freedesktop/stereo/`.

## Architecture

Direct audio playback (`paplay`, `pw-play`) fails inside namespaces/containers because the audio stack is unreachable. The solution is a host-side daemon that reads sound paths from a FIFO and plays them.

```
┌────────────────────────────┐      ┌──────────────────────────┐
│  Pi (namespace)            │      │  Host                    │
│                            │ FIFO │                          │
│  Extension writes path ────┼─────►│  notify-daemon.sh reads  │
│  to .notify-fifo           │      │  and plays at 2x volume  │
│                            │      │                          │
│  Falls back to terminal    │      │                          │
│  bell (\a) if no daemon    │      │                          │
└────────────────────────────┘      └──────────────────────────┘
```

## Setup

### 1. Start the daemon (on the host)

The daemon must be running **outside** any namespace where audio works.

**Manual:**

```bash
~/.pi/agent/extensions/notification/notify-daemon.sh &
```

**Systemd (recommended):**

A user service auto-starts on login and restarts on crash.

```bash
# Unit file is already at:
# ~/.config/systemd/user/pi-notify.service

systemctl --user daemon-reload
systemctl --user enable --now pi-notify.service

# Check status
systemctl --user status pi-notify.service

# View logs
journalctl --user -u pi-notify.service -f
```

### 2. Use Pi

The extension loads automatically. `/reload` if Pi was already running.

## Commands

| Command | Description |
|---------|-------------|
| `/notify` | Play the current session's sound (for testing) |

## Exported API

The extension exports a reusable function:

```typescript
import { playNotificationSound } from "./index.ts";

// Play the session's assigned sound
playNotificationSound();

// Play a specific sound
playNotificationSound("/path/to/sound.oga");
