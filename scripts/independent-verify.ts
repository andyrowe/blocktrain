// Independent, from-scratch verification of a sealed blocktrain entry — trusting NOTHING
// except the public BSV chain (via WhatsOnChain) and math. Proves the whole claim:
//   (a) bsv.cx's inclusion proof for a linkHash folds to the anchored Merkle root
//       (checked with OUR client-side RFC 6962 verifier, not bsv.cx's),
//   (b) the anchor tx's OP_RETURN really encodes bsv.cx/not2/<that same root> on-chain.
//
// usage: node scripts/independent-verify.ts <txid> <root> <linkHash>

import { Transaction } from "@bsv/sdk";
import { verifyInclusion, type ProofStep } from "../src/merkle.ts";

const [txid, root, linkHash] = process.argv.slice(2);
if (!txid || !root || !linkHash) throw new Error("usage: independent-verify <txid> <root> <linkHash>");

async function main() {
  // (a) pull bsv.cx's inclusion proof and verify it OURSELVES
  const proof = (await (await fetch(`https://bsv.cx/n/${linkHash}/proof`)).json()) as {
    index: number; path: ProofStep[]; root: string; alg: string;
  };
  const foldsToRoot = verifyInclusion(Buffer.from(linkHash, "hex"), proof.path, proof.root);
  console.log(`(a) bsv.cx proof alg=${proof.alg} index=${proof.index} steps=${proof.path.length}`);
  console.log(`    proof.root == our seal root : ${proof.root.toLowerCase() === root.toLowerCase()}`);
  console.log(`    our verifier folds proof->root: ${foldsToRoot}`);

  // (b) decode the anchor tx OP_RETURN straight from the public chain
  const hex = (await (await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txid}/hex`)).text()).trim();
  const tx = Transaction.fromHex(hex);
  let onchain: string[] | null = null;
  for (const o of tx.outputs) {
    const script = Buffer.from(o.lockingScript.toHex(), "hex");
    // find OP_RETURN (0x6a), tolerating a leading OP_FALSE (0x00)
    let p = 0;
    if (script[p] === 0x00) p++;
    if (script[p] !== 0x6a) continue;
    p++;
    const chunks: string[] = [];
    while (p < script.length) {
      const len = script[p]; // our pushes are all < OP_PUSHDATA1 (0x4c)
      if (len >= 0x4c) break;
      p++;
      chunks.push(script.subarray(p, p + len).toString("utf8"));
      p += len;
    }
    onchain = chunks;
  }
  console.log(`(b) on-chain OP_RETURN: ${JSON.stringify(onchain)}`);
  const rootOnChain = onchain?.some((c) => c.toLowerCase() === root.toLowerCase());
  console.log(`    OP_RETURN carries our root : ${rootOnChain}`);

  const allGood = foldsToRoot && proof.root.toLowerCase() === root.toLowerCase() && rootOnChain;
  console.log(`\nVERDICT: ${allGood ? "✅ independently verified" : "❌ FAILED"}`);
  if (!allGood) process.exit(1);
}

main();
