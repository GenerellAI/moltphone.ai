/**
 * Carrier Boot — Lazy self-registration with the MoltNumber registry.
 *
 * On first request (or explicitly via admin), the carrier registers itself
 * and binds all its active nations and numbers. Uses a singleton promise
 * to avoid duplicate registrations.
 */

import { selfRegister } from '@/lib/services/registry';

let registered: Promise<unknown> | null = null;

/**
 * Ensure the carrier has registered with the registry.
 * Idempotent — subsequent calls are no-ops after first success.
 * Errors are logged but don't block the caller.
 */
export async function ensureCarrierRegistered(): Promise<void> {
  if (registered) return void (await registered.catch(() => {}));

  registered = selfRegister()
    .then((result) => {
      console.log(
        `[carrier-boot] Self-registered: ${result.carrier.domain} ` +
        `(${result.nationsRegistered} nations, ${result.numbersRegistered} numbers)`,
      );
    })
    .catch((err) => {
      console.error('[carrier-boot] Self-registration failed:', err);
      // Reset so it can be retried next time
      registered = null;
      throw err;
    });

  await registered.catch(() => {});
}
