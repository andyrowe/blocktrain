// Shared operations used by BOTH the CLI and the MCP server, so there is one implementation
// of append / seal / verify / reveal (no drift between surfaces).

import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { appendEntry, verifyChain, computeEntryHash, computeContextHash } from "./chain.ts";
import { readLog, appendLog, readSeals, writeSeals, sealedThrough, writeContext, type Seal } from "./store.ts";
import { canonicalize } from "./canonical.ts";
import { merkleRoot, proofForIndex, verifyInclusion } from "./merkle.ts";
import { anchorBatch, anchorCarriesRoot } from "./client.ts";
import { parseRefArg, verifyRef, type Ref } from "./refs.ts";
import { encryptFor, decryptWith } from "./crypto.ts";

export type Paths = { log: string; seals: string };

export type AppendOpts = {
  actor?: string;
  kind: string;
  data?: unknown;
  refs?: (string | Ref)[]; // "type:value" tokens or Ref objects
  evidence?: string;
  encryptTo?: string[]; // recipient pubkeys
  context?: Buffer | string; // decision-time context snapshot
};

export function appendEvent(paths: Paths, o: AppendOpts) {
  const actor = o.actor ?? "mike";
  const refs = (o.refs ?? []).map((r) => (typeof r === "string" ? parseRefArg(r) : r));
  const evidence = o.evidence ?? (refs.length ? "corroborated" : "structured");
  const base = o.data && typeof o.data === "object" && !Array.isArray(o.data) ? (o.data as Record<string, unknown>) : { value: o.data };
  const nonce = randomBytes(16).toString("hex");
  const ctxBlob = o.context == null ? null : Buffer.isBuffer(o.context) ? o.context : Buffer.from(String(o.context), "utf8");
  const contextHash = ctxBlob ? computeContextHash(nonce, ctxBlob) : undefined;
  const enriched = { ...base, evidence, capturedBy: "self", nonce, ...(refs.length ? { refs } : {}), ...(contextHash ? { contextHash } : {}) };

  const log = readLog(paths.log);
  const entry = appendEntry(log, { actor, kind: o.kind, data: enriched });
  const encTo = o.encryptTo ?? [];
  if (ctxBlob && contextHash) {
    if (encTo.length) writeContext(paths.log, contextHash, Buffer.from(JSON.stringify(encryptFor(ctxBlob, encTo)), "utf8"), true);
    else writeContext(paths.log, contextHash, ctxBlob, false);
  }
  let stored: Record<string, unknown> = entry;
  if (encTo.length) {
    const env = encryptFor(Buffer.from(canonicalize(entry.data), "utf8"), encTo);
    stored = { seq: entry.seq, ts: entry.ts, actor: entry.actor, kind: entry.kind, enc: env, entryHash: entry.entryHash, linkHash: entry.linkHash };
  }
  appendLog(paths.log, stored as never);
  return { seq: entry.seq, kind: o.kind, entryHash: entry.entryHash, linkHash: entry.linkHash, evidence, encryptedTo: encTo.length, contextHash };
}

export async function sealPending(paths: Paths, wif: string) {
  const log = readLog(paths.log);
  const sf = readSeals(paths.seals);
  const from = sealedThrough(sf.seals) + 1;
  if (from >= log.length) return { sealed: false as const, reason: "nothing to seal — all entries already anchored" };
  const leaves = log.slice(from).map((e) => e.linkHash);
  const localRoot = merkleRoot(leaves.map((h) => Buffer.from(h, "hex"))).toString("hex");
  const receipt = await anchorBatch(leaves, wif);
  if (receipt.root.toLowerCase() !== localRoot.toLowerCase()) {
    throw new Error(`root mismatch! local ${localRoot} vs bsv.cx ${receipt.root} — aborting`);
  }
  const seal: Seal = {
    root: receipt.root, txid: receipt.txid, network: "main", anchored: receipt.anchored,
    settlementTxid: receipt.settlementTxid, createdAt: new Date().toISOString(),
    fromSeq: from, toSeq: log.length - 1, leaves,
  };
  sf.seals.push(seal);
  writeSeals(paths.seals, sf);
  return { sealed: true as const, txid: receipt.txid, root: receipt.root, settlementTxid: receipt.settlementTxid, count: leaves.length, fromSeq: from, toSeq: log.length - 1 };
}

export async function verifyLog(paths: Paths, opts: { refs?: boolean; onchain?: boolean } = {}) {
  const log = readLog(paths.log);
  const chain = verifyChain(log);
  if (!chain.ok) return { ok: false as const, stage: "chain", failedSeq: chain.failedSeq, reason: chain.reason };
  const sf = readSeals(paths.seals);
  const seals: { fromSeq: number; toSeq: number; root: string; txid: string; onchain?: string }[] = [];
  for (const s of sf.seals) {
    const bufs = s.leaves.map((h) => Buffer.from(h, "hex"));
    for (let i = 0; i < bufs.length; i++) {
      if (log[s.fromSeq + i]?.linkHash !== s.leaves[i]) return { ok: false as const, stage: "seal", reason: `leaf ${i} != log seq ${s.fromSeq + i}` };
      if (!verifyInclusion(bufs[i], proofForIndex(bufs, i), s.root)) return { ok: false as const, stage: "seal", reason: `inclusion proof failed at leaf ${i}` };
    }
    let onchain: string | undefined;
    if (opts.onchain && s.txid && s.txid !== "DRY") {
      const c = await anchorCarriesRoot(s.txid, s.root, s.network === "test" ? "test" : "main");
      onchain = c.confirmed ? `root-confirmed (${c.sources.join("+")})` : "ROOT-NOT-FOUND";
    }
    seals.push({ fromSeq: s.fromSeq, toSeq: s.toSeq, root: s.root, txid: s.txid, onchain });
  }
  const refs: { seq: number; type: string; ok: boolean; detail: string }[] = [];
  if (opts.refs) {
    for (const e of log) {
      const rr = (e.data as { refs?: unknown[] })?.refs;
      if (!Array.isArray(rr)) continue;
      for (const ref of rr) {
        const r = await verifyRef(ref as never);
        refs.push({ seq: e.seq, type: (ref as { type: string }).type, ok: r.ok, detail: r.detail });
      }
    }
  }
  const refsOk = refs.every((r) => r.ok);
  const onchainOk = seals.every((s) => s.onchain !== "ROOT-NOT-FOUND");
  return { ok: refsOk && onchainOk, count: chain.count, encrypted: chain.encrypted, tip: chain.tip, sealed: sealedThrough(sf.seals), seals, refs };
}

export function revealEntry(paths: Paths, seq: number, wif?: string) {
  const log = readLog(paths.log);
  const e = log[seq] as { seq: number; ts: string; actor: string; kind: string; data?: unknown; enc?: unknown; entryHash: string };
  if (!e) throw new Error(`no entry at seq ${seq}`);
  if (!e.enc) return { seq, kind: e.kind, data: e.data, integrityOk: true, encrypted: false };
  if (!wif) throw new Error("entry is encrypted — a key is required");
  const data = JSON.parse(decryptWith(e.enc as never, wif).toString("utf8"));
  const integrityOk = computeEntryHash({ seq: e.seq, ts: e.ts, actor: e.actor, kind: e.kind, data }) === e.entryHash;
  return { seq, kind: e.kind, data, integrityOk, encrypted: true };
}
