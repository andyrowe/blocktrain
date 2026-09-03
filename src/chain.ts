// blocktrain hash-chained append-only event log.
//
// This is what blocktrain adds ON TOP of bsv.cx's batch notary: bsv.cx proves a
// SET of hashes existed by some time; the hash-chain additionally proves the
// ORDER of events and makes any after-the-fact edit/insert/delete detectable.
//
//   entryHash_i = SHA256(canonical(event_i))
//   linkHash_0  = SHA256( GENESIS(32 zero bytes) || entryHash_0 )
//   linkHash_i  = SHA256( linkHash_{i-1}         || entryHash_i )
//
// A verifier replays the raw events, recomputes the chain, and checks the tip.
// The linkHashes are what we anchor (as Merkle leaves) via bsv.cx, so each entry
// gets an independent on-chain timestamp while the chain gives global order.
//
// Honest scope (stated at the same weight as the pitch): this proves integrity +
// order + timestamp of a SELF-REPORTED log. It makes tampering detectable; it does
// NOT make the agent truthful to its own log. Same limit every anchor has.

import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.ts";

export const GENESIS = Buffer.alloc(32, 0);

export type EventInput = {
  actor: string; // who/what produced this (e.g. "mike")
  kind: string; // event type (e.g. "twetch.post", "spend", "deploy")
  data: unknown; // arbitrary JSON payload
  ts?: string; // ISO timestamp; filled with now() if omitted
};

export type LogEntry = {
  seq: number;
  ts: string;
  actor: string;
  kind: string;
  data: unknown;
  entryHash: string; // hex, sha256(canonical of the {seq,ts,actor,kind,data} tuple)
  linkHash: string; // hex, chained
};

function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// The exact object that gets canonicalized+hashed for a given entry. Kept as its
// own function so verification hashes the identical shape the writer committed.
function entryTuple(e: Pick<LogEntry, "seq" | "ts" | "actor" | "kind" | "data">) {
  return { seq: e.seq, ts: e.ts, actor: e.actor, kind: e.kind, data: e.data };
}

export function computeEntryHash(
  e: Pick<LogEntry, "seq" | "ts" | "actor" | "kind" | "data">,
): string {
  return sha256hex(Buffer.from(canonicalize(entryTuple(e)), "utf8"));
}

// P6 context anchoring: commit the agent's decision-time context (model input / retrieved
// state) as sha256(nonce ‖ context). Placed in the entry's data, so it's part of entryHash →
// linkHash → the on-chain anchor: the commitment is timestamped at action-time and cannot be
// backfilled with a more flattering context later. (It proves what the agent CLAIMS it knew
// when it acted — not that the context caused the action; LLMs aren't bit-replayable.)
export function computeContextHash(nonceHex: string, context: Buffer): string {
  return sha256hex(Buffer.concat([Buffer.from(nonceHex, "hex"), context]));
}

export function computeLinkHash(prevLinkHex: string | null, entryHashHex: string): string {
  const prev = prevLinkHex ? Buffer.from(prevLinkHex, "hex") : GENESIS;
  return sha256hex(Buffer.concat([prev, Buffer.from(entryHashHex, "hex")]));
}

// Append one event to an existing (possibly empty) ordered log, returning the new
// entry. Pure: does no I/O. The store layer persists what this returns.
export function appendEntry(log: LogEntry[], input: EventInput): LogEntry {
  const seq = log.length;
  const ts = input.ts ?? new Date().toISOString();
  const base = { seq, ts, actor: input.actor, kind: input.kind, data: input.data };
  const entryHash = computeEntryHash(base);
  const prevLink = log.length > 0 ? log[log.length - 1].linkHash : null;
  const linkHash = computeLinkHash(prevLink, entryHash);
  return { ...base, entryHash, linkHash };
}

export type VerifyResult =
  | { ok: true; count: number; tip: string | null; encrypted: number }
  | { ok: false; failedSeq: number; reason: string };

// Replay the chain from raw events and confirm every entryHash + linkHash. This is
// the free, offline half of verification (order + integrity). The on-chain half
// (timestamp) is checked separately against bsv.cx / SPV.
export function verifyChain(log: LogEntry[]): VerifyResult {
  let prevLink: string | null = null;
  let encrypted = 0;
  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e.seq !== i) {
      return { ok: false, failedSeq: i, reason: `seq mismatch: expected ${i}, got ${e.seq}` };
    }
    // Encrypted entries (payload replaced by an `enc` envelope, no plaintext `data`) can't have
    // their entryHash recomputed without a key — we verify the chain LINKAGE from the stored
    // entryHash, and defer content-integrity to a key-holder (see `reveal`). Plaintext entries
    // are fully checked here.
    const isEncrypted = (e as { enc?: unknown }).enc !== undefined && e.data === undefined;
    if (isEncrypted) {
      encrypted++;
    } else if (computeEntryHash(e) !== e.entryHash) {
      return { ok: false, failedSeq: i, reason: "entryHash mismatch (event body was altered)" };
    }
    const expectLink = computeLinkHash(prevLink, e.entryHash);
    if (expectLink !== e.linkHash) {
      return { ok: false, failedSeq: i, reason: "linkHash mismatch (chain order/integrity broken)" };
    }
    prevLink = e.linkHash;
  }
  return { ok: true, count: log.length, tip: prevLink, encrypted };
}
