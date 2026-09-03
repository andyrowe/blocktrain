#!/usr/bin/env node
// Standalone blocktrain verifier — trusts NOTHING but math and the public BSV chain.
//
// Zero dependencies (Node >= 18 built-ins only). Drop it next to a blocktrain-poc.json
// bundle and run:
//
//     node verify.mjs blocktrain-poc.json
//
// It independently:
//   1. recomputes the hash-chain over the raw entries  (order + integrity),
//   2. folds each entry's RFC 6962 Merkle inclusion proof to the sealed root,
//   3. reads the anchor transaction's OP_RETURN from WhatsOnChain and checks it encodes
//      bsv.cx / not2 / <that same root>  (the timestamp, on the public chain).
//
// If all three pass, the batch provably existed, in order, at that block time — and you
// did not have to trust blocktrain or bsv.cx to know it.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const sha256 = (buf) => createHash("sha256").update(buf).digest();
const GENESIS = Buffer.alloc(32, 0);

// --- safe outbound fetch for bundle-supplied `url` refs ------------------------------
// A bundle is untrusted input. Refuse loopback/private hosts (SSRF), block redirects,
// time out, and cap size — so verifying a hostile bundle can't hit internal services,
// follow a redirect into one, hang, or OOM the machine running this script.
const MAX_REF_BYTES = 5 * 1024 * 1024;
function assertSafeUrl(u) {
  const url = new URL(u);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) URLs allowed");
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (
    h === "localhost" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^(fc|fd|fe80)/i.test(h)
  ) throw new Error(`refusing to fetch private/loopback host ${h}`);
}
function safeFetch(u, init = {}) {
  assertSafeUrl(u);
  return fetch(u, { redirect: "error", signal: AbortSignal.timeout(8000), ...init });
}

