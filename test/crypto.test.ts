// Envelope encryption tests: blind by default, multi-party, per-scope, tamper-evident,
// and hash-after-decrypt round-trips (so encrypted entries stay chain-verifiable by key-holders).

import assert from "node:assert/strict";
import { generateIdentity, encryptFor, decryptWith, canDecrypt } from "../src/crypto.ts";
import { canonicalize } from "../src/canonical.ts";
import { computeEntryHash } from "../src/chain.ts";

let pass = 0;
function check(name: string, fn: () => void) { fn(); pass++; console.log("ok -", name); }

const client = generateIdentity();
const lawyer = generateIdentity();
const counter = generateIdentity();
const secret = Buffer.from("wired 50000 sats to acme for invoice #42", "utf8");

check("authorized recipients decrypt; a non-recipient cannot", () => {
  const env = encryptFor(secret, [client.pub, lawyer.pub]);
  assert.equal(decryptWith(env, client.wif).toString("utf8"), secret.toString("utf8"));
  assert.equal(decryptWith(env, lawyer.wif).toString("utf8"), secret.toString("utf8"));
  assert.throws(() => decryptWith(env, counter.wif), /not a recipient/);
  assert.equal(canDecrypt(env, client.wif), true);
  assert.equal(canDecrypt(env, counter.wif), false);
});

check("blind: the envelope leaks no plaintext", () => {
  const env = encryptFor(secret, [client.pub]);
  const blob = JSON.stringify(env);
  assert.ok(!blob.includes("acme"), "ciphertext must not contain the plaintext");
  assert.ok(!blob.includes(secret.toString("hex")), "raw bytes must not appear");
});

check("per-scope: counterparty sees shared entries, not the private one", () => {
  const shared = encryptFor(Buffer.from("engagement started"), [client.pub, lawyer.pub, counter.pub]);
  const priv = encryptFor(secret, [client.pub, lawyer.pub]); // counterparty excluded
  assert.ok(canDecrypt(shared, counter.wif));       // can read shared
  assert.ok(!canDecrypt(priv, counter.wif));         // cannot read the payment
  assert.equal(decryptWith(priv, lawyer.wif).toString("utf8"), secret.toString("utf8"));
});

check("tampering the ciphertext is detected (GCM auth)", () => {
  const env = encryptFor(secret, [client.pub]);
  const bytes = Buffer.from(env.ct, "hex");
  bytes[5] ^= 0xff;
  const tampered = { ...env, ct: bytes.toString("hex") };
  assert.throws(() => decryptWith(tampered, client.wif));
});

check("hash-after-decrypt round-trips (encrypted entries stay chain-verifiable)", () => {
  const base = { seq: 7, ts: "2026-09-02T00:00:00.000Z", actor: "mike", kind: "payment", data: { to: "acme", sats: 50000 } };
  const entryHash = computeEntryHash(base);
  // encrypt canonical(data); a key-holder decrypts, re-parses, and recomputes the same hash
  const env = encryptFor(Buffer.from(canonicalize(base.data), "utf8"), [client.pub]);
  const recovered = JSON.parse(decryptWith(env, client.wif).toString("utf8"));
  assert.equal(computeEntryHash({ ...base, data: recovered }), entryHash);
});

console.log(`\n${pass} crypto checks passed`);
