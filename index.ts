/**
 * Pi Notification Sound Extension
 *
 * Plays a notification sound when the agent finishes its full response
 * (all tool calls complete, waiting for user input).
 *
 * At session start, one random sound is picked from a pool of 5 so that
 * concurrent Pi sessions can be distinguished by ear.
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
import { execFile } from "node:child_process";
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
	"window-attention.oga",    // 👁️ window attention
] as const;

/** Pick a random sound and return its absolute path. */
function pickRandomSound(): string {
	const index = Math.floor(Math.random() * SOUND_FILES.length);
	return join(SOUND_DIR, SOUND_FILES[index]);
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
// Core playback
// ---------------------------------------------------------------------------

/**
 * Play a notification sound.
 *
 * Writes the sound file path to the FIFO for the host-side daemon to play.
 * Falls back to a terminal bell if the daemon isn't running.
 *
 * @param filePath Absolute path to an audio file (.oga, .wav, etc.).
 *                 If omitted, a random sound from the pool is used.
 */
export function playNotificationSound(filePath?: string): void {
	const sound = filePath ?? pickRandomSound();

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
	/** The sound chosen for this particular session. */
	let sessionSound: string;

	// Pick a random sound once per session so each Pi window has its own identity.
	pi.on("session_start", async () => {
		sessionSound = pickRandomSound();
		console.log(`[notification] Session sound: ${soundLabel(sessionSound)}`);
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
