/**
 * Tests for MoltProtocol error codes and factory helpers.
 */
import {
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
  ERROR_MESSAGES,
  moltError,
} from '../core/moltprotocol/src/errors';

describe('MoltProtocol Error Codes', () => {
  it('all error codes are unique', () => {
    const codes = [
      MOLT_BAD_REQUEST, MOLT_AUTH_REQUIRED, MOLT_POLICY_DENIED,
      MOLT_NOT_FOUND, MOLT_CONFLICT, MOLT_DECOMMISSIONED, MOLT_RATE_LIMITED,
      MOLT_OFFLINE, MOLT_BUSY, MOLT_DND, MOLT_FORWARDING_FAILED,
      MOLT_INTERNAL_ERROR, MOLT_WEBHOOK_FAILED, MOLT_WEBHOOK_TIMEOUT,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('client errors are in 400-499 range', () => {
    expect(MOLT_BAD_REQUEST).toBeGreaterThanOrEqual(400);
    expect(MOLT_BAD_REQUEST).toBeLessThan(500);
    expect(MOLT_AUTH_REQUIRED).toBeGreaterThanOrEqual(400);
    expect(MOLT_RATE_LIMITED).toBeLessThan(500);
  });

  it('SIP-inspired codes are in 480-499 range', () => {
    expect(MOLT_OFFLINE).toBeGreaterThanOrEqual(480);
    expect(MOLT_BUSY).toBeGreaterThanOrEqual(480);
    expect(MOLT_DND).toBeGreaterThanOrEqual(480);
    expect(MOLT_FORWARDING_FAILED).toBeGreaterThanOrEqual(480);
  });

  it('server errors are in 500-599 range', () => {
    expect(MOLT_INTERNAL_ERROR).toBeGreaterThanOrEqual(500);
    expect(MOLT_WEBHOOK_FAILED).toBeGreaterThanOrEqual(500);
    expect(MOLT_WEBHOOK_TIMEOUT).toBeGreaterThanOrEqual(500);
  });

  it('every error code has a default message', () => {
    const codes = [
      MOLT_BAD_REQUEST, MOLT_AUTH_REQUIRED, MOLT_POLICY_DENIED,
      MOLT_NOT_FOUND, MOLT_CONFLICT, MOLT_DECOMMISSIONED, MOLT_RATE_LIMITED,
      MOLT_OFFLINE, MOLT_BUSY, MOLT_DND, MOLT_FORWARDING_FAILED,
      MOLT_INTERNAL_ERROR, MOLT_WEBHOOK_FAILED, MOLT_WEBHOOK_TIMEOUT,
    ];
    for (const code of codes) {
      expect(ERROR_MESSAGES[code]).toBeDefined();
      expect(typeof ERROR_MESSAGES[code]).toBe('string');
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });
});

describe('moltError factory', () => {
  it('creates error with default message', () => {
    const err = moltError(MOLT_NOT_FOUND);
    expect(err.code).toBe(404);
    expect(err.message).toBe('Not found');
    expect(err.data).toBeUndefined();
  });

  it('creates error with custom message', () => {
    const err = moltError(MOLT_NOT_FOUND, 'Agent not found');
    expect(err.code).toBe(404);
    expect(err.message).toBe('Agent not found');
  });

  it('creates error with data', () => {
    const err = moltError(MOLT_NOT_FOUND, 'Not found', { phone_number: 'SOLR-1234-5678-9012-A' });
    expect(err.data).toEqual({ phone_number: 'SOLR-1234-5678-9012-A' });
  });

  it('uses "Unknown error" for unrecognized codes', () => {
    const err = moltError(999);
    expect(err.message).toBe('Unknown error');
  });

  it('omits data field when not provided', () => {
    const err = moltError(MOLT_BAD_REQUEST, 'Bad');
    expect('data' in err).toBe(false);
  });
});
