const S = require('../src/algorithms/schedule.js');

const now = new Date('2026-11-04T10:00:00');
const days = (iso) => Math.round((new Date(iso) - now) / 864e5);
const TOUGH = 1, FINE = 3, EASY = 4;

// Rate a sequence of tiers, one per day, starting from `problem`.
function walk(problem, ratings) {
    let p = { ...problem };
    const out = [];
    for (const r of ratings) {
        const res = S.apply(p, r, now);
        p = { ...p, sched: res.sched };
        out.push({ mode: res.sched.mode, gap: res.gap });
    }
    return out;
}

describe('three tiers', () => {
    test('old Hard counts as tough', () => {
        expect(S.tier(2)).toBe('tough');
        expect(S.tier(1)).toBe('tough');
        expect(S.tier(3)).toBe('fine');
        expect(S.tier(4)).toBe('easy');
    });

    test('tough → every day until not tough, then one confirm day, then normal', () => {
        expect(walk({}, [TOUGH, TOUGH, FINE, EASY])).toEqual([
            { mode: 'daily', gap: 1 },
            { mode: 'daily', gap: 1 },
            { mode: 'confirm', gap: 1 },
            { mode: 'normal', gap: 3 }
        ]);
    });

    test('tough on the confirm day starts daily practice again', () => {
        expect(walk({}, [TOUGH, EASY, TOUGH]).map(x => x.mode)).toEqual(['daily', 'confirm', 'daily']);
    });

    test('confirm day rated fine → back to normal, in 2 days', () => {
        expect(walk({}, [TOUGH, FINE, FINE])).toEqual([
            { mode: 'daily', gap: 1 }, { mode: 'confirm', gap: 1 }, { mode: 'normal', gap: 2 }
        ]);
    });

    test('fine → 2 days; easy → 3, 7, 15, 30, 60, 60', () => {
        expect(walk({ sched: { mode: 'normal', rung: 0 } }, [FINE])).toEqual([{ mode: 'normal', gap: 2 }]);
        expect(walk({ sched: { mode: 'normal', rung: 0 } }, [EASY, EASY, EASY, EASY, EASY, EASY]).map(x => x.gap))
            .toEqual([3, 7, 15, 30, 60, 60]);
    });

    test('fine steps the easy gap back one rung', () => {
        expect(walk({ sched: { mode: 'normal', rung: 0 } }, [EASY, EASY, EASY, FINE, EASY]).map(x => x.gap))
            .toEqual([3, 7, 15, 2, 15]);
    });

    test('daily practice keeps the day it started', () => {
        const first = S.apply({}, TOUGH, now);
        const later = S.apply({ sched: first.sched }, TOUGH, new Date('2026-11-05T10:00:00'));
        expect(later.sched.since).toBe(first.sched.since);
    });

    test('review date and interval', () => {
        const f = S.fields({}, EASY, now);
        expect(days(f.nextReviewDate)).toBe(3);
        expect(f.interval).toBe(3);
        expect(f.relearn).toBeUndefined();
        expect(S.fields({}, 0, now)).toEqual({});
    });
});

describe('existing problems', () => {
    test('older relearn data: step 0 → daily, step 1 → confirm, step 2 → normal', () => {
        expect(S.stateOf({ relearn: { step: 0 } }).mode).toBe('daily');
        expect(S.stateOf({ relearn: { step: 1 } }).mode).toBe('confirm');
        expect(S.stateOf({ relearn: { step: 2 } }).mode).toBe('normal');
        expect(S.stateOf({ reinforce: { mode: 'intensive' } }).mode).toBe('daily');
        expect(S.stateOf({ reinforce: { mode: 'queued' } }).mode).toBe('normal');
    });

    test('no stored state: the next easy gap follows the current one', () => {
        const p = (gap) => ({ interval: gap, history: [{ date: '2026-10-01T10:00:00Z', rating: 3 }], nextReviewDate: new Date(Date.parse('2026-10-01T10:00:00Z') + gap * 864e5).toISOString() });
        expect(S.apply(p(1), EASY, now).gap).toBe(3);
        expect(S.apply(p(20), EASY, now).gap).toBe(30);
        expect(S.apply(p(100), EASY, now).gap).toBe(60);
    });

    test('can do = last rating not tough and not in daily practice / confirm', () => {
        const h = (r) => [{ date: '2026-11-01T10:00:00Z', rating: r }];
        expect(S.canDo({ history: h(3) })).toBe(true);
        expect(S.canDo({ history: h(2) })).toBe(false);
        expect(S.canDo({ history: h(4), sched: { mode: 'confirm', rung: 0 } })).toBe(false);
        expect(S.phase({ sched: { mode: 'daily', rung: 0 } })).toBe('daily');
        expect(S.phase({})).toBeNull();
    });
});
