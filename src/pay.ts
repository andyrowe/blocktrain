// x402 payment client for bsv.cx pay-gated endpoints.
//
// bsv.cx's anchoring endpoints (e.g. POST /n/batch) charge per call via x402 v2.
// Flow (mirrors bsv.cx's own scripts/x402-demo.ts, the canonical client):
//   1. POST the request; a 402 comes back with a base64 PAYMENT-REQUIRED header.
//   2. Build + sign a BSV tx paying `amount` sats to `payTo` from a funded WIF.
//   3. Resubmit THE SAME request with header PAYMENT-SIGNATURE: base64(PaymentPayload).
//   4. Get 200 + a receipt; the payment-response header carries the settlement txid.
//
// Deliberately reads the x402 HEADERS, not bsv.cx's convenience JSON body — so this is
// a generic x402 client that happens to be pointed at bsv.cx, not bsv.cx-specific glue.

import { P2PKH, PrivateKey, SatoshisPerKilobyte, Transaction } from "@bsv/sdk";

const PAY_SCHEMES = new Set(["exact", "rawtx", "bsv-rawtx"]);

const b64 = {
  encode: (o: unknown) => Buffer.from(JSON.stringify(o), "utf8").toString("base64"),
  decode: (s: string) => JSON.parse(Buffer.from(s, "base64").toString("utf8")),
};

function netFromCaip2(id: string): "main" | "test" {
  const ref = id.split(":")[1] ?? "";
  if (id.startsWith("bsv:")) {
    if (ref === "mainnet") return "main";
    if (ref === "testnet") return "test";
  }
  // legacy bip122:<genesis> — assume main unless it's the known testnet genesis
  if (ref.startsWith("000000000933ea01ad0ee984209779ba")) return "test";
  return "main";
}

export type PaidResult<T> = { data: T; settlementTxid: string };

// POST `body` to `url`, paying the x402 invoice from `wif` if a 402 is returned.
export async function postPaid<T>(url: string, body: unknown, wif: string): Promise<PaidResult<T>> {
  const headers = { "content-type": "application/json", accept: "application/json" };
  const first = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (first.status !== 402) {
    const txt = await first.text();
    if (!first.ok) throw new Error(`bsv.cx POST ${url} -> ${first.status}: ${txt.slice(0, 300)}`);
    return { data: JSON.parse(txt) as T, settlementTxid: "" }; // wasn't gated
  }

  const challengeHeader = first.headers.get("payment-required");
  if (!challengeHeader) throw new Error("402 without PAYMENT-REQUIRED header — cannot pay");
  const required = b64.decode(challengeHeader);
  const offer = required.accepts?.find((a: { scheme: string }) => PAY_SCHEMES.has(a.scheme));
  if (!offer) throw new Error(`no payable offer in 402 accepts: ${JSON.stringify(required.accepts)}`);

  const amount = Number(offer.amount);
  const net = netFromCaip2(offer.network ?? "bsv:mainnet");
  const key = PrivateKey.fromWif(wif);
  const payerAddr = key.toAddress(net === "main" ? "mainnet" : "testnet");
  const WOC = `https://api.whatsonchain.com/v1/bsv/${net}`;

  const utxos: Array<{ tx_hash: string; tx_pos: number; value: number }> = await (
    await fetch(`${WOC}/address/${payerAddr}/unspent`)
  ).json();
  if (!utxos.length) throw new Error(`payer ${payerAddr} has no UTXOs — fund it`);

  const tx = new Transaction();
  let sourced = 0;
  for (const u of utxos.sort((a, b) => b.value - a.value).slice(0, 5)) {
    const hex = (await (await fetch(`${WOC}/tx/${u.tx_hash}/hex`)).text()).trim();
    tx.addInput({
      sourceTransaction: Transaction.fromHex(hex),
      sourceOutputIndex: u.tx_pos,
      unlockingScriptTemplate: new P2PKH().unlock(key),
    });
    sourced += u.value;
    if (sourced > amount + 500) break;
  }
  tx.addOutput({ lockingScript: new P2PKH().lock(offer.payTo), satoshis: amount });
  tx.addOutput({ lockingScript: new P2PKH().lock(payerAddr), change: true });
  await tx.fee(new SatoshisPerKilobyte(500));
  await tx.sign();

  const payment = {
    x402Version: required.x402Version,
    resource: { url: required.resource.url },
    accepted: offer,
    payload: { rawtx: tx.toHex() },
  };
  const paid = await fetch(url, {
    method: "POST",
    headers: { ...headers, "PAYMENT-SIGNATURE": b64.encode(payment) },
    body: JSON.stringify(body),
  });
  const paidText = await paid.text();
  if (!paid.ok) throw new Error(`payment rejected ${paid.status}: ${paidText.slice(0, 300)}`);

  let settlementTxid = "";
  const settleHeader = paid.headers.get("payment-response");
  if (settleHeader) {
    try {
      const s = b64.decode(settleHeader);
      if (!s.success) throw new Error("settlement reported failure");
      settlementTxid = s.transaction ?? "";
    } catch (e) {
      if (e instanceof Error && e.message.includes("settlement")) throw e;
    }
  }
  return { data: JSON.parse(paidText) as T, settlementTxid };
}

export { b64 };
