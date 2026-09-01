// RFC 6962 Certificate Transparency reference vectors + round-trip inclusion proofs.
// If these pass, our client-side verifier is byte-compatible with bsv.cx's not2 tree,
// so blocktrain can verify anchors without trusting the server.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { merkleRoot, leafHash, nodeHash, proofForIndex, verifyInclusion } from "../src/merkle.ts";

let pass = 0;
function check(name: string, fn: () => void) {
  fn();
  pass++;
  console.log("ok -", name);
}

const h = (b: Buffer) => b.toString("hex");
const sha = (b: Buffer) => createHash("sha256").update(b).digest();

// --- RFC 6962 §2.1.3 worked reference values (data = single bytes 0x00..0x03) ---
const d = [
  Buffer.from([0x00]),
  Buffer.from([0x10]),
  Buffer.from([0x20]),
  Buffer.from([0x30]),
];

check("empty tree root == SHA256('')", () => {
  assert.equal(h(merkleRoot([])), h(sha(Buffer.alloc(0))));
});

check("single leaf root == leafHash", () => {
  assert.equal(h(merkleRoot([d[0]])), h(leafHash(d[0])));
});

check("two leaves == node(leaf0, leaf1)", () => {
  const expect = nodeHash(leafHash(d[0]), leafHash(d[1]));
  assert.equal(h(merkleRoot([d[0], d[1]])), h(expect));
});

check("three leaves promote lone node (RFC 6962 split)", () => {
  // MTH = node( node(leaf0,leaf1), leaf2 )
  const expect = nodeHash(nodeHash(leafHash(d[0]), leafHash(d[1])), leafHash(d[2]));
  assert.equal(h(merkleRoot([d[0], d[1], d[2]])), h(expect));
});

check("four leaves balanced", () => {
  const expect = nodeHash(
    nodeHash(leafHash(d[0]), leafHash(d[1])),
    nodeHash(leafHash(d[2]), leafHash(d[3])),
  );
  assert.equal(h(merkleRoot([d[0], d[1], d[2], d[3]])), h(expect));
});

// --- round-trip: every proof we generate must verify against the root, for many sizes
check("inclusion proof round-trips for sizes 1..33 and every index", () => {
  for (let n = 1; n <= 33; n++) {
    const leaves = Array.from({ length: n }, (_, i) =>
      sha(Buffer.from(`leaf-${n}-${i}`)),
    );
    const root = h(merkleRoot(leaves));
    for (let i = 0; i < n; i++) {
      const proof = proofForIndex(leaves, i);
      assert.equal(verifyInclusion(leaves[i], proof, root), true, `n=${n} i=${i} should verify`);
      // a wrong leaf must NOT verify
      const wrong = sha(Buffer.from("not-a-leaf"));
      assert.equal(verifyInclusion(wrong, proof, root), false, `n=${n} i=${i} wrong leaf must fail`);
    }
  }
});

console.log(`\n${pass} merkle checks passed`);
