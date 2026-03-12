/**
 * Lexicon Pack — CSV export utilities.
 *
 * Supports two Wispr-compatible formats:
 *   1. Vocabulary CSV (1-column): one canonical term per line
 *   2. Corrections CSV (2-column): misspelling,correction
 *
 * Safety rules applied to all exports:
 *   - Deduplicate entries
 *   - Escape CSV formula injection (=, +, -, @, \t, \r)
 *   - Proper RFC 4180 quoting
 */

/** Minimal shape for lexicon entries used in exports. */
export interface LexiconEntryLike {
  type: 'vocabulary' | 'correction';
  term: string;
  variant?: string;
}

// ── CSV Safety ──────────────────────────────────────────

/** Characters that trigger formula execution in spreadsheet software. */
const FORMULA_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * Escape a value for safe CSV inclusion.
 * - Prefixes formula-triggering chars with a single quote (Excel/Sheets convention)
 * - Wraps in double quotes if the value contains commas, quotes, or newlines
 */
function escapeCsvValue(value: string): string {
  let v = value.trim();
  if (v.length > 0 && FORMULA_CHARS.has(v[0])) {
    v = `'${v}`;
  }
  // Always quote to be safe
  return `"${v.replace(/"/g, '""')}"`;
}

// ── Export Functions ─────────────────────────────────────

/**
 * Generate Wispr-compatible 1-column vocabulary CSV.
 * One canonical term per line, no header.
 */
export function toWisprVocabCsv(entries: LexiconEntryLike[]): string {
  const vocabEntries = entries.filter(e => e.type === 'vocabulary');
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const entry of vocabEntries) {
    const key = entry.term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(escapeCsvValue(entry.term));
  }

  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

/**
 * Generate Wispr-compatible 2-column corrections CSV.
 * Each line: misspelling,correction (no header).
 */
export function toWisprCorrectionCsv(entries: LexiconEntryLike[]): string {
  const corrections = entries.filter(e => e.type === 'correction' && e.variant);
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const entry of corrections) {
    const key = `${entry.variant!.toLowerCase()}→${entry.term.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`${escapeCsvValue(entry.variant!)},${escapeCsvValue(entry.term)}`);
  }

  return lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

/**
 * Generate a combined JSON export of all lexicon entries.
 */
export function toLexiconJson(entries: LexiconEntryLike[]): {
  vocabulary: string[];
  corrections: { from: string; to: string }[];
} {
  const vocabSeen = new Set<string>();
  const corrSeen = new Set<string>();

  const vocabulary: string[] = [];
  const corrections: { from: string; to: string }[] = [];

  for (const entry of entries) {
    if (entry.type === 'vocabulary') {
      const key = entry.term.toLowerCase();
      if (!vocabSeen.has(key)) {
        vocabSeen.add(key);
        vocabulary.push(entry.term);
      }
    } else if (entry.type === 'correction' && entry.variant) {
      const key = `${entry.variant.toLowerCase()}→${entry.term.toLowerCase()}`;
      if (!corrSeen.has(key)) {
        corrSeen.add(key);
        corrections.push({ from: entry.variant, to: entry.term });
      }
    }
  }

  return { vocabulary, corrections };
}
