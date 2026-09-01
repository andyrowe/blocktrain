// Ref parsing tests (pure). Live verifyRef() is exercised against the real chain/GitHub
// in the P4 end-to-end run, not here (no network in unit tests).

import assert from "node:assert/strict";
import { parseRefArg } from "../src/refs.ts";

let pass = 0;
function check(name: string, fn: () => void) { fn(); pass++; console.log("ok -", name); }

check("bsv-txid", () => {
  assert.deepEqual(parseRefArg("bsv-txid:abc123"), { type: "bsv-txid", value: "abc123" });
});

check("git-commit with owner/repo", () => {
  assert.deepEqual(parseRefArg("git-commit:279c41e:andyrowe/blocktrain"),
    { type: "git-commit", value: "279c41e", repo: "andyrowe/blocktrain" });
});

check("url plain", () => {
  assert.deepEqual(parseRefArg("url:https://blocktrain.org/"),
    { type: "url", value: "https://blocktrain.org/" });
});

check("url with content sha256", () => {
  const h = "a".repeat(64);
  assert.deepEqual(parseRefArg(`url:https://x.org/f.json::${h}`),
    { type: "url", value: "https://x.org/f.json", sha256: h });
});

check("bad ref throws", () => {
  assert.throws(() => parseRefArg("garbage"));
  assert.throws(() => parseRefArg("git-commit:onlysha"));
});

console.log(`\n${pass} refs checks passed`);
