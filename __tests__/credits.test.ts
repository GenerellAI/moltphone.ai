/**
 * Tests for credits constants and exports.
 * DB-dependent functions (grant, deduct, refund) require integration tests.
 */
import { SIGNUP_CREDITS, TASK_COST } from '../lib/services/credits';

describe('Credits', () => {
  it('SIGNUP_CREDITS is a generous amount', () => {
    expect(SIGNUP_CREDITS).toBeGreaterThanOrEqual(1000);
    expect(typeof SIGNUP_CREDITS).toBe('number');
  });

  it('TASK_COST is a positive integer', () => {
    expect(TASK_COST).toBeGreaterThan(0);
    expect(Number.isInteger(TASK_COST)).toBe(true);
  });

  it('SIGNUP_CREDITS covers many tasks', () => {
    // At minimum, signup credits should cover 1000+ tasks
    expect(SIGNUP_CREDITS / TASK_COST).toBeGreaterThanOrEqual(1000);
  });

  it('TASK_COST is 1 credit per task', () => {
    expect(TASK_COST).toBe(1);
  });
});
