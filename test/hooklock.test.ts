// Stale-lock recovery: a crashed hook must not wedge capture forever. A lock older than
// the stale threshold should be stolen so the next hook still appends.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook, reconcile } from "../src/hook.ts";
import { verifyChain, type LogEntry } from "../src/chain.ts";
import { readLog } from "../src/store.ts";

let pass = 0;
function check(name: string, fn: () => void) { fn(); pass++; console.log("ok -", name); }

const dir = mkdtempSync(join(tmpdir(), "bt-lock-"));
const log = join(dir, "log.jsonl");
const lock = log + ".lock";

check("a stale lock (10s old) is stolen; capture still appends", () => {
  writeFileSync(lock, ""); // simulate a lock left by a crashed hook
  const old = Date.now() / 1000 - 10; // 10s ago
  utimesSync(lock, old, old);
  const ev = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git push origin x" } });
  const entry = runHook(ev, log);
  assert.ok(entry, "entry should be appended despite the pre-existing (stale) lock");
  assert.equal(entry?.kind, "shell.git.push");
  assert.ok(existsSync(log) && readFileSync(log, "utf8").includes("shell.git.push"));
  assert.ok(!existsSync(lock), "lock should be released after append");
});

check("contention-spilled events are reconciled into a valid chain", () => {
  const dir2 = mkdtempSync(join(tmpdir(), "bt-pend-"));
  const log2 = join(dir2, "log.jsonl");
  // simulate two events that were spilled under lock contention
  const pend = log2 + ".pending.jsonl";
  writeFileSync(pend,
    JSON.stringify({ actor: "mike", kind: "message.send", data: { evidence: "mechanical", nonce: "a" } }) + "\n" +
    JSON.stringify({ actor: "mike", kind: "shell.git.push", data: { evidence: "mechanical", nonce: "b" } }) + "\n");
  const n = reconcile(log2);
  assert.equal(n, 2, "both spilled events fold in");
  const log = readLog(log2) as LogEntry[];
  assert.equal(log.length, 2);
  assert.equal(verifyChain(log).ok, true, "reconciled chain verifies");
  assert.ok(!existsSync(pend), "pending file cleared after reconcile");
});

console.log(`\n${pass} hook-lock checks passed`);
