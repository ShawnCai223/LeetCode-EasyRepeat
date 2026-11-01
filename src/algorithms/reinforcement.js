/**
 * LeetCode EasyRepeat - Reinforcement rules (加强复习)
 *
 * Sits on top of FSRS. After every review it decides whether the problem needs
 * short-term reinforcement and, if so, overrides FSRS's next review date.
 *
 * Ratings (what the user means by them):
 *   4 Easy  = 会写会说          (wrote it and can explain it)
 *   3 Good  = 会写不会说        (wrote it, can't fully explain)
 *   2 Hard  = 按照提示写了出来  (needed hints)
 *   1 Again = 完全不会写        (couldn't write it)
 *
 * Rules:
 * - New problem, first review rated >= 3: "consolidate" — reviewed again
 *   after gaps of 3, 8 and 20 days, then plain FSRS. Rated <= 2 → relearn.
 * - Any rating <= 2 means the problem needs reinforcement *now*, whatever its
 *   history: it enters "relearn" with steps of 1, 3, 7 days (never later than
 *   FSRS would schedule). Each rating >= 3 advances one step; after the last
 *   step it goes back to plain FSRS. A rating <= 2 during relearn steps back
 *   one step (not back to the start).
 * - Existing weak problems found at setup/import are "queued": not scheduled
 *   until the daily plan has room for them (see LoadBalancer.admitQueued).
 * - "Stubborn" = the last 3 ratings in a row were <= 2. Stubborn problems go
 *   into "intensive" mode (练 2 次/天, or 3 次/天 when the last 3 were all
 *   rating 1 or the weak streak is >= 5), spaced 4 hours apart within the day.
 *   Only a small pool of problems is intensive at once (default 3), so the
 *   daily load stays doable; the rest stay in relearn until a slot frees up.
 * - An intensive problem leaves intensive mode after 2 ratings >= 3 in a row
 *   and then goes through the relearn steps. A rating <= 2 while intensive
 *   keeps it intensive and resets that count.
 *
 * Problem fields used/written:
 *   problem.reinforce = { mode: 'consolidate'|'relearn'|'intensive'|'queued', step, goodStreak, intraday, since }
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.Reinforcement = exports;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    const RELEARN_STEPS_DAYS = [1, 3, 7];
    const CONSOLIDATE_STEPS_DAYS = [3, 8, 20];
    const STUBBORN_STREAK = 3;
    const HEAVY_STREAK = 5;
    const INTRADAY_GAP_HOURS = 4;
    const LAST_INTRADAY_HOUR = 23; // no same-day practice scheduled after 23:00 local
    const EXIT_INTENSIVE_GOOD_STREAK = 2;
    const DEFAULT_POOL_SIZE = 3;
    const MAX_POOL_SIZE = 10;

    const DAY_MS = 24 * 60 * 60 * 1000;

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function toKey(date) {
        const d = date instanceof Date ? date : new Date(date);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function sortedHistory(history) {
        return (Array.isArray(history) ? history : [])
            .filter(h => h && Number.isFinite(new Date(h.date).getTime()))
            .slice()
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    function ratedHistory(history) {
        return sortedHistory(history).filter(h => Number.isFinite(Number(h.rating)) && Number(h.rating) >= 1);
    }

    /** Number of trailing ratings <= 2 in a row. */
    function weakStreak(history) {
        const rated = ratedHistory(history);
        let n = 0;
        for (let i = rated.length - 1; i >= 0; i--) {
            if (Number(rated[i].rating) <= 2) n++;
            else break;
        }
        return n;
    }

    function isStubborn(history) {
        return weakStreak(history) >= STUBBORN_STREAK;
    }

    function lastRating(history) {
        const rated = ratedHistory(history);
        return rated.length ? Number(rated[rated.length - 1].rating) : null;
    }

    /** Practices per day for an intensive problem: 3 for the worst cases, else 2. */
    function intensiveTarget(history) {
        const rated = ratedHistory(history);
        const last3 = rated.slice(-3).map(h => Number(h.rating));
        const allAgain = last3.length === 3 && last3.every(r => r === 1);
        return (allAgain || weakStreak(history) >= HEAVY_STREAK) ? 3 : 2;
    }

    function practicesOnDay(history, day) {
        const key = toKey(day);
        return sortedHistory(history).filter(h => toKey(new Date(h.date)) === key).length;
    }

    function addDays(date, n) {
        const d = new Date(date);
        d.setDate(d.getDate() + n);
        return d;
    }

    function startOfNextDay(now) {
        const d = new Date(now);
        d.setHours(0, 5, 0, 0);
        d.setDate(d.getDate() + 1);
        return d;
    }

    function minDate(a, b) {
        if (!a) return b;
        if (!b) return a;
        return a.getTime() <= b.getTime() ? a : b;
    }

    function normalizePoolSize(value) {
        const n = Math.floor(Number(value));
        if (!Number.isFinite(n) || n < 0) return DEFAULT_POOL_SIZE;
        return Math.min(n, MAX_POOL_SIZE);
    }

    /**
     * Next due time for an intensive problem.
     * @param {Array} history  history INCLUDING the review just done
     */
    function nextIntensiveDue(history, now) {
        const target = intensiveTarget(history);
        const done = practicesOnDay(history, now);
        const candidate = new Date(now.getTime() + INTRADAY_GAP_HOURS * 60 * 60 * 1000);
        const cutoff = new Date(now);
        cutoff.setHours(LAST_INTRADAY_HOUR, 0, 0, 0);
        if (done < target && candidate.getTime() <= cutoff.getTime() && toKey(candidate) === toKey(now)) {
            return { date: candidate, intraday: true, target, done };
        }
        return { date: startOfNextDay(now), intraday: false, target, done };
    }

    function relearnDue(step, now, fsrsDate) {
        return minDate(fsrsDate, addDays(now, RELEARN_STEPS_DAYS[step]));
    }

    function modeOf(problem) {
        return problem && problem.reinforce ? problem.reinforce.mode : null;
    }

    function isQueued(problem) {
        return modeOf(problem) === 'queued';
    }

    /**
     * Decide schedule overrides after a review.
     *
     * @param {Object} args
     * @param {Object} args.problem          problem BEFORE this review (history without it)
     * @param {number} args.rating           1..4
     * @param {Date}   args.now
     * @param {string|Date} args.fsrsNextReviewDate  what FSRS proposed
     * @param {string[]} [args.intensiveSlugs] slugs currently in the intensive pool
     * @param {number} [args.poolSize]
     * @returns {{nextReviewDate: string, reinforce: Object|null, joinedIntensive: boolean, leftIntensive: boolean}}
     */
    function scheduleAfterReview({ problem, rating, now, fsrsNextReviewDate, intensiveSlugs = [], poolSize = DEFAULT_POOL_SIZE }) {
        const r = Number(rating);
        const nowDate = now instanceof Date ? now : new Date(now);
        const nowISO = nowDate.toISOString();
        const fsrsDate = fsrsNextReviewDate ? new Date(fsrsNextReviewDate) : null;
        const prev = problem && problem.reinforce ? problem.reinforce : null;
        const slug = problem && problem.slug;
        const history = [...((problem && problem.history) || []), { date: nowISO, rating: r }];
        const pool = Array.isArray(intensiveSlugs) ? intensiveSlugs : [];
        const size = normalizePoolSize(poolSize);
        const fallback = fsrsDate || addDays(nowDate, 1);

        if (!Number.isFinite(r) || r < 1 || r > 4) {
            return { nextReviewDate: fallback.toISOString(), reinforce: prev, joinedIntensive: false, leftIntensive: false };
        }

        const wasIntensive = Boolean(prev && prev.mode === 'intensive');

        if (r <= 2) {
            const inPool = wasIntensive || pool.includes(slug);
            const hasRoom = pool.filter(s => s !== slug).length < size;
            // Stays intensive on any bad rating; enters it after 3 bad ratings in a row.
            if ((wasIntensive || weakStreak(history) >= STUBBORN_STREAK) && (inPool || hasRoom)) {
                const due = nextIntensiveDue(history, nowDate);
                return {
                    nextReviewDate: due.date.toISOString(),
                    reinforce: {
                        mode: 'intensive',
                        step: 0,
                        goodStreak: 0,
                        intraday: due.intraday,
                        since: wasIntensive && prev.since ? prev.since : nowISO
                    },
                    joinedIntensive: !inPool,
                    leftIntensive: false
                };
            }
            // Relearn: a bad rating steps back one step instead of restarting.
            const inRelearn = prev && prev.mode === 'relearn';
            const step = inRelearn ? Math.max(0, (Number(prev.step) || 0) - 1) : 0;
            return {
                nextReviewDate: relearnDue(step, nowDate, fsrsDate).toISOString(),
                reinforce: { mode: 'relearn', step, goodStreak: 0, intraday: false, since: inRelearn && prev.since ? prev.since : nowISO },
                joinedIntensive: false,
                leftIntensive: wasIntensive
            };
        }

        // rating >= 3
        const isFirstReview = sortedHistory(problem && problem.history).length === 0;
        if (isFirstReview) {
            return {
                nextReviewDate: addDays(nowDate, CONSOLIDATE_STEPS_DAYS[0]).toISOString(),
                reinforce: { mode: 'consolidate', step: 0, goodStreak: 0, intraday: false, since: nowISO },
                joinedIntensive: false,
                leftIntensive: false
            };
        }

        if (prev && prev.mode === 'consolidate') {
            const step = (Number(prev.step) || 0) + 1;
            if (step < CONSOLIDATE_STEPS_DAYS.length) {
                return {
                    nextReviewDate: addDays(nowDate, CONSOLIDATE_STEPS_DAYS[step]).toISOString(),
                    reinforce: { ...prev, step, intraday: false },
                    joinedIntensive: false,
                    leftIntensive: false
                };
            }
        }
        if (wasIntensive) {
            const goodStreak = (Number(prev.goodStreak) || 0) + 1;
            if (goodStreak >= EXIT_INTENSIVE_GOOD_STREAK) {
                return {
                    nextReviewDate: relearnDue(0, nowDate, fsrsDate).toISOString(),
                    reinforce: { mode: 'relearn', step: 0, goodStreak: 0, intraday: false, since: nowISO },
                    joinedIntensive: false,
                    leftIntensive: true
                };
            }
            const due = nextIntensiveDue(history, nowDate);
            return {
                nextReviewDate: due.date.toISOString(),
                reinforce: { ...prev, goodStreak, intraday: due.intraday },
                joinedIntensive: false,
                leftIntensive: false
            };
        }

        if (prev && prev.mode === 'relearn') {
            const step = (Number(prev.step) || 0) + 1;
            if (step < RELEARN_STEPS_DAYS.length) {
                return {
                    nextReviewDate: relearnDue(step, nowDate, fsrsDate).toISOString(),
                    reinforce: { ...prev, step, intraday: false },
                    joinedIntensive: false,
                    leftIntensive: false
                };
            }
        }

        return { nextReviewDate: fallback.toISOString(), reinforce: null, joinedIntensive: false, leftIntensive: false };
    }

    /**
     * Whether a second review of the same problem on the same day should be
     * recorded (normally same-day repeats are ignored as duplicates).
     */
    function allowsSameDayReview(problem, now) {
        if (!problem || !problem.reinforce || problem.reinforce.mode !== 'intensive') return false;
        const due = new Date(problem.nextReviewDate);
        if (!Number.isFinite(due.getTime())) return false;
        const n = now instanceof Date ? now : new Date(now);
        return due.getTime() <= n.getTime();
    }

    /**
     * One-time setup for problems recorded before reinforcement existed (or
     * imported): a last rating <= 2 puts the problem in the queue. Queued
     * problems are not planned until the daily plan admits them.
     * Returns a new problem object or the same one.
     */
    function bootstrapProblem(problem) {
        if (!problem || problem.reinforce) return problem;
        const rated = ratedHistory(problem.history);
        if (!rated.length || Number(rated[rated.length - 1].rating) > 2) return problem;
        return {
            ...problem,
            reinforce: { mode: 'queued', step: 0, goodStreak: 0, intraday: false, since: new Date(rated[rated.length - 1].date).toISOString() }
        };
    }

    /** Take a queued problem into relearn, due now. */
    function admitQueued(problem, now) {
        const nowDate = now instanceof Date ? now : new Date(now);
        return {
            ...problem,
            nextReviewDate: nowDate.toISOString(),
            reinforce: { mode: 'relearn', step: 0, goodStreak: 0, intraday: false, since: nowDate.toISOString() }
        };
    }

    /**
     * Pick today's intensive pool: keep current intensive problems, then fill
     * free slots with the most stubborn problems (longest weak streak, harder first).
     * Returns { pool: string[], promoted: string[] }.
     */
    function selectIntensivePool(problems, poolSize) {
        const size = normalizePoolSize(poolSize);
        const weight = { easy: 1, medium: 2, hard: 3 };
        const all = Object.values(problems || {}).filter(p => p && p.slug);
        const current = all.filter(p => p.reinforce && p.reinforce.mode === 'intensive').map(p => p.slug);
        const pool = current.slice();
        const promoted = [];
        if (pool.length < size) {
            const candidates = all
                .filter(p => !pool.includes(p.slug) && !isQueued(p) && isStubborn(p.history))
                .map(p => ({ slug: p.slug, streak: weakStreak(p.history), w: weight[String(p.difficulty || 'medium').toLowerCase()] || 2 }))
                .sort((a, b) => b.streak - a.streak || b.w - a.w || (a.slug < b.slug ? -1 : 1));
            for (const c of candidates) {
                if (pool.length >= size) break;
                pool.push(c.slug);
                promoted.push(c.slug);
            }
        }
        return { pool, promoted };
    }

    /** Put a promoted problem into intensive mode, due right away. */
    function promoteToIntensive(problem, now) {
        const nowDate = now instanceof Date ? now : new Date(now);
        const current = problem.nextReviewDate ? new Date(problem.nextReviewDate) : nowDate;
        const due = minDate(Number.isFinite(current.getTime()) ? current : nowDate, nowDate);
        return {
            ...problem,
            nextReviewDate: due.toISOString(),
            reinforce: { mode: 'intensive', step: 0, goodStreak: 0, intraday: true, since: nowDate.toISOString() }
        };
    }

    return {
        RELEARN_STEPS_DAYS,
        CONSOLIDATE_STEPS_DAYS,
        STUBBORN_STREAK,
        INTRADAY_GAP_HOURS,
        DEFAULT_POOL_SIZE,
        MAX_POOL_SIZE,
        toKey,
        weakStreak,
        isStubborn,
        lastRating,
        intensiveTarget,
        practicesOnDay,
        nextIntensiveDue,
        normalizePoolSize,
        scheduleAfterReview,
        allowsSameDayReview,
        bootstrapProblem,
        admitQueued,
        isQueued,
        selectIntensivePool,
        promoteToIntensive
    };
}));
