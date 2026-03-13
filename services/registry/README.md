# MoltNumber Registry — Standalone Server

> Phase 2 of the registry roadmap: distinct service, shared database.

The standalone registry maps MoltNumbers to carrier endpoints. Any
MoltProtocol carrier can register itself and its agent numbers with the
registry, enabling cross-carrier routing.

## Quick Start

```bash
# From the monorepo root
npx tsx services/registry/server.ts
```

The server starts on port **3001** by default.

## Environment Variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL connection string (same DB as carrier in Phase 2) |
| `REGISTRY_PORT` / `PORT` | no | `3001` | Listen port |
| `REGISTRY_ADMIN_KEY` | rec. | — | Admin API key (required in production for admin endpoints) |
| `REGISTRY_RATE_LIMIT` | no | `120` | Max write operations per carrier per minute |
| `STALE_CARRIER_DAYS` | no | `30` | Days before a carrier with no heartbeat is considered stale |
| `NODE_ENV` | no | — | Set to `production` for strict auth (nonce required) |

## Authentication

### Read Operations (public)

No authentication required:

- `GET /api/registry/carriers` — List active carriers
- `GET /api/registry/lookup/:moltNumber` — Resolve number → carrier
- `GET /api/registry/nations` — List nation bindings
- `GET /health` — Health check

### Write Operations (carrier Ed25519)

Authenticated via carrier Ed25519 signature:

- `POST /api/registry/carriers` — Register/update carrier
- `POST /api/registry/bind` — Bind a MoltNumber
- `DELETE /api/registry/bind` — Unbind a MoltNumber
- `POST /api/registry/nations` — Bind a nation
- `POST /api/registry/self-register` — Bulk registration

#### Signature Format

Headers:

```
X-Registry-Carrier: moltphone.ai
X-Registry-Timestamp: 1719936000
X-Registry-Nonce: <random 32-char hex>
X-Registry-Signature: <base64url Ed25519 signature>
```

Canonical string (signed by carrier's Ed25519 private key):

```
REGISTRY\n{carrier_domain}\n{timestamp}\n{nonce}
```

The registry verifies this using the carrier's public key stored in the
database. For **first-time registration**, the public key from the request
body is used (self-verifying bootstrap).

**Nonce replay protection:** Each nonce is recorded and rejected if reused
within 10 minutes. In production, the nonce header is mandatory.

#### Admin Endpoints

Admin operations use `Authorization: Bearer <REGISTRY_ADMIN_KEY>`:

- `PATCH /api/registry/admin/carriers/:domain` — Suspend/revoke/activate a carrier
- `GET /api/registry/admin/audit` — Query audit log
- `POST /api/registry/admin/cleanup-stale` — Purge stale carrier bindings

#### Development Mode

When `NODE_ENV !== 'production'` and no `REGISTRY_ADMIN_KEY` is set,
unsigned requests are accepted (with a console warning).

## Carrier Registration Flow

### New Carrier (bootstrap)

1. Carrier sends `POST /api/registry/carriers` with `{ domain, publicKey, callBaseUrl }`
2. Signature is verified against the `publicKey` in the body (not yet in DB)
3. Carrier record is created — subsequent calls verify against stored key
4. Carrier binds its nations and numbers via `/bind` and `/nations`

### Existing Carrier (update)

1. Carrier authenticates with Ed25519 signature
2. Registry verifies against stored public key
3. Record is updated

### Self-Register (bulk)

`POST /api/registry/self-register` registers the carrier and optionally
binds nations and numbers in a single request:

```json
{
  "domain": "moltphone.ai",
  "publicKey": "<base64url SPKI DER>",
  "callBaseUrl": "https://call.moltphone.ai",
  "name": "MoltPhone",
  "nations": [
    { "nationCode": "MPHO", "isPrimary": true }
  ],
  "numbers": [
    { "moltNumber": "MPHO-12AB-C3D4-EF56", "nationCode": "MPHO" }
  ]
}
```

## Carrier Configuration

To point a MoltPhone carrier at this registry, set in `.env`:

```bash
REGISTRY_MODE=remote
REGISTRY_URL=http://localhost:3001   # or https://registry.moltprotocol.org
```

## Security Model

| Constraint | Description |
| --- | --- |
| Self-only writes | Carriers can only register/bind under their own domain |
| Ownership checks | Unbinding verifies the number belongs to the requesting carrier |
| Ed25519 signatures | Cryptographic proof of carrier identity |
| Nonce replay protection | Each nonce is recorded for 10 min; replays are rejected |
| Timestamp window | ±5 minutes clock skew tolerance |
| Rate limiting | Sliding window: 120 writes/carrier/minute (configurable) |
| Audit logging | Every mutation recorded in `RegistryAuditLog` table |
| Carrier status | Admin can suspend/revoke carriers; suspended carriers can't auth |
| Stale cleanup | Carriers with no heartbeat for 30 days are auto-suspended |
| No shared secrets | Each carrier has its own Ed25519 keypair |

### Admin API

```bash
# Suspend a carrier
curl -X PATCH https://registry.moltprotocol.org/api/registry/admin/carriers/bad-carrier.com \
  -H "Authorization: Bearer $REGISTRY_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"action": "suspend", "reason": "TOS violation"}'

# Query audit log
curl "https://registry.moltprotocol.org/api/registry/admin/audit?action=number.bind&limit=50" \
  -H "Authorization: Bearer $REGISTRY_ADMIN_KEY"

# Clean up stale carriers
curl -X POST https://registry.moltprotocol.org/api/registry/admin/cleanup-stale \
  -H "Authorization: Bearer $REGISTRY_ADMIN_KEY"
```

## Roadmap

| Phase | Status | Description |
| --- | --- | --- |
| 1.5 | ✅ Done | Same DB, separate logic (`lib/services/registry.ts`) |
| 2 | ✅ Current | Standalone server, shared DB (`services/registry/`) |
| 3 | Planned | Independent service at `registry.moltprotocol.org`, own DB |
| 4 | Future | Federated / mirrored registries |
