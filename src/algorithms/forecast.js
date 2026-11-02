/**
 * LeetCode EasyRepeat - Forecast (预计多久全部会做)
 *
 * Answers: "at this many reviews a day, when will every problem I had done up
 * to yesterday be one I can do?"
 *
 * "Can do" (会做) = last rating Good/Easy and not in any reinforcement state
 * (relearn, multi-practice, queued, rethink). A new problem being consolidated
 * (3/8/20 days) counts as can-do: it was solved well, it is only being kept.
 *
 * Estimate, with the user's own numbers (last 90 days of their history):
 * - pAfterBad  = how often the attempt after a bad rating is Good/Easy,
 *   pAfterGood = how often the attempt after a good rating is Good/Easy.
 *   (Measuring the rate on today's weak problems would be biased: they are
 *   weak because their recent ratings were bad.)
 * - Each problem still to fix needs a few good reviews in a row (relearn: 3
 *   steps; a bad rating steps back one). The expected number of reviews comes
 *   from a small Markov chain over (step, last rating good/bad).
 * - Problems that are already fine still need upkeep: one review per current
 *   gap each (Σ 1/gap per day). About 10% of those reviews will be forgotten
 *   (the fixed FSRS schedules reviews at ~90% recall) and each lapse costs
 *   another relearn, so upkeep costs Σ 1/gap × (1 + 10% × relearn reviews).
 * - Days = (expected reviews to fix everything) / (reviews a day − upkeep),
 *   but never less than the calendar time the steps take (1+3+7 = 11 days).
 * - Also: how many reviews a day would finish within a given number of days.
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.Forecast = exports;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    const DAY_MS = 24 * 60 * 60 * 1000;
    const RELEARN_STEPS = 3;
    const RELEARN_STEP_DAYS = [1, 3, 7];
    const MAX_DAYS = 3650;
    const UPKEEP_LAPSE_RATE = 0.1;

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function toKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function rated(history) {
        return (Array.isArray(history) ? history : [])
            .filter(h => h && Number.isFinite(new Date(h.date).getTime()) && Number(h.rating) >= 1)
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    function mode(problem) {
        return problem && problem.reinforce ? problem.reinforce.mode : null;
    }

    /** Can the user do this problem now? */
    function canDo(problem) {
        const m = mode(problem);
        if (m && m !== 'consolidate') return false;
        const r = rated(problem && problem.history);
        return r.length > 0 && Number(r[r.length - 1].rating) >= 3;
    }

    /** Good reviews in a row still needed to make a problem can-do. */
    function stepsLeft(problem) {
        const m = mode(problem);
        const step = Number(problem && problem.reinforce && problem.reinforce.step) || 0;
        if (m === 'relearn') return Math.max(1, RELEARN_STEPS - step);
        if (m === 'intensive' || m === 'rethink') return 2 + RELEARN_STEPS; // leave multi-practice, then relearn
        return RELEARN_STEPS; // queued, or weak without a state yet
    }

    /**
     * Expected reviews to climb `steps` good reviews in a row, starting just
     * after a bad rating; success depends on whether the previous review was
     * good or bad; a bad review steps back one step.
     */
    function expectedReviews(steps, pAfterBad, pAfterGood = pAfterBad) {
        if (steps <= 0) return 0;
        // E[k][b]: expected reviews from step k, b = 1 if the last review was bad.
        const E = Array.from({ length: steps + 1 }, () => [0, 0]);
        for (let iter = 0; iter < 5000; iter++) {
            let delta = 0;
            for (let k = steps - 1; k >= 0; k--) {
                for (const b of [0, 1]) {
                    const p = b ? pAfterBad : pAfterGood;
                    const next = k + 1 >= steps ? 0 : E[k + 1][0];
                    const v = 1 + p * next + (1 - p) * E[Math.max(0, k - 1)][1];
                    delta = Math.max(delta, Math.abs(v - E[k][b]));
                    E[k][b] = v;
                }
            }
            if (delta < 1e-9) break;
        }
        return E[0][1];
    }

    /** P(good | previous bad) and P(good | previous good) from the user's last 90 days. */
    function transitionRates(problems, today, windowDays = 90) {
        const since = today.getTime() - windowDays * DAY_MS;
        let nb = 0, gb = 0, ng = 0, gg = 0;
        for (const p of Object.values(problems || {})) {
            const r = rated(p && p.history);
            for (let i = 1; i < r.length; i++) {
                const t = new Date(r[i].date).getTime();
                if (t < since || t > today.getTime()) continue;
                const good = Number(r[i].rating) >= 3;
                if (Number(r[i - 1].rating) <= 2) { nb += 1; gb += good ? 1 : 0; } else { ng += 1; gg += good ? 1 : 0; }
            }
        }
        const clamp = (x) => Math.min(0.95, Math.max(0.1, x));
        return {
            pAfterBad: clamp(nb >= 10 ? gb / nb : 0.4),
            pAfterGood: clamp(ng >= 10 ? gg / ng : 0.75),
            samples: nb + ng
        };
    }

    /**
     * @param {Object} problems
     * @param {Date} today
     * @param {number} reviewsPerDay
     * @returns {{target:number, done:number, todo:number, pAfterBad:number, pAfterGood:number, expectedReviews:number,
     *            upkeepPerDay:number, days:number|null, date:string|null, enough:boolean}}
     *   days/date null when the reviews a day cannot even keep up with upkeep.
     */
    function estimateClearDays(problems, today, reviewsPerDay) {
        const now = today instanceof Date ? today : new Date(today);
        const todayKey = toKey(now);
        const target = Object.values(problems || {}).filter(p => {
            const r = rated(p && p.history);
            return r.length > 0 && toKey(new Date(r[0].date)) < todayKey;
        });
        const todo = target.filter(p => !canDo(p));
        const fine = target.filter(canDo);
        const rates = transitionRates(problems, now);
        const expected = todo.reduce((sum, prob) => sum + expectedReviews(stepsLeft(prob), rates.pAfterBad, rates.pAfterGood), 0);

        let upkeep = 0;
        for (const prob of fine) {
            const r = rated(prob.history);
            const last = new Date(r[r.length - 1].date).getTime();
            const next = new Date(prob.nextReviewDate).getTime();
            if (!Number.isFinite(next)) continue;
            upkeep += 1 / Math.max(1, (next - last) / DAY_MS);
        }

        const relearnCost = expectedReviews(RELEARN_STEPS, rates.pAfterBad, rates.pAfterGood);
        const upkeepCost = upkeep * (1 + UPKEEP_LAPSE_RATE * relearnCost);
        const calendarFloor = RELEARN_STEP_DAYS.reduce((a, b) => a + b, 0);
        const reviewsFor = (days) => Math.ceil(upkeepCost + expected / Math.max(days, calendarFloor));

        const result = {
            target: target.length,
            done: fine.length,
            todo: todo.length,
            pAfterBad: Math.round(rates.pAfterBad * 100) / 100,
            pAfterGood: Math.round(rates.pAfterGood * 100) / 100,
            expectedReviews: Math.round(expected),
            upkeepPerDay: Math.round(upkeepCost * 10) / 10,
            reviewsFor30: reviewsFor(30),
            reviewsFor90: reviewsFor(90),
            days: 0,
            date: todayKey,
            enough: true
        };
        if (!todo.length) return result;

        const room = Number(reviewsPerDay) - upkeepCost;
        if (!(room > 0)) return { ...result, days: null, date: null, enough: false };
        const days = Math.min(MAX_DAYS, Math.ceil(Math.max(expected / room, calendarFloor)));
        const end = new Date(now);
        end.setDate(end.getDate() + days);
        return { ...result, days, date: toKey(end) };
    }

    return { canDo, stepsLeft, expectedReviews, transitionRates, estimateClearDays };
}));