// --- deterministic JSON (sorted keys) — must match how entries were hashed -----------
function canonical(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") return JSON.stringify(v);
  if (t === "boolean" || t === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (t === "object") {
    const keys = Object.keys(v).sort();
    return "{" + keys.filter((k) => v[k] !== undefined)
      .map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
  }
  throw new Error("uncanonicalizable: " + t);
}

// --- hash-chain ----------------------------------------------------------------------
const entryHashOf = (e) =>
  sha256(Buffer.from(canonical({ seq: e.seq, ts: e.ts, actor: e.actor, kind: e.kind, data: e.data }), "utf8")).toString("hex");
const linkHashOf = (prevHex, entryHex) =>
  sha256(Buffer.concat([prevHex ? Buffer.from(prevHex, "hex") : GENESIS, Buffer.from(entryHex, "hex")])).toString("hex");

// --- RFC 6962 Merkle -----------------------------------------------------------------
const leafHash = (d) => sha256(Buffer.concat([Buffer.from([0x00]), d]));
const nodeHash = (l, r) => sha256(Buffer.concat([Buffer.from([0x01]), l, r]));
function pow2Below(n) { let k = 1; while (k * 2 < n) k *= 2; return k; }
function mth(hashes) {
  if (hashes.length === 1) return hashes[0];
  const k = pow2Below(hashes.length);
  return nodeHash(mth(hashes.slice(0, k)), mth(hashes.slice(k)));
}
function proofForIndex(leaves, index) {
  const hashes = leaves.map(leafHash);
  const path = [];
  (function build(hs, idx) {
    if (hs.length <= 1) return;
    const k = pow2Below(hs.length);
    if (idx < k) { build(hs.slice(0, k), idx); path.push({ hash: mth(hs.slice(k)), side: "right" }); }
    else { build(hs.slice(k), idx - k); path.push({ hash: mth(hs.slice(0, k)), side: "left" }); }
  })(hashes, index);
  return path;
}
function foldProof(leafData, path) {
  let acc = leafHash(leafData);
  for (const s of path) acc = s.side === "left" ? nodeHash(s.hash, acc) : nodeHash(acc, s.hash);
  return acc.toString("hex");
}

// --- read the anchor tx OP_RETURN off the public chain -------------------------------
async function opReturnChunks(txid, net) {
  const base = `https://api.whatsonchain.com/v1/bsv/${net === "test" ? "test" : "main"}`;
  const hex = (await (await fetch(`${base}/tx/${txid}/hex`)).text()).trim();
  if (!/^[0-9a-f]+$/i.test(hex)) throw new Error("could not fetch anchor tx hex");
  // minimal tx parse: locate outputs and scan each script for OP_RETURN pushdata
  // (we scan the whole raw tx for the 006a marker; robust enough for a data output)
  const buf = Buffer.from(hex, "hex");
  const results = [];
  for (let i = 0; i < buf.length - 1; i++) {
    if (buf[i] === 0x00 && buf[i + 1] === 0x6a) {
      let p = i + 2;
      const chunks = [];
      while (p < buf.length) {
        const len = buf[p];
        if (len === 0 || len >= 0x4c) break;
        p++;
        if (p + len > buf.length) break;
        chunks.push(buf.subarray(p, p + len).toString("utf8"));
        p += len;
      }
      if (chunks.length) results.push(chunks);
    }
  }
  return results;
}

// --- main ----------------------------------------------------------------------------
const file = process.argv[2] ?? "blocktrain-poc.json";
const bundle = JSON.parse(readFileSync(file, "utf8"));
const { entries, seal } = bundle;
let ok = true;
const fail = (m) => { ok = false; console.log("  ✗ " + m); };
const pass = (m) => console.log("  ✓ " + m);

console.log(`blocktrain bundle: ${entries.length} entries, seal root ${seal.root.slice(0, 16)}…\n`);

// 1) hash-chain
console.log("1) hash-chain (order + integrity)");
let prev = null;
for (const e of entries) {
  const eh = entryHashOf(e);
  if (eh !== e.entryHash) fail(`seq ${e.seq}: entryHash mismatch (body altered)`);
  const lh = linkHashOf(prev, eh);
  if (lh !== e.linkHash) fail(`seq ${e.seq}: linkHash mismatch (chain broken)`);
  prev = e.linkHash;
}
if (ok) pass(`${entries.length} entries chain cleanly; tip ${prev.slice(0, 16)}…`);

// 2) Merkle inclusion against the sealed root
console.log("2) Merkle inclusion proofs (recomputed locally)");
const leafBufs = seal.leaves.map((h) => Buffer.from(h, "hex"));
for (let i = 0; i < leafBufs.length; i++) {
  const seq = seal.fromSeq + i;
  const e = entries.find((x) => x.seq === seq);
  if (!e || e.linkHash !== seal.leaves[i]) { fail(`leaf ${i} != entry seq ${seq} linkHash`); continue; }
  const folded = foldProof(leafBufs[i], proofForIndex(leafBufs, i));
  if (folded !== seal.root.toLowerCase()) fail(`leaf ${i}: proof does not fold to root`);
}
if (ok) pass(`all ${leafBufs.length} leaves fold to root ${seal.root.slice(0, 16)}…`);

// 3) on-chain anchor
console.log("3) on-chain anchor (public BSV chain via WhatsOnChain)");
try {
  const found = (await opReturnChunks(seal.txid, seal.network)).find(
    (c) => c[0] === "bsv.cx" && c[1] === "not2" && (c[2] || "").toLowerCase() === seal.root.toLowerCase(),
  );
  if (found) pass(`tx ${seal.txid.slice(0, 16)}… OP_RETURN = ["bsv.cx","not2","${seal.root.slice(0, 12)}…"]`);
  else fail("anchor tx OP_RETURN does not carry this root");
} catch (e) {
  fail("chain read failed: " + e.message);
}

// 4) external corroboration — check any entry refs against their real-world source
const allRefs = entries.flatMap((e) => (Array.isArray(e.data?.refs) ? e.data.refs.map((r) => ({ seq: e.seq, r })) : []));
if (allRefs.length) {
  console.log("4) external corroboration (refs checked against WhatsOnChain / GitHub / the open web)");
  for (const { seq, r } of allRefs) {
    try {
      let res;
      if (r.type === "bsv-txid") {
        const ok2 = (await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/hash/${r.value}`)).ok;
        res = ok2 ? "on-chain" : "NOT FOUND";
        if (!ok2) fail(`seq ${seq} bsv-txid not found`);
      } else if (r.type === "git-commit") {
        const gh = await fetch(`https://api.github.com/repos/${r.repo}/commits/${r.value}`, { headers: { "user-agent": "blocktrain-verify" } });
        res = gh.ok ? `commit in ${r.repo}` : "NOT FOUND";
        if (!gh.ok) fail(`seq ${seq} git-commit not found`);
      } else if (r.type === "url") {
        if (r.sha256) {
          const resp = await safeFetch(r.value);
          const cl = Number(resp.headers.get("content-length") || 0);
          if (cl > MAX_REF_BYTES) { res = "TOO LARGE"; fail(`seq ${seq} url exceeds ${MAX_REF_BYTES}B`); }
          else {
            const body = new Uint8Array(await resp.arrayBuffer());
            if (body.length > MAX_REF_BYTES) { res = "TOO LARGE"; fail(`seq ${seq} url exceeds ${MAX_REF_BYTES}B`); }
            else {
              const got = sha256(Buffer.from(body)).toString("hex");
              res = got === r.sha256.toLowerCase() ? "content sha256 matches" : "CONTENT MISMATCH";
              if (got !== r.sha256.toLowerCase()) fail(`seq ${seq} url content mismatch`);
            }
          }
        } else {
          const ok2 = (await safeFetch(r.value, { method: "HEAD" })).ok;
          res = ok2 ? "live" : "DEAD";
          if (!ok2) fail(`seq ${seq} url dead`);
        }
      } else { res = "unknown ref type"; fail(`seq ${seq} unknown ref`); }
      console.log(`  ${res.startsWith("NOT") || res.includes("MISMATCH") || res === "DEAD" ? "✗" : "✓"} seq ${seq} ${r.type} — ${res}`);
    } catch (e) { fail(`seq ${seq} ref check error: ${e.message}`); }
  }
}

console.log(`\n${ok ? "✅ VERIFIED — batch existed, in order, anchored on-chain" + (allRefs.length ? ", refs corroborated" : "") + ". No trust required." : "❌ VERIFICATION FAILED"}`);
process.exit(ok ? 0 : 1);
