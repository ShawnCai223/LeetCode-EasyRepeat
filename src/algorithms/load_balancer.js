/**
 * LeetCode EasyRepeat - Daily load planner (每日题量均衡)
 *
 * FSRS / reinforcement decide *when a problem becomes due*. This planner decides
 * *which day you actually do it*, within a daily budget:
 *
 * - Three modes. Learning (学习模式) and grinding (刷题模式) split the day's
 *   problems 70/30 and 50/50 between new and review. Free (自由模式): new
 *   problems are up to the user (no quota); reviews follow a recommended
 *   number that floats with how the user has been doing (±10% a day when
 *   they kept up / fell behind over the last week).
 *   The total follows the user's real pace (average problems a day over their
 *   last 14 active days; 10 for new users) or a number they set. Reviews get
 *   their share as the review budget; new problems are the user's own picks,
 *   shown as a quota with progress.
 * - When more reviews are due than the review share, the user chooses: add
 *   them to today, or roll them on. When fewer are due, the user chooses: pull
 *   in reviews due within a week, or give the room to new problems.
 *
 * - Load is weighted by difficulty: Easy 1, Medium 2, Hard 3.
 * - `capacity` passed to planReviews is the REVIEW budget in load units
 *   (review quota × average weight); reviews already done today count
 *   against it, new problems do not (they have their own quota).
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
 *   the budget. Queued weak problems are not planned until admitted;
 *   "rethink" problems are paused until the user marks them understood.
 * - Weak-topic problems get a small priority boost.
 * - Sprint mode (冲刺, before an interview): every problem not reviewed since
 *   the sprint started is due now, queued ones included, so the (larger)
 *   budget walks through all of them by forgetting risk and topic mix.
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
        defaultDailyProblems: 10, // new users (no pace yet)
        fillAheadDays: 7,         // "pull in" looks this far ahead
        minCapacity: 3,
        topicShare: 0.4,
        broadTagShare: 0.3,       // tags on more than 30% of problems are too broad to be a topic
        admitBudgetShare: 0.8,    // queued problems may fill the projected load up to 80% of budget
        admitCostFactor: 0.4,     // average daily cost of a problem in relearn, × its weight
        admitMaxPerDay: 5,
        admitMinPerDay: 1,        // the queue always moves, even when the review share is full
        pullForwardDays: 2,
        pullForwardMinInterval: 7,
        pullForwardRatio: 0.15,
        relearnBoost: 0.1,
        weakTopicBoost: 0.05,
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

    function isRethink(problem) {
        return Boolean(problem && problem.reinforce && problem.reinforce.mode === 'rethink');
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

    const MODES = {
        learn: { newShare: 0.7 },
        grind: { newShare: 0.5 },
        free: { newShare: null }
    };

    function normalizeMode(mode) {
        return mode === 'grind' || mode === 'free' ? mode : 'learn';
    }

    /** Average reviews a day (problems seen before, multi-practice excluded) over the last 14 active days. */
    function reviewPace(problems, today, options = {}) {
        const opt = { ...DEFAULTS, ...options };
        const todayKey = toKey(today);
        const earliest = startOfDay(today).getTime() - opt.lookbackDays * DAY_MS;
        const perDay = new Map();
        for (const p of Object.values(problems || {})) {
            if (!p) continue;
            const dates = sortedDates((p.history || []).filter(h => h && !h.extra));
            const seen = new Set();
            for (let i = 1; i < dates.length; i++) {
                const key = toKey(dates[i]);
                if (dates[i].getTime() < earliest || key >= todayKey || seen.has(key) || key === toKey(dates[0])) continue;
                seen.add(key);
                perDay.set(key, (perDay.get(key) || 0) + 1);
            }
        }
        const recent = Array.from(perDay.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, opt.windowDays);
        if (!recent.length) return { avg: null, activeDays: 0 };
        return { avg: recent.reduce((sum, [, n]) => sum + n, 0) / recent.length, activeDays: recent.length };
    }

    /**
     * Free mode: today's recommended number of reviews.
     * Starts from the user's review pace (5 for new users). Each day it looks at
     * the last 7 days in `dayLog` ({date: {rec, available, done}}): kept up
     * (done ≥ 95% of what was recommended and available) → +10%; fell behind
     * (< 70%) → −10%. Between 3 and 60.
     */
    function recommendReviews(problems, today, previous, dayLog = {}, options = {}) {
        const opt = { ...DEFAULTS, ...options };
        const todayKey = toKey(today);
        let rec = Number(previous);
        if (!(rec > 0)) {
            const pace = reviewPace(problems, today, opt);
            rec = pace.activeDays >= opt.minActiveDays ? Math.round(pace.avg) : 5;
        }
        const weekAgo = new Date(startOfDay(today));
        weekAgo.setDate(weekAgo.getDate() - 7);
        const fromKey = toKey(weekAgo);
        const days = Object.entries(dayLog || {})
            .filter(([k]) => k < todayKey && k >= fromKey)
            .map(([, v]) => v || {});
        let expected = 0;
        let done = 0;
        for (const d of days) {
            const possible = Math.min(Number(d.rec) || 0, Number(d.available) || 0);
            expected += possible;
            done += Math.min(Number(d.done) || 0, possible);
        }
        if (expected >= 3) {
            const ratio = done / expected;
            if (ratio >= 0.95) rec = Math.ceil(rec * 1.1);
            else if (ratio < 0.7) rec = Math.floor(rec * 0.9);
        }
        return Math.min(60, Math.max(3, rec));
    }

    /**
     * Average number of problems a day over the last 14 active days before
     * today (within 60 days). A problem counts once a day; multi-practice
     * reviews (marked `extra`) are left out.
     */
    function paceProblems(problems, today, options = {}) {
        const opt = { ...DEFAULTS, ...options };
        const todayKey = toKey(today);
        const earliest = startOfDay(today).getTime() - opt.lookbackDays * DAY_MS;
        const perDay = new Map();
        for (const p of Object.values(problems || {})) {
            if (!p) continue;
            const seen = new Set();
            const budgeted = (Array.isArray(p.history) ? p.history : []).filter(h => h && !h.extra);
            for (const d of sortedDates(budgeted)) {
                if (d.getTime() < earliest) continue;
                const key = toKey(d);
                if (key >= todayKey || seen.has(key)) continue;
                seen.add(key);
                perDay.set(key, (perDay.get(key) || 0) + 1);
            }
        }
        const recent = Array.from(perDay.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, opt.windowDays);
        if (!recent.length) return { avg: null, activeDays: 0 };
        return { avg: recent.reduce((sum, [, n]) => sum + n, 0) / recent.length, activeDays: recent.length };
    }

    /**
     * Today's budget in problems, split by mode.
     * `previousAuto` = yesterday's automatic total (the automatic total only goes up:
     * following the plan must not shrink the plan; users lower it in Settings).
     * @returns {{mode, total, newQuota, reviewQuota, reviewCapacity, avgWeight, source: 'fixed'|'auto'|'default'}}
     */
    function dailyBudget(problems, today, settings = {}, previousAuto = 0, options = {}) {
        const opt = { ...DEFAULTS, ...options };
        const mode = normalizeMode(settings && settings.mode);
        const avgWeight = averageWeight(problems);
        if (mode === 'free') {
            // Reviews only; the caller passes today's recommendation (recommendReviews).
            const reviewQuota = Math.max(1, Math.round(Number(opt.recommendedReviews) || 5));
            return { mode, total: null, newQuota: null, reviewQuota, reviewCapacity: Math.max(1, Math.round(reviewQuota * avgWeight)), avgWeight, source: 'recommended' };
        }
        const fixed = Number(settings && settings.dailyProblems);
        let total;
        let source;
        if (Number.isFinite(fixed) && fixed > 0) {
            total = Math.round(fixed);
            source = 'fixed';
        } else {
            const pace = paceProblems(problems, today, opt);
            const floor = Number(previousAuto) || 0;
            if (pace.activeDays < opt.minActiveDays) {
                total = Math.max(floor, opt.defaultDailyProblems);
                source = 'default';
            } else {
                total = Math.max(floor, Math.round(pace.avg));
                source = 'auto';
            }
        }
        total = Math.max(1, total);
        const newQuota = Math.min(total - 1, Math.round(total * MODES[mode].newShare));
        const reviewQuota = Math.max(1, total - Math.max(0, newQuota));
        return {
            mode,
            total,
            newQuota: Math.max(0, newQuota),
            reviewQuota,
            reviewCapacity: Math.max(1, Math.round(reviewQuota * avgWeight)),
            avgWeight,
            source
        };
    }

    /** What was done today: new problems (first review today) and reviews (others), multi-practice left out. */
    function doneToday(problems, today) {
        const key = toKey(today);
        let newCount = 0;
        let reviewCount = 0;
        let reviewLoad = 0;
        for (const p of Object.values(problems || {})) {
            const dates = p ? sortedDates((p.history || []).filter(h => h && !h.extra)) : [];
            if (!dates.some(d => toKey(d) === key)) continue;
            if (toKey(dates[0]) === key) newCount += 1;
            else {
                reviewCount += 1;
                reviewLoad += weightOf(p);
            }
        }
        return { newCount, reviewCount, reviewLoad };
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
     * Expected steady daily load of the problems already in rotation:
     * each problem costs its weight once per current gap (next − last review).
     * Queued and intensive problems are left out.
     */
    function projectedDailyLoad(problems) {
        let load = 0;
        for (const p of Object.values(problems || {})) {
            if (!p || isQueued(p) || isRethink(p) || isIntensive(p) || !p.nextReviewDate) continue;
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
     * Which queued weak problems to take into relearn today: most stubborn
     * (longest run of bad ratings) and most recently seen first, while the
     * projected load stays within 80% of the review budget, at most 5 a day —
     * and always at least 1, so the queue keeps moving even when reviews fill
     * the share (the popup then asks about the overflow).
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
            .sort((a, b) => b.tail - a.tail || b.seen - a.seen || (a.slug < b.slug ? -1 : 1));
        const admit = [];
        for (const c of candidates) {
            if (admit.length >= opt.admitMaxPerDay) break;
            const cost = c.w * opt.admitCostFactor;
            if (projected + cost > limit && admit.length >= opt.admitMinPerDay) break;
            admit.push(c.slug);
            projected += cost;
        }
        return { admit, projected, queued: candidates.length };
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
            : dailyBudget(problems, today, ctx.settings || {}, 0, opt).reviewCapacity;
        const broad = broadTags(problems, opt.broadTagShare);
        const weakTopics = new Set(Array.isArray(ctx.weakTopics) ? ctx.weakTopics : []);
        const inWeakTopic = (p) => Array.isArray(p.topics) && p.topics.some(t => weakTopics.has(t));
        const sprintStart = ctx.sprint && ctx.sprint.start ? startOfDay(new Date(`${ctx.sprint.start}T00:00:00`)).getTime() : null;
        const lastReviewTime = (p) => { const d = sortedDates(p.history); return d.length ? d[d.length - 1].getTime() : -Infinity; };
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
        const doneLoad = doneToday(problems, today).reviewLoad;
        const includeAllDueToday = Boolean(ctx.includeAllDueToday);
        const fillToday = Boolean(ctx.fillTodayFromSoon);
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
            if (!p || !p.slug || !p.nextReviewDate || isRethink(p)) continue;
            const inSprint = sprintStart !== null && lastReviewTime(p) < sprintStart;
            if (isQueued(p) && !inSprint) continue;
            const due = new Date(p.nextReviewDate);
            if (!Number.isFinite(due.getTime())) continue;
            const idx = inSprint ? Math.min(0, dayIndex(due, today)) : dayIndex(due, today);
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
            const score = (it) => retrievability(it.p, onDate)
                - (isRelearn(it.p) ? opt.relearnBoost : 0)
                - (inWeakTopic(it.p) ? opt.weakTopicBoost : 0);
            queue.sort((a, b) => score(a) - score(b) || b.w - a.w || (a.slug < b.slug ? -1 : 1));

            // Regular reviews share the capacity; pinned intensive load is extra.
            const cap = d === 0 && includeAllDueToday ? Infinity : capacity - (d === 0 ? doneLoad : 0);
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

            // The user chose to fill today's review room with problems due soon.
            if (d === 0 && fillToday && regular < cap) {
                const soon = pending
                    .filter(it => !taken.has(it.slug) && it.dueIdx > 0 && it.dueIdx <= opt.fillAheadDays)
                    .sort((a, b) => score(a) - score(b) || a.dueIdx - b.dueIdx);
                for (const it of soon) {
                    if (regular + it.w > cap) continue;
                    take(it);
                }
            }

            // Smooth peaks: pull a few long-interval problems slightly early.
            if (regular < cap && cap !== Infinity) {
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
            plannedRegularLoad: days[0].regular,
            spareLoad: includeAllDueToday ? 0 : Math.max(0, capacity - doneLoad - days[0].regular),
            soonCount: pending.filter(it => it.dueIdx > 0 && it.dueIdx <= opt.fillAheadDays && assignment[it.slug] !== todayKey).length,
            sprintLeft: sprintStart === null ? 0 : Object.values(problems || {}).filter(p => p && !isRethink(p) && lastReviewTime(p) < sprintStart).length
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
        doneToday,
        paceProblems,
        dailyBudget,
        reviewPace,
        recommendReviews,
        MODES,
        broadTags,
        mainTopic,
        averageWeight,
        projectedDailyLoad,
        chooseAdmissions,
        planReviews
    };
}));
