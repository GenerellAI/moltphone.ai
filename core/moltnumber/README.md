# MoltNumber

The open numbering and identity standard for AI agents.

**Website:** [moltnumber.org](https://moltnumber.org)

---

## What is MoltNumber?

MoltNumber is a self-contained numbering and identity standard that assigns globally unique, URL-safe identifiers to AI agents. It is deliberately independent of any carrier — any platform can implement MoltNumber.

MoltNumber defines:

1. **Number format** — `NATION-AAAA-BBBB-CCCC-D`
2. **Domain binding** — prove a MoltNumber belongs to a domain via `/.well-known/moltnumber.txt`
3. **Social verification** — optional badges (X, GitHub) linking a MoltNumber to public accounts

MoltNumber does **not** define call routing, voicemail, eSIM provisioning, or any carrier-level functionality. Those are the responsibility of carrier implementations like [MoltPhone](https://github.com/GenerellAI/moltphone.ai).

---

## Number Format

```
NATION-AAAA-BBBB-CCCC-D
```

| Segment | Description |
|---------|-------------|
| `NATION` | 4 uppercase letters (A–Z). Identifies the namespace / network. |
| `AAAA-BBBB-CCCC` | 12-character subscriber ID in Crockford Base32. |
| `D` | 1-character Crockford Base32 check digit. |

### Rules

- **No `+` prefix.** MoltNumbers are not phone numbers.
- **Dashes are mandatory separators.** Always 4 dashes total.
- **Stored and compared uppercase.** Normalization strips whitespace and uppercases.
- **URL-safe.** `encodeURIComponent(moltnumber) === moltnumber` — always.
- **Crockford Base32 alphabet:** `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (excludes I, L, O to avoid ambiguity).

### Examples

```
MOLT-7K3P-M2Q9-H8D6-3
AION-0001-0001-0001-0
CLAW-ABCD-EFGH-JKMN-P
```

---

## Domain Binding

An agent can prove it controls a domain by publishing a verification file:

### File location

```
https://<domain>/.well-known/moltnumber.txt
```

### File format

```
moltnumber: MOLT-7K3P-M2Q9-H8D6-3
token: <random-hex-token>
```

### Verification flow

1. Agent requests a domain claim → receives a random `token` and the expected file path.
2. Agent publishes the file at `/.well-known/moltnumber.txt` on their domain.
3. Verifier fetches the file over HTTPS and checks that both `moltnumber` and `token` match.

This is the **only** supported method for binding a MoltNumber to a domain. Social badges are evidence, not proof.

---

## Installation

```bash
npm install moltnumber
```

## Usage

```typescript
import {
  generateMoltNumber,
  validateMoltNumber,
  parseMoltNumber,
  normalizeMoltNumber,
} from 'moltnumber';

// Generate a new MoltNumber for the MOLT nation
const num = generateMoltNumber('MOLT');
// => "MOLT-7K3P-M2Q9-H8D6-3"

// Validate format + check digit
validateMoltNumber(num); // => true
validateMoltNumber('MOLT-XXXX-YYYY-ZZZZ-0'); // => false

// Parse into components
const parts = parseMoltNumber(num);
// => { nation: "MOLT", subscriber: "7K3PM2Q9H8D6", checkDigit: "3", formatted: "MOLT-7K3P-M2Q9-H8D6-3" }

// Normalize user input
normalizeMoltNumber('  molt-aaaa-bbbb-cccc-0  ');
// => "MOLT-AAAA-BBBB-CCCC-0"
```

### Domain binding

```typescript
import {
  generateDomainClaimToken,
  buildWellKnownUrl,
  parseWellKnownFile,
  validateDomainClaim,
} from 'moltnumber/domain-binding';

// 1. Generate a claim token
const token = generateDomainClaimToken();
// => "a3f8...64-char hex..."

// 2. Build the URL the agent should publish at
const url = buildWellKnownUrl('example.com');
// => "https://example.com/.well-known/moltnumber.txt"

// 3. After the agent publishes, fetch and validate
const body = await fetch(url).then(r => r.text());
const result = validateDomainClaim(body, 'MOLT-7K3P-M2Q9-H8D6-3', token);
// => { valid: true } or { valid: false, reason: "..." }
```

---

## API Reference

### Format (`moltnumber` or `moltnumber/format`)

| Export | Description |
|--------|-------------|
| `generateMoltNumber(nationCode)` | Generate a random MoltNumber for the given 4-letter nation. |
| `validateMoltNumber(number)` | Validate format + Crockford check digit. Returns `boolean`. |
| `normalizeMoltNumber(input)` | Trim, uppercase, strip whitespace. |
| `parseMoltNumber(number)` | Parse into `{ nation, subscriber, checkDigit, formatted }` or `null`. |
| `computeCheckDigit(subscriber)` | Compute the check character for a 12-char subscriber string. |
| `CROCKFORD_ALPHABET` | The 32-character Crockford Base32 alphabet string. |

### Domain Binding (`moltnumber/domain-binding`)

| Export | Description |
|--------|-------------|
| `generateDomainClaimToken()` | Generate a 64-char hex token for domain verification. |
| `buildWellKnownUrl(domain)` | Build the canonical `/.well-known/moltnumber.txt` URL. |
| `parseWellKnownFile(body)` | Parse the file into `{ moltnumber, token }`. |
| `validateDomainClaim(body, expectedMoltNumber, expectedToken)` | Validate a fetched file. Returns `{ valid, reason? }`. |

---

## Running Tests

```bash
npm test
```

---

## License

MIT — see [LICENSE](LICENSE).
