const DR = require('../src/algorithms/daily_reviews.js');
const S = require('../src/algorithms/schedule.js');

const today = new Date('2026-11-04T09:00:00');
const at = (offset, hour = 10) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
};
const key = (offset) => DR.toKey(new Date(at(offset)));
const reviewed = (offsets) => ({ history: [{ date: at(-40), rating: 3 }, ...offsets.map(o => ({ date: at(o), rating: 3 }))] });
// n problems reviewed on each of the given day offsets
const reviewsOnDays = (n, offsets) => {
    const map = {};
    offsets.forEach((o, i) => { for (let k = 0; k < n; k++) map[`p${i}-${k}`] = reviewed([o]); });
    return map;
};

describe('counting reviews', () => {
    test('first attempts and same-day repeats are not reviews', () => {
        const problems = {
            a: reviewed([-1]),
            b: { history: [{ date: at(-1), rating: 2 }, { date: at(-1, 15), rating: 3 }] },
            c: { history: [{ date: at(-5), rating: 1 }, { date: at(-1), rating: 1 }, { date: at(-1, 15), rating: 3 }] }
        };
        expect(DR.reviewsOn(problems, key(-1))).toBe(2);
    });

    test('pace = average on the days you reviewed (skipped days ignored)', () => {
        const problems = reviewsOnDays(12, [-1, -5, -9]);
        expect(DR.reviewPace(problems, today)).toEqual({ avg: 12, activeDays: 3 });
    });
});

describe("today's number", () => {
    test('starts from the pace, or 8 with no history; bounded by the maximum', () => {
        expect(DR.today({}, today, null, null)).toMatchObject({ target: 8, max: 15, changed: true });
        expect(DR.today(reviewsOnDays(12, [-1, -3]), today, null, null).target).toBe(12);
        expect(DR.today(reviewsOnDays(28, [-1, -3]), today, null, null).target).toBe(15);
        expect(DR.today(reviewsOnDays(28, [-1, -3]), today, null, { max: 20 }).target).toBe(20);
    });

    test('+1 after a day you finished, unchanged otherwise', () => {
        const state = { algo: 'ramp1', date: key(-2), target: 10 };
        expect(DR.today(reviewsOnDays(10, [-2]), today, state, null)).toMatchObject({ target: 11, changed: true });
        expect(DR.today(reviewsOnDays(6, [-2]), today, state, null).target).toBe(10);
        expect(DR.today(reviewsOnDays(15, [-2]), today, { ...state, target: 15 }, null).target).toBe(15);
    });

    test('computed once a day; a lower maximum applies right away', () => {
        const state = { algo: 'ramp1', date: key(0), target: 12 };
        expect(DR.today({}, today, state, null)).toMatchObject({ target: 12, changed: false });
        expect(DR.today({}, today, state, { max: 8 }).target).toBe(8);
    });

    test('state from the older algorithm starts over from the pace; older `fixed` reads as the maximum', () => {
        expect(DR.today(reviewsOnDays(9, [-1]), today, { algo: 'load14', date: key(0), recommended: 29 }, null).target).toBe(9);
        expect(DR.maxOf({ fixed: 10 })).toBe(10);
        expect(DR.maxOf({ max: 99 })).toBe(15);
    });
});

describe('split', () => {
    const P = (slug, offset, sched) => ({ slug, nextReviewDate: at(offset), ...(sched ? { sched } : {}) });

    test('daily practice (at most 5, oldest first), then confirm, then longest overdue', () => {
        const due = [
            P('n-old', -6), P('n-new', 0), P('c1', 0, { mode: 'confirm', rung: 0 }),
            ...[1, 2, 3, 4, 5, 6].map(i => P(`d${i}`, 0, { mode: 'daily', rung: 0, since: at(-i) }))
        ];
        const s = DR.split(due, 20, S.phase);
        expect(s.today.map(p => p.slug)).toEqual(['d6', 'd5', 'd4', 'd3', 'd2', 'c1', 'n-old', 'n-new']);
        expect(s.restCount).toBe(1);
    });

    test('at most 5 confirm-day problems before the normal ones; the rest only if there is room', () => {
        const due = [P('n1', -1), ...[1, 2, 3, 4, 5, 6, 7].map(i => P(`c${i}`, -8 + i, { mode: 'confirm', rung: 0 }))];
        expect(DR.split(due, 6, S.phase).today.map(p => p.slug)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'n1']);
        expect(DR.split(due, 8, S.phase).today.map(p => p.slug)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'n1', 'c6', 'c7']);
    });

    test('cut to what is left for today', () => {
        const due = [P('a', -3), P('b', -2), P('c', -1)];
        expect(DR.split(due, 2, S.phase).today.map(p => p.slug)).toEqual(['a', 'b']);
        expect(DR.split(due, -1, S.phase).today).toEqual([]);
    });
});
