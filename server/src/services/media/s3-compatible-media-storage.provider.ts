import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  S3_PATH_PREFIX,
  type MediaPutResult,
  type MediaStorageProvider,
} from "./media-storage.types";

export type S3MediaConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  /** Optional CDN/public base; when set, signed URLs may be skipped for reads. */
  publicBaseUrl?: string;
  keyPrefix?: string;
};

function extensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "video/mp4": ".mp4",
    "video/3gpp": ".3gp",
    "application/pdf": ".pdf",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      ".xlsx",
    "text/plain": ".txt",
  };
  return map[mimeType] || ".bin";
}

function toObjectKey(publicPathOrKey: string, keyPrefix: string): string {
  let key = publicPathOrKey;
  if (key.startsWith(S3_PATH_PREFIX)) {
    key = key.slice(S3_PATH_PREFIX.length);
  } else if (key.startsWith("/uploads/")) {
    key = `${keyPrefix}${key.slice("/uploads/".length)}`;
  }
  return key.replace(/^\/+/, "");
}

async function streamToBuffer(
  body: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> | Blob | undefined
): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof (body as Blob).arrayBuffer === "function") {
    return Buffer.from(await (body as Blob).arrayBuffer());
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class S3CompatibleMediaStorageProvider implements MediaStorageProvider {
  readonly name = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly keyPrefix: string;
  private readonly publicBaseUrl?: string;

  constructor(config: S3MediaConfig) {
    this.bucket = config.bucket;
    this.keyPrefix = (config.keyPrefix || "media/").replace(/\/?$/, "/");
    this.publicBaseUrl = config.publicBaseUrl?.replace(/\/$/, "");
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint || undefined,
      forcePathStyle: config.forcePathStyle ?? Boolean(config.endpoint),
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async put(
    buffer: Buffer,
    mimeType: string,
    _originalName?: string
  ): Promise<MediaPutResult> {
    const filename = `${Date.now()}-${randomUUID()}${extensionFromMime(mimeType)}`;
    const key = `${this.keyPrefix}${filename}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );
    return {
      key,
      publicPath: `${S3_PATH_PREFIX}${key}`,
      filename,
    };
  }

  async getBuffer(publicPathOrKey: string): Promise<Buffer | null> {
    const key = toObjectKey(publicPathOrKey, this.keyPrefix);
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return streamToBuffer(out.Body as AsyncIterable<Uint8Array>);
    } catch {
      return null;
    }
  }

  async exists(publicPathOrKey: string): Promise<boolean> {
    const key = toObjectKey(publicPathOrKey, this.keyPrefix);
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return true;
    } catch {
      return false;
    }
  }

  async delete(publicPathOrKey: string): Promise<void> {
    const key = toObjectKey(publicPathOrKey, this.keyPrefix);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async getSignedReadUrl(
    publicPathOrKey: string,
    ttlSeconds = 3600
  ): Promise<string | null> {
    const key = toObjectKey(publicPathOrKey, this.keyPrefix);
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${key}`;
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds }
    );
  }
}
