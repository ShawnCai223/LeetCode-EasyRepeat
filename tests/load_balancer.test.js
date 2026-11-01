const LB = require('../src/algorithms/load_balancer.js');

const today = new Date('2026-11-04T09:00:00'); // local
const dayAt = (offset, hour = 10) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    d.setHours(hour, 0, 0, 0);
    return d;
};
let n = 0;
const mk = (difficulty, dueOffset, extra = {}) => {
    n++;
    const slug = extra.slug || `p${n}`;
    return {
        slug,
        difficulty,
        interval: 10,
        fsrs_stability: 10,
        fsrs_last_review: dayAt(dueOffset - 10).toISOString(),
        nextReviewDate: dayAt(dueOffset).toISOString(),
        history: [],
        ...extra
    };
};
const toMap = (list) => Object.fromEntries(list.map(p => [p.slug, p]));

describe('capacity (budget from real pace)', () => {
    const solved = (offsets, difficulty = 'Medium', slug) => mk(difficulty, 30, { slug, history: offsets.map(o => ({ date: dayAt(o).toISOString(), rating: 3 })) });

    test('new user (< 5 active days) gets the default of 3 problems a day', () => {
        const problems = toMap([solved([-1, -2], 'Medium', 'a'), solved([-3], 'Medium', 'b')]);
        expect(LB.computeCapacity(problems, today, {})).toBe(6); // 3 × average weight 2
    });

    test('average load of the last 14 active days, today excluded', () => {
        const list = [];
        for (let i = 1; i <= 20; i++) list.push(solved([-i], 'Medium', `m${i}`), solved([-i], 'Hard', `h${i}`)); // 5 a day
        list.push(solved([0, 0, 0], 'Hard', 'today')); // today does not count
        expect(LB.computeCapacity(toMap(list), today, {})).toBe(5);
    });

    test('rest days do not lower the budget', () => {
        const list = [];
        for (let i = 1; i <= 10; i++) list.push(solved([-3 * i], 'Medium', `m${i}`), solved([-3 * i], 'Medium', `n${i}`)); // 4 on every 3rd day
        expect(LB.computeCapacity(toMap(list), today, {})).toBe(4);
    });

    test('automatic budget only goes up; multi-practice and same-day repeats do not count', () => {
        const list = [];
        for (let i = 1; i <= 14; i++) list.push(solved([-i], 'Medium', `m${i}`)); // 2 a day
        list.push(mk('Hard', 3, { slug: 'x', history: [-1, -2, -3].map(o => ({ date: dayAt(o, 9).toISOString(), rating: 1, extra: true })) }));
        list.push(mk('Hard', 3, { slug: 'rep', history: [{ date: dayAt(-1, 9).toISOString(), rating: 1 }, { date: dayAt(-1, 15).toISOString(), rating: 3 }] }));
        const problems = toMap(list);
        // day -1: 2 + 3 (rep once) = 5, others 2 → (5 + 13×2) / 14 = 2.2 → 3 (minimum)
        expect(LB.computeCapacity(problems, today, {})).toBe(3);
        expect(LB.computeCapacity(problems, today, {}, {}, 8)).toBe(8); // never below yesterday's automatic budget
        expect(LB.computeCapacity(problems, today, { dailyProblems: 2 }, {}, 8)).toBe(Math.round(2 * LB.averageWeight(problems))); // a fixed setting can lower it
    });

    test('a fixed "problems a day" setting wins', () => {
        const problems = toMap([solved([-1], 'Easy', 'e'), solved([-1], 'Hard', 'h')]); // average weight 2
        expect(LB.computeCapacity(problems, today, { dailyProblems: 5 })).toBe(10);
    });
});

