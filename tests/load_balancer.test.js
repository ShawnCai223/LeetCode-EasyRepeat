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

describe('daily budget: modes split new and review', () => {
    const solved = (offsets, difficulty = 'Medium', slug) => mk(difficulty, 30, { slug, history: offsets.map(o => ({ date: dayAt(o).toISOString(), rating: 3 })) });
    const paceOf = (perDay, days = 20) => {
        const list = [];
        for (let i = 1; i <= days; i++) for (let k = 0; k < perDay; k++) list.push(solved([-i], 'Medium', `p${i}-${k}`));
        return toMap(list);
    };

    test('new user (< 5 active days): 10 a day; learning 7 new + 3 review', () => {
        const b = LB.dailyBudget(toMap([solved([-1], 'Medium', 'a')]), today, {});
        expect(b).toMatchObject({ mode: 'learn', total: 10, newQuota: 7, reviewQuota: 3, source: 'default' });
        expect(b.reviewCapacity).toBe(6); // 3 reviews × average weight 2
    });

    test('grinding mode splits 50/50', () => {
        expect(LB.dailyBudget(paceOf(12), today, { mode: 'grind' })).toMatchObject({ total: 12, newQuota: 6, reviewQuota: 6, source: 'auto' });
    });

    test('total follows the average problems a day over the last 14 active days', () => {
        expect(LB.paceProblems(paceOf(5), today)).toMatchObject({ avg: 5, activeDays: 14 });
        expect(LB.dailyBudget(paceOf(5), today, {})).toMatchObject({ total: 5, newQuota: 4, reviewQuota: 1 });
    });

    test('multi-practice and same-day repeats do not count towards the pace', () => {
        const problems = paceOf(4);
        problems.x = mk('Hard', 3, { slug: 'x', history: [-1, -2, -3].map(o => ({ date: dayAt(o, 9).toISOString(), rating: 1, extra: true })) });
        problems.rep = mk('Hard', 3, { slug: 'rep', history: [{ date: dayAt(-1, 9).toISOString(), rating: 1 }, { date: dayAt(-1, 15).toISOString(), rating: 3 }] });
        expect(LB.paceProblems(problems, today).avg).toBeCloseTo((5 + 13 * 4) / 14, 5);
    });

    test('automatic total only goes up; a fixed number wins', () => {
        expect(LB.dailyBudget(paceOf(5), today, {}, 9).total).toBe(9);
        expect(LB.dailyBudget(paceOf(5), today, { dailyProblems: 4 }, 9)).toMatchObject({ total: 4, source: 'fixed', newQuota: 3, reviewQuota: 1 });
    });

    test('always at least one review slot', () => {
        expect(LB.dailyBudget(paceOf(1), today, { dailyProblems: 1 })).toMatchObject({ total: 1, newQuota: 0, reviewQuota: 1 });
    });
});

describe('today\'s choices: over or under the review share', () => {
    const due = (slug, offset, s = 5) => mk('Medium', offset, { slug, fsrs_stability: s, history: [{ date: dayAt(offset - 10).toISOString(), rating: 3 }] });

    test('done today: first review today = new, others = review', () => {
        const fresh = mk('Medium', 3, { slug: 'n', history: [{ date: dayAt(0, 8).toISOString(), rating: 3 }] });
        const old = mk('Hard', 3, { slug: 'o', history: [{ date: dayAt(-5).toISOString(), rating: 3 }, { date: dayAt(0, 9).toISOString(), rating: 3 }] });
        expect(LB.doneToday(toMap([fresh, old]), today)).toEqual({ newCount: 1, reviewCount: 1, reviewLoad: 3 });
    });

    test('overflow: rolled on by default, all of it today when the user adds it', () => {
        const problems = toMap([due('a', -1, 1), due('b', 0, 2), due('c', 0, 3)]);
        const plan = LB.planReviews(problems, { today, capacity: 2 });
        expect(plan.today).toEqual(['a']);
        expect(plan.deferredCount).toBe(2);
        const all = LB.planReviews(problems, { today, capacity: 2, includeAllDueToday: true });
        expect(all.today.sort()).toEqual(['a', 'b', 'c']);
        expect(all.spareLoad).toBe(0);
    });

    test('spare room: reviews due within a week are pulled in only when the user asks', () => {
        const problems = toMap([due('now', 0), due('soon', 3), due('later', 12)]);
        const plain = LB.planReviews(problems, { today, capacity: 6 });
        expect(plain.today).toEqual(['now']);
        expect(plain.spareLoad).toBe(4);
        expect(plain.soonCount).toBe(1);
        const filled = LB.planReviews(problems, { today, capacity: 6, fillTodayFromSoon: true });
        expect(filled.today.sort()).toEqual(['now', 'soon']);
    });

    test('new problems done today do not use the review share', () => {
        const fresh = mk('Hard', 3, { slug: 'new', history: [{ date: dayAt(0, 8).toISOString(), rating: 3 }] });
        const plan = LB.planReviews(toMap([fresh, due('r', 0)]), { today, capacity: 2 });
        expect(plan.today).toEqual(['r']);
    });
});

