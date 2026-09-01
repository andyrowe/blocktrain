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

// Ground-truth on-chain check: read the anchor tx from the public chain (WhatsOnChain)
// and confirm its OP_RETURN encodes `bsv.cx/not2/<root>`. This trusts only the chain and
// math — not bsv.cx. Returns true iff the committed root is on-chain in that tx.
export async function anchorCarriesRoot(
  txid: string,
  root: string,
  net: "main" | "test" = "main",
): Promise<boolean> {
  const { Transaction } = await import("@bsv/sdk");
  const hex = (await (await fetch(`https://api.whatsonchain.com/v1/bsv/${net}/tx/${txid}/hex`)).text()).trim();
  if (!/^[0-9a-f]+$/i.test(hex)) return false;
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
    if (chunks[0] === "bsv.cx" && chunks[1] === "not2" && chunks[2]?.toLowerCase() === root.toLowerCase()) {
      return true;
    }
  }
  return false;
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
