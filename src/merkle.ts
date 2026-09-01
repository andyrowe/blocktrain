// Client-side RFC 6962 (Certificate Transparency) Merkle verification.
//
// This is the trust anchor of blocktrain: verifying an inclusion proof must NEVER
// require trusting bsv.cx's server. bsv.cx builds its `not2` batches with exactly
// this scheme (domain-separated single-SHA256, odd nodes promoted not duplicated),
// so we recompute the root ourselves from {leaf hash, index, sibling path} and
// compare. If it matches the root that is OP_RETURN-anchored on-chain, the entry
// provably existed at that block time. Proven against the same CT vectors bsv.cx
// passes (see test/merkle.test.ts).

import { createHash } from "node:crypto";

function sha256(buf: Buffer): Buffer {
  return createHash("sha256").update(buf).digest();
}

// leaf hash: SHA256(0x00 || leafData)
export function leafHash(leafData: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x00]), leafData]));
}

// inner hash: SHA256(0x01 || left || right)
export function nodeHash(left: Buffer, right: Buffer): Buffer {
  return sha256(Buffer.concat([Buffer.from([0x01]), left, right]));
}

// Build a Merkle tree root over an ordered list of leaf *data* buffers.
// RFC 6962: split at the largest power of two < n; lone right subtree carries up.
export function merkleRoot(leaves: Buffer[]): Buffer {
  if (leaves.length === 0) return sha256(Buffer.alloc(0)); // MTH({}) = SHA256() per RFC
  return mth(leaves.map(leafHash));
}

function mth(hashes: Buffer[]): Buffer {
  if (hashes.length === 1) return hashes[0];
  const k = largestPow2Below(hashes.length);
  return nodeHash(mth(hashes.slice(0, k)), mth(hashes.slice(k)));
}

function largestPow2Below(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export type ProofStep = { hash: string; side: "left" | "right" };

// Verify an inclusion proof independently. `leafData` is the raw bytes committed
// as a leaf (for blocktrain, the 32-byte linkHash). Returns true iff folding the
// path reproduces `rootHex`.
export function verifyInclusion(
  leafData: Buffer,
  proof: ProofStep[],
  rootHex: string,
): boolean {
  let acc = leafHash(leafData);
  for (const step of proof) {
    const sib = Buffer.from(step.hash, "hex");
    acc = step.side === "left" ? nodeHash(sib, acc) : nodeHash(acc, sib);
  }
  return acc.toString("hex") === rootHex.toLowerCase();
}

// Build the inclusion proof for a given leaf index over ordered leaf data. Used
// locally so blocktrain can verify without asking the server for the path at all.
export function proofForIndex(leaves: Buffer[], index: number): ProofStep[] {
  if (index < 0 || index >= leaves.length) throw new Error("index out of range");
  const hashes = leaves.map(leafHash);
  const path: ProofStep[] = [];
  build(hashes, index, path);
  return path;
}

function build(hashes: Buffer[], index: number, path: ProofStep[]): void {
  const n = hashes.length;
  if (n <= 1) return;
  const k = largestPow2Below(n);
  // Recurse toward the leaf FIRST, then push this level's sibling, so the path is
  // ordered bottom-up (leaf's immediate sibling first) to match verifyInclusion's fold.
  if (index < k) {
    build(hashes.slice(0, k), index, path);
    // sibling is the right subtree root, on our right
    path.push({ hash: mth(hashes.slice(k)).toString("hex"), side: "right" });
  } else {
    build(hashes.slice(k), index - k, path);
    // sibling is the left subtree root, on our left
    path.push({ hash: mth(hashes.slice(0, k)).toString("hex"), side: "left" });
  }
}
