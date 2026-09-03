// SSRF guard: url refs pointing at loopback/private hosts must be refused before any fetch.
import assert from "node:assert/strict";
import { verifyRef } from "../src/refs.ts";

let pass = 0;
for (const host of ["http://127.0.0.1/x", "http://localhost/x", "http://169.254.169.254/latest", "http://10.0.0.1/", "https://[::1]/"]) {
  const r = await verifyRef({ type: "url", value: host });
  assert.equal(r.ok, false, `${host} must be refused`);
  assert.match(r.detail, /private|loopback|http/i, `${host} detail should explain refusal (got: ${r.detail})`);
  console.log("ok - refused", host);
  pass++;
}
for (const bad of ["ftp://example.com/x", "file:///etc/passwd"]) {
  const r = await verifyRef({ type: "url", value: bad });
  assert.equal(r.ok, false, `${bad} must be refused`);
  console.log("ok - refused non-http", bad);
  pass++;
}
console.log(`\n${pass} refs-guard checks passed`);
