const R = require('../src/algorithms/reinforcement.js');

// Local times (tests run with TZ set by the caller or the machine default).
const at = (s) => new Date(s);
const h = (date, rating) => ({ date: at(date).toISOString(), rating, status: 'Accepted' });
const dayKey = (d) => R.toKey(new Date(d));

describe('streaks', () => {
    test('weak streak counts trailing ratings <= 2', () => {
        expect(R.weakStreak([h('2026-10-01T10:00', 3), h('2026-10-02T10:00', 2), h('2026-10-03T10:00', 1)])).toBe(2);
        expect(R.weakStreak([h('2026-10-01T10:00', 1), h('2026-10-02T10:00', 4)])).toBe(0);
        expect(R.weakStreak([])).toBe(0);
    });

    test('order is by date, not array order', () => {
        const hist = [h('2026-10-03T10:00', 2), h('2026-10-01T10:00', 3), h('2026-10-02T10:00', 1)];
        expect(R.weakStreak(hist)).toBe(2);
    });

    test('intensive target: 3 when last three are all Again or streak >= 5', () => {
        const twoTimes = [h('2026-10-01T10:00', 2), h('2026-10-02T10:00', 1), h('2026-10-03T10:00', 2)];
        const allAgain = [h('2026-10-01T10:00', 1), h('2026-10-02T10:00', 1), h('2026-10-03T10:00', 1)];
        const five = [1, 2, 2, 1, 2].map((r, i) => h(`2026-10-0${i + 1}T10:00`, r));
        expect(R.intensiveTarget(twoTimes)).toBe(2);
        expect(R.intensiveTarget(allAgain)).toBe(3);
        expect(R.intensiveTarget(five)).toBe(3);
    });
});

