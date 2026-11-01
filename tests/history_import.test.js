const HI = require('../src/shared/history_import.js');

const e = (date, rating) => ({ date, rating, status: 'Accepted' });

describe('parseBackup', () => {
    test('accepts v2 envelope, v1 envelope and raw storage', () => {
        const problems = { a: { slug: 'a', history: [] } };
        expect(HI.parseBackup({ data: { problems }, indexedDBData: {} }).problems).toBe(problems);
        expect(HI.parseBackup({ data: { problems } }).problems).toBe(problems);
        expect(HI.parseBackup({ problems }).problems).toBe(problems);
    });

    test('rejects files without problems', () => {
        expect(() => HI.parseBackup({ data: { theme: 'x' } })).toThrow('no_problems');
        expect(() => HI.parseBackup([1, 2])).toThrow();
    });
});

describe('mergeReviewData', () => {
    const current = {
        problems: {
            a: {
                slug: 'a', title: 'A', difficulty: 'Easy', notes: 'mine', topics: ['Array'],
                history: [e('2026-10-01T10:00:00.000Z', 3), e('2026-10-05T10:00:00.000Z', 2)],
                nextReviewDate: '2026-10-06T10:00:00.000Z', fsrs_stability: 1.5,
                reinforce: { mode: 'relearn', step: 0 }
            },
            b: { slug: 'b', history: [e('2026-10-10T10:00:00.000Z', 4)], nextReviewDate: '2026-11-10T10:00:00.000Z' }
        },
        activityLog: ['2026-10-01', '2026-10-05'],
        localizedProblemTitles: { a: { zh: '甲' } }
    };

    test('new problems are added, histories unioned, newest schedule wins', () => {
        const incoming = {
            problems: {
                a: {
                    slug: 'a', notes: 'theirs', topics: ['Hash Table'],
                    history: [e('2026-10-01T10:00:00.000Z', 3), e('2026-10-20T10:00:00.000Z', 4)],
                    nextReviewDate: '2026-12-01T10:00:00.000Z', fsrs_stability: 30
                },
                b: { slug: 'b', history: [e('2026-09-01T10:00:00.000Z', 1)], nextReviewDate: '2026-09-02T10:00:00.000Z' },
                c: { slug: 'c', history: [e('2026-10-03T10:00:00.000Z', 3)] }
            },
            activityLog: ['2026-09-01'],
            localizedProblemTitles: { a: { zh: 'X' }, c: { zh: '丙' } }
        };
        const out = HI.mergeReviewData(current, incoming);

        // a: 3 entries, schedule from incoming (newer), reinforce removed since incoming has none
        expect(out.problems.a.history.map(h => h.date)).toEqual([
            '2026-10-01T10:00:00.000Z', '2026-10-05T10:00:00.000Z', '2026-10-20T10:00:00.000Z'
        ]);
        expect(out.problems.a.nextReviewDate).toBe('2026-12-01T10:00:00.000Z');
        expect(out.problems.a.fsrs_stability).toBe(30);
        expect(out.problems.a.reinforce).toBeUndefined();
        expect(out.problems.a.notes).toContain('mine');
        expect(out.problems.a.notes).toContain('theirs');
        expect(out.problems.a.topics).toEqual(['Array', 'Hash Table']);
        expect(out.problems.a.title).toBe('A');

        // b: older imported review added, but current (newer) schedule kept
        expect(out.problems.b.history).toHaveLength(2);
        expect(out.problems.b.nextReviewDate).toBe('2026-11-10T10:00:00.000Z');

        // c: new
        expect(out.problems.c.slug).toBe('c');

        expect(out.stats).toMatchObject({ added: 1, merged: 2, historyAdded: 3, notesAppended: 1, titlesAdded: 1 });
        expect(out.activityLog).toEqual(expect.arrayContaining(['2026-09-01', '2026-10-01', '2026-10-05']));
        expect(out.localizedProblemTitles.a.zh).toBe('甲'); // existing title kept

        // inputs untouched
        expect(current.problems.a.history).toHaveLength(2);
        expect(current.problems.a.notes).toBe('mine');
    });

    test('importing the same data twice changes nothing', () => {
        const once = HI.mergeReviewData({ problems: {}, activityLog: [] }, current);
        const twice = HI.mergeReviewData(once, current);
        expect(twice.stats).toMatchObject({ added: 0, merged: 0, historyAdded: 0, activityAdded: 0 });
        expect(twice.stats.unchanged).toBe(2);
    });

    test('invalid entries are skipped, bad dates dropped', () => {
        const out = HI.mergeReviewData({ problems: {} }, {
            problems: {
                bad: 'nope',
                nohist: { slug: 'nohist' },
                ok: { slug: 'ok', history: [e('not a date', 3), e('2026-10-01T10:00:00Z', 3)] }
            }
        });
        expect(out.stats.skipped).toBe(2);
        expect(out.problems.ok.history).toHaveLength(1);
    });

    test('prepareProblem hook runs on new and updated problems', () => {
        const seen = [];
        HI.mergeReviewData(current, { problems: { c: { slug: 'c', history: [e('2026-10-03T10:00:00Z', 1)] } } }, {
            prepareProblem: (p) => { seen.push(p.slug); return p; }
        });
        expect(seen).toEqual(['c']);
    });
});
