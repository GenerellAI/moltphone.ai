/**
 * File storage abstraction.
 *
 * Storage priority:
 *   1. R2 binding (Cloudflare Workers — `AVATARS_BUCKET` wrangler binding)
 *   2. S3-compatible API (`S3_BUCKET` env var — R2 S3 API, AWS S3, MinIO)
 *   3. Local filesystem (Node.js development)
 *   4. Data URI fallback (edge runtimes without any storage configured)
 *
 * R2 binding mode (recommended for Cloudflare Workers):
 *   Configure `r2_buckets` in wrangler.jsonc with binding name `AVATARS_BUCKET`.
 *   Files are served via `/api/storage/[...key]` route.
 *   Set `STORAGE_PUBLIC_URL` to override the serving URL prefix.
 *
 * S3 API mode:
 *   S3_BUCKET         — bucket name
 *   S3_REGION          — region (default: "auto" for R2)
 *   S3_ENDPOINT        — endpoint URL
 *   S3_ACCESS_KEY_ID   — access key
 *   S3_SECRET_ACCESS_KEY — secret key
 *   S3_PUBLIC_URL      — public base URL for serving files
 *
 * All functions return URL paths suitable for storing in `avatarUrl` DB field.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// ── Cloudflare R2 type (minimal interface for Workers binding) ───

/** Minimal R2Bucket interface — avoids @cloudflare/workers-types dependency */
interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Buffer | ReadableStream | string, options?: {
    httpMetadata?: { contentType?: string; cacheControl?: string };
  }): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string; cacheControl?: string };
  } | null>;
  delete(key: string): Promise<void>;
}

// fs/path dynamically required — not available on Cloudflare Workers
// Only used for local filesystem fallback (development mode)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fsPromises: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let path: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fsPromises = require('fs/promises');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  path = require('path');
} catch {
  // Not available on edge runtimes — S3/R2 must be configured
}

// ── R2 binding access ────────────────────────────────────

/**
 * Try to get the R2 bucket binding from the Cloudflare Workers context.
 * Returns null when not running on Workers or binding not configured.
 */
async function getR2Bucket(): Promise<R2BucketLike | null> {
  try {
    // Dynamic import — only available when deployed via @opennextjs/cloudflare
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const ctx = await getCloudflareContext({ async: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bucket = (ctx.env as any).AVATARS_BUCKET as R2BucketLike | undefined;
    return bucket ?? null;
  } catch {
    return null;
  }
}

// ── S3 client (lazy singleton) ───────────────────────────

let _s3: S3Client | null = null;
let _s3Checked = false;

function getS3(): S3Client | null {
  if (_s3Checked) return _s3;
  _s3Checked = true;

  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    console.log('[storage] S3_BUCKET not set — using local filesystem.');
    return null;
  }

  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || 'auto';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.warn('[storage] S3_BUCKET set but missing S3_ENDPOINT, S3_ACCESS_KEY_ID, or S3_SECRET_ACCESS_KEY — falling back to local filesystem.');
    return null;
  }

  _s3 = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // R2 requires this for path-style addressing
    forcePathStyle: true,
  });

  console.log('[storage] S3 storage configured — bucket:', bucket);
  return _s3;
}

// ── Public API ───────────────────────────────────────────

/**
 * Upload a file and return its public URL path.
 *
 * @param key       Storage key (e.g. "avatars/agent-id.jpg")
 * @param data      File contents as Buffer
 * @param mimeType  MIME type (e.g. "image/jpeg")
 * @returns         URL path for the file (e.g. "/api/storage/avatars/agent-id.jpg" or CDN URL)
 *
 * Storage priority:
 *   1. R2 binding (Cloudflare Workers — uses wrangler binding)
 *   2. S3 API (if S3_BUCKET configured)
 *   3. Local filesystem (if fs module available — Node.js dev)
 *   4. Data URI fallback (edge runtimes without any storage)
 */
export async function uploadFile(
  key: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  // 1. Try R2 binding (Cloudflare Workers)
  const r2 = await getR2Bucket();
  if (r2) {
    return uploadR2(r2, key, data, mimeType);
  }

  // 2. Try S3 API
  const s3 = getS3();
  if (s3) {
    return uploadS3(s3, key, data, mimeType);
  }

  // 3. Try local filesystem
  if (fsPromises && path) {
    return uploadLocal(key, data);
  }

  // 4. Fallback: data URI (works everywhere but stored in DB)
  return `data:${mimeType};base64,${data.toString('base64')}`;
}

/**
 * Delete a file by its URL path (as stored in the database).
 *
 * Handles both S3 and local files. Safe to call if the file doesn't exist.
 *
 * @param urlPath   The URL path returned by uploadFile (e.g. "/avatars/agent-id.jpg"
 *                  or "https://cdn.example.com/avatars/agent-id.jpg")
 */
