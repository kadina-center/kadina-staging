/**
 * Unit checks for login rate-limit config (no HTTP server).
 * Usage: npx ts-node --transpile-only scripts/test-login-rate-limit.ts
 */
import { LOGIN_RATE_LIMIT } from "../src/routes/auth.routes";
import { readFileSync } from "fs";
import path from "path";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

console.log("--- login rate limit config tests ---");

assert(
  LOGIN_RATE_LIMIT.max === 10,
  "A: login max is 10 attempts per window"
);
assert(
  LOGIN_RATE_LIMIT.windowMs === 15 * 60 * 1000,
  "A: login window remains 15 minutes"
);
assert(
  LOGIN_RATE_LIMIT.max < 11,
  "B: 11th attempt is beyond max (rate-limited by express-rate-limit)"
);

const indexSrc = readFileSync(
  path.join(__dirname, "../src/index.ts"),
  "utf8"
);
assert(
  /max:\s*300/.test(indexSrc),
  "D: global apiLimiter max: 300 unchanged"
);
assert(
  !/loginLimiter|LOGIN_RATE_LIMIT/.test(indexSrc),
  "D: login limiter is not applied globally in index.ts"
);

const authSrc = readFileSync(
  path.join(__dirname, "../src/routes/auth.routes.ts"),
  "utf8"
);
assert(
  authSrc.includes('message: { error: "Too many login attempts" }'),
  "C: rate-limit response message format preserved"
);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll login rate-limit config tests passed.");
console.log(
  "Note: express-rate-limit enforcement of the 11th request is library behavior; config max=10 verified above."
);
