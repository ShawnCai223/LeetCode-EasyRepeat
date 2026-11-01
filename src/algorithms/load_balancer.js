/**
 * LeetCode EasyRepeat - Daily load planner (每日题量均衡)
 *
 * FSRS / reinforcement decide *when a problem becomes due*. This planner decides
 * *which day you actually do it*, so that every day has a similar workload:
 *
 * - Load is weighted by difficulty: Easy 1, Medium 2, Hard 3.
 * - Daily capacity is automatic: the weighted load due within the next 14 days
 *   (overdue backlog included) divided by the non-leave days in that window,
 *   at least 3 (so one Hard always fits). It is frozen once per day.
 * - Simulating day by day, due problems wait in a queue ordered by how likely
 *   they are to be forgotten (FSRS retrievability, lowest first; problems in
 *   relearn get a small boost). Each day takes problems from the queue until the
 *   capacity is used; leftovers roll to the next day. So after leave or a missed
 *   day the backlog is spread out instead of landing on one day.
 * - A day with spare room may pull in a long-interval problem due within the
 *   next 2 days (at most ~15% of its interval early) to smooth peaks.
 * - Intensive (一天多练) problems are pinned to their day, count double in the
 *   day's load, and come on top of the capacity: extra practice never pushes
 *   regular reviews away, and the capacity is computed from regular reviews only.
 * - Leave days have zero capacity. Work already done today counts against
 *   today's capacity.
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.LoadBalancer = exports;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    const WEIGHTS = { easy: 1, medium: 2, hard: 3 };
    const DEFAULTS = {
        horizonDays: 45,
        windowDays: 14,
        minCapacity: 3,
        pullForwardDays: 2,
        pullForwardMinInterval: 7,
        pullForwardRatio: 0.15,
        relearnBoost: 0.1,
        intensiveFactor: 2
    };
    const DECAY = -0.5;
    const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
    const DAY_MS = 24 * 60 * 60 * 1000;

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function toKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function startOfDay(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    /** Whole local days from `today` to `date` (negative = in the past). */
    function dayIndex(date, today) {
        const a = startOfDay(today);
        const b = startOfDay(date);
        return Math.round((b - a) / DAY_MS);
    }

    function keyAt(today, idx) {
        const d = startOfDay(today);
        d.setDate(d.getDate() + idx);
        return toKey(d);
    }

    function weightOf(problem) {
        return WEIGHTS[String((problem && problem.difficulty) || 'medium').toLowerCase()] || 2;
    }

    function isIntensive(problem) {
        return Boolean(problem && problem.reinforce && problem.reinforce.mode === 'intensive');
    }

    function isRelearn(problem) {
        return Boolean(problem && problem.reinforce && problem.reinforce.mode === 'relearn');
    }

    /** FSRS retrievability on a given day; falls back to an overdue ratio. */
    function retrievability(problem, onDate) {
        const s = Number(problem.fsrs_stability);
        const last = problem.fsrs_last_review || problem.lastSolved;
        const lastT = last ? new Date(last).getTime() : NaN;
        if (s > 0 && Number.isFinite(lastT)) {
            const elapsed = Math.max(0, (onDate.getTime() - lastT) / DAY_MS);
            return Math.pow(1 + FACTOR * elapsed / s, DECAY);
        }
        const due = new Date(problem.nextReviewDate).getTime();
        const interval = Math.max(1, Number(problem.interval) || 1);
        const overdue = (onDate.getTime() - due) / DAY_MS;
        return Math.max(0, 1 - Math.max(0, overdue + 1) / (interval * 4));
    }

    function doneLoadOn(problems, day) {
        const key = toKey(day);
        let load = 0;
        for (const p of Object.values(problems || {})) {
            if (!p || !Array.isArray(p.history)) continue;
            for (const h of p.history) {
                if (h && toKey(new Date(h.date)) === key) load += weightOf(p);
            }
        }
        return load;
    }

    /**
     * Automatic daily capacity.
     */
    function computeCapacity(problems, today, leaveDays = [], options = {}) {
        const opt = { ...DEFAULTS, ...options };
        const leave = new Set(leaveDays || []);
        let total = 0;
        for (const p of Object.values(problems || {})) {
            if (!p || !p.nextReviewDate) continue;
            const due = new Date(p.nextReviewDate);
            if (!Number.isFinite(due.getTime())) continue;
            if (!isIntensive(p) && dayIndex(due, today) < opt.windowDays) {
                total += weightOf(p);
            }
        }
        let workDays = 0;
        for (let i = 0; i < opt.windowDays; i++) {
            if (!leave.has(keyAt(today, i))) workDays++;
        }
        const avg = total / Math.max(1, workDays);
        return Math.max(opt.minCapacity, Math.ceil(avg));
    }

    /**
     * Build the plan.
     *
     * @param {Object} problems  slug -> problem
     * @param {Object} ctx
     * @param {Date}   ctx.today        "now"
     * @param {string[]} [ctx.leaveDays]
     * @param {number} [ctx.capacity]   frozen capacity for today (else computed)
     * @param {Object} [ctx.options]
     * @returns {{capacity:number, doneLoad:number, days:Array<{key:string, load:number, slugs:string[], leave:boolean}>, assignment:Object, today:string[], deferredCount:number}}
     */
    function planReviews(problems, ctx = {}) {
        const opt = { ...DEFAULTS, ...(ctx.options || {}) };
        const today = ctx.today ? new Date(ctx.today) : new Date();
        const leave = new Set(ctx.leaveDays || []);
        const capacity = Number.isFinite(ctx.capacity) && ctx.capacity > 0
            ? ctx.capacity
            : computeCapacity(problems, today, ctx.leaveDays, opt);
        const doneLoad = doneLoadOn(problems, today);
        const H = opt.horizonDays;

        const days = [];
        for (let i = 0; i <= H; i++) {
            const key = keyAt(today, i);
            days.push({ key, load: 0, slugs: [], leave: leave.has(key) });
        }
        const nextWorkDay = (i) => {
            let j = Math.max(0, i);
            while (j <= H && days[j].leave) j++;
            return j;
        };

        const assignment = {};
        const pending = [];
        for (const p of Object.values(problems || {})) {
            if (!p || !p.slug || !p.nextReviewDate) continue;
            const due = new Date(p.nextReviewDate);
            if (!Number.isFinite(due.getTime())) continue;
            const idx = dayIndex(due, today);
            if (idx > H) continue;
            if (isIntensive(p)) {
                const d = nextWorkDay(idx);
                if (d <= H) {
                    days[d].slugs.push(p.slug);
                    days[d].load += weightOf(p) * opt.intensiveFactor;
                    assignment[p.slug] = days[d].key;
                }
                continue;
            }
            pending.push({ p, slug: p.slug, w: weightOf(p), dueIdx: idx, interval: Math.max(1, Number(p.interval) || 1) });
        }
        pending.sort((a, b) => a.dueIdx - b.dueIdx || (a.slug < b.slug ? -1 : 1));

        const queue = [];
        let cursor = 0;
        const taken = new Set();

        for (let d = 0; d <= H; d++) {
            while (cursor < pending.length && pending[cursor].dueIdx <= d) {
                const it = pending[cursor++];
                if (!taken.has(it.slug)) queue.push(it); // skip ones already pulled forward
            }
            const day = days[d];
            if (day.leave) continue;

            const onDate = new Date(startOfDay(today).getTime() + d * DAY_MS + 12 * 60 * 60 * 1000);
            const score = (it) => retrievability(it.p, onDate) - (isRelearn(it.p) ? opt.relearnBoost : 0);
            queue.sort((a, b) => score(a) - score(b) || b.w - a.w || (a.slug < b.slug ? -1 : 1));

            // Regular reviews share the capacity; pinned intensive load is extra.
            const cap = capacity - (d === 0 ? doneLoad : 0);
            let regular = 0;
            const remainingQueue = [];
            for (const it of queue) {
                const fits = regular + it.w <= cap;
                const firstOfEmptyDay = d > 0 && regular === 0;
                if (fits || firstOfEmptyDay) {
                    day.slugs.push(it.slug);
                    day.load += it.w;
                    regular += it.w;
                    assignment[it.slug] = day.key;
                    taken.add(it.slug);
                } else {
                    remainingQueue.push(it);
                }
            }
            queue.length = 0;
            queue.push(...remainingQueue);

            // Smooth peaks: pull a few long-interval problems slightly early.
            if (regular < cap) {
                for (let k = cursor; k < pending.length; k++) {
                    const it = pending[k];
                    const ahead = it.dueIdx - d;
                    if (ahead <= 0) continue;
                    if (ahead > opt.pullForwardDays) break;
                    if (taken.has(it.slug)) continue;
                    if (it.interval < opt.pullForwardMinInterval) continue;
                    if (ahead > Math.floor(it.interval * opt.pullForwardRatio)) continue;
                    if (regular + it.w > cap) continue;
                    day.slugs.push(it.slug);
                    day.load += it.w;
                    regular += it.w;
                    assignment[it.slug] = day.key;
                    taken.add(it.slug);
                }
            }
        }

        // Items that the pull-forward already took must not be assigned again.
        for (const day of days) {
            day.slugs = day.slugs.filter((slug, i, arr) => arr.indexOf(slug) === i && assignment[slug] === day.key);
        }

        const todayKey = days[0].key;
        const dueNowOrBefore = pending.filter(it => it.dueIdx <= 0).length;
        const todaySlugs = days[0].slugs.slice();
        const deferredCount = pending.filter(it => it.dueIdx <= 0 && assignment[it.slug] !== todayKey).length;

        return {
            capacity,
            doneLoad,
            days,
            assignment,
            today: todaySlugs,
            dueCount: dueNowOrBefore,
            deferredCount
        };
    }

    return {
        WEIGHTS,
        DEFAULTS,
        toKey,
        dayIndex,
        weightOf,
        retrievability,
        doneLoadOn,
        computeCapacity,
        planReviews
    };
}));
