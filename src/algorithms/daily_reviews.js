/**
 * LeetCode EasyRepeat - Daily reviews (每天复习多少)
 *
 * New problems are not counted or limited: do as many as you like.
 *
 * Reviews a day start from what you have actually been doing and grow slowly:
 * - Start: your average reviews on the days you reviewed (last 14 such days);
 *   8 with no history.
 * - Each new day: +1 if you did the whole number on the last day you opened
 *   the extension; otherwise it stays. Days you didn't open it don't count.
 * - Never above your daily maximum (Settings, default 15), never below 3.
 *
 * Today's list (nothing about the backlog is shown):
 * 1. problems in daily practice (rated tough), at most 5 — the ones that
 *    have been in it longest first;
 * 2. problems on their confirm day, at most 5;
 * 3. other due problems, longest overdue first;
 * 4. any further confirm-day problems if there is still room;
 * then cut to today's number minus what you already reviewed today. The rest
 * stay due and come up on the next days in the same order.
 *
 * A "review" = a rated attempt on a problem first done on an earlier day
 * (one per problem per day).
 *
 * Storage: dailyReviews = { algo: 'ramp1', date, target }
 *          dailyReviewSettings = { max: number }   (older `fixed` is read as max)
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.DailyReviews = exports;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    const ALGO = 'ramp1';
    const START = 8;
    const MIN = 3;
    const DEFAULT_MAX = 15;
    const LIMIT_MAX = 60;
    const PACE_DAYS = 14;
    const DAILY_LIMIT = 5;

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function toKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function rated(history) {
        return (Array.isArray(history) ? history : [])
            .filter(h => h && Number(h.rating) >= 1 && Number.isFinite(new Date(h.date).getTime()))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    /** Map day key -> number of problems reviewed that day. */
    function reviewsByDay(problems) {
        const byDay = new Map();
        for (const p of Object.values(problems || {})) {
            const r = rated(p && p.history);
            if (!r.length) continue;
            const firstKey = toKey(new Date(r[0].date));
            const seen = new Set();
            for (const h of r) {
                const key = toKey(new Date(h.date));
                if (key === firstKey || seen.has(key)) continue;
                seen.add(key);
                byDay.set(key, (byDay.get(key) || 0) + 1);
            }
        }
        return byDay;
    }

    function reviewsOn(problems, dayKey) {
        return reviewsByDay(problems).get(dayKey) || 0;
    }

    /** Average reviews on the last 14 days you reviewed (before today). */
    function reviewPace(problems, today) {
        const todayKey = toKey(today);
        const days = Array.from(reviewsByDay(problems).entries())
            .filter(([k]) => k < todayKey)
            .sort((a, b) => (a[0] < b[0] ? 1 : -1))
            .slice(0, PACE_DAYS);
        if (!days.length) return { avg: null, activeDays: 0 };
        return { avg: days.reduce((s, [, n]) => s + n, 0) / days.length, activeDays: days.length };
    }

    function maxOf(settings) {
        const s = settings || {};
        const n = Number(s.max ?? s.fixed);
        return Number.isInteger(n) && n >= MIN && n <= LIMIT_MAX ? n : DEFAULT_MAX;
    }

    /**
     * Today's number. Returns { target, max, state, changed }.
     * `state` is what to store as `dailyReviews`.
     */
    function today(problems, now, state, settings) {
        const todayKey = toKey(now);
        const max = maxOf(settings);
        const bound = (n) => Math.min(max, Math.max(MIN, Math.round(n)));
        const s = state && typeof state === 'object' && state.algo === ALGO ? state : null;

        if (s && s.date === todayKey && Number(s.target) > 0) {
            return { target: bound(s.target), max, state: s, changed: false };
        }
        let target;
        if (s && Number(s.target) > 0) {
            const doneLastDay = reviewsOn(problems, s.date);
            target = doneLastDay >= Number(s.target) ? Number(s.target) + 1 : Number(s.target);
        } else {
            const pace = reviewPace(problems, now);
            target = pace.avg === null ? START : pace.avg;
        }
        target = bound(target);
        return { target, max, state: { algo: ALGO, date: todayKey, target }, changed: true };
    }

    /**
     * Today's list from the due problems.
     * @param {Object[]} due        problems due by the end of today
     * @param {number}   remaining  today's number minus reviews already done today
     * @param {(p:Object)=>('daily'|'confirm'|null)} phaseOf
     * @returns {{ today: Object[], restCount: number }}
     */
    function split(due, remaining, phaseOf = () => null) {
        const byDate = (a, b) => new Date(a.nextReviewDate) - new Date(b.nextReviewDate);
        const since = (p) => new Date((p.sched && p.sched.since) || p.nextReviewDate).getTime();
        const daily = (due || []).filter(p => phaseOf(p) === 'daily').sort((a, b) => since(a) - since(b)).slice(0, DAILY_LIMIT);
        const confirm = (due || []).filter(p => phaseOf(p) === 'confirm').sort(byDate);
        const normal = (due || []).filter(p => !phaseOf(p)).sort(byDate);
        const ordered = [...daily, ...confirm.slice(0, DAILY_LIMIT), ...normal, ...confirm.slice(DAILY_LIMIT)];
        const n = Math.max(0, remaining);
        return { today: ordered.slice(0, n), restCount: (due || []).length - Math.min(n, ordered.length) };
    }

    return {
        ALGO, START, MIN, DEFAULT_MAX, LIMIT_MAX, DAILY_LIMIT,
        toKey, reviewsByDay, reviewsOn, reviewPace, maxOf, today, split
    };
}));