export async function deleteFile(urlPath: string): Promise<void> {
  // Data URIs live in the database — nothing to delete from storage
  if (urlPath.startsWith('data:')) return;

  // 1. Try R2 binding
  const r2 = await getR2Bucket();
  if (r2) {
    return deleteR2(r2, urlPath);
  }

  // 2. Try S3 API
  const s3 = getS3();
  if (s3) {
    return deleteS3(s3, urlPath);
  }

  // 3. Local filesystem
  return deleteLocal(urlPath);
}

// ── R2 binding implementation ────────────────────────────

/** URL prefix for serving R2 files through the API route */
const R2_SERVE_PREFIX = '/api/storage';

async function uploadR2(
  r2: R2BucketLike,
  key: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  await r2.put(key, data, {
    httpMetadata: {
      contentType: mimeType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });

  // Return URL served by /api/storage/[...key] route
  const publicUrl = process.env.STORAGE_PUBLIC_URL;
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, '')}/${key}`;
  }
  return `${R2_SERVE_PREFIX}/${key}`;
}

async function deleteR2(r2: R2BucketLike, urlPath: string): Promise<void> {
  // Extract key from URL path
  let key = urlPath;
  const publicUrl = process.env.STORAGE_PUBLIC_URL;
  if (publicUrl && key.startsWith(publicUrl)) {
    key = key.slice(publicUrl.replace(/\/$/, '').length + 1);
  } else if (key.startsWith(R2_SERVE_PREFIX + '/')) {
    key = key.slice(R2_SERVE_PREFIX.length + 1);
  } else if (key.startsWith('/')) {
    key = key.slice(1);
  }

  try {
    await r2.delete(key);
  } catch {
    // R2 delete is idempotent — catch network errors
  }
}

/**
 * Read a file from storage. Used by the /api/storage/[...key] route to serve R2 files.
 * Returns null if the file doesn't exist or storage is not available.
 */
export async function readFile(key: string): Promise<{ data: ReadableStream | Buffer; mimeType: string; cacheControl?: string } | null> {
  // 1. Try R2 binding
  const r2 = await getR2Bucket();
  if (r2) {
    const obj = await r2.get(key);
    if (!obj) return null;
    return {
      data: obj.body as ReadableStream,
      mimeType: obj.httpMetadata?.contentType || 'application/octet-stream',
      cacheControl: obj.httpMetadata?.cacheControl || undefined,
    };
  }

  // 2. Try local filesystem
  if (fsPromises && path) {
    const filepath = path.join(getPublicDir(), key);
    try {
      const data = await fsPromises.readFile(filepath);
      const ext = path.extname(key).toLowerCase();
      const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
      return { data, mimeType: mimeMap[ext] || 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  return null;
}

// ── S3 implementation ────────────────────────────────────

async function uploadS3(
  s3: S3Client,
  key: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  const bucket = process.env.S3_BUCKET!;

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: data,
    ContentType: mimeType,
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  // Return public URL
  const publicUrl = process.env.S3_PUBLIC_URL;
  if (publicUrl) {
    return `${publicUrl.replace(/\/$/, '')}/${key}`;
  }
  return `/${key}`;
}

async function deleteS3(s3: S3Client, urlPath: string): Promise<void> {
  const bucket = process.env.S3_BUCKET!;

  // Extract key from URL path — strip public URL prefix or leading slash
  let key = urlPath;
  const publicUrl = process.env.S3_PUBLIC_URL;
  if (publicUrl && key.startsWith(publicUrl)) {
    key = key.slice(publicUrl.replace(/\/$/, '').length + 1);
  } else if (key.startsWith('/')) {
    key = key.slice(1);
  }

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    // S3 DeleteObject is idempotent — but catch network errors
  }
}

// ── Local filesystem implementation ──────────────────────

function getPublicDir(): string {
  if (!path) throw new Error('Local filesystem storage not available in this runtime. Configure S3/R2.');
  return path.join(process.cwd(), 'public');
}

async function uploadLocal(key: string, data: Buffer): Promise<string> {
  if (!fsPromises || !path) throw new Error('Local filesystem storage not available. Configure S3/R2.');
  const filepath = path.join(getPublicDir(), key);
  await fsPromises.mkdir(path.dirname(filepath), { recursive: true });
  await fsPromises.writeFile(filepath, data);
  return `/${key}`;
}

async function deleteLocal(urlPath: string): Promise<void> {
  if (!fsPromises || !path) return; // Can't delete locally on edge — no-op
  const filepath = path.join(getPublicDir(), urlPath);
  try {
    await fsPromises.unlink(filepath);
  } catch {
    // File may not exist — safe to ignore
  }
}