describe('queue admission and new-problem advice', () => {
    const inRotation = (slug, gapDays, difficulty = 'Medium') => mk(difficulty, gapDays, { slug, history: [{ date: dayAt(0).toISOString(), rating: 3 }] });
    const queued = (slug, ratings, lastOffset) => mk('Medium', 40, {
        slug, reinforce: { mode: 'queued' },
        history: ratings.map((r, i) => ({ date: dayAt(lastOffset - (ratings.length - 1 - i)).toISOString(), rating: r }))
    });

    test('projected load = weight / current gap; queued and multi-practice left out', () => {
        const problems = toMap([inRotation('a', 2), inRotation('b', 4, 'Hard'), queued('q', [1], -2), mk('Hard', 0, { slug: 'i', reinforce: { mode: 'intensive' }, history: [{ date: dayAt(-1).toISOString(), rating: 1 }] })]);
        expect(LB.projectedDailyLoad(problems)).toBeCloseTo(2 / 2 + 3 / 4, 1);
    });

    test('admits most stubborn first, within 80% of budget, at most 5 a day', () => {
        const problems = toMap([
            inRotation('busy', 1),                // projected 2
            queued('stubborn', [1, 1, 1, 1], -1),
            queued('once', [3, 2], -1),
            queued('twice', [2, 2], -3)
        ]);
        const r = LB.chooseAdmissions(problems, 4); // limit 3.2, each costs 0.8
        expect(r.admit).toEqual(['stubborn']);
        const roomy = LB.chooseAdmissions(problems, 20);
        expect(roomy.admit).toEqual(['stubborn', 'twice', 'once']);
    });

    test('new-problem advice', () => {
        expect(LB.newProblemAdvice({ capacity: 6, projected: 2, doneLoad: 0, plannedLoad: 2, deferredLoad: 0, avgWeight: 2 }))
            .toEqual({ today: 2, perWeek: 3, pause: false });
        expect(LB.newProblemAdvice({ capacity: 6, projected: 6, doneLoad: 0, plannedLoad: 6, deferredLoad: 14, avgWeight: 2 }))
            .toEqual({ today: 0, perWeek: 0, pause: true });
        // with a queue, new problems get only the 20% that admissions leave free
        expect(LB.newProblemAdvice({ capacity: 24, projected: 12, doneLoad: 0, plannedLoad: 10, deferredLoad: 0, avgWeight: 2, queuedCount: 90 }))
            .toEqual({ today: 1, perWeek: 4, pause: false });
    });
});

