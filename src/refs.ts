// P4 corroboration: external references that make a log entry falsifiable against the
// real world. An entry can *say* an agent posted, spent, or shipped; a ref lets a third
// party go check it independently — on the BSV chain, on GitHub, on the open web.
//
// A ref lives inside entry.data.refs (so the existing hash-chain is unchanged; refs are
// committed as part of the entry hash like any other content). Presence of a verifiable
// ref is what promotes an entry from evidence:"mechanical" to "corroborated".

export type Ref =
  | { type: "bsv-txid"; value: string }
  | { type: "git-commit"; value: string; repo: string }
  | { type: "url"; value: string; sha256?: string };

export type RefResult = { ref: Ref; ok: boolean; detail: string };

const WOC = "https://api.whatsonchain.com/v1/bsv/main";
const MAX_REF_BYTES = 5 * 1024 * 1024;

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Buffer.from(new Uint8Array(d)).toString("hex");
}

// `url` refs come from untrusted entry data. Block loopback/private hosts (SSRF), refuse
// redirects, time out, and cap size before hashing.
function assertSafeUrl(u: string): void {
  const url = new URL(u);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("only http(s) URLs allowed");
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (
    h === "localhost" || h === "0.0.0.0" || h === "::1" || h.endsWith(".local") ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^(fc|fd|fe80)/i.test(h)
  ) throw new Error(`refusing to fetch private/loopback host ${h}`);
}
function safeFetch(u: string, init: RequestInit = {}): Promise<Response> {
  assertSafeUrl(u);
  return fetch(u, { redirect: "error", signal: AbortSignal.timeout(8000), ...init });
}

// Verify a single ref against its external source of truth. Trusts only the named public
// service (WhatsOnChain / GitHub / the URL's own host) — never blocktrain.
export async function verifyRef(ref: Ref): Promise<RefResult> {
  try {
    if (ref.type === "bsv-txid") {
      if (!/^[0-9a-f]{64}$/i.test(ref.value)) return { ref, ok: false, detail: "not a 64-hex txid" };
      const r = await fetch(`${WOC}/tx/hash/${ref.value}`);
      if (!r.ok) return { ref, ok: false, detail: `WhatsOnChain ${r.status}` };
      const j = (await r.json()) as { blockheight?: number; confirmations?: number };
      return { ref, ok: true, detail: `on-chain, block ${j.blockheight ?? "?"} (${j.confirmations ?? 0} conf)` };
    }
    if (ref.type === "git-commit") {
      const r = await fetch(`https://api.github.com/repos/${ref.repo}/commits/${ref.value}`, {
        headers: { accept: "application/vnd.github+json", "user-agent": "blocktrain-verify" },
      });
      if (!r.ok) return { ref, ok: false, detail: `GitHub ${r.status}` };
      const j = (await r.json()) as { sha?: string };
      return { ref, ok: true, detail: `commit exists in ${ref.repo} (${(j.sha ?? "").slice(0, 12)})` };
    }
    if (ref.type === "url") {
      if (ref.sha256) {
        const r = await safeFetch(ref.value);
        if (!r.ok) return { ref, ok: false, detail: `HTTP ${r.status}` };
        if (Number(r.headers.get("content-length") || 0) > MAX_REF_BYTES) {
          return { ref, ok: false, detail: `too large (> ${MAX_REF_BYTES}B)` };
        }
        const bytes = await r.arrayBuffer();
        if (bytes.byteLength > MAX_REF_BYTES) return { ref, ok: false, detail: `too large (> ${MAX_REF_BYTES}B)` };
        const got = await sha256Hex(bytes);
        return got.toLowerCase() === ref.sha256.toLowerCase()
          ? { ref, ok: true, detail: "content sha256 matches" }
          : { ref, ok: false, detail: `content sha256 mismatch (${got.slice(0, 12)}…)` };
      }
      const r = await safeFetch(ref.value, { method: "HEAD" });
      return r.ok
        ? { ref, ok: true, detail: `live (HTTP ${r.status})` }
        : { ref, ok: false, detail: `HTTP ${r.status}` };
    }
    return { ref, ok: false, detail: "unknown ref type" };
  } catch (e) {
    return { ref, ok: false, detail: `error: ${(e as Error).message.slice(0, 60)}` };
  }
}

// Parse a CLI "--ref" token: "bsv-txid:<hex>" | "git-commit:<sha>:<owner/repo>" | "url:<u>[::<sha256>]"
export function parseRefArg(s: string): Ref {
  const i = s.indexOf(":");
  if (i < 0) throw new Error(`bad --ref '${s}' (want type:value)`);
  const type = s.slice(0, i);
  const rest = s.slice(i + 1);
  if (type === "bsv-txid") return { type, value: rest };
  if (type === "git-commit") {
    const j = rest.lastIndexOf(":");
    if (j < 0) throw new Error("git-commit ref needs sha:owner/repo");
    return { type, value: rest.slice(0, j), repo: rest.slice(j + 1) };
  }
  if (type === "url") {
    const m = rest.match(/^(.*)::([0-9a-fA-F]{64})$/); // url::<sha256> for content verification
    return m ? { type, value: m[1], sha256: m[2] } : { type, value: rest };
  }
  throw new Error(`unknown ref type '${type}'`);
}
