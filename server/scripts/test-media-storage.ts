/**
 * Unit-ish smoke tests for media storage providers (no S3 credentials required).
 * Usage: npx ts-node --transpile-only scripts/test-media-storage.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { LocalMediaStorageProvider } from "../src/services/media/local-media-storage.provider";
import {
  fromMediaServeToken,
  toMediaServeToken,
  signStoredMediaPath,
  verifyMediaSignature,
} from "../src/services/media-access.service";
import { S3_PATH_PREFIX } from "../src/services/media/media-storage.types";
import { createMediaStorageProvider } from "../src/services/media";

let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function testLocalProvider(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kadina-media-"));
  try {
    const provider = new LocalMediaStorageProvider(root);
    const payload = Buffer.from("hello-kadina-media");
    const put = await provider.put(payload, "text/plain", "note.txt");
    assert(put.publicPath.startsWith("/uploads/"), "local publicPath prefix");
    assert(put.absolutePath && fs.existsSync(put.absolutePath), "local file written");
    const read = await provider.getBuffer(put.publicPath);
    assert(read && read.equals(payload), "local getBuffer round-trip");
    assert(await provider.exists(put.publicPath), "local exists");
    const escaped = provider.resolveLocalAbsolute("/uploads/../../etc/passwd");
    assert(
      escaped === null || escaped.startsWith(path.resolve(root) + path.sep) || escaped === path.resolve(root, "passwd"),
      "path traversal cannot escape storage root"
    );
    assert(
      provider.resolveLocalAbsolute("/uploads/foo/../../../etc/passwd") ===
        path.resolve(root, "passwd") ||
        provider.resolveLocalAbsolute("/uploads/foo/../../../etc/passwd") ===
          null,
      "basename containment for nested .."
    );
    await provider.delete?.(put.publicPath);
    assert(!(await provider.exists(put.publicPath)), "local delete");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function testServeTokens(): void {
  const localPath = "/uploads/123-abc.jpg";
  const token = toMediaServeToken(localPath);
  assert(token === "123-abc.jpg", "local serve token is basename");
  assert(fromMediaServeToken(token) === localPath, "local token round-trip");

  const s3Path = `${S3_PATH_PREFIX}media/456-def.png`;
  const s3Token = toMediaServeToken(s3Path);
  assert(s3Token.startsWith("b64."), "s3 serve token uses b64");
  assert(fromMediaServeToken(s3Token) === s3Path, "s3 token round-trip");

  const signed = signStoredMediaPath(localPath, 60);
  assert(signed && signed.includes("/media/123-abc.jpg"), "signed local URL");
  const url = new URL(signed!);
  const e = url.searchParams.get("e") || undefined;
  const s = url.searchParams.get("s") || undefined;
  assert(verifyMediaSignature("123-abc.jpg", e, s), "HMAC verifies");
  assert(!verifyMediaSignature("123-abc.jpg", e, "deadbeef"), "HMAC rejects bad sig");
}

function testDefaultProviderWithoutS3(): void {
  const provider = createMediaStorageProvider();
  assert(provider.name === "local", "default provider is local without S3 ENV");
}

async function main(): Promise<void> {
  console.log("--- media storage provider tests ---");
  await testLocalProvider();
  testServeTokens();
  testDefaultProviderWithoutS3();
  if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed`);
    process.exit(1);
  }
  console.log("\nAll media storage tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
