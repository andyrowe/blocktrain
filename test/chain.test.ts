// Hash-chain integrity + tamper-detection tests. Free, offline half of blocktrain.

import assert from "node:assert/strict";
import { appendEntry, verifyChain, type LogEntry } from "../src/chain.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass++;
  console.log("ok -", name);
}

function buildLog(n: number): LogEntry[] {
  const log: LogEntry[] = [];
  for (let i = 0; i < n; i++) {
    log.push(
      appendEntry(log, {
        actor: "mike",
        kind: "test.event",
        data: { i, note: `event ${i}` },
        ts: new Date(1700000000000 + i * 1000).toISOString(),
      }),
    );
  }
  return log;
}

check("a clean chain verifies", () => {
  const r = verifyChain(buildLog(10));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.count, 10);
});

check("determinism: same events -> same tip regardless of key order in data", () => {
  const a = appendEntry([], { actor: "mike", kind: "k", data: { b: 2, a: 1 }, ts: "2026-01-01T00:00:00.000Z" });
  const b = appendEntry([], { actor: "mike", kind: "k", data: { a: 1, b: 2 }, ts: "2026-01-01T00:00:00.000Z" });
  assert.equal(a.linkHash, b.linkHash);
});

check("editing an event body is detected", () => {
  const log = buildLog(6);
  (log[3].data as { note: string }).note = "tampered";
  const r = verifyChain(log);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.failedSeq, 3);
});

check("deleting an entry breaks the chain", () => {
  const log = buildLog(6);
  log.splice(2, 1); // remove seq 2; subsequent seqs now mismatch their index
  const r = verifyChain(log);
  assert.equal(r.ok, false);
});

check("reordering entries is detected", () => {
  const log = buildLog(6);
  const tmp = log[2];
  log[2] = log[3];
  log[3] = tmp;
  const r = verifyChain(log);
  assert.equal(r.ok, false);
});

check("splicing in a forged entry is detected", () => {
  const log = buildLog(6);
  const forged = { ...log[5], seq: 3, data: { i: 99, note: "forged" } };
  log.splice(3, 0, forged as LogEntry);
  const r = verifyChain(log);
  assert.equal(r.ok, false);
});

console.log(`\n${pass} chain checks passed`);
