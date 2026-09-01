// Mechanical capture (roadmap P2). Turns a harness PostToolUse event into a blocktrain
// log entry — WITHOUT the agent choosing to log. Two hard rules:
//
//  1. PRIVACY BY CONSTRUCTION. Never store raw content. We commit sha256(nonce ‖ input)
//     and keep only coarse, non-sensitive descriptors (tool, action, coarse target,
//     byte length). The log can later be published without leaking message text, shell
//     commands, IPs, or file contents.
//  2. NEVER BREAK THE AGENT. The hook must not throw or block tool use. Any error →
//     silent no-op (best-effort debug line), exit 0.
//
// Only outward/mutating actions are captured (sends, writes, deploys, spends, schedules).
// Reads (Read/Grep/Glob/search/fetch) are ignored — noise + privacy.

import { createHash, randomBytes } from "node:crypto";
import { openSync, closeSync, unlinkSync, appendFileSync } from "node:fs";
import { canonicalize } from "./canonical.ts";
import { readLog, type LogEntry } from "./store.ts";
import { appendEntry } from "./chain.ts";

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export type ToolEvent = {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  hook_event_name?: string;
};

type Classified = { kind: string; data: Record<string, unknown> } | null;

// Bash is used for everything; only capture clearly outward/mutating commands.
const BASH_RULES: Array<[RegExp, string]> = [
  // permissive about flags (e.g. `git -c user.email=x commit`) but bounded by command
  // separators so a later chained command can't leak into the classification
  [/\bgit\b[^;|&]*\bpush\b/, "git.push"],
  [/\bgit\b[^;|&]*\bcommit\b/, "git.commit"],
  [/\bscp\b/, "deploy.scp"],
  [/\brsync\b/, "deploy.rsync"],
  [/\brclone\s+(copy|copyto|sync|move|delete|purge)\b/, "deploy.rclone"],
  [/\bsystemctl\b[^\n]*\b(restart|start|stop|enable|disable|reload)\b/, "service.systemctl"],
  [/\bcurl\b[^\n]*-X\s*(POST|PUT|DELETE|PATCH)\b/i, "http.write"],
  [/\bnpm\s+publish\b/, "publish.npm"],
  [/\bgh\s+(pr|release|repo|issue|gist)\s+create\b/, "github.create"],
];

const MESSAGE_OUTWARD = new Set([
  "send", "reply", "thread-reply", "thread-create", "poll", "edit", "sticker", "upload-file", "topic-create",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : JSON.stringify(v);
}

// Decide whether/how to capture. Returns null to skip.
export function classify(ev: ToolEvent): Classified {
  const tool = ev.tool_name ?? "";
  const input = ev.tool_input ?? {};

  // Messaging (Discord/Telegram/etc.)
  if (tool.endsWith("message")) {
    const action = str(input.action) || "send";
    if (!MESSAGE_OUTWARD.has(action)) return null;
    const text = str(input.message ?? input.caption ?? "");
    return {
      kind: `message.${action}`,
      data: {
        channel: str(input.channel) || undefined,
        target: str(input.target) || str(input.channelId) || undefined,
        textLen: text.length || undefined,
      },
    };
  }

  // Cross-agent messaging / spawn
  if (tool.endsWith("sessions_send")) return { kind: "agent.message", data: { to: str(input.sessionKey ?? input.agentId ?? input.label) || undefined } };
  if (tool.endsWith("sessions_spawn")) return { kind: "agent.spawn", data: { taskName: str(input.taskName) || undefined } };

  // Scheduling
  if (tool.endsWith("cron")) {
    const action = str(input.action);
    if (!["add", "update", "remove"].includes(action)) return null;
    return { kind: `schedule.${action}`, data: { jobId: str(input.jobId) || undefined } };
  }

  // Media generation
  if (tool.endsWith("image_generate")) return { kind: "media.image", data: {} };
  if (tool.endsWith("video_generate")) return { kind: "media.video", data: {} };

  // Local file mutation
  if (tool === "Write" || tool === "Edit" || tool === "NotebookEdit") {
    const path = str(input.file_path ?? input.notebook_path);
    // Don't log writes to blocktrain's own store (avoid self-noise; the hook writes the
    // log via fs, not the Write tool, but a manual edit of it would otherwise show up).
    if (/blocktrain\/data\//.test(path)) return null;
    return { kind: tool === "NotebookEdit" ? "notebook.edit" : `file.${tool === "Write" ? "write" : "edit"}`, data: { path: path || undefined } };
  }

  // Shell — only the mutating/outward subset. Match against the command with quoted
  // regions stripped, so trigger words inside args/messages (e.g. a commit message that
  // mentions "git push") can't misclassify the action.
  if (tool === "Bash") {
    const cmd = str(input.command);
    const scan = cmd.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
    for (const [re, cat] of BASH_RULES) {
      if (re.test(scan)) return { kind: `shell.${cat}`, data: { cmdLen: cmd.length } };
    }
    return null; // reads, greps, ls, tests, etc.
  }

  return null; // everything else (Read/Grep/Glob/web_*/memory_*/status) = not an outward action
}

// Locked append so concurrent PostToolUse hooks can't corrupt the hash-chain.
function withLock<T>(lockPath: string, fn: () => T): T {
  let fd: number | null = null;
  for (let i = 0; i < 100; i++) {
    try {
      fd = openSync(lockPath, "wx"); // O_EXCL: fails if lock exists
      break;
    } catch {
      // busy-wait a few ms (synchronous; hooks are short-lived processes)
      const until = Date.now() + 15;
      while (Date.now() < until) { /* spin */ }
    }
  }
  if (fd === null) throw new Error("could not acquire log lock");
  try {
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* ignore */ }
    try { unlinkSync(lockPath); } catch { /* ignore */ }
  }
}

// Ingest one tool-event JSON string and append a redacted entry if it's captureable.
// Returns the appended entry (for tests) or null when skipped. NEVER throws.
export function runHook(stdinStr: string, logPath: string, actor = "mike"): LogEntry | null {
  try {
    const ev = JSON.parse(stdinStr) as ToolEvent;
    const c = classify(ev);
    if (!c) return null;

    const nonce = randomBytes(16).toString("hex");
    const payloadHash = sha256hex(nonce + canonicalize(ev.tool_input ?? {}));
    const data = {
      ...c.data,
      evidence: "mechanical",
      capturedBy: "harness-hook",
      tool: ev.tool_name,
      nonce,
      payloadHash, // commits to the full tool input privately; raw content is NOT stored
    };

    const lockPath = logPath + ".lock";
    return withLock(lockPath, () => {
      const log = readLog(logPath);
      const entry = appendEntry(log, { actor, kind: c.kind, data });
      appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
      return entry;
    });
  } catch (e) {
    try {
      appendFileSync(logPath + ".hook-errors", `${new Date().toISOString()} ${String(e)}\n`, "utf8");
    } catch { /* ignore */ }
    return null;
  }
}
