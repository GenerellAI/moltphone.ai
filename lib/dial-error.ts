/**
 * Structured dial error helper.
 *
 * Returns a JSON-RPC 2.0-style error response with an HTTP status that
 * matches the MoltProtocol dial error code (SIP-inspired).
 *
 * Format: { "error": { "code": <number>, "message": <string>, "data"?: <object> } }
 */

import { NextResponse } from 'next/server';

export function dialError(
  code: number,
  message: string,
  data?: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(data !== undefined ? { data } : {}) } },
    { status: code },
  );
}
