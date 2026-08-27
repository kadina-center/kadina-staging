/**
 * Unit tests for JWT auth resolution (no DB required).
 * Usage: npx ts-node --transpile-only scripts/test-auth-resolve.ts
 */
import jwt from "jsonwebtoken";
import { env } from "../src/config/env";
import { resolveAuthUserFromJwt } from "../src/middleware/auth";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function testInvalidTokens(): Promise<void> {
  assert((await resolveAuthUserFromJwt("")) === null, "empty token → null");
  assert(
    (await resolveAuthUserFromJwt("not-a-jwt")) === null,
    "malformed token → null"
  );

  const expired = jwt.sign(
    { id: "user-does-not-matter", role: "admin" },
    env.JWT_SECRET,
    { expiresIn: -10 }
  );
  assert(
    (await resolveAuthUserFromJwt(expired)) === null,
    "expired token → null"
  );

  const noId = jwt.sign({ email: "a@b.c", role: "admin" }, env.JWT_SECRET, {
    expiresIn: "1h",
  });
  assert(
    (await resolveAuthUserFromJwt(noId)) === null,
    "token without id claim → null (id-only identity)"
  );
}

async function main(): Promise<void> {
  console.log("--- auth resolveAuthUserFromJwt tests ---");
  await testInvalidTokens();
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll auth-resolve tests passed.");
}

void main();
