// Seal funding-receipt tests (pure; no network). Proves the on-chain funding cross-check
// confirms a truthful receipt, catches a wrong funder, catches a wrong anchor amount, and
// tolerates a malformed claimed address without throwing. Uses @bsv/sdk to build real P2PKH
// locking scripts — the same trusted-library path verify uses — but no explorer fetch.

import assert from "node:assert/strict";
import { P2PKH, PrivateKey } from "@bsv/sdk";
import { receiptMatchesOutputs } from "../src/client.ts";

let pass = 0;
async function check(name: string, fn: () => Promise<void>) { await fn(); pass++; console.log("ok -", name); }

// Two real, independent mainnet keys → real addresses → real P2PKH locking scripts.
const funderKey = PrivateKey.fromRandom();
const serviceKey = PrivateKey.fromRandom();
const funder = funderKey.toAddress("mainnet");
const payTo = serviceKey.toAddress("mainnet");
const lock = (addr: string) => new P2PKH().lock(addr).toHex();

// A settlement tx's outputs: 300 sats to the service, change back to the funder.
const outputs = [
  { scriptHex: lock(payTo), satoshis: 300 },
  { scriptHex: lock(funder), satoshis: 9_999_586 },
];

await check("truthful receipt: pays anchor + change to funder", async () => {
  const r = await receiptMatchesOutputs(outputs, { funder, payTo, anchorSats: 300 });
  assert.deepEqual(r, { paysAnchor: true, changeToFunder: true });
});

await check("wrong funder is caught (change not to claimed funder)", async () => {
  const other = PrivateKey.fromRandom().toAddress("mainnet");
  const r = await receiptMatchesOutputs(outputs, { funder: other, payTo, anchorSats: 300 });
  assert.equal(r.paysAnchor, true);
  assert.equal(r.changeToFunder, false);
});

await check("wrong anchor amount is caught", async () => {
  const r = await receiptMatchesOutputs(outputs, { funder, payTo, anchorSats: 301 });
  assert.equal(r.paysAnchor, false);
  assert.equal(r.changeToFunder, true);
});

await check("malformed claimed address does not throw — reports no match", async () => {
  const r = await receiptMatchesOutputs(outputs, { funder: "not-an-address", payTo, anchorSats: 300 });
  assert.equal(r.paysAnchor, true);
  assert.equal(r.changeToFunder, false);
});

console.log(`\n${pass} seal-receipt checks passed`);
