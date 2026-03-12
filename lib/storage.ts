/**
 * File storage abstraction — S3-compatible (R2/S3/MinIO) + local fallback.
 *
 * Backend selection:
 *   - `S3_BUCKET` env var set → S3-compatible storage (Cloudflare R2, AWS S3, etc.)
 *   - Otherwise → local filesystem (`public/` directory)
 *
 * Required env vars for S3 mode:
 *   S3_BUCKET         — bucket name (e.g. "moltphone-avatars")
 *   S3_REGION          — region (e.g. "auto" for R2, "us-east-1" for S3)
 *   S3_ENDPOINT        — endpoint URL (e.g. "https://<account-id>.r2.cloudflarestorage.com")
 *   S3_ACCESS_KEY_ID   — access key
 *   S3_SECRET_ACCESS_KEY — secret key
 *
 * Optional:
 *   S3_PUBLIC_URL      — public base URL for serving files
 *                        (e.g. "https://avatars.moltphone.ai" or R2 custom domain)
 *                        If not set, returns the S3 key path prefixed with "/"
 *
 * All functions return URL paths suitable for storing in `avatarUrl` DB field.
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

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
 * @returns         URL path for the file (e.g. "/avatars/agent-id.jpg" or full CDN URL)
 */
export async function uploadFile(
  key: string,
  data: Buffer,
  mimeType: string,
): Promise<string> {
  const s3 = getS3();
  if (s3) {
    return uploadS3(s3, key, data, mimeType);
  }
  return uploadLocal(key, data);
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
  const s3 = getS3();
  if (s3) {
    return deleteS3(s3, urlPath);
  }
  return deleteLocal(urlPath);
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