describe('scheduleAfterReview', () => {
    const fsrsLate = '2026-11-20T10:00:00.000Z';

    test('one bad rating after a good history -> relearn, 1 day, overriding FSRS', () => {
        const problem = { slug: 'p', history: [h('2026-10-01T10:00', 3), h('2026-10-10T10:00', 4)] };
        const now = at('2026-10-20T10:00');
        const r = R.scheduleAfterReview({ problem, rating: 2, now, fsrsNextReviewDate: fsrsLate });
        expect(r.reinforce).toMatchObject({ mode: 'relearn', step: 0 });
        expect(dayKey(r.nextReviewDate)).toBe('2026-10-21');
    });

    test('relearn steps 1 -> 3 -> 7 days, then back to FSRS', () => {
        let problem = { slug: 'p', history: [h('2026-10-01T10:00', 1)], reinforce: { mode: 'relearn', step: 0 } };
        let now = at('2026-10-02T10:00');
        let r = R.scheduleAfterReview({ problem, rating: 3, now, fsrsNextReviewDate: fsrsLate });
        expect(r.reinforce.step).toBe(1);
        expect(dayKey(r.nextReviewDate)).toBe('2026-10-05');

        problem = { ...problem, reinforce: r.reinforce, history: [...problem.history, h('2026-10-02T10:00', 3)] };
        now = at('2026-10-05T10:00');
        r = R.scheduleAfterReview({ problem, rating: 3, now, fsrsNextReviewDate: fsrsLate });
        expect(r.reinforce.step).toBe(2);
        expect(dayKey(r.nextReviewDate)).toBe('2026-10-12');

        problem = { ...problem, reinforce: r.reinforce, history: [...problem.history, h('2026-10-05T10:00', 3)] };
        r = R.scheduleAfterReview({ problem, rating: 4, now: at('2026-10-12T10:00'), fsrsNextReviewDate: fsrsLate });
        expect(r.reinforce).toBe(null);
        expect(r.nextReviewDate).toBe(fsrsLate);
    });

    test('relearn never schedules later than FSRS', () => {
        const problem = { slug: 'p', history: [h('2026-10-01T10:00', 3)] };
        const fsrsSoon = at('2026-10-20T18:00').toISOString();
        const r = R.scheduleAfterReview({ problem, rating: 2, now: at('2026-10-20T10:00'), fsrsNextReviewDate: fsrsSoon });
        expect(r.nextReviewDate).toBe(fsrsSoon);
    });

    test('3rd weak rating in a row -> intensive, next practice 3h later same day', () => {
        const problem = { slug: 'p', history: [h('2026-10-18T10:00', 2), h('2026-10-19T10:00', 1)] };
        const now = at('2026-10-20T10:00');
        const r = R.scheduleAfterReview({ problem, rating: 2, now, fsrsNextReviewDate: fsrsLate, intensiveSlugs: [] });
        expect(r.reinforce).toMatchObject({ mode: 'intensive', intraday: true, goodStreak: 0 });
        expect(r.joinedIntensive).toBe(true);
        expect(new Date(r.nextReviewDate).getTime() - now.getTime()).toBe(3 * 3600 * 1000);
    });

    test('pool full -> stubborn problem waits in relearn', () => {
        const problem = { slug: 'p', history: [h('2026-10-18T10:00', 2), h('2026-10-19T10:00', 1)] };
        const r = R.scheduleAfterReview({ problem, rating: 1, now: at('2026-10-20T10:00'), fsrsNextReviewDate: fsrsLate, intensiveSlugs: ['a', 'b', 'c'], poolSize: 3 });
        expect(r.reinforce.mode).toBe('relearn');
        expect(r.joinedIntensive).toBe(false);
    });

    test('pool size 0 disables multi-practice', () => {
        const problem = { slug: 'p', history: [h('2026-10-18T10:00', 2), h('2026-10-19T10:00', 1)] };
        const r = R.scheduleAfterReview({ problem, rating: 1, now: at('2026-10-20T10:00'), fsrsNextReviewDate: fsrsLate, intensiveSlugs: [], poolSize: 0 });
        expect(r.reinforce.mode).toBe('relearn');
    });

    test('daily target reached -> next intensive practice tomorrow', () => {
        const problem = {
            slug: 'p',
            reinforce: { mode: 'intensive', goodStreak: 0, intraday: true },
            history: [h('2026-10-18T10:00', 2), h('2026-10-19T10:00', 2), h('2026-10-20T09:00', 2)]
        };
        // 2nd practice today, target 2 -> tomorrow
        const r = R.scheduleAfterReview({ problem, rating: 2, now: at('2026-10-20T12:00'), fsrsNextReviewDate: fsrsLate, intensiveSlugs: ['p'] });
        expect(r.reinforce.intraday).toBe(false);
        expect(dayKey(r.nextReviewDate)).toBe('2026-10-21');
    });

    test('no same-day practice scheduled after 23:00', () => {
        const problem = { slug: 'p', history: [h('2026-10-18T10:00', 2), h('2026-10-19T10:00', 1)] };
        const r = R.scheduleAfterReview({ problem, rating: 1, now: at('2026-10-20T21:30'), fsrsNextReviewDate: fsrsLate, intensiveSlugs: [] });
        expect(r.reinforce.mode).toBe('intensive');
        expect(r.reinforce.intraday).toBe(false);
        expect(dayKey(r.nextReviewDate)).toBe('2026-10-21');
    });

    test('intensive exits after two good ratings in a row, into relearn', () => {
        const base = { slug: 'p', history: [h('2026-10-18T10:00', 2), h('2026-10-19T10:00', 1), h('2026-10-20T10:00', 1)] };
        let problem = { ...base, reinforce: { mode: 'intensive', goodStreak: 0, intraday: true } };
        let r = R.scheduleAfterReview({ problem, rating: 3, now: at('2026-10-20T13:00'), fsrsNextReviewDate: fsrsLate, intensiveSlugs: ['p'] });
        expect(r.reinforce).toMatchObject({ mode: 'intensive', goodStreak: 1 });

        problem = { ...problem, reinforce: r.reinforce, history: [...base.history, h('2026-10-20T13:00', 3)] };
        r = R.scheduleAfterReview({ problem, rating: 4, now: at('2026-10-21T10:00'), fsrsNextReviewDate: fsrsLate, intensiveSlugs: ['p'] });
        expect(r.reinforce.mode).toBe('relearn');
        expect(r.leftIntensive).toBe(true);
        expect(dayKey(r.nextReviewDate)).toBe('2026-10-22');
    });

    test('a bad rating while intensive keeps it intensive and resets the good streak', () => {
        const problem = { slug: 'p', reinforce: { mode: 'intensive', goodStreak: 1, intraday: true, since: 'x' }, history: [h('2026-10-18T10:00', 1), h('2026-10-19T10:00', 1), h('2026-10-20T08:00', 1), h('2026-10-20T11:00', 3)] };
        const r = R.scheduleAfterReview({ problem, rating: 2, now: at('2026-10-21T10:00'), fsrsNextReviewDate: fsrsLate, intensiveSlugs: ['p'] });
        expect(r.reinforce).toMatchObject({ mode: 'intensive', goodStreak: 0, since: 'x' });
        expect(r.leftIntensive).toBe(false);
    });

    test('plain good review without reinforcement keeps FSRS date', () => {
        const r = R.scheduleAfterReview({ problem: { slug: 'p', history: [] }, rating: 3, now: at('2026-10-20T10:00'), fsrsNextReviewDate: fsrsLate });
        expect(r).toMatchObject({ nextReviewDate: fsrsLate, reinforce: null });
    });
});

