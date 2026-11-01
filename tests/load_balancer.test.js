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

describe('capacity', () => {
    test('average weighted load over the window, at least 3', () => {
        const problems = toMap([mk('Hard', 0), mk('Medium', 1), mk('Easy', 2), mk('Hard', 20)]);
        // (3 + 2 + 1) / 14 -> 1 -> floor of 3
        expect(LB.computeCapacity(problems, today, [])).toBe(3);
        const many = toMap(Array.from({ length: 28 }, (_, i) => mk('Medium', i % 14)));
        expect(LB.computeCapacity(many, today, [])).toBe(4); // 56 / 14
    });

    test('leave days shrink the number of work days', () => {
        const many = toMap(Array.from({ length: 28 }, (_, i) => mk('Medium', i % 14)));
        const leave = [0, 1].map(i => LB.toKey(dayAt(i)));
        expect(LB.computeCapacity(many, today, leave)).toBe(5); // 56 / 12 -> 4.67
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
        // capacity ignores intensive load
        expect(LB.computeCapacity(toMap([hard]), today, [])).toBe(3);
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
