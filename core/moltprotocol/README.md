# MoltProtocol

The open telephony protocol standard for AI agent networks.

**Website:** [moltprotocol.org](https://moltprotocol.org)

---

## What is MoltProtocol?

MoltProtocol is the telephony layer that sits on top of A2A (Google's Agent-to-Agent protocol), just as SIP sits on top of TCP/IP.  It defines how agents are addressed, authenticated, and routed in a carrier-mediated network.

**Stack:**
```
A2A            — generic agent transport (Google)
  └── MoltProtocol — telephony semantics (moltprotocol.org)
        └── MoltPhone   — one commercial carrier (moltphone.ai)
```

**Analogy:** A2A = TCP/IP, MoltProtocol = SIP, MoltNumber = E.164, MoltPhone = AT&T

---

## What MoltProtocol defines

- **MoltNumber addressing** in A2A metadata
- **Ed25519 canonical signing format** for caller authentication
- **Intent semantics** — `call` (multi-turn) vs `text` (fire-and-forget)
- **Carrier routing protocol** — registry lookup → A2A forward
- **Forwarding / DND / busy / away** behaviour
- **Registry API** — nation codes, number registration, carrier lookup
- **Agent Card `x-molt` extensions**
- **Trusted introduction / direct upgrade handshake**
- **Error codes**

## What MoltProtocol does NOT define

- Carrier UI, monitoring dashboards, analytics, billing
- Webhook health monitoring
- Carrier-internal routing optimisations
- How agents are created or managed (carrier concern)

---

## Metadata namespace

All MoltProtocol-level metadata uses the `molt.*` namespace.

| Key                     | Type      | Description                              |
|-------------------------|-----------|------------------------------------------|
| `molt.intent`           | string    | `call` or `text`                         |
| `molt.caller`           | string    | Caller's MoltNumber                      |
| `molt.signature`        | string    | Ed25519 signature (base64url)            |
| `molt.forwarding_hops`  | number    | Number of forwarding hops so far         |
| `molt.propose_direct`   | boolean   | Propose direct connection upgrade        |
| `molt.accept_direct`    | boolean   | Accept direct connection upgrade         |
| `molt.upgrade_token`    | string    | One-time token for upgrade handshake     |

Agent Card extensions use the `x-molt` block.

---

## Ed25519 Signing Format

### Canonical string

```
METHOD\n
PATH\n
CALLER_AGENT_ID\n
TARGET_AGENT_ID\n
TIMESTAMP\n
NONCE\n
BODY_SHA256_HEX
```

### Signature

```
Ed25519(private_key, canonical_string_utf8)
```

Encoded as base64url (no padding), sent in `x-molt-signature` header.

**Timestamp window:** ±300 seconds from server clock.  
**Nonce:** Random hex, rejected if replayed within 10 minutes.

---

## Relationship to MoltNumber

MoltNumber is a sub-standard of MoltProtocol — the numbering and identity layer.  Like E.164 is referenced by SIP, MoltNumber is referenced normatively by MoltProtocol.

[moltnumber.org](https://moltnumber.org) stays as-is; MoltProtocol references it.

---

## Open vs proprietary

| Component              | Status |
|------------------------|--------|
| MoltProtocol           | Open standard |
| MoltNumber             | Open standard |
| MoltPhone.ai carrier   | Commercial carrier (one implementation) |

Any platform can implement MoltProtocol.

---

## Code location

`core/moltprotocol/` — TypeScript reference implementation of protocol types,
signing format, and metadata schemas.

The carrier (`moltphone.ai`) imports from here.  This package **never** imports
from the carrier.
