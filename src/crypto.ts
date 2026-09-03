// P5 privacy: envelope encryption so a blocktrain log can be held by a blind service (or
// sit in any store) while only key-holders can read it — and different parties can be granted
// different entries. Built on native BSV keys (secp256k1) so clients use wallet-compatible
// identities.
//
// Scheme (per entry):
//   - CEK = random AES-256-GCM key; ciphertext = AES-GCM(CEK, plaintext).
//   - for each recipient pubkey R: wrap the CEK to R via ECIES (electrum) — encrypt-to-pubkey.
//   - store { ct, recipients:[{pub, wrapped}] }. The chain still commits sha256(plaintext),
//     so anchoring stays blind (only a hash goes on-chain) and a key-holder can recompute the
//     hash after decrypting to prove the ciphertext matches what was committed.
//
// What this gives: blind-by-default (no key → only ciphertext + hashes), multi-party access
// (client + counsel + counterparty), per-entry scoping (selective disclosure), and tamper
// detection (GCM auth tag). It does NOT hide seq/ts/actor/kind — only the payload.

import { PrivateKey, PublicKey, SymmetricKey, ECIES } from "@bsv/sdk";

export type Envelope = {
  alg: "bt-ecies-aes256gcm-v1";
  ct: string; // hex AES-GCM ciphertext of the plaintext
  recipients: { pub: string; wrapped: string }[]; // pub = compressed hex; wrapped = ECIES(CEK)
};

const toHex = (a: number[]): string => Buffer.from(a).toString("hex");
const fromHex = (s: string): number[] => [...Buffer.from(s, "hex")];

// A fresh wallet-compatible identity. Keep the WIF secret; share the pub.
export function generateIdentity(): { wif: string; pub: string } {
  const p = PrivateKey.fromRandom();
  return { wif: p.toWif(), pub: p.toPublicKey().toString() };
}

export function pubFromWif(wif: string): string {
  return PrivateKey.fromWif(wif).toPublicKey().toString();
}

// Encrypt `plaintext` so exactly the given recipient pubkeys can read it.
export function encryptFor(plaintext: Buffer, recipientPubs: string[]): Envelope {
  const uniq = [...new Set(recipientPubs)];
  if (!uniq.length) throw new Error("encryptFor: need at least one recipient pubkey");
  const cek = SymmetricKey.fromRandom();
  const ct = cek.encrypt([...plaintext]) as number[];
  const cekBytes = cek.toArray();
  const recipients = uniq.map((pub) => {
    const ephemeral = PrivateKey.fromRandom(); // fresh per recipient
    const wrapped = ECIES.electrumEncrypt(cekBytes, PublicKey.fromString(pub), ephemeral);
    return { pub, wrapped: toHex(wrapped) };
  });
  return { alg: "bt-ecies-aes256gcm-v1", ct: toHex(ct), recipients };
}

// True iff `wif`'s pubkey is one of the envelope's recipients (cheap check, no decrypt).
export function canDecrypt(env: Envelope, wif: string): boolean {
  const myPub = pubFromWif(wif);
  return env.recipients.some((r) => r.pub === myPub);
}

// Decrypt with a recipient key. Throws if not a recipient, or if the ciphertext/tag was
// tampered (GCM auth failure).
export function decryptWith(env: Envelope, wif: string): Buffer {
  const priv = PrivateKey.fromWif(wif);
  const myPub = priv.toPublicKey().toString();
  const mine = env.recipients.find((r) => r.pub === myPub);
  if (!mine) throw new Error("not a recipient of this entry");
  const cekBytes = ECIES.electrumDecrypt(fromHex(mine.wrapped), priv);
  const cek = new SymmetricKey(cekBytes);
  return Buffer.from(cek.decrypt(fromHex(env.ct)) as number[]);
}
