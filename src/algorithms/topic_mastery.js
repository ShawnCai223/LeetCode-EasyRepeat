/**
 * LeetCode EasyRepeat - Topic mastery (专题掌握度)
 *
 * A topic is weak when it is clearly below the user's OWN level, not below a
 * fixed bar (most learners sit around 50% at some point, and a fixed bar would
 * flag almost everything):
 *
 * - Rate = share of "good" ratings (Good/Easy) among the topic's reviews in the
 *   last 30 days. Overall rate = the same over all reviews.
 * - A topic is judged only with at least 5 problems and 8 ratings.
 * - Tags on more than 30% of the user's problems (e.g. Array) are too broad to
 *   say anything and are left out.
 * - Weak  = rate at least 15 points below the overall rate.
 *   Strong = rate at least 15 points above it.
 *
 * Weak topics are reviewed more often (see Reinforcement.weakTopicGap) and get
 * priority in the daily plan.
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.TopicMastery = exports;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    const DEFAULTS = {
        windowDays: 30,
        minProblems: 5,
        minRatings: 8,
        gapPoints: 15,
        broadShare: 0.3
    };
    const DAY_MS = 24 * 60 * 60 * 1000;

    function broadTags(problems, share) {
        const list = Object.values(problems || {}).filter(Boolean);
        const counts = new Map();
        for (const p of list) {
            for (const t of new Set(Array.isArray(p.topics) ? p.topics : [])) counts.set(t, (counts.get(t) || 0) + 1);
        }
        const out = new Set();
        for (const [t, c] of counts) if (list.length >= 10 && c / list.length > share) out.add(t);
        return out;
    }

    /**
     * @returns {{overall:number|null, ratings:number, topics:Array<{topic:string, problems:number, ratings:number, rate:number, status:'weak'|'normal'|'strong'}>, weak:string[], strong:string[]}}
     * rates are percentages (0-100), rounded.
     */
    function computeTopicMastery(problems, today, options = {}) {
        const opt = { ...DEFAULTS, ...options };
        const now = today ? new Date(today) : new Date();
        const since = now.getTime() - opt.windowDays * DAY_MS;
        const broad = broadTags(problems, opt.broadShare);
        const stats = new Map();
        let total = 0;
        let good = 0;
        for (const p of Object.values(problems || {})) {
            if (!p || !Array.isArray(p.history)) continue;
            const recent = p.history.filter(h => {
                const t = new Date(h && h.date).getTime();
                return Number.isFinite(t) && t >= since && t <= now.getTime() && Number(h.rating) >= 1;
            });
            if (!recent.length) continue;
            const g = recent.filter(h => Number(h.rating) >= 3).length;
            total += recent.length;
            good += g;
            for (const topic of new Set(Array.isArray(p.topics) ? p.topics : [])) {
                if (broad.has(topic)) continue;
                const s = stats.get(topic) || { problems: 0, ratings: 0, good: 0 };
                s.problems += 1;
                s.ratings += recent.length;
                s.good += g;
                stats.set(topic, s);
            }
        }
        if (!total) return { overall: null, ratings: 0, topics: [], weak: [], strong: [] };
        const overall = (good / total) * 100;
        const topics = [];
        for (const [topic, s] of stats) {
            if (s.problems < opt.minProblems || s.ratings < opt.minRatings) continue;
            const rate = (s.good / s.ratings) * 100;
            const status = rate <= overall - opt.gapPoints ? 'weak' : rate >= overall + opt.gapPoints ? 'strong' : 'normal';
            topics.push({ topic, problems: s.problems, ratings: s.ratings, rate: Math.round(rate), status });
        }
        topics.sort((a, b) => a.rate - b.rate || b.ratings - a.ratings || (a.topic < b.topic ? -1 : 1));
        return {
            overall: Math.round(overall),
            ratings: total,
            topics,
            weak: topics.filter(t => t.status === 'weak').map(t => t.topic),
            strong: topics.filter(t => t.status === 'strong').map(t => t.topic)
        };
    }

    function isInWeakTopic(problem, weakTopics) {
        if (!problem || !Array.isArray(problem.topics) || !weakTopics || !weakTopics.length) return false;
        return problem.topics.some(t => weakTopics.includes(t));
    }

    /** LeetCode problem list for a topic ("Heap (Priority Queue)" → /problem-list/heap-priority-queue/). */
    function topicUrl(base, topic) {
        const slug = String(topic || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `${String(base || 'https://leetcode.com').replace(/\/$/, '')}/problem-list/${slug}/`;
    }

    return { DEFAULTS, computeTopicMastery, isInWeakTopic, topicUrl };
}));