describe('queue admission', () => {
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
        const full = LB.chooseAdmissions(problems, 1); // projected already above the limit
        expect(full.admit).toEqual(['stubborn']);       // the queue still moves by one
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

    test('reviews already done today count against today', () => {
        const done = mk('Hard', 5, { slug: 'done', history: [{ date: dayAt(-6).toISOString(), rating: 3 }, { date: dayAt(0, 8).toISOString(), rating: 3 }] });
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

describe('free mode: recommended reviews float with what got done', () => {
    // Each problem: first solved 30 days ago, reviewed on the given day offsets.
    const reviewed = (offsets, slug) => mk('Medium', 30, {
        slug,
        history: [{ date: dayAt(-30).toISOString(), rating: 3 }, ...offsets.map(o => ({ date: dayAt(o).toISOString(), rating: 3 }))]
    });
    const reviewsPerDay = (perDay, days) => {
        const list = [];
        for (let i = 1; i <= days; i++) for (let k = 0; k < perDay; k++) list.push(reviewed([-i], `r${i}-${k}`));
        return toMap(list);
    };
    const log = (entries) => Object.fromEntries(entries.map(([offset, v]) => [LB.toKey(dayAt(offset)), v]));

    test('no new-problem quota; reviews = recommendation', () => {
        const b = LB.dailyBudget({}, today, { mode: 'free' }, 0, { recommendedReviews: 8 });
        expect(b).toMatchObject({ mode: 'free', total: null, newQuota: null, reviewQuota: 8, source: 'recommended' });
        expect(b.reviewCapacity).toBe(16);
    });

    test('review pace counts reviews only (not first solves, not extra practice)', () => {
        const problems = reviewsPerDay(6, 10);
        problems.first = mk('Easy', 3, { slug: 'first', history: [{ date: dayAt(-1).toISOString(), rating: 3 }] });
        problems.extra = reviewed([], 'extra');
        problems.extra.history.push({ date: dayAt(-1).toISOString(), rating: 1, extra: true });
        expect(LB.reviewPace(problems, today)).toMatchObject({ avg: 6, activeDays: 10 });
    });

    test('starts at 5 for new users, else from the review pace', () => {
        expect(LB.recommendReviews({}, today, 0, {})).toBe(5);
        expect(LB.recommendReviews(reviewsPerDay(12, 3), today, 0, {})).toBe(5);
        expect(LB.recommendReviews(reviewsPerDay(12, 8), today, 0, {})).toBe(12);
    });

    test('+10% when nearly everything recommended and possible got done', () => {
        const dayLog = log([[-1, { rec: 10, available: 12, done: 10 }], [-2, { rec: 10, available: 6, done: 6 }]]);
        expect(LB.recommendReviews({}, today, 10, dayLog)).toBe(11);
    });

    test('−10% when under 70% got done; unchanged in between', () => {
        expect(LB.recommendReviews({}, today, 10, log([[-1, { rec: 10, available: 10, done: 5 }]]))).toBe(9);
        expect(LB.recommendReviews({}, today, 10, log([[-1, { rec: 10, available: 10, done: 8 }]]))).toBe(10);
    });

    test('only the last 7 days before today count; small samples and today are ignored; clamped 3..60', () => {
        const old = log([[-9, { rec: 10, available: 10, done: 0 }], [0, { rec: 10, available: 10, done: 0 }]]);
        expect(LB.recommendReviews({}, today, 10, old)).toBe(10);
        expect(LB.recommendReviews({}, today, 10, log([[-1, { rec: 10, available: 2, done: 0 }]]))).toBe(10);
        expect(LB.recommendReviews({}, today, 3, log([[-1, { rec: 3, available: 3, done: 0 }]]))).toBe(3);
        expect(LB.recommendReviews({}, today, 60, log([[-1, { rec: 60, available: 60, done: 60 }]]))).toBe(60);
    });
});