describe('planReviews', () => {
    test('backlog after missed days is spread to stay within capacity', () => {
        const backlog = Array.from({ length: 10 }, () => mk('Medium', -3)); // 20 load overdue
        const plan = LB.planReviews(toMap(backlog), { today, capacity: 6 });
        const loads = plan.days.slice(0, 5).map(d => d.load);
        expect(loads).toEqual([6, 6, 6, 2, 0]);
        expect(plan.today).toHaveLength(3);
        expect(plan.deferredCount).toBe(7);
    });

    test('most-forgotten problems come first', () => {
        const fresh = mk('Medium', 0, { slug: 'fresh', fsrs_stability: 50 });
        const weak = mk('Medium', 0, { slug: 'weak', fsrs_stability: 1 });
        const plan = LB.planReviews(toMap([fresh, weak]), { today, capacity: 2 });
        expect(plan.today).toEqual(['weak']);
    });

    test('first-fit fills remaining room with smaller problems', () => {
        const list = [mk('Hard', 0, { slug: 'h1', fsrs_stability: 1 }), mk('Hard', 0, { slug: 'h2', fsrs_stability: 2 }), mk('Easy', 0, { slug: 'e1', fsrs_stability: 30 })];
        const plan = LB.planReviews(toMap(list), { today, capacity: 4 });
        expect(plan.today.sort()).toEqual(['e1', 'h1']);
    });

    test('work already done today counts against today', () => {
        const done = mk('Hard', 5, { slug: 'done', history: [{ date: dayAt(0, 8).toISOString(), rating: 3 }] });
        const plan = LB.planReviews(toMap([done, mk('Medium', 0, { slug: 'due' })]), { today, capacity: 4 });
        expect(plan.doneLoad).toBe(3);
        expect(plan.today).toEqual([]); // 3 done + 2 would exceed 4
        expect(plan.assignment.due).toBe(LB.toKey(dayAt(1)));
    });

    test('leave days get nothing; work moves to the next day', () => {
        const list = [mk('Easy', 0, { slug: 'a' }), mk('Easy', 1, { slug: 'b' })];
        const plan = LB.planReviews(toMap(list), { today, capacity: 5, leaveDays: [LB.toKey(dayAt(0))] });
        expect(plan.today).toEqual([]);
        expect(plan.assignment.a).toBe(LB.toKey(dayAt(1)));
        expect(plan.assignment.b).toBe(LB.toKey(dayAt(1)));
    });

    test('intensive problems are pinned, count double, and come on top of capacity', () => {
        const hard = mk('Hard', 0, { slug: 'stubborn', reinforce: { mode: 'intensive' } });
        const plan = LB.planReviews(toMap([hard, mk('Easy', 0, { slug: 'e' })]), { today, capacity: 3 });
        expect(plan.today).toEqual(['stubborn', 'e']);
        expect(plan.days[0].load).toBe(7);
    });

    test('a light day pulls in a long-interval problem due soon (never twice)', () => {
        const longOne = mk('Medium', 2, { slug: 'long', interval: 30, fsrs_stability: 30, fsrs_last_review: dayAt(-28).toISOString() });
        const shortOne = mk('Medium', 2, { slug: 'short', interval: 3, fsrs_stability: 3, fsrs_last_review: dayAt(-1).toISOString() });
        const plan = LB.planReviews(toMap([longOne, shortOne]), { today, capacity: 4 });
        expect(plan.today).toEqual(['long']);
        expect(plan.assignment.short).toBe(LB.toKey(dayAt(2)));
        const count = plan.days.reduce((sum, d) => sum + d.slugs.filter(s => s === 'long').length, 0);
        expect(count).toBe(1);
    });

    test('queued and rethink problems are not planned', () => {
        const plan = LB.planReviews(toMap([mk('Easy', 0, { slug: 'q', reinforce: { mode: 'queued' } }), mk('Easy', 0, { slug: 'r', reinforce: { mode: 'rethink' } }), mk('Easy', 0, { slug: 'e' })]), { today, capacity: 5 });
        expect(plan.today).toEqual(['e']);
    });

    test('weak-topic problems get priority', () => {
        const a = mk('Medium', 0, { slug: 'normal', topics: ['Tree'], fsrs_stability: 10 });
        const b = mk('Medium', 0, { slug: 'weak', topics: ['Dynamic Programming'], fsrs_stability: 10 });
        expect(LB.planReviews(toMap([a, b]), { today, capacity: 2 }).today).toEqual(['normal']);
        expect(LB.planReviews(toMap([a, b]), { today, capacity: 2, weakTopics: ['Dynamic Programming'] }).today).toEqual(['weak']);
    });

    test('sprint: everything not reviewed since the start is due, queued included', () => {
        const old = (slug, extra = {}) => mk('Easy', 30, { slug, history: [{ date: dayAt(-20).toISOString(), rating: 3 }], ...extra });
        const fresh = mk('Easy', 30, { slug: 'fresh', history: [{ date: dayAt(-1).toISOString(), rating: 3 }] });
        const problems = toMap([old('a'), old('b'), old('q', { reinforce: { mode: 'queued' } }), old('r', { reinforce: { mode: 'rethink' } }), fresh]);
        const sprint = { start: LB.toKey(dayAt(-2)), end: LB.toKey(dayAt(10)) };
        const plan = LB.planReviews(problems, { today, capacity: 10, sprint });
        expect(plan.today.sort()).toEqual(['a', 'b', 'q']);
        expect(plan.sprintLeft).toBe(3);
        expect(LB.planReviews(problems, { today, capacity: 10 }).today).toEqual([]);
    });

    test('one topic takes at most 40% of the budget while others wait', () => {
        const list = [
            ...[1, 2, 3, 4].map(i => mk('Medium', 0, { slug: `dp${i}`, topics: ['Dynamic Programming'], fsrs_stability: i })),
            mk('Medium', 0, { slug: 'tree', topics: ['Tree'], fsrs_stability: 9 }),
            mk('Medium', 0, { slug: 'graph', topics: ['Graph'], fsrs_stability: 9 })
        ];
        const plan = LB.planReviews(toMap(list), { today, capacity: 10 }); // topic cap 4 = two Mediums
        expect(plan.today.filter(s => s.startsWith('dp'))).toHaveLength(3); // 2 in pass 1, 1 more to fill the leftover room
        expect(plan.today).toEqual(expect.arrayContaining(['tree', 'graph']));
        const tight = LB.planReviews(toMap(list), { today, capacity: 8 });
        expect(tight.today.sort()).toEqual(['dp1', 'dp2', 'graph', 'tree']);
    });

    test('today\'s new problems count towards their topic (reviews favour other topics)', () => {
        const newDp = mk('Medium', 3, { slug: 'new-dp', topics: ['Dynamic Programming'], history: [{ date: dayAt(0, 8).toISOString(), rating: 3 }] });
        const list = [newDp, mk('Medium', 0, { slug: 'old-dp', topics: ['Dynamic Programming'], fsrs_stability: 1 }), mk('Medium', 0, { slug: 'tree', topics: ['Tree'], fsrs_stability: 20 })];
        const plan = LB.planReviews(toMap(list), { today, capacity: 6 }); // 2 done today, room 4; DP cap 2.4 already used by the new problem
        expect(plan.today[0]).toBe('tree');
    });

    test('every problem due within the horizon is planned exactly once', () => {
        const list = Array.from({ length: 60 }, (_, i) => mk(['Easy', 'Medium', 'Hard'][i % 3], (i % 20) - 5));
        const plan = LB.planReviews(toMap(list), { today });
        const all = plan.days.flatMap(d => d.slugs);
        expect(new Set(all).size).toBe(all.length);
        expect(all.length).toBe(60);
        const max = Math.max(...plan.days.slice(1).map(d => d.load));
        expect(max).toBeLessThanOrEqual(plan.capacity);
    });
});
