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
import { openSync, closeSync, unlinkSync, appendFileSync, statSync, existsSync, readFileSync } from "node:fs";
import { canonicalize } from "./canonical.ts";
import { readLog, type LogEntry } from "./store.ts";
import { appendEntry } from "./chain.ts";

function sha256hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// Redact a potentially-identifying value (message target/phone, agent target, file path) to a
// short non-reversible digest, so the operational log never stores raw PII even locally. Lets
// you correlate "same target" without revealing it; the full input is still committed in payloadHash.
function redact(s: string): string | undefined {
  return s ? sha256hex(s).slice(0, 16) : undefined;
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
        channel: str(input.channel) || undefined, // provider name (e.g. "discord") — not PII
        targetHash: redact(str(input.target) || str(input.channelId)), // recipient may be a phone number → hashed
        textLen: text.length || undefined,
      },
    };
  }

  // Cross-agent messaging / spawn
  if (tool.endsWith("sessions_send")) return { kind: "agent.message", data: { toHash: redact(str(input.sessionKey ?? input.agentId ?? input.label)) } };
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
    const dot = path.lastIndexOf(".");
    const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : undefined; // coarse hint, not identifying
    return { kind: tool === "NotebookEdit" ? "notebook.edit" : `file.${tool === "Write" ? "write" : "edit"}`, data: { pathHash: redact(path), ext } };
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

// Try to grab the append lock (O_EXCL), stealing one left stale by a crashed hook.
// Returns the fd, or null if it stays contended past the retry budget (~1.5s).
function acquireLock(lockPath: string): number | null {
  const STALE_MS = 5000; // a hook run is <2s; a lock older than this was left by a crash
  for (let i = 0; i < 100; i++) {
    try {
      return openSync(lockPath, "wx");
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_MS) {
          unlinkSync(lockPath);
          continue; // retry immediately
        }
      } catch { /* lock vanished between open and stat — just retry */ }
      const until = Date.now() + 15;
      while (Date.now() < until) { /* spin */ }
    }
  }
  return null;
}
function releaseLock(fd: number, lockPath: string): void {
  try { closeSync(fd); } catch { /* ignore */ }
  try { unlinkSync(lockPath); } catch { /* ignore */ }
}

type SpillRecord = { actor: string; kind: string; data: ReturnType<typeof buildData> };
function buildData(ev: ToolEvent, c: { kind: string; data: Record<string, unknown> }) {
  const nonce = randomBytes(16).toString("hex");
  return {
    ...c.data,
    evidence: "mechanical",
    capturedBy: "harness-hook",
    tool: ev.tool_name,
    nonce,
    payloadHash: sha256hex(nonce + canonicalize(ev.tool_input ?? {})),
  };
}

// Fold any spilled-under-contention events (FIFO) into the chain. Called while holding the
// lock, before the new append. Spilled events keep their own order; only their interleaving
// with concurrently-locked events is approximate — acceptable, and never lost.
function drainPending(logPath: string): LogEntry[] {
  const pend = logPath + ".pending.jsonl";
  if (!existsSync(pend)) return readLog(logPath);
  const lines = readFileSync(pend, "utf8").split("\n").filter((l) => l.trim());
  const log = readLog(logPath);
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as { actor: string; kind: string; data: unknown };
      const entry = appendEntry(log, rec);
      appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
      log.push(entry);
    } catch { /* skip a corrupt pending line */ }
  }
  try { unlinkSync(pend); } catch { /* ignore */ }
  return log;
}

// Ingest one tool-event JSON string and append a redacted entry if it's captureable.
// Returns the appended entry (for tests) or null when skipped/spilled. NEVER throws,
// and NEVER silently loses a captureable event (falls back to a pending spill).
export function runHook(stdinStr: string, logPath: string, actor = "mike"): LogEntry | null {
  let record: SpillRecord | null = null;
  try {
    const ev = JSON.parse(stdinStr) as ToolEvent;
    const c = classify(ev);
    if (!c) return null;
    record = { actor, kind: c.kind, data: buildData(ev, c) };

    const lockPath = logPath + ".lock";
    const fd = acquireLock(lockPath);
    if (fd === null) {
      // Couldn't lock in time — spill (atomic single-line append). Reconciled on next lock.
      appendFileSync(logPath + ".pending.jsonl", JSON.stringify(record) + "\n", "utf8");
      return null;
    }
    try {
      const log = drainPending(logPath);
      const entry = appendEntry(log, record);
      appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
      return entry;
    } finally {
      releaseLock(fd, lockPath);
    }
  } catch (e) {
    // Last resort: if we already built the record, spill it rather than lose it.
    try {
      if (record) appendFileSync(logPath + ".pending.jsonl", JSON.stringify(record) + "\n", "utf8");
      appendFileSync(logPath + ".hook-errors", `${new Date().toISOString()} ${String(e)}\n`, "utf8");
    } catch { /* ignore */ }
    return null;
  }
}

// Manually fold any pending (contention-spilled) events into the chain. Belt-and-suspenders
// for the `blocktrain reconcile` CLI verb; the hook also drains automatically on each append.
export function reconcile(logPath: string): number {
  const before = readLog(logPath).length;
  const lockPath = logPath + ".lock";
  const fd = acquireLock(lockPath);
  if (fd === null) return 0;
  try {
    const after = drainPending(logPath).length;
    return after - before;
  } finally {
    releaseLock(fd, lockPath);
  }
}
