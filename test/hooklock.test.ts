// Stale-lock recovery: a crashed hook must not wedge capture forever. A lock older than
// the stale threshold should be stolen so the next hook still appends.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runHook } from "../src/hook.ts";

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

console.log(`\n${pass} hook-lock checks passed`);
