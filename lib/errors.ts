/**
 * Carrier-level error response helper.
 *
 * Wraps MoltProtocol error codes into JSON-RPC 2.0 error responses
 * that can be returned from Next.js route handlers.
 */

import { NextResponse } from 'next/server';
import {
  moltError,
  MOLT_BAD_REQUEST,
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
  MOLT_CONFLICT,
  MOLT_DECOMMISSIONED,
  MOLT_RATE_LIMITED,
  MOLT_OFFLINE,
  MOLT_BUSY,
  MOLT_DND,
  MOLT_FORWARDING_FAILED,
  MOLT_INTERNAL_ERROR,
  MOLT_WEBHOOK_FAILED,
  MOLT_WEBHOOK_TIMEOUT,
} from '@/core/moltprotocol/src/errors';

// ── HTTP status mapping ──────────────────────────────────

/**
 * Map MoltProtocol error codes to HTTP status codes.
 *
 * Most codes in the 4xx/5xx range map 1:1.  SIP-inspired codes (480–488)
 * map to the closest standard HTTP status.
 */
const HTTP_STATUS: Record<number, number> = {
  [MOLT_BAD_REQUEST]: 400,
  [MOLT_AUTH_REQUIRED]: 401,
  [MOLT_POLICY_DENIED]: 403,
  [MOLT_NOT_FOUND]: 404,
  [MOLT_CONFLICT]: 409,
  [MOLT_DECOMMISSIONED]: 410,
  [MOLT_RATE_LIMITED]: 429,
  [MOLT_OFFLINE]: 503,
  [MOLT_BUSY]: 503,
  [MOLT_DND]: 503,
  [MOLT_FORWARDING_FAILED]: 502,
  [MOLT_INTERNAL_ERROR]: 500,
  [MOLT_WEBHOOK_FAILED]: 502,
  [MOLT_WEBHOOK_TIMEOUT]: 504,
};

function httpStatus(code: number): number {
  return HTTP_STATUS[code] ?? (code >= 400 && code < 600 ? code : 500);
}

// ── Response builder ─────────────────────────────────────

/**
 * Build a JSON-RPC 2.0 error `NextResponse`.
 *
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "error": { "code": 404, "message": "Not found" },
 *   "id": null
 * }
 * ```
 *
 * @param code    One of the MOLT_* error code constants.
 * @param message Override the default message for this code.
 * @param data    Optional structured data to attach.
 * @param id      JSON-RPC request id (null for notifications / unknown).
 */
export function moltErrorResponse(
  code: number,
  message?: string,
  data?: Record<string, unknown>,
  id: string | number | null = null,
): NextResponse {
  const err = moltError(code, message, data);
  return NextResponse.json(
    { jsonrpc: '2.0', error: err, id },
    { status: httpStatus(code) },
  );
}
