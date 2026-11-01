/**
 * LeetCode EasyRepeat - Daily load planner (每日题量均衡)
 *
 * FSRS / reinforcement decide *when a problem becomes due*. This planner decides
 * *which day you actually do it*, within a daily budget:
 *
 * - Load is weighted by difficulty: Easy 1, Medium 2, Hard 3.
 * - Budget (capacity) follows the user's real pace: the average daily load of
 *   their last 14 active days (new problems included; multi-practice reviews,
 *   marked `extra`, and repeats of a problem on the same day are left out, so
 *   practice outside the budget does not inflate it). Fewer than 5 active
 *   days → the default of 3 problems a day. The user may fix it instead
 *   ("N problems a day"). Frozen once per day by the caller.
 * - Simulating day by day, due problems wait in a queue ordered by how likely
 *   they are to be forgotten (FSRS retrievability, lowest first; relearn gets a
 *   small boost). Each day takes problems until the budget is used; the rest
 *   roll to the next day, so backlog after leave or missed days is spread out.
 * - Topic mix: one topic may take at most 40% of a day's budget, and today's
 *   new problems count towards their topic, so reviews favour other topics
 *   (interleaving for list-followers). The cap is soft: leftover room is
 *   filled anyway rather than left empty.
 * - A day with spare room may pull in a long-interval problem due within the
 *   next 2 days (at most ~15% of its interval early).
 * - Intensive (一天多练) problems are pinned, count double, and come on top of
 *   the budget. Queued weak problems are not planned until admitted.
 * - Leave days have zero budget. Work already done today counts.
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
        windowDays: 14,           // active days averaged for the budget
        lookbackDays: 60,         // how far back to look for those active days
        minActiveDays: 5,         // fewer → default budget
        defaultDailyProblems: 3,  // new users
        minCapacity: 3,
        topicShare: 0.4,
        broadTagShare: 0.3,       // tags on more than 30% of problems are too broad to be a topic
        admitBudgetShare: 0.8,    // queued problems may fill the projected load up to 80% of budget
        admitCostFactor: 0.4,     // average daily cost of a problem in relearn, × its weight
        admitMaxPerDay: 5,
        newProblemCostFactor: 4,  // first solve + 3 consolidation reviews
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

    function isQueued(problem) {
        return Boolean(problem && problem.reinforce && problem.reinforce.mode === 'queued');
    }

    function sortedDates(history) {
        return (Array.isArray(history) ? history : [])
            .map(h => new Date(h && h.date))
            .filter(d => Number.isFinite(d.getTime()))
            .sort((a, b) => a - b);
    }

    /** Tags that appear on more than `share` of all problems (e.g. Array). */
    function broadTags(problems, share = DEFAULTS.broadTagShare) {
        const list = Object.values(problems || {}).filter(Boolean);
        const counts = new Map();
        for (const p of list) {
            for (const t of new Set(Array.isArray(p.topics) ? p.topics : [])) counts.set(t, (counts.get(t) || 0) + 1);
        }
        const out = new Set();
        for (const [t, c] of counts) if (list.length >= 10 && c / list.length > share) out.add(t);
        return out;
    }

    /** First topic tag that is not too broad (falls back to the first tag). */
    function mainTopic(problem, broad) {
        const topics = Array.isArray(problem && problem.topics) ? problem.topics : [];
        return topics.find(t => !broad.has(t)) || topics[0] || null;
    }

    function averageWeight(problems) {
        const list = Object.values(problems || {}).filter(Boolean);
        if (!list.length) return 2;
        return list.reduce((sum, p) => sum + weightOf(p), 0) / list.length;
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
     * Daily budget from the user's real pace: average load of the last 14
     * active days before today (within 60 days). Fewer than 5 active days →
     * default 3 problems a day. Automatic budget only goes up (`previousAuto`
     * is yesterday's). `settings.dailyProblems` overrides it.
     */
    function computeCapacity(problems, today, settings = {}, options = {}, previousAuto = 0) {
        const opt = { ...DEFAULTS, ...options };
        const avgW = averageWeight(problems);
        const fixed = Number(settings && settings.dailyProblems);
        if (Number.isFinite(fixed) && fixed > 0) {
            return Math.max(opt.minCapacity, Math.round(fixed * avgW));
        }
        const todayKey = toKey(today);
        const earliest = startOfDay(today).getTime() - opt.lookbackDays * DAY_MS;
        const perDay = new Map();
        for (const p of Object.values(problems || {})) {
            if (!p) continue;
            const w = weightOf(p);
            const seen = new Set(); // a problem counts once a day: extra same-day practice is outside the budget
            const budgeted = (Array.isArray(p.history) ? p.history : []).filter(h => h && !h.extra);
            for (const d of sortedDates(budgeted)) {
                if (d.getTime() < earliest) continue;
                const key = toKey(d);
                if (key >= todayKey || seen.has(key)) continue;
                seen.add(key);
                perDay.set(key, (perDay.get(key) || 0) + w);
            }
        }
        const recent = Array.from(perDay.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, opt.windowDays);
        const floor = Math.max(opt.minCapacity, Number(previousAuto) || 0);
        if (recent.length < opt.minActiveDays) {
            return Math.max(floor, Math.round(opt.defaultDailyProblems * avgW));
        }
        const avg = recent.reduce((sum, [, load]) => sum + load, 0) / recent.length;
        // Upward only: following the plan must not shrink the plan (feedback loop);
        // missed days are backlog, not less capacity. Users lower it in Settings.
        return Math.max(floor, Math.round(avg));
    }

    /**
     * Expected steady daily load of the problems already in rotation:
     * each problem costs its weight once per current gap (next − last review).
     * Queued and intensive problems are left out.
     */
    function projectedDailyLoad(problems) {
        let load = 0;
        for (const p of Object.values(problems || {})) {
            if (!p || isQueued(p) || isIntensive(p) || !p.nextReviewDate) continue;
            const dates = sortedDates(p.history);
            if (!dates.length) continue;
            const last = dates[dates.length - 1].getTime();
            const next = new Date(p.nextReviewDate).getTime();
            if (!Number.isFinite(next)) continue;
            const gap = Math.max(1, (next - last) / DAY_MS);
            load += weightOf(p) / gap;
        }
        return load;
    }

    /**
     * Which queued weak problems to take into relearn today: least stubborn and
     * most recently seen first, while the projected load stays within 80% of
     * the budget, at most 5 a day.
     */
    function chooseAdmissions(problems, capacity, options = {}) {
        const opt = { ...DEFAULTS, ...options };
        let projected = projectedDailyLoad(problems);
        const limit = capacity * opt.admitBudgetShare;
        const weakTail = (p) => {
            const rated = (Array.isArray(p.history) ? p.history : [])
                .filter(h => h && Number.isFinite(new Date(h.date).getTime()) && Number(h.rating) >= 1)
                .sort((a, b) => new Date(a.date) - new Date(b.date));
            let n = 0;
            for (let i = rated.length - 1; i >= 0 && Number(rated[i].rating) <= 2; i--) n++;
            return n;
        };
        const lastSeen = (p) => { const d = sortedDates(p.history); return d.length ? d[d.length - 1].getTime() : 0; };
        const candidates = Object.values(problems || {})
            .filter(isQueued)
            .map(p => ({ slug: p.slug, w: weightOf(p), tail: weakTail(p), seen: lastSeen(p) }))
            .sort((a, b) => a.tail - b.tail || b.seen - a.seen || (a.slug < b.slug ? -1 : 1));
        const admit = [];
        for (const c of candidates) {
            if (admit.length >= opt.admitMaxPerDay) break;
            const cost = c.w * opt.admitCostFactor;
            if (projected + cost > limit) break;
            admit.push(c.slug);
            projected += cost;
        }
        return { admit, projected, queued: candidates.length };
    }

    /**
     * Advice on new problems (soft — the user picks them on LeetCode):
     * how many fit today, how many a week the budget sustains, and whether the
     * backlog says to pause.
     */
    function newProblemAdvice({ capacity, projected, doneLoad, plannedLoad, deferredLoad, avgWeight, queuedCount = 0 }, options = {}) {
        const opt = { ...DEFAULTS, ...options };
        const w = avgWeight > 0 ? avgWeight : 2;
        const pause = deferredLoad > 2 * capacity;
        // While weak problems wait in the queue, they get the budget first and
        // new problems get only the share admissions leave free.
        const sustainable = queuedCount > 0
            ? Math.min(Math.max(0, capacity - projected), capacity * (1 - opt.admitBudgetShare))
            : Math.max(0, capacity - projected);
        const todayRoom = Math.max(0, capacity - doneLoad - plannedLoad);
        const perWeek = Math.floor((7 * sustainable) / (opt.newProblemCostFactor * w));
        // Today: what fits today, never more than a week's worth (a day's share while a queue waits).
        const today = pause ? 0 : Math.min(Math.floor(todayRoom / w), queuedCount > 0 ? Math.ceil(perWeek / 7) : perWeek);
        return { today, perWeek, pause };
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
            : computeCapacity(problems, today, ctx.settings, opt);
        const broad = broadTags(problems, opt.broadTagShare);
        // Today's new problems (first review today) count towards their topic.
        const todayKey0 = toKey(today);
        const newTopicLoad = new Map();
        for (const p of Object.values(problems || {})) {
            const dates = p ? sortedDates(p.history) : [];
            if (dates.length && toKey(dates[0]) === todayKey0) {
                const t = mainTopic(p, broad);
                if (t) newTopicLoad.set(t, (newTopicLoad.get(t) || 0) + weightOf(p));
            }
        }
        const doneLoad = doneLoadOn(problems, today);
        const H = opt.horizonDays;

        const days = [];
        for (let i = 0; i <= H; i++) {
            const key = keyAt(today, i);
            days.push({ key, load: 0, regular: 0, slugs: [], leave: leave.has(key) });
        }
        const nextWorkDay = (i) => {
            let j = Math.max(0, i);
            while (j <= H && days[j].leave) j++;
            return j;
        };

        const assignment = {};
        const pending = [];
        for (const p of Object.values(problems || {})) {
            if (!p || !p.slug || !p.nextReviewDate || isQueued(p)) continue;
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
            pending.push({ p, slug: p.slug, w: weightOf(p), dueIdx: idx, interval: Math.max(1, Number(p.interval) || 1), topic: mainTopic(p, broad) });
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
            const topicCap = Math.max(1, capacity * opt.topicShare);
            const topicLoad = d === 0 ? new Map(newTopicLoad) : new Map();
            let regular = 0;
            const take = (it) => {
                day.slugs.push(it.slug);
                day.load += it.w;
                regular += it.w;
                assignment[it.slug] = day.key;
                taken.add(it.slug);
                if (it.topic) topicLoad.set(it.topic, (topicLoad.get(it.topic) || 0) + it.w);
            };
            // Pass 1: respect the topic share. Pass 2: fill leftover room anyway.
            for (const pass of [1, 2]) {
                for (const it of queue) {
                    if (taken.has(it.slug)) continue;
                    const fits = regular + it.w <= cap;
                    const firstOfEmptyDay = d > 0 && regular === 0;
                    if (!fits && !firstOfEmptyDay) continue;
                    const tl = it.topic ? (topicLoad.get(it.topic) || 0) : 0;
                    if (pass === 1 && it.topic && tl > 0 && tl + it.w > topicCap) continue;
                    take(it);
                }
            }
            const remainingQueue = queue.filter(it => !taken.has(it.slug));
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
                    take(it);
                }
            }
            day.regular = regular;
        }

        // Items that the pull-forward already took must not be assigned again.
        for (const day of days) {
            day.slugs = day.slugs.filter((slug, i, arr) => arr.indexOf(slug) === i && assignment[slug] === day.key);
        }

        const todayKey = days[0].key;
        const dueNowOrBefore = pending.filter(it => it.dueIdx <= 0).length;
        const todaySlugs = days[0].slugs.slice();
        const deferredItems = pending.filter(it => it.dueIdx <= 0 && assignment[it.slug] !== todayKey);
        const deferredCount = deferredItems.length;
        const deferredLoad = deferredItems.reduce((sum, it) => sum + it.w, 0);

        return {
            capacity,
            doneLoad,
            days,
            assignment,
            today: todaySlugs,
            dueCount: dueNowOrBefore,
            deferredCount,
            deferredLoad,
            plannedRegularLoad: days[0].regular
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
        broadTags,
        mainTopic,
        averageWeight,
        computeCapacity,
        projectedDailyLoad,
        chooseAdmissions,
        newProblemAdvice,
        planReviews
    };
}));
