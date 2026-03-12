import type { PrismaClient } from '@prisma/client';

/* -------------------------------------------------------------------------- */
/*  Cloudflare Workers context helpers                                        */
/* -------------------------------------------------------------------------- */

type CfContext = {
  env?: Record<string, unknown>;
  ctx?: { waitUntil(p: Promise<unknown>): void };
};

function getCfContext(): CfContext | undefined {
  try {
    return (globalThis as Record<symbol, unknown>)[
      Symbol.for('__cloudflare-context__')
    ] as CfContext | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read an env var from CF Worker bindings first, then process.env.
 *
 * In Cloudflare Workers, secrets / vars are bound to the Worker and
 * available via the context stored in AsyncLocalStorage by OpenNext.
 */
function getEnv(key: string): string | undefined {
  try {
    const ctx = getCfContext();
    if (ctx?.env) {
      const val = ctx.env[key];
      if (typeof val === 'string') return val;
    }
  } catch {
    /* not in a Worker — fall through */
  }
  return process.env[key];
}

/* -------------------------------------------------------------------------- */
/*  PrismaClient factories                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Create a Wasm PrismaClient backed by the Neon serverless driver.
 *
 * `@prisma/adapter-neon` v6 exports `PrismaNeon` as a *factory* that
 * receives Pool config (NOT a Pool instance). Its `connect()` method
 * creates `new neon.Pool(config)` internally.
 *
 * Because Cloudflare Workers forbid reusing I/O objects (WebSocket
 * connections) across request boundaries, **each request gets its own
 * PrismaClient → PrismaNeon → neon.Pool**. Pool options are tuned to
 * close idle connections immediately and limit concurrency.
 */
function createNeonClient(): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: WasmPrismaClient } = require('@prisma/client/wasm');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaNeon } = require('@prisma/adapter-neon');

  const connectionString = getEnv('DATABASE_URL');
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. ' +
        `DATABASE_PROVIDER=${getEnv('DATABASE_PROVIDER')}, ` +
        `CF context available=${!!getCfContext()}`,
    );
  }

  const adapter = new PrismaNeon({
    connectionString,
    // Minimise lingering connections that would trip the
    // Workers cross-request I/O guard:
    max: 2,
    idleTimeoutMillis: 0,
    connectionTimeoutMillis: 10_000,
  });

  return new WasmPrismaClient({ adapter }) as PrismaClient;
}

/** Standard binary-engine PrismaClient for local development. */
function createDevClient(): PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient: StandardPrismaClient } = require('@prisma/client');
  return new StandardPrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  }) as PrismaClient;
}

/* -------------------------------------------------------------------------- */
/*  Per-request PrismaClient lifecycle (Workers)                              */
/* -------------------------------------------------------------------------- */

/**
 * WeakMap keyed on the per-request CF context object.
 * When the context is GC'd (after the request ends) the entry disappears.
 * This gives us per-request isolation without modifying the context object.
 */
const clientCache = new WeakMap<object, PrismaClient>();

/**
 * Module-level reference to the most recently created worker PrismaClient,
 * used to `$disconnect()` the previous request's client when a new request
 * arrives. This tears down leftover neon.Pool WebSocket connections that
 * would otherwise violate the Workers cross-request I/O rule.
 *
 * NOTE: in the (rare) case of truly concurrent requests this disconnect
 * may hit the wrong client. The WeakMap cache prevents the *current*
 * request from being affected — the worst outcome is an extra reconnect.
 */
let lastClient: PrismaClient | null = null;

/** Global singleton for non-Worker environments (local dev). */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getPrisma(): PrismaClient {
  const isNeon = getEnv('DATABASE_PROVIDER') === 'neon';

  if (isNeon) {
    const cfCtx = getCfContext();
    if (!cfCtx) {
      throw new Error(
        'DATABASE_PROVIDER=neon but no Cloudflare context available',
      );
    }

    // Fast path: reuse client created earlier in the same request.
    const cached = clientCache.get(cfCtx);
    if (cached) return cached;

    // Different (or first) request — tear down old client's connections.
    if (lastClient) {
      const old = lastClient;
      lastClient = null;
      // Fire-and-forget: don't block the incoming request on disconnect.
      old.$disconnect().catch(() => {});
    }

    const client = createNeonClient();
    clientCache.set(cfCtx, client);
    lastClient = client;
    return client;
  }

  // ---- Local dev: classic singleton ----
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createDevClient();
  }
  return globalForPrisma.prisma;
}

/* -------------------------------------------------------------------------- */
/*  Exported proxy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Lazy proxy that defers PrismaClient creation until first property access.
 *
 * In Workers the underlying client changes per request (via `getPrisma()`).
 * In local dev it's a stable singleton. Consumers just `import { prisma }`.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  },
});
