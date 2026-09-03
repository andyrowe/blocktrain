// Append-only persistence. The log is JSONL (one LogEntry per line) so it is
// human-readable, greppable, and cheap to append. Seals (batch receipts) live in a
// small JSON sidecar keyed by batch root. Nothing here touches the chain.

import { readFileSync, appendFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { LogEntry } from "./chain.ts";

export type Seal = {
  root: string; // merkle root of the sealed linkHashes (== bsv.cx not2 root)
  txid: string; // on-chain anchor txid
  settlementTxid?: string; // x402 payment tx we sent to bsv.cx (provenance of the spend)
  network: string; // "main" | "test"
  anchored: boolean;
  createdAt: string;
  fromSeq: number; // inclusive
  toSeq: number; // inclusive
  leaves: string[]; // ordered linkHashes anchored in this batch (index = position)
};

export type SealFile = { seals: Seal[] };

function ensureDir(p: string) {
  const dir = dirname(p);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readLog(path: string): LogEntry[] {
  if (!existsSync(path)) return [];
  const txt = readFileSync(path, "utf8");
  const out: LogEntry[] = [];
  for (const line of txt.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t) as LogEntry);
  }
  return out;
}

export function appendLog(path: string, entry: LogEntry): void {
  ensureDir(path);
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

export function readSeals(path: string): SealFile {
  if (!existsSync(path)) return { seals: [] };
  return JSON.parse(readFileSync(path, "utf8")) as SealFile;
}

export function writeSeals(path: string, data: SealFile): void {
  ensureDir(path);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// --- context snapshots (P6) ---------------------------------------------------------
// Snapshots live in a sidecar dir keyed by their contextHash, off the main log (they can be
// large). Stored raw (.bin) or as an encryption envelope (.enc). The entry only carries the
// hash, so the log stays lean and context can be disclosed selectively.
import { join } from "node:path";
function contextDir(logPath: string): string {
  return join(dirname(logPath) || ".", "context");
}
export function writeContext(logPath: string, hash: string, data: Buffer, encrypted: boolean): string {
  const dir = contextDir(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, hash + (encrypted ? ".enc" : ".bin"));
  writeFileSync(p, data);
  return p;
}
export function readContext(logPath: string, hash: string): { data: Buffer; encrypted: boolean } | null {
  const dir = contextDir(logPath);
  const enc = join(dir, hash + ".enc");
  const raw = join(dir, hash + ".bin");
  if (existsSync(enc)) return { data: readFileSync(enc), encrypted: true };
  if (existsSync(raw)) return { data: readFileSync(raw), encrypted: false };
  return null;
}

// Which sequence numbers are already covered by a seal.
export function sealedThrough(seals: Seal[]): number {
  let max = -1;
  for (const s of seals) if (s.toSeq > max) max = s.toSeq;
  return max;
}
