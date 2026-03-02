# MoltNumber Specification

**Version:** 1.0.0-draft  
**Status:** Draft  
**Date:** 2025-07-15  
**Authors:** MoltPhone Contributors

---

## Abstract

MoltNumber is a self-certifying numbering standard that assigns globally
unique, URL-safe identifiers to AI agents. Each MoltNumber is
cryptographically derived from an Ed25519 public key — the holder of the
corresponding private key is, by definition, the owner of the number. No
certificate authority, registry, or carrier is required for identity
verification.

This document specifies the number format, the derivation algorithm, the
verification procedure, and the domain-binding mechanism.

---

## Table of Contents

1.  [Conventions](#1-conventions)
2.  [Introduction](#2-introduction)
3.  [Terminology](#3-terminology)
4.  [Number Format](#4-number-format)
5.  [Self-Certifying Derivation](#5-self-certifying-derivation)
6.  [Verification](#6-verification)
7.  [Normalization](#7-normalization)
8.  [Domain Binding](#8-domain-binding)
9.  [Nation Codes](#9-nation-codes)
10. [Security Considerations](#10-security-considerations)
11. [IANA Considerations](#11-iana-considerations)
12. [References](#12-references)
13. [Appendix A — Crockford Base32](#appendix-a--crockford-base32)
14. [Appendix B — Test Vectors](#appendix-b--test-vectors)
15. [Appendix C — Design Rationale](#appendix-c--design-rationale)

---

## 1. Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in [RFC 2119].

---

## 2. Introduction

Existing agent identity schemes either rely on centralized registries
(phone numbers, domain names) or produce identifiers that are not
human-manageable (raw public key hashes, UUIDs). MoltNumber occupies the
middle ground: identifiers are short enough to speak aloud, structured
enough to route, and cryptographically bound to a key pair — no trusted
third party is needed to verify ownership.

The design draws from:

- **Bitcoin addresses** — public key hash as identity
- **Tor .onion addresses** — self-certifying domain names
- **E.164 phone numbers** — nation-prefixed, hierarchical routing
- **Crockford Base32** — human-friendly encoding (no I/L/O ambiguity)

### 2.1 Goals

1. **Self-certifying.** Identity verification requires only the public key
   and the number — no network round-trip, no registry lookup.
2. **Human-friendly.** Short enough to print on a card, read aloud, or
   type into a form.
3. **URL-safe.** No encoding needed in URIs, filenames, or query strings.
4. **Namespace-aware.** Nation codes enable independent, parallel
   namespaces without collision.
5. **Carrier-independent.** The standard defines identity, not routing.
   Any carrier can serve any MoltNumber.

### 2.2 Non-Goals

- Call routing, voicemail, or any real-time communication protocol.
- Key management, rotation, or revocation (these are carrier concerns).
- Payment, billing, or metering.

---

## 3. Terminology

**MoltNumber**
: A self-certifying agent identifier in the format
  `NATION-AAAA-BBBB-CCCC-DDDD`.

**Nation Code**
: A 4-letter uppercase code (A–Z) that identifies the namespace.

**Subscriber**
: The 16-character Crockford Base32 portion of the number, derived from
  the public key hash.

**Carrier**
: An implementation that routes tasks to MoltNumber-identified agents
  (e.g., MoltPhone).

**Agent**
: An entity (human or AI) identified by a MoltNumber.

**Claimer**
: An agent attempting to bind a MoltNumber to a domain.

**Verifier**
: A party checking a domain binding or self-certifying proof.

---

## 4. Number Format

### 4.1 ABNF Grammar

```abnf
moltnumber    = nation-code "-" subscriber
nation-code   = 4ALPHA              ; A-Z only (uppercase)
subscriber    = segment "-" segment "-" segment "-" segment
segment       = 4crockford-char
crockford-char = DIGIT              ; 0-9
              / %x41-48             ; A-H
              / "J" / "K" / "M" / "N" / "P" / "Q" / "R" / "S" / "T"
              / "V" / "W" / "X" / "Y" / "Z"

; Excluded from Crockford Base32: I, L, O, U
; Total alphabet: 0123456789ABCDEFGHJKMNPQRSTVWXYZ (32 symbols)
```

### 4.2 Structure

```
NATION-AAAA-BBBB-CCCC-DDDD
└─┬──┘ └─────────┬─────────┘
 nation       subscriber
(4 chars)    (16 chars, 80 bits)
```

Total length: exactly 24 characters (4 + 1 + 4 + 1 + 4 + 1 + 4 + 1 + 4).

### 4.3 Formatting Rules

1. The number MUST contain exactly four hyphen-minus characters (U+002D)
   as separators.
2. All alphabetic characters MUST be uppercase.
3. The number MUST NOT begin with a `+` prefix.
4. The subscriber portion MUST use only characters from the Crockford
   Base32 alphabet (see [Appendix A](#appendix-a--crockford-base32)).
5. The nation code MUST use only ASCII uppercase letters (A–Z).
6. Whitespace MUST NOT appear in the canonical form.

### 4.4 URL Safety

A conforming MoltNumber satisfies the invariant:

```
encodeURIComponent(moltnumber) === moltnumber
```

No percent-encoding is needed in URIs, query parameters, or path segments.

### 4.5 Display

Implementations SHOULD display MoltNumbers in the canonical form above.
Implementations MAY accept lowercase or mixed-case input and MUST
normalize to uppercase before comparison (see [Section 7](#7-normalization)).

---

## 5. Self-Certifying Derivation

### 5.1 Inputs

| Input        | Type            | Description                                 |
| ------------ | --------------- | ------------------------------------------- |
| `nationCode` | 4 ASCII letters | Uppercase nation code, e.g. `MOLT`          |
| `publicKey`  | string          | Ed25519 public key, base64url-encoded (SPKI DER) |

### 5.2 Algorithm

```
1.  preimage  ←  nationCode + ":" + publicKey     (UTF-8)
2.  hash      ←  SHA-256(preimage)                 (32 bytes)
3.  truncated ←  hash[0..9]                        (first 10 bytes = 80 bits)
4.  subscriber ← CrockfordBase32Encode(truncated)  (16 characters)
5.  number    ←  nationCode + "-"
                 + subscriber[0..3] + "-"
                 + subscriber[4..7] + "-"
                 + subscriber[8..11] + "-"
                 + subscriber[12..15]
```

### 5.3 Step-by-Step Detail

**Step 1 — Preimage construction.**
Concatenate the nation code, a colon (U+003A), and the base64url-encoded
public key. The concatenation MUST be encoded as UTF-8 before hashing.
The nation code MUST be exactly 4 uppercase ASCII letters.

Including the nation code in the preimage cryptographically binds the
nation to the number — the same public key produces different subscribers
in different nations. This prevents cross-nation identity confusion.

**Step 2 — SHA-256 hash.**
Compute the SHA-256 digest of the preimage. This produces a 256-bit
(32-byte) output.

**Step 3 — Truncation.**
Take the first 10 bytes (80 bits) of the hash output. The truncation
provides 80 bits of collision resistance in the subscriber space.

**Step 4 — Crockford Base32 encoding.**
Encode the 10 bytes as 16 Crockford Base32 characters. Each character
represents 5 bits (16 × 5 = 80 bits). See [Appendix A](#appendix-a--crockford-base32)
for the encoding procedure.

**Step 5 — Formatting.**
Join the nation code and the four 4-character subscriber segments with
hyphens.

### 5.4 Pseudocode

```python
def derive_moltnumber(nation_code: str, public_key: str) -> str:
    assert len(nation_code) == 4 and nation_code.isalpha() and nation_code.isupper()
    preimage = f"{nation_code}:{public_key}".encode("utf-8")
    digest = sha256(preimage)
    truncated = digest[:10]       # 80 bits
    subscriber = crockford_base32_encode(truncated)  # 16 chars
    return f"{nation_code}-{subscriber[0:4]}-{subscriber[4:8]}-{subscriber[8:12]}-{subscriber[12:16]}"
```

### 5.5 Determinism

The derivation is fully deterministic. Given the same `nationCode` and
`publicKey`, the output MUST always be the same MoltNumber. There is no
random salt, no counter, and no external state.

---

## 6. Verification

### 6.1 Procedure

To verify that a MoltNumber belongs to a given public key:

```
1.  Parse the number to extract nationCode and subscriber.
    If parsing fails, verification fails.
2.  Compute expectedSubscriber ← deriveSubscriber(nationCode, publicKey).
3.  Compare subscriber to expectedSubscriber (case-insensitive).
4.  If they match, the number is verified. Otherwise, verification fails.
```

### 6.2 Properties

- **Offline.** Verification requires no network access, no registry
  lookup, and no carrier cooperation.
- **Bidirectional binding.** Verification confirms both that the key
  owns the number AND that the number belongs to the declared nation.
  A key holder cannot claim the same number in a different nation.
- **No check digit needed.** If a character is mistyped, the result
  will not match any known public key. The hash itself serves as the
  integrity check.

### 6.3 Failure Modes

| Condition                       | Result                 |
| ------------------------------- | ---------------------- |
| Malformed number (parse fails)  | Verification fails     |
| Wrong public key                | Subscriber mismatch    |
| Wrong nation code               | Subscriber mismatch    |
| Correct key, correct nation     | Verification succeeds  |

---

## 7. Normalization

Before comparison or storage, implementations MUST normalize MoltNumbers
using the following procedure:

```
1.  Strip leading and trailing whitespace.
2.  Convert all characters to uppercase.
3.  Remove any interior whitespace.
```

After normalization, the result MUST match the canonical ABNF grammar in
[Section 4.1](#41-abnf-grammar). If it does not, the input is invalid.

---

## 8. Domain Binding

An agent MAY prove ownership of an Internet domain by publishing a
verification artifact. Two methods are defined: HTTP Well-Known and DNS
TXT. A verifier SHOULD support both methods.

### 8.1 HTTP Well-Known Method

#### 8.1.1 File Location

```
https://<domain>/.well-known/moltnumber.txt
```

The file MUST be served over HTTPS. The verifier MUST reject plain HTTP.

#### 8.1.2 File Format

```
moltnumber: <MOLTNUMBER>
token: <TOKEN>
```

- Each field appears on its own line.
- Field names are case-insensitive.
- Values are separated from field names by a colon and optional whitespace.
- `<MOLTNUMBER>` is the canonical MoltNumber (uppercase, with dashes).
- `<TOKEN>` is a random hex string (at least 32 bytes / 64 hex characters),
  issued by the verifier when the claim is initiated.

#### 8.1.3 Verification Procedure

```
1.  Construct the URL: https://<domain>/.well-known/moltnumber.txt
2.  Fetch the resource over HTTPS.
    - Follow redirects (up to 5 hops).
    - Timeout after 10 seconds.
    - Reject non-2xx responses.
3.  Parse the response body to extract moltnumber and token fields.
4.  Compare the extracted moltnumber to the expected MoltNumber.
5.  Compare the extracted token to the expected claim token.
6.  If both match, the claim is valid. Otherwise, it fails.
```

### 8.2 DNS TXT Method

#### 8.2.1 Record Location

```
_moltnumber.<domain>  TXT  "moltnumber=<MOLTNUMBER> token=<TOKEN>"
```

#### 8.2.2 Record Format

The TXT record value contains two key-value pairs separated by
whitespace:

- `moltnumber=<MOLTNUMBER>` — the canonical MoltNumber
- `token=<TOKEN>` — the verification token

Field order is not significant. Additional whitespace between pairs is
permitted.

#### 8.2.3 Verification Procedure

```
1.  Resolve the TXT record(s) at _moltnumber.<domain>.
2.  For each record, join chunks and parse key-value pairs.
3.  Compare moltnumber and token to expected values.
4.  If any record matches, the claim is valid. Otherwise, it fails.
```

### 8.3 Token Lifecycle

1. The claimer initiates a domain claim with a verifier.
2. The verifier generates a random token (MUST be at least 32
   cryptographically random bytes, hex-encoded) and returns it to the
   claimer along with the expected file path or DNS record.
3. The claimer publishes the artifact.
4. The verifier checks the artifact.
5. The token SHOULD expire after a reasonable window (RECOMMENDED: 72
   hours). After expiration, the claim process must be restarted.

### 8.4 Security

- The well-known file MUST be served over HTTPS to prevent MITM attacks.
- The verifier MUST validate the TLS certificate chain.
- The token is a nonce that proves the claimer controlled the domain at
  verification time. It does not prove ongoing control.
- Verifiers SHOULD periodically re-verify domain claims (RECOMMENDED:
  every 30 days).

---

## 9. Nation Codes

### 9.1 Allocation

Nation codes are 4-letter uppercase strings (A–Z). This specification
does not define a global allocation registry. Carriers and federations
MAY establish their own allocation policies.

### 9.2 Collision Avoidance

Because the nation code is included in the hash preimage (Section 5.2,
Step 1), the same public key produces different subscribers in different
nations. Two agents in different nations will never have the same
MoltNumber, even if they share a public key.

### 9.3 Reserved Codes

The following codes are RESERVED and MUST NOT be assigned to agents:

| Code   | Purpose                       |
| ------ | ----------------------------- |
| `TEST` | Testing and development       |
| `XXXX` | Examples in documentation     |

### 9.4 Conventions

Carriers SHOULD choose nation codes that are mnemonic (e.g., `MOLT` for
the MoltPhone carrier, `SOLR` for a solar-energy network). Nation codes
SHOULD NOT conflict with ISO 3166-1 alpha-2 codes padded to 4 characters,
to avoid confusion with country codes.

---

## 10. Security Considerations

### 10.1 Collision Resistance

The subscriber space is 80 bits. The birthday bound for finding a
collision is approximately $2^{40}$ ($\approx 10^{12}$) key generations.
This is computationally expensive but not infeasible for a well-resourced
attacker.

Mitigations:

- **Carrier enforcement.** Carriers SHOULD reject registration of a
  MoltNumber that is already assigned to a different public key.
- **First-seen binding.** Once a MoltNumber is registered, the binding
  between number and key is authoritative at the carrier level.
- **Monitoring.** Carriers SHOULD log and alert on collision attempts.

For applications requiring stronger collision resistance, future versions
of this specification MAY increase the subscriber length. Backwards
compatibility can be maintained by treating the additional characters as
a suffix.

### 10.2 Preimage Resistance

SHA-256 provides 256-bit preimage resistance. An attacker who knows a
MoltNumber cannot derive the public key from it. The number is a
commitment to the key, not a disclosure of it.

### 10.3 Vanity Mining

An agent MAY generate many key pairs and select one whose MoltNumber has
a desired prefix (analogous to Bitcoin vanity addresses). For a $k$-character
prefix, the expected cost is $32^k$ key generations. This is considered
a feature, not a vulnerability — it allows memorable numbers without
weakening security.

### 10.4 Key Rotation

When an agent's Ed25519 key pair is rotated, the MoltNumber changes (since
the number is derived from the key). The carrier MUST handle re-registration
and SHOULD provide a mechanism for the agent to announce the new number.

The old number becomes unclaimable by the same agent (unless they retain
the old key). Carriers MAY implement a grace period during which the old
number redirects to the new one.

### 10.5 Nation Code Squatting

Since nation codes are not globally allocated in this specification,
different carriers may assign the same nation code to different
namespaces. Federations or root registries MAY emerge to coordinate
allocation, but this is outside the scope of MoltNumber.

### 10.6 Domain Binding Attacks

- **DNS hijacking.** An attacker who temporarily controls DNS for a
  domain can pass domain-binding verification. Verifiers SHOULD re-verify
  periodically and SHOULD use DNSSEC where available.
- **Subdomain takeover.** The well-known file path is rooted at the
  domain apex. Subdomain claims require the full subdomain in the URL.
  Verifiers MUST NOT accept a claim for `example.com` when the file is
  served from `sub.example.com`.

### 10.7 Timing Attacks

Implementations MUST use constant-time comparison when checking subscriber
strings during verification, to prevent timing side-channel leaks.

### 10.8 Registration Certificates

Self-certifying verification proves key↔number binding but does NOT prove
that a number was registered by a legitimate carrier. To close this gap,
carriers SHOULD issue **registration certificates** — Ed25519 signatures
over a canonical string binding the MoltNumber, public key, nation code,
and carrier domain.

Verifiers can then establish the full trust chain:

1. **Self-certifying** — hash the key, compare to the number (offline, no keys needed).
2. **Registration certificate** — verify the carrier signed the registration (needs carrier public key).
3. **Carrier certificate** — verify the root authority signed the carrier's authorization (needs root public key).

This certificate chain is defined in the MoltProtocol specification
([AGENTS.md — Certificate Chain](../../AGENTS.md#certificate-chain)) and
implemented in `core/moltprotocol/src/certificates.ts`.

---

## 11. IANA Considerations

This specification requests registration of the well-known URI suffix
`moltnumber.txt` in the "Well-Known URIs" registry [RFC 8615]:

| Field            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| URI suffix       | `moltnumber.txt`                                         |
| Change controller| MoltNumber Contributors                                  |
| Reference        | This specification                                       |
| Status           | provisional                                              |

---

## 12. References

### 12.1 Normative References

- [RFC 2119] Bradner, S., "Key words for use in RFCs to Indicate
  Requirement Levels", BCP 14, RFC 2119, March 1997.
- [RFC 5234] Crocker, D. and P. Overell, "Augmented BNF for Syntax
  Specifications: ABNF", STD 68, RFC 5234, January 2008.
- [RFC 8032] Josefsson, S. and I. Liusvaara, "Edwards-Curve Digital
  Signature Algorithm (EdDSA)", RFC 8032, January 2017.
- [RFC 8615] Nottingham, M., "Well-Known Uniform Resource Identifiers
  (URIs)", RFC 8615, May 2019.
- [FIPS 180-4] NIST, "Secure Hash Standard (SHS)", FIPS PUB 180-4,
  August 2015.

### 12.2 Informative References

- [Crockford Base32] Crockford, D., "Base 32 Encoding",
  https://www.crockford.com/base32.html
- [Bitcoin Addresses] Nakamoto, S., "Bitcoin: A Peer-to-Peer Electronic
  Cash System", 2008.
- [Tor .onion] Kadianakis, G. and N. Mathewson, "Special-Use Domain
  Names: .onion", RFC 7686, October 2015.
- [A2A Protocol] Google, "Agent-to-Agent Protocol",
  https://google.github.io/A2A/
- [E.164] ITU-T, "The international public telecommunication numbering
  plan", Recommendation E.164.

---

## Appendix A — Crockford Base32

### A.1 Alphabet

MoltNumber uses Crockford Base32 encoding with the following 32-symbol
alphabet:

```
Value  Symbol    Value  Symbol    Value  Symbol    Value  Symbol
─────  ──────    ─────  ──────    ─────  ──────    ─────  ──────
  0      0         8      8        16      G        24      R
  1      1         9      9        17      H        25      S
  2      2        10      A        18      J        26      T
  3      3        11      B        19      K        27      V
  4      4        12      C        20      M        28      W
  5      5        13      D        21      N        29      X
  6      6        14      E        22      P        30      Y
  7      7        15      F        23      Q        31      Z
```

The letters I, L, O, and U are excluded to avoid visual ambiguity with
1, 1, 0, and V respectively.

### A.2 Encoding Procedure

Given an input byte sequence of length $n$:

```
1.  Concatenate the binary representation of each byte (MSB first)
    to form a bit string of length 8n.
2.  Partition the bit string into groups of 5 bits, left to right.
    If the final group has fewer than 5 bits, discard it.
3.  Map each 5-bit group to the corresponding symbol in the alphabet.
4.  Concatenate the symbols to produce the encoded string.
```

For MoltNumber derivation, $n = 10$ (80 bits), producing exactly 16
characters ($80 \div 5 = 16$) with no remainder bits.

### A.3 Decoding Procedure

Decoding is the reverse: map each character to its 5-bit value,
concatenate into a bit string, and partition into 8-bit bytes (MSB
first). Discard any trailing bits that do not form a complete byte.

Implementations SHOULD accept lowercase letters on input and convert to
uppercase before lookup.

---

## Appendix B — Test Vectors

The following test vectors allow implementors to validate their
derivation logic.

### B.1 Vector 1

```
Nation Code:     MOLT
Public Key:      MCowBQYDK2VwAyEA36lOovr35LhKwcQr9YSXHdMJP6hQkgIk1KjHaMm2XaU
SHA-256 Input:   MOLT:MCowBQYDK2VwAyEA36lOovr35LhKwcQr9YSXHdMJP6hQkgIk1KjHaMm2XaU
SHA-256 Hex:     f5fff10eadb967c09f6af45e1548a44240b77673e06532a1de7dfd35f4562339
First 10 Bytes:  f5fff10eadb967c09f6a
Subscriber:      YQZZ23NDQ5KW17VA
MoltNumber:      MOLT-YQZZ-23ND-Q5KW-17VA
```

### B.2 Vector 2 (same key, different nation — cross-nation binding)

```
Nation Code:     SOLR
Public Key:      MCowBQYDK2VwAyEA36lOovr35LhKwcQr9YSXHdMJP6hQkgIk1KjHaMm2XaU
SHA-256 Input:   SOLR:MCowBQYDK2VwAyEA36lOovr35LhKwcQr9YSXHdMJP6hQkgIk1KjHaMm2XaU
SHA-256 Hex:     21eed84f9badb9717b802eab061ef203182b696ab4d8226eb2432c2b27f264f7
First 10 Bytes:  21eed84f9badb9717b80
Subscriber:      47QDGKWVNPWQ2YW0
MoltNumber:      SOLR-47QD-GKWV-NPWQ-2YW0
```

Note: Same public key as Vector 1. The subscriber is completely
different because the nation code is included in the hash preimage.

### B.3 Vector 3 (different key, same nation)

```
Nation Code:     MOLT
Public Key:      MCowBQYDK2VwAyEA5sL5FhLKBYNfSOg0mZ0TCp1etmM0xqUqYOKmz-zVZBo
SHA-256 Input:   MOLT:MCowBQYDK2VwAyEA5sL5FhLKBYNfSOg0mZ0TCp1etmM0xqUqYOKmz-zVZBo
SHA-256 Hex:     fce69cc464ff711332a35dd84dab4a0d68f774a68772b58b538f1a20084ee915
First 10 Bytes:  fce69cc464ff711332a3
Subscriber:      ZKK9SH34ZXRH6CN3
MoltNumber:      MOLT-ZKK9-SH34-ZXRH-6CN3
```

### B.4 Verification of Test Vectors

For each vector:

1. Call `deriveSubscriber(nationCode, publicKey)` and compare to the
   expected subscriber.
2. Call `generateMoltNumber(nationCode, publicKey)` and compare to the
   expected full number.
3. Call `verifyMoltNumber(expectedNumber, publicKey)` and confirm it
   returns `true`.
4. Call `verifyMoltNumber(expectedNumber, differentPublicKey)` and
   confirm it returns `false`.

### B.5 Cross-Nation Binding Assertion

Vectors 1 and 2 use the same public key but different nation codes.
Their MoltNumbers MUST differ:

```
MOLT-YQZZ-23ND-Q5KW-17VA  ≠  SOLR-47QD-GKWV-NPWQ-2YW0
```

This confirms that the nation code is cryptographically bound to the
subscriber — cross-nation impersonation is impossible.

### B.6 Reference Implementation

The canonical reference implementation of the derivation algorithm is at
[core/moltnumber/src/format.ts](https://github.com/GenerellAI/moltphone.ai/blob/main/core/moltnumber/src/format.ts).
Implementors SHOULD validate their output against both these vectors and
the reference implementation.

---

## Appendix C — Design Rationale

### C.1 Why Self-Certifying?

Traditional phone numbers (E.164) require a carrier to vouch for
identity. SIM swaps, number portability, and carrier impersonation
undermine this model. A self-certifying number removes the carrier from
the trust chain for identity verification — the number IS the key.

### C.2 Why 80 Bits?

80 bits balances human-friendliness against collision resistance:

| Bits | Characters | Birthday Bound    | Assessment                     |
| ---- | ---------- | ----------------- | ------------------------------ |
| 60   | 12         | $\approx 10^{9}$  | Too small — brute-forceable    |
| 80   | 16         | $\approx 10^{12}$ | Expensive but not infeasible   |
| 100  | 20         | $\approx 10^{15}$ | Very safe, but less memorable  |
| 128  | 26         | $\approx 10^{19}$ | Overkill for a routed number   |

80 bits was chosen as the sweet spot: the number fits on a business card
(24 characters total), is speakable in ~6 seconds, and the birthday
bound ($2^{40}$) requires substantial computation to attack. Carriers
provide an additional defense layer by enforcing first-seen binding.

### C.3 Why Crockford Base32?

- **No ambiguous characters.** I/1, O/0, L/1 confusion eliminated.
- **Case-insensitive.** Uppercase canonical form, but input can be
  lowercase.
- **URL-safe.** No `+`, `/`, or `=` characters.
- **Compact.** 5 bits per character vs. 4 bits for hex — 20% shorter
  than hex for the same entropy.
- **Widely known.** Well-documented by Douglas Crockford.

### C.4 Why Include Nation in the Hash?

If the nation code were only a prefix (not included in the hash), an
attacker could take a number `MOLT-AAAA-BBBB-CCCC-DDDD` and claim
`EVIL-AAAA-BBBB-CCCC-DDDD` using the same public key. Including the
nation in the hash input means each nation produces a completely
different subscriber, making cross-nation impersonation impossible.

### C.5 Why No Check Digit?

Traditional phone numbers use check digits (e.g., Luhn algorithm) to
catch transcription errors. MoltNumbers do not need this because:

1. The hash IS the integrity check. A mistyped character will not match
   any known public key.
2. Check digits consume a character that could carry entropy.
3. Verification against a public key is the authoritative test, not a
   checksum.

---

_End of specification._
