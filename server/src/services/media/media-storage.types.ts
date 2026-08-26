export type MediaPutResult = {
  /** Stable storage key (filename for local, object key for S3). */
  key: string;
  /** Value persisted on Message.mediaUrl — `/uploads/...` or `s3:...`. */
  publicPath: string;
  filename: string;
  /** Absolute filesystem path when available (local provider only). */
  absolutePath?: string;
};

export type MediaStorageProvider = {
  readonly name: "local" | "s3";
  put(
    buffer: Buffer,
    mimeType: string,
    originalName?: string
  ): Promise<MediaPutResult>;
  /**
   * Resolve bytes for a stored publicPath/key.
   * Returns null when the object is missing.
   */
  getBuffer(publicPathOrKey: string): Promise<Buffer | null>;
  exists(publicPathOrKey: string): Promise<boolean>;
  delete?(publicPathOrKey: string): Promise<void>;
  /**
   * Local absolute path for streaming via express sendFile.
   * Null for remote providers (use getSignedReadUrl instead).
   */
  resolveLocalAbsolute?(publicPathOrKey: string): string | null;
  /**
   * Optional direct/presigned HTTPS URL for clients.
   * Local provider returns null (HMAC /media route is used instead).
   */
  getSignedReadUrl?(
    publicPathOrKey: string,
    ttlSeconds?: number
  ): Promise<string | null>;
};

export const S3_PATH_PREFIX = "s3:";
