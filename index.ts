/**
 * Pi Notification Sound Extension
 *
 * Plays a notification sound when the agent finishes its full response
 * (all tool calls complete, waiting for user input).
 *
 * At session start, sounds are assigned round-robin from a pool of 4,
 * so that concurrent Pi sessions each get a distinct, predictable sound.
 *
 * ## How it works
 *
 * Inside a namespace/container, direct audio playback (paplay, pw-play)
 * fails because the audio stack is unreachable. The solution is a
 * host-side daemon (`daemon.sh`) that reads sound paths from a FIFO
 * and plays them on the host where audio works.
 *
 * The extension writes to the FIFO from inside the namespace — the
 * filesystem is shared, so this works.
 *
 * ## Setup
 *
 * On the host (outside any namespace), start the daemon:
 *
 *     ~/.pi/agent/extensions/notification/daemon.sh &
 *
 * Then use Pi normally. The extension will write to the FIFO whenever
 * a notification should play.
 *
 * If the daemon isn't running, the extension falls back to a terminal
 * bell (\a) — always available as a visual cue.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Extension directory (used for FIFO isolation)
// ---------------------------------------------------------------------------

const EXT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Sound pool
// ---------------------------------------------------------------------------

const SOUND_DIR = "/usr/share/sounds/freedesktop/stereo";

const SOUND_FILES = [
	"complete.oga",            // ✓ task complete
	"bell.oga",                // 🔔 classic bell
	"message-new-instant.oga", // 💬 new message
	"dialog-information.oga",  // ℹ️ info dialog
] as const;

const COUNTER_FILE = join(EXT_DIR, ".sound-counter");

/**
 * Atomically allocate the next sound index using a shared counter file.
 * Sessions grab IDs round-robin: 0, 1, 2, 3, 0, 1, ...
 * Uses flock for mutual exclusion so concurrent sessions don't collide.
 */
function acquireSoundIndex(): number {
	const lockFile = "/tmp/pi-notify-sound.lock";

	try {
		const result = execFileSync("bash", ["-c", `
			exec 200>"${lockFile}"
			flock 200
			if [ -f "${COUNTER_FILE}" ]; then
				idx=$(cat "${COUNTER_FILE}")
			else
				idx=0
			fi
			echo $((idx + 1)) > "${COUNTER_FILE}"
			echo $idx
		`], { encoding: "utf8", timeout: 5000 });

		return parseInt(result.trim());
	} catch (e) {
		// Fallback to random if locking fails
		console.warn("[notification] Failed to acquire sound index, falling back to random", e);
		return Math.floor(Math.random() * SOUND_FILES.length);
	}
}

/** Extract just the filename from a full path. */
function soundLabel(path: string): string {
	return path.split("/").pop() ?? path;
}

// ---------------------------------------------------------------------------
// FIFO management
// ---------------------------------------------------------------------------

const FIFO_PATH = join(EXT_DIR, ".notify-fifo");

/**
 * Ensure the FIFO exists by running the `mkfifo` system command.
 * No-op if it already exists and is a valid FIFO.
 */
function ensureFifo(): void {
	if (existsSync(FIFO_PATH)) return;

	try {
		// Use the system `mkfifo` command — Node's fs module doesn't wrap mkfifo.
		const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
		execFileSync("mkfifo", [FIFO_PATH], { stdio: "ignore" });
	} catch {
		// Another session may have created it concurrently — that's fine.
	}
}

// ---------------------------------------------------------------------------
// Session sound (assigned round-robin at session_start)
// ---------------------------------------------------------------------------

let sessionSound: string;

// ---------------------------------------------------------------------------
// Core playback
// ---------------------------------------------------------------------------

/**
 * Play a notification sound.
 *
 * Writes the sound file path to the FIFO for the host-side daemon to play.
 * Falls back to a terminal bell if the daemon isn't running.
 *
 * @param filePath Absolute path to an audio file (.oga, .wav, etc.).
 *                 If omitted, the session's assigned sound is used.
 */
export function playNotificationSound(filePath?: string): void {
	const sound = filePath ?? sessionSound;

	if (!existsSync(sound)) {
		console.warn(`[notification] Sound file not found: ${sound}`);
		fallbackBell();
		return;
	}

	ensureFifo();

	// Write the path to the FIFO using a child process with a timeout.
	// If the daemon isn't reading, the `sh -c 'echo > fifo'` would block
	// indefinitely — the `timeout` wrapper kills it after 0.5s.
	execFile(
		"timeout",
		["0.5", "sh", "-c", `printf '%s\\n' '${sound}' > '${FIFO_PATH}'`],
		(err) => {
			if (err) {
				// Daemon not running or FIFO write failed — use terminal bell
				fallbackBell();
			}
		},
	);
}

/** Emit a terminal bell as a last-resort visual/audio cue. */
function fallbackBell(): void {
	process.stdout.write("\x07");
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Allocate the next sound round-robin so each Pi window gets a distinct identity.
	pi.on("session_start", async () => {
		const idx = acquireSoundIndex() % SOUND_FILES.length;
		sessionSound = join(SOUND_DIR, SOUND_FILES[idx]);
	});

	// Fire when the agent is fully done — all turns, all tool calls,
	// waiting for new user input.
	pi.on("agent_end", async () => {
		playNotificationSound(sessionSound);
	});

	// Handy command to test / replay the current session's sound.
	pi.registerCommand("notify", {
		description: "Play the session notification sound",
		handler: async (_args, ctx) => {
			ctx.ui.notify(`Playing: ${soundLabel(sessionSound)}`, "info");
			playNotificationSound(sessionSound);
		},
	});
}
