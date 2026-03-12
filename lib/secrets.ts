import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export function generateSecret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

export async function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 10);
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  return bcrypt.compare(secret, hash);
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
