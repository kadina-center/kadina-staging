/**
 * Unit tests for Meta webhook HMAC verification (no HTTP server).
 * Usage: npx ts-node --transpile-only scripts/test-meta-signature.ts
 */
import crypto from "crypto";
import { checkMetaSignature } from "../src/middleware/verify-meta-signature";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

const SECRET = "test-meta-app-secret-for-hmac";

function sign(rawBody: Buffer): string {
  const hex = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  return `sha256=${hex}`;
}

function testValidRawBodyValidSignature(): void {
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
  const result = checkMetaSignature({
    appSecret: SECRET,
    signatureHeader: sign(rawBody),
    rawBody,
  });
  assert(result.ok === true, "A: valid rawBody + valid signature => accepted");
}

function testValidRawBodyInvalidSignature(): void {
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
  const result = checkMetaSignature({
    appSecret: SECRET,
    signatureHeader: "sha256=0000000000000000000000000000000000000000000000000000000000000000",
    rawBody,
  });
  assert(
    result.ok === false && result.reason === "invalid_signature",
    "B: valid rawBody + invalid signature => rejected"
  );
}

function testMissingRawBody(): void {
  const logical = { object: "whatsapp_business_account" };
  const reconstructed = Buffer.from(JSON.stringify(logical), "utf8");
  const result = checkMetaSignature({
    appSecret: SECRET,
    signatureHeader: sign(reconstructed),
    rawBody: undefined,
  });
  assert(
    result.ok === false && result.reason === "missing_raw_body",
    "C: missing rawBody => rejected (even with otherwise-valid signature material)"
  );
}

function testTamperedRawBody(): void {
  const original = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
  const header = sign(original);
  const tampered = Buffer.from(
    '{"object":"whatsapp_business_account","evil":true}',
    "utf8"
  );
  const result = checkMetaSignature({
    appSecret: SECRET,
    signatureHeader: header,
    rawBody: tampered,
  });
  assert(
    result.ok === false && result.reason === "invalid_signature",
    "D: tampered rawBody => rejected"
  );
}

function testParsedBodyWithoutRawBodyRejected(): void {
  // Same logical JSON Meta might send with different whitespace than JSON.stringify.
  const metaBytes = Buffer.from(
    '{ "object" : "whatsapp_business_account" }',
    "utf8"
  );
  const parsedEquivalent = { object: "whatsapp_business_account" };
  const reconstructed = Buffer.from(JSON.stringify(parsedEquivalent), "utf8");

  // Signature matches Meta's exact bytes…
  const header = sign(metaBytes);
  // …but middleware must NOT accept reconstructed JSON when rawBody is missing.
  assert(
    !reconstructed.equals(metaBytes),
    "E-setup: reconstructed JSON differs from Meta raw bytes"
  );

  const withoutRaw = checkMetaSignature({
    appSecret: SECRET,
    signatureHeader: header,
    rawBody: undefined,
  });
  assert(
    withoutRaw.ok === false && withoutRaw.reason === "missing_raw_body",
    "E: parsed req.body / no rawBody => rejected"
  );

  const withExactRaw = checkMetaSignature({
    appSecret: SECRET,
    signatureHeader: header,
    rawBody: metaBytes,
  });
  assert(
    withExactRaw.ok === true,
    "E: same signature accepted only with exact Meta rawBody"
  );
}

function testTimingSafeComparisonUsed(): void {
  const source = checkMetaSignature.toString();
  assert(
    source.includes("timingSafeEqual"),
    "F: checkMetaSignature uses crypto.timingSafeEqual"
  );
}

console.log("--- meta webhook signature tests ---");
testValidRawBodyValidSignature();
testValidRawBodyInvalidSignature();
testMissingRawBody();
testTamperedRawBody();
testParsedBodyWithoutRawBodyRejected();
testTimingSafeComparisonUsed();

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll meta signature tests passed.");
