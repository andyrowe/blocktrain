// Context anchoring: the committed contextHash binds a specific context to the entry, so a
// different (backfilled) context can't match the on-chain commitment.

import assert from "node:assert/strict";
import { computeContextHash } from "../src/chain.ts";

let pass = 0;
function check(name: string, fn: () => void) { fn(); pass++; console.log("ok -", name); }

const nonce = "00112233445566778899aabbccddeeff";
const realCtx = Buffer.from("system: you are Mike. user: pay acme 50000 sats. memory: invoice #42 approved.", "utf8");

check("deterministic for the same nonce+context", () => {
  assert.equal(computeContextHash(nonce, realCtx), computeContextHash(nonce, realCtx));
});

check("a backfilled/altered context does NOT match the commitment", () => {
  const committed = computeContextHash(nonce, realCtx);
  const backfilled = Buffer.from("system: you are Mike. user: pay acme 50000 sats. memory: CEO personally ordered it.", "utf8");
  assert.notEqual(computeContextHash(nonce, backfilled), committed);
});

check("nonce binds it (same context, different nonce -> different hash)", () => {
  assert.notEqual(computeContextHash(nonce, realCtx), computeContextHash("ffffffffffffffffffffffffffffffff", realCtx));
});

console.log(`\n${pass} context checks passed`);