describe('same-day review and setup helpers', () => {
    test('same-day review allowed only for a due intensive practice', () => {
        const due = { reinforce: { mode: 'intensive', intraday: true }, nextReviewDate: at('2026-10-20T13:00').toISOString() };
        expect(R.allowsSameDayReview(due, at('2026-10-20T13:05'))).toBe(true);
        expect(R.allowsSameDayReview(due, at('2026-10-20T12:00'))).toBe(false);
        expect(R.allowsSameDayReview({ ...due, reinforce: { mode: 'relearn' } }, at('2026-10-20T14:00'))).toBe(false);
    });

    test('bootstrap starts relearn for last rating <= 2 only', () => {
        const weak = { slug: 'w', nextReviewDate: at('2026-11-30T10:00').toISOString(), history: [h('2026-10-01T10:00', 4), h('2026-10-20T10:00', 2)] };
        const fine = { slug: 'f', nextReviewDate: at('2026-11-30T10:00').toISOString(), history: [h('2026-10-20T10:00', 3)] };
        const b = R.bootstrapProblem(weak);
        expect(b.reinforce.mode).toBe('relearn');
        expect(dayKey(b.nextReviewDate)).toBe('2026-10-21');
        expect(R.bootstrapProblem(fine)).toBe(fine);
        expect(R.bootstrapProblem(b)).toBe(b); // idempotent
    });

    test('pool keeps current intensive problems and fills with the most stubborn', () => {
        const mk = (slug, ratings, extra = {}) => ({ slug, difficulty: 'Medium', history: ratings.map((r, i) => h(`2026-10-1${i}T10:00`, r)), ...extra });
        const problems = {
            cur: mk('cur', [3], { reinforce: { mode: 'intensive' } }),
            s3: mk('s3', [2, 1, 2]),
            s5: mk('s5', [1, 1, 2, 1, 2]),
            s4hard: mk('s4hard', [2, 2, 2, 1], { difficulty: 'Hard' }),
            ok: mk('ok', [1, 1, 3])
        };
        const { pool, promoted } = R.selectIntensivePool(problems, 3);
        expect(pool).toEqual(['cur', 's5', 's4hard']);
        expect(promoted).toEqual(['s5', 's4hard']);
    });
});
