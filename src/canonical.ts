// Deterministic JSON canonicalization for hashing.
// Rules: object keys sorted lexicographically at every level, no insignificant
// whitespace, arrays keep order. This is the RFC 8785-style shape we need so the
// SAME logical event always produces the SAME bytes -> the same entryHash, on any
// machine, regardless of key insertion order. We deliberately keep it small and
// dependency-free; if we ever need full JCS number formatting we swap this one file.

export function canonicalize(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "number") {
    if (!Number.isFinite(v as number)) {
      throw new Error("canonicalize: non-finite number is not representable");
    }
    return JSON.stringify(v);
  }
  if (t === "boolean" || t === "string") return JSON.stringify(v);
  if (t === "bigint") throw new Error("canonicalize: bigint not supported");
  if (t === "undefined" || t === "function") {
    throw new Error("canonicalize: undefined/function is not representable");
  }
  if (Array.isArray(v)) {
    return "[" + v.map(serialize).join(",") + "]";
  }
  if (t === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) continue; // drop undefined-valued keys, JSON-style
      parts.push(JSON.stringify(k) + ":" + serialize(val));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error("canonicalize: unsupported type " + t);
}
