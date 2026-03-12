import { toWisprVocabCsv, toWisprCorrectionCsv, toLexiconJson } from '@/lib/lexicon-csv';

// Minimal entry shape for tests
type TestEntry = { type: 'vocabulary' | 'correction'; term: string; variant: string };

describe('lexicon-csv', () => {
  // ── toWisprVocabCsv ─────────────────────────────────

  describe('toWisprVocabCsv', () => {
    it('generates one term per line', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: 'MoltNumber', variant: '' },
        { type: 'vocabulary', term: 'MoltSIM', variant: '' },
      ];
      expect(toWisprVocabCsv(entries)).toBe('"MoltNumber"\n"MoltSIM"\n');
    });

    it('filters out correction entries', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: 'MoltPhone', variant: '' },
        { type: 'correction', term: 'MoltPhone', variant: 'moltfone' },
      ];
      expect(toWisprVocabCsv(entries)).toBe('"MoltPhone"\n');
    });

    it('deduplicates case-insensitively', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: 'MoltNumber', variant: '' },
        { type: 'vocabulary', term: 'moltnumber', variant: '' },
      ];
      expect(toWisprVocabCsv(entries)).toBe('"MoltNumber"\n');
    });

    it('returns empty string for no entries', () => {
      expect(toWisprVocabCsv([])).toBe('');
    });

    it('escapes formula-injection characters', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: '=cmd()', variant: '' },
        { type: 'vocabulary', term: '+exploit', variant: '' },
        { type: 'vocabulary', term: '-malicious', variant: '' },
        { type: 'vocabulary', term: '@attack', variant: '' },
      ];
      const csv = toWisprVocabCsv(entries);
      expect(csv).toContain("\"'=cmd()\"");
      expect(csv).toContain("\"'+exploit\"");
      expect(csv).toContain("\"'-malicious\"");
      expect(csv).toContain("\"'@attack\"");
    });

    it('escapes double quotes in terms', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: 'He said "hello"', variant: '' },
      ];
      expect(toWisprVocabCsv(entries)).toBe('"He said ""hello"""\n');
    });
  });

  // ── toWisprCorrectionCsv ────────────────────────────

  describe('toWisprCorrectionCsv', () => {
    it('generates misspelling,correction pairs', () => {
      const entries: TestEntry[] = [
        { type: 'correction', term: 'MoltNumber', variant: 'moltnumber' },
        { type: 'correction', term: 'MoltSIM', variant: 'moltsim' },
      ];
      expect(toWisprCorrectionCsv(entries)).toBe('"moltnumber","MoltNumber"\n"moltsim","MoltSIM"\n');
    });

    it('filters out vocabulary entries', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: 'MoltPhone', variant: '' },
        { type: 'correction', term: 'MoltPhone', variant: 'moltfone' },
      ];
      expect(toWisprCorrectionCsv(entries)).toBe('"moltfone","MoltPhone"\n');
    });

    it('deduplicates case-insensitively', () => {
      const entries: TestEntry[] = [
        { type: 'correction', term: 'MoltNumber', variant: 'moltnumber' },
        { type: 'correction', term: 'MoltNumber', variant: 'Moltnumber' },
      ];
      expect(toWisprCorrectionCsv(entries)).toBe('"moltnumber","MoltNumber"\n');
    });

    it('skips corrections without variant', () => {
      const entries: TestEntry[] = [
        { type: 'correction', term: 'MoltNumber', variant: '' },
      ];
      expect(toWisprCorrectionCsv(entries)).toBe('');
    });

    it('escapes formula injection in both columns', () => {
      const entries: TestEntry[] = [
        { type: 'correction', term: '=SUM(A1)', variant: '=exploit' },
      ];
      const csv = toWisprCorrectionCsv(entries);
      expect(csv).toContain("\"'=exploit\"");
      expect(csv).toContain("\"'=SUM(A1)\"");
    });
  });

  // ── toLexiconJson ───────────────────────────────────

  describe('toLexiconJson', () => {
    it('splits entries into vocabulary and corrections', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: 'MoltNumber', variant: '' },
        { type: 'vocabulary', term: 'MoltSIM', variant: '' },
        { type: 'correction', term: 'MoltPhone', variant: 'moltfone' },
      ];
      const result = toLexiconJson(entries);
      expect(result.vocabulary).toEqual(['MoltNumber', 'MoltSIM']);
      expect(result.corrections).toEqual([{ from: 'moltfone', to: 'MoltPhone' }]);
    });

    it('deduplicates', () => {
      const entries: TestEntry[] = [
        { type: 'vocabulary', term: 'MoltNumber', variant: '' },
        { type: 'vocabulary', term: 'moltnumber', variant: '' },
        { type: 'correction', term: 'MoltPhone', variant: 'moltfone' },
        { type: 'correction', term: 'MoltPhone', variant: 'Moltfone' },
      ];
      const result = toLexiconJson(entries);
      expect(result.vocabulary).toHaveLength(1);
      expect(result.corrections).toHaveLength(1);
    });

    it('returns empty arrays for no entries', () => {
      const result = toLexiconJson([]);
      expect(result).toEqual({ vocabulary: [], corrections: [] });
    });
  });
});
