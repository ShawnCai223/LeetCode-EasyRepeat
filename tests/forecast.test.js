const FC = require('../src/algorithms/forecast.js');

const today = new Date('2026-11-04T09:00:00');
const at = (offset, hour = 10) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
};
const prob = (ratings, extra = {}) => ({
    history: ratings.map(([offset, rating]) => ({ date: at(offset), rating })),
    nextReviewDate: at(10),
    ...extra
});

describe('can do', () => {
    test('last rating Good/Easy and not being reinforced', () => {
        expect(FC.canDo(prob([[-5, 1], [-2, 3]]))).toBe(true);
        expect(FC.canDo(prob([[-5, 3], [-2, 2]]))).toBe(false);
        expect(FC.canDo(prob([[-2, 3]], { reinforce: { mode: 'consolidate', step: 0 } }))).toBe(true);
        expect(FC.canDo(prob([[-2, 3]], { reinforce: { mode: 'relearn', step: 1 } }))).toBe(false);
        expect(FC.canDo(prob([[-2, 4]], { reinforce: { mode: 'queued' } }))).toBe(false);
        expect(FC.canDo(prob([]))).toBe(false);
    });

    test('steps left', () => {
        expect(FC.stepsLeft({ reinforce: { mode: 'relearn', step: 1 } })).toBe(2);
        expect(FC.stepsLeft({ reinforce: { mode: 'relearn', step: 5 } })).toBe(1);
        expect(FC.stepsLeft({ reinforce: { mode: 'intensive' } })).toBe(5);
        expect(FC.stepsLeft({ reinforce: { mode: 'queued' } })).toBe(3);
        expect(FC.stepsLeft({})).toBe(3);
    });
});

describe('expected reviews', () => {
    test('always good → one review per step', () => {
        expect(FC.expectedReviews(3, 1, 1)).toBeCloseTo(3, 6);
        expect(FC.expectedReviews(0, 0.5)).toBe(0);
    });

    test('one step at p: geometric 1/p', () => {
        expect(FC.expectedReviews(1, 0.5, 0.5)).toBeCloseTo(2, 6);
    });

    test('worse odds after a bad rating cost more', () => {
        const easy = FC.expectedReviews(3, 0.6, 0.8);
        const hard = FC.expectedReviews(3, 0.3, 0.8);
        expect(hard).toBeGreaterThan(easy);
        expect(easy).toBeGreaterThan(3);
    });
});

describe('transition rates', () => {
    test('defaults with too little history', () => {
        expect(FC.transitionRates({ a: prob([[-3, 1], [-2, 3]]) }, today)).toMatchObject({ pAfterBad: 0.4, pAfterGood: 0.75 });
    });

    test('measured from consecutive ratings in the last 90 days', () => {
        const problems = {};
        // 10 bad → good, 10 bad → bad, 10 good → good; plus old pairs that do not count.
        for (let i = 0; i < 10; i++) problems[`bg${i}`] = prob([[-10, 1], [-5, 3]]);
        for (let i = 0; i < 10; i++) problems[`bb${i}`] = prob([[-10, 2], [-5, 1]]);
        for (let i = 0; i < 10; i++) problems[`gg${i}`] = prob([[-10, 3], [-5, 4]]);
        problems.old = prob([[-200, 1], [-150, 1]]);
        const r = FC.transitionRates(problems, today);
        expect(r.pAfterBad).toBeCloseTo(0.5, 6);
        expect(r.pAfterGood).toBeCloseTo(0.95, 6); // 100% clamped
    });
});

describe('estimate', () => {
    test('only problems first done before today count; all can-do → done', () => {
        const problems = { a: prob([[-5, 3]]), b: prob([[0, 1]]) };
        expect(FC.estimateClearDays(problems, today, 10)).toMatchObject({ target: 1, done: 1, todo: 0, days: 0 });
    });

    test('more reviews a day → sooner; never under the 11-day calendar floor', () => {
        const problems = {};
        for (let i = 0; i < 40; i++) problems[`w${i}`] = prob([[-20, 3], [-3, 1]], { reinforce: { mode: 'relearn', step: 0 } });
        for (let i = 0; i < 40; i++) problems[`f${i}`] = prob([[-40, 3], [-10, 3]]);
        const slow = FC.estimateClearDays(problems, today, 8);
        const fast = FC.estimateClearDays(problems, today, 30);
        expect(slow).toMatchObject({ target: 80, done: 40, todo: 40, enough: true });
        expect(fast.days).toBeLessThan(slow.days);
        expect(FC.estimateClearDays(problems, today, 1000).days).toBe(11);
        expect(slow.reviewsFor30).toBeGreaterThanOrEqual(slow.reviewsFor90);
        expect(slow.date > '2026-11-04').toBe(true);
    });

    test('not enough to even keep the known ones → no date', () => {
        const problems = {};
        for (let i = 0; i < 5; i++) problems[`w${i}`] = prob([[-20, 1]]);
        // 60 known problems due every 2 days → ~30+ reviews a day of upkeep.
        for (let i = 0; i < 60; i++) problems[`f${i}`] = prob([[-30, 3], [-1, 3]], { nextReviewDate: at(1) });
        const r = FC.estimateClearDays(problems, today, 10);
        expect(r).toMatchObject({ todo: 5, enough: false, days: null, date: null });
        expect(r.reviewsFor90).toBeGreaterThan(10);
    });
});
