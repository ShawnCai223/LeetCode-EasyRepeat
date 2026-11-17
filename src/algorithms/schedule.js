/**
 * LeetCode EasyRepeat - Review schedule (三档评分)
 *
 * Three ratings, by what happened this time (UI names in brackets):
 *   tough (1) [Couldn't / 不会]     — couldn't write it, or used hints
 *   fine  (3) [Stuck / 卡壳]        — got it, but got stuck or fixed bugs a few times
 *   easy  (4) [Solved / 写出来了]   — wrote it yourself, fairly smoothly
 * (Older ratings: 2 "Hard" counts as tough.)
 *
 * Rules:
 * - tough → practise it every day until a day you don't rate it tough, then
 *   one more day to confirm; if the confirm day isn't tough either, it goes
 *   back to the normal schedule (by that day's rating). Tough at any point
 *   starts the daily practice again.
 * - fine → again in 2 days.
 * - easy → the gap roughly doubles: 3, 7, 15, 30, 60 days (60 is the max).
 *   Fine steps the gap back one rung; tough starts it over.
 * - At most 5 problems are in daily practice on the same day (see
 *   daily_reviews.js); the rest wait their turn.
 *
 * FSRS still runs in the background (retention on the cards); the review
 * date comes from these rules.
 *
 * Stored on the problem as `sched: { mode: 'daily'|'confirm'|'normal', rung, since }`.
 * Older fork data (`relearn`, `reinforce`) is read once and replaced.
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.Schedule = exports;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    const DAY_MS = 24 * 60 * 60 * 1000;
    const EASY_GAPS = [3, 7, 15, 30, 60];
    const FINE_GAP = 2;
    const DAILY_LIMIT = 5;
    const RATING = { tough: 1, fine: 3, easy: 4 };

    function tier(rating) {
        const r = Number(rating);
        if (r === 1 || r === 2) return 'tough';
        if (r === 3) return 'fine';
        if (r === 4) return 'easy';
        return null;
    }

    function lastRated(problem) {
        const h = (Array.isArray(problem && problem.history) ? problem.history : [])
            .filter(x => x && Number(x.rating) >= 1 && Number.isFinite(new Date(x.date).getTime()))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        return h.length ? h[h.length - 1] : null;
    }

    /** Rung for a problem with no stored state: the rung after its current gap. */
    function rungFromGap(problem) {
        const last = lastRated(problem);
        let gap = Number(problem && problem.interval) || 0;
        const next = new Date(problem && problem.nextReviewDate).getTime();
        if (last && Number.isFinite(next)) gap = Math.max(gap, (next - new Date(last.date).getTime()) / DAY_MS);
        let rung = 0;
        while (rung < EASY_GAPS.length - 1 && EASY_GAPS[rung] <= gap) rung++;
        return rung;
    }

    /** { mode, rung, since } for any problem, old data included. */
    function stateOf(problem) {
        const s = problem && problem.sched;
        if (s && ['daily', 'confirm', 'normal'].includes(s.mode)) {
            return { mode: s.mode, rung: Math.min(EASY_GAPS.length - 1, Math.max(0, Number(s.rung) || 0)), since: s.since || null };
        }
        const relearnStep = problem && problem.relearn && Number.isInteger(problem.relearn.step) ? problem.relearn.step : null;
        const old = problem && problem.reinforce;
        if (relearnStep !== null || (old && ['relearn', 'intensive', 'rethink'].includes(old.mode))) {
            // 1/3/7 steps: step 0 = still failing → daily; step 1 = one good
            // after failing → confirm; step 2 = already confirmed → normal.
            const step = relearnStep !== null ? relearnStep : (old.mode === 'relearn' ? Number(old.step) || 0 : 0);
            return { mode: step === 0 ? 'daily' : step === 1 ? 'confirm' : 'normal', rung: 0, since: null };
        }
        return { mode: 'normal', rung: rungFromGap(problem), since: null };
    }

    function addDays(now, days) {
        const d = new Date(now);
        d.setDate(d.getDate() + days);
        return d.toISOString();
    }

    /**
     * Apply a rating.
     * @returns {{ sched:{mode,rung,since}, gap:number, nextReviewDate:string } | null} null for no rating
     */
    function apply(problem, rating, now) {
        const t = tier(rating);
        if (!t) return null;
        const s = stateOf(problem);
        const stamp = new Date(now).toISOString();
        if (t === 'tough') {
            const since = s.mode === 'daily' && s.since ? s.since : stamp;
            return { sched: { mode: 'daily', rung: 0, since }, gap: 1, nextReviewDate: addDays(now, 1) };
        }
        if (s.mode === 'daily') {
            return { sched: { mode: 'confirm', rung: 0, since: null }, gap: 1, nextReviewDate: addDays(now, 1) };
        }
        if (t === 'fine') {
            const rung = Math.max(0, s.rung - 1);
            return { sched: { mode: 'normal', rung, since: null }, gap: FINE_GAP, nextReviewDate: addDays(now, FINE_GAP) };
        }
        const gap = EASY_GAPS[s.rung];
        const rung = Math.min(EASY_GAPS.length - 1, s.rung + 1);
        return { sched: { mode: 'normal', rung, since: null }, gap, nextReviewDate: addDays(now, gap) };
    }

    /** Fields to merge into the stored problem (drops the older `relearn` / `reinforce`). */
    function fields(problem, rating, now) {
        const r = apply(problem, rating, now);
        if (!r) return {};
        return { sched: r.sched, relearn: undefined, reinforce: undefined, nextReviewDate: r.nextReviewDate, interval: r.gap };
    }

    /** 'daily' | 'confirm' | null — for tags and ordering. */
    function phase(problem) {
        const m = stateOf(problem).mode;
        return m === 'normal' ? null : m;
    }

    /** Can do it now: last rating not tough and not in daily practice / confirm. */
    function canDo(problem) {
        const last = lastRated(problem);
        return !!last && tier(last.rating) !== 'tough' && stateOf(problem).mode === 'normal';
    }

    return { EASY_GAPS, FINE_GAP, DAILY_LIMIT, RATING, tier, stateOf, apply, fields, phase, canDo };
}));
