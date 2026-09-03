// Payment guard-rail tests (pure; no network). Ensures auto-pay refuses bad amounts,
// over-cap amounts, and unrecognized networks — the money-safety checks.

import assert from "node:assert/strict";
import { resolvePayment, netFromCaip2 } from "../src/pay.ts";

let pass = 0;
function check(name: string, fn: () => void) { fn(); pass++; console.log("ok -", name); }

check("valid mainnet 300 sats", () => {
  assert.deepEqual(resolvePayment(300, "bsv:mainnet", 100000), { amount: 300, net: "main" });
});
check("string amount is coerced", () => {
  assert.equal(resolvePayment("300", "bsv:testnet", 100000).net, "test");
});
check("over cap throws", () => {
  assert.throws(() => resolvePayment(200000, "bsv:mainnet", 100000), /exceeds cap/);
});
check("non-integer / zero / negative throw", () => {
  assert.throws(() => resolvePayment("abc", "bsv:mainnet"));
  assert.throws(() => resolvePayment(0, "bsv:mainnet"));
  assert.throws(() => resolvePayment(-5, "bsv:mainnet"));
  assert.throws(() => resolvePayment(1.5, "bsv:mainnet"));
});
check("missing network throws", () => {
  assert.throws(() => resolvePayment(300, undefined), /no network/);
});
check("unknown network refuses (no silent mainnet default)", () => {
  assert.throws(() => resolvePayment(300, "eth:1"), /refusing to guess/);
  assert.throws(() => netFromCaip2("solana:mainnet"), /refusing to guess/);
});
check("bip122 genesis mapping", () => {
  assert.equal(netFromCaip2("bip122:000000000019d6689c085ae165831e93"), "main");
  assert.equal(netFromCaip2("bip122:000000000933ea01ad0ee984209779ba"), "test");
});

console.log(`\n${pass} pay checks passed`);
