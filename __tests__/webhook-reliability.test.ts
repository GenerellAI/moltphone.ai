/**
 * Tests for webhook reliability — circuit breaker and retry logic.
 * These are unit tests for the pure-logic functions (no DB dependency).
 */
import { getCircuitState, retryDelayMs } from '../lib/services/webhook-reliability';

describe('Webhook Reliability', () => {
  describe('getCircuitState', () => {
    it('returns closed when failures are below threshold', () => {
      expect(getCircuitState({ webhookFailures: 0, circuitOpenUntil: null })).toBe('closed');
      expect(getCircuitState({ webhookFailures: 4, circuitOpenUntil: null })).toBe('closed');
    });

    it('returns open when failures >= threshold and circuitOpenUntil is in the future', () => {
      const future = new Date(Date.now() + 60_000);
      expect(getCircuitState({ webhookFailures: 5, circuitOpenUntil: future })).toBe('open');
      expect(getCircuitState({ webhookFailures: 10, circuitOpenUntil: future })).toBe('open');
    });

    it('returns half-open when failures >= threshold but circuitOpenUntil is in the past', () => {
      const past = new Date(Date.now() - 1000);
      expect(getCircuitState({ webhookFailures: 5, circuitOpenUntil: past })).toBe('half-open');
    });

    it('returns half-open when failures >= threshold and circuitOpenUntil is null', () => {
      expect(getCircuitState({ webhookFailures: 5, circuitOpenUntil: null })).toBe('half-open');
    });

    it('boundary: exactly at threshold with future date is open', () => {
      const future = new Date(Date.now() + 1);
      expect(getCircuitState({ webhookFailures: 5, circuitOpenUntil: future })).toBe('open');
    });
  });

  describe('retryDelayMs', () => {
    it('returns 1s for first retry', () => {
      expect(retryDelayMs(0)).toBe(1000);
    });

    it('returns 5s for second retry', () => {
      expect(retryDelayMs(1)).toBe(5000);
    });

    it('returns 30s for third retry', () => {
      expect(retryDelayMs(2)).toBe(30_000);
    });

    it('returns 5min for fourth retry', () => {
      expect(retryDelayMs(3)).toBe(5 * 60_000);
    });

    it('returns 15min for fifth retry', () => {
      expect(retryDelayMs(4)).toBe(15 * 60_000);
    });

    it('caps at 15min for attempts beyond schedule', () => {
      expect(retryDelayMs(10)).toBe(15 * 60_000);
      expect(retryDelayMs(100)).toBe(15 * 60_000);
    });

    it('delays increase monotonically', () => {
      for (let i = 0; i < 4; i++) {
        expect(retryDelayMs(i + 1)).toBeGreaterThanOrEqual(retryDelayMs(i));
      }
    });
  });
});
