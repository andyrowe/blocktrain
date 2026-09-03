// bsv.cx client — the ONLY networked part of blocktrain. Everything blocktrain
// proves can be re-checked without this file (that's the point), but this is how a
// seal actually gets anchored on-chain and how we pull an anchor's proof back.
//
// bsv.cx surface used:
//   POST /n/batch        { hashes:[hex,...] } -> { root, txid, count, anchored }
//   GET  /n/:hash/proof  -> { hash, alg, index, path:[{hash,side}], root, txid, anchored, network }
//   POST /spv/verify     { txid, height?, index, nodes } | { beef } | { bump, txid }
//                        -> { status: "confirmed" | "rejected" | "inconclusive", ... }

export type BatchReceipt = {
  root: string;
  txid: string;
  count: number;
  anchored: boolean;
};

export type BsvcxProof = {
  hash: string;
  alg: string;
  index: number;
  path: { hash: string; side: "left" | "right" }[];
  root: string;
  txid: string;
  anchored: boolean;
  network: string;
};

const DEFAULT_BASE = process.env.BLOCKTRAIN_BSVCX ?? "https://bsv.cx";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", accept: "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`bsv.cx ${init?.method ?? "GET"} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`bsv.cx ${url} returned non-JSON: ${text.slice(0, 200)}`);
  }
}

// Anchor an ordered set of linkHashes as one on-chain not2 batch.
// bsv.cx's /n/batch is x402 pay-gated, so a funded WIF is required to pay the invoice.
// Returns the batch receipt plus the settlement txid of the x402 payment we made.
export async function anchorBatch(
  hashes: string[],
  wif: string,
  base = DEFAULT_BASE,
): Promise<BatchReceipt & { settlementTxid: string }> {
  const { data, settlementTxid } = await postPaid<BatchReceipt>(`${base}/n/batch`, { hashes }, wif);
  return { ...data, settlementTxid };
}

// Pull bsv.cx's own inclusion proof for a hash. Free. We still verify it locally.
export function fetchProof(hash: string, base = DEFAULT_BASE): Promise<BsvcxProof> {
  return jsonFetch<BsvcxProof>(`${base}/n/${hash}/proof`);
}

import { postPaid } from "./pay.ts";

// Explorer-agnostic on-chain reads. We never trust a single explorer: by default we read the
// tx from multiple independent sources and require them to AGREE on the bytes, so one down or
// lying explorer can't break or fool verification. Override with your OWN node via
// BLOCKTRAIN_EXPLORER=<WoC-compatible base url> (then that single trusted source is used).
type Explorer = { name: string; hexUrl: (txid: string, net: "main" | "test") => string | null };
export function explorers(): Explorer[] {
  const custom = process.env.BLOCKTRAIN_EXPLORER;
  if (custom) {
    const base = custom.replace(/\/$/, "");
    return [{ name: "custom", hexUrl: (txid, net) => `${base}/tx/${txid}/hex`.replace("{net}", net) }];
  }
  return [
    { name: "whatsonchain", hexUrl: (txid, net) => `https://api.whatsonchain.com/v1/bsv/${net}/tx/${txid}/hex` },
    { name: "bitails", hexUrl: (txid, net) => (net === "main" ? `https://api.bitails.io/download/tx/${txid}/hex` : null) },
  ];
}
// Fetch the raw tx hex from every configured explorer that has it.
async function fetchTxHex(txid: string, net: "main" | "test"): Promise<{ name: string; hex: string }[]> {
  const out: { name: string; hex: string }[] = [];
  for (const e of explorers()) {
    const u = e.hexUrl(txid, net);
    if (!u) continue;
    try {
      const t = (await (await fetch(u)).text()).trim();
      if (/^[0-9a-f]+$/i.test(t) && t.length > 0) out.push({ name: e.name, hex: t });
    } catch { /* explorer down — try the next */ }
  }
  return out;
}
// Does the tx exist on-chain (per any explorer)? Used to corroborate bsv-txid refs.
export async function txExists(txid: string, net: "main" | "test" = "main"): Promise<boolean> {
  return (await fetchTxHex(txid, net)).length > 0;
}
function opReturnCarries(hex: string, root: string, Transaction: typeof import("@bsv/sdk").Transaction): boolean {
  const tx = Transaction.fromHex(hex);
  for (const o of tx.outputs) {
    const script = Buffer.from(o.lockingScript.toHex(), "hex");
    let p = 0;
    if (script[p] === 0x00) p++;
    if (script[p] !== 0x6a) continue;
    p++;
    const chunks: string[] = [];
    while (p < script.length) {
      const len = script[p];
      if (len >= 0x4c) break;
      p++;
      chunks.push(script.subarray(p, p + len).toString("utf8"));
      p += len;
    }
    if (chunks[0] === "bsv.cx" && chunks[1] === "not2" && chunks[2]?.toLowerCase() === root.toLowerCase()) return true;
  }
  return false;
}

// Confirm the anchor tx carries bsv.cx/not2/<root>, cross-checked across explorers. Trusts only
// the chain + math. `confirmed` iff ≥1 source carries the root and no two sources disagree on the
// tx bytes (disagreement = tampering → refuse). `sources` = explorers that returned the tx.
export async function anchorCarriesRoot(
  txid: string,
  root: string,
  net: "main" | "test" = "main",
): Promise<{ confirmed: boolean; sources: string[] }> {
  const { Transaction } = await import("@bsv/sdk");
  const results = await fetchTxHex(txid, net);
  if (!results.length) return { confirmed: false, sources: [] };
  if (new Set(results.map((r) => r.hex)).size > 1) return { confirmed: false, sources: [] }; // sources disagree — refuse
  const confirmed = opReturnCarries(results[0].hex, root, Transaction);
  return { confirmed, sources: results.map((r) => r.name) };
}

export type SpvResult = { status: "confirmed" | "rejected" | "inconclusive"; [k: string]: unknown };

// Ask bsv.cx's headers node whether a proof lands in a real block. Free. This is a
// convenience cross-check; independent verification of the txid OP_RETURN is the
// gold standard and does not require trusting this endpoint either.
export function spvVerify(
  body: Record<string, unknown>,
  base = DEFAULT_BASE,
): Promise<SpvResult> {
  return jsonFetch<SpvResult>(`${base}/spv/verify`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
