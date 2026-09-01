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

// Anchor an ordered set of linkHashes as one on-chain not2 batch. SPENDS FLOAT.
export function anchorBatch(hashes: string[], base = DEFAULT_BASE): Promise<BatchReceipt> {
  return jsonFetch<BatchReceipt>(`${base}/n/batch`, {
    method: "POST",
    body: JSON.stringify({ hashes }),
  });
}

// Pull bsv.cx's own inclusion proof for a hash. Free. We still verify it locally.
export function fetchProof(hash: string, base = DEFAULT_BASE): Promise<BsvcxProof> {
  return jsonFetch<BsvcxProof>(`${base}/n/${hash}/proof`);
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
