import { describe, expect, it } from 'vitest';
import { parseFilterQuery, matchesFilterQuery } from './textFilter';

describe('parseFilterQuery', () => {
    it('treats space-separated terms as AND', () => {
        const q = parseFilterQuery('player command');
        expect(q.include).toEqual(['player', 'command']);
        expect(q.isEmpty).toBe(false);
    });

    it('parses excludes and quoted phrases', () => {
        const q = parseFilterQuery('player -bot "ran command"');
        expect(q.include).toEqual(['player']);
        expect(q.exclude).toEqual(['bot']);
        expect(q.phrases).toEqual(['ran command']);
    });

    it('lowercases everything and reports empty', () => {
        expect(parseFilterQuery('   ').isEmpty).toBe(true);
        expect(parseFilterQuery('PlAyEr').include).toEqual(['player']);
    });
});

describe('matchesFilterQuery', () => {
    const line = '06:38 pm [chat] snipz ran command /tp for player 4'.toLowerCase();

    it('requires every include term', () => {
        expect(matchesFilterQuery(line, parseFilterQuery('player command'))).toBe(true);
        expect(matchesFilterQuery(line, parseFilterQuery('player missing'))).toBe(false);
    });

    it('honors excludes', () => {
        expect(matchesFilterQuery(line, parseFilterQuery('player -chat'))).toBe(false);
        expect(matchesFilterQuery(line, parseFilterQuery('player -banned'))).toBe(true);
    });

    it('honors quoted phrases', () => {
        expect(matchesFilterQuery(line, parseFilterQuery('"ran command"'))).toBe(true);
        expect(matchesFilterQuery(line, parseFilterQuery('"command ran"'))).toBe(false);
    });
});
