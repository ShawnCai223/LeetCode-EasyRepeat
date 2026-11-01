/**
 * LeetCode EasyRepeat - Merge-import review history from a JSON backup
 *
 * Unlike "Restore from Backup" (which wipes and replaces everything), this
 * merges only the review data from a backup file into the current data:
 *   - problems: history entries are unioned (deduplicated by timestamp);
 *     scheduling fields come from whichever side was reviewed more recently;
 *     notes are kept (different imported notes are appended, never dropped);
 *     topics are unioned.
 *   - activityLog: unioned, plus the days of newly imported reviews.
 *   - localizedProblemTitles: missing titles are filled in.
 * Settings, API keys, leave days and everything else are left untouched.
 *
 * Accepts the extension's backup formats (v2 with indexedDBData, v1 with a
 * `data` envelope, or a raw storage object).
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.HistoryImport = exports;
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {

    const SCHEDULE_FIELDS = [
        'interval', 'repetition', 'easeFactor', 'nextReviewDate', 'lastSolved',
        'fsrs_stability', 'fsrs_difficulty', 'fsrs_state', 'fsrs_last_review', 'reinforce'
    ];
    const NOTES_SEPARATOR = '\n\n— imported —\n';
    const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

    function isPlainObject(v) {
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    }

    function pad(n) {
        return String(n).padStart(2, '0');
    }

    function localDayKey(date) {
        const d = new Date(date);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    function validTime(value) {
        const t = new Date(value).getTime();
        return Number.isFinite(t) ? t : null;
    }

    /**
     * Pull the review data out of a parsed backup file.
     * @returns {{problems: Object, activityLog: string[], localizedProblemTitles: Object, exportedAt: string}}
     */
    function parseBackup(parsed) {
        let data = null;
        if (isPlainObject(parsed) && isPlainObject(parsed.data)) data = parsed.data;
        else if (isPlainObject(parsed)) data = parsed;
        if (!data || !isPlainObject(data.problems)) {
            throw new Error('no_problems');
        }
        return {
            problems: data.problems,
            activityLog: Array.isArray(data.activityLog) ? data.activityLog : [],
            localizedProblemTitles: isPlainObject(data.localizedProblemTitles) ? data.localizedProblemTitles : {},
            exportedAt: (isPlainObject(parsed) && typeof parsed.exportedAt === 'string') ? parsed.exportedAt : ''
        };
    }

    function cleanHistory(history) {
        const out = [];
        for (const h of Array.isArray(history) ? history : []) {
            if (!isPlainObject(h)) continue;
            const t = validTime(h.date);
            if (t === null) continue;
            out.push({ ...h, date: new Date(t).toISOString() });
        }
        return out;
    }

    function latestTime(history) {
        let best = -Infinity;
        for (const h of history) {
            const t = validTime(h.date);
            if (t !== null && t > best) best = t;
        }
        return best;
    }

    function mergeOne(current, incoming, slug) {
        const curHist = cleanHistory(current.history);
        const incHist = cleanHistory(incoming.history);
        const seen = new Set(curHist.map(h => h.date));
        const added = incHist.filter(h => !seen.has(h.date) && seen.add(h.date));
        const history = [...curHist, ...added].sort((a, b) => new Date(a.date) - new Date(b.date));

        const merged = { ...current, slug, history };
        let changed = added.length > 0;

        if (latestTime(incHist) > latestTime(curHist)) {
            for (const field of SCHEDULE_FIELDS) {
                if (incoming[field] !== undefined) merged[field] = incoming[field];
                else if (field === 'reinforce') delete merged[field];
            }
            changed = true;
        }

        const curTopics = Array.isArray(current.topics) ? current.topics : [];
        const incTopics = Array.isArray(incoming.topics) ? incoming.topics : [];
        const topics = Array.from(new Set([...curTopics, ...incTopics]));
        if (topics.length !== curTopics.length) {
            merged.topics = topics;
            changed = true;
        }

        for (const field of ['title', 'difficulty']) {
            if (!merged[field] && incoming[field]) {
                merged[field] = incoming[field];
                changed = true;
            }
        }

        let notesAppended = false;
        const curNotes = typeof current.notes === 'string' ? current.notes.trim() : '';
        const incNotes = typeof incoming.notes === 'string' ? incoming.notes.trim() : '';
        if (incNotes && !curNotes) {
            merged.notes = incoming.notes;
            changed = true;
        } else if (incNotes && curNotes && !current.notes.includes(incNotes)) {
            merged.notes = current.notes + NOTES_SEPARATOR + incoming.notes;
            notesAppended = true;
            changed = true;
        }

        return { merged, changed, historyAdded: added.length, addedEntries: added, notesAppended };
    }

    /**
     * Merge imported review data into the current data. Pure: inputs are not mutated.
     *
     * @param {{problems?: Object, activityLog?: string[], localizedProblemTitles?: Object}} current
     * @param {{problems: Object, activityLog?: string[], localizedProblemTitles?: Object}} incoming
     * @param {{prepareProblem?: Function}} [options] hook applied to new/updated problems
     */
    function mergeReviewData(current, incoming, options = {}) {
        const prepare = typeof options.prepareProblem === 'function' ? options.prepareProblem : (p) => p;
        const curProblems = isPlainObject(current && current.problems) ? current.problems : {};
        const incProblems = isPlainObject(incoming && incoming.problems) ? incoming.problems : {};
        const problems = { ...curProblems };
        const stats = { added: 0, merged: 0, unchanged: 0, skipped: 0, historyAdded: 0, notesAppended: 0, activityAdded: 0, titlesAdded: 0 };
        const newDays = new Set();

        for (const [key, raw] of Object.entries(incProblems)) {
            const slug = (isPlainObject(raw) && typeof raw.slug === 'string' && raw.slug) || key;
            if (!isPlainObject(raw) || !slug || !Array.isArray(raw.history)) {
                stats.skipped++;
                continue;
            }
            const existing = curProblems[slug];
            if (!existing) {
                const history = cleanHistory(raw.history).sort((a, b) => new Date(a.date) - new Date(b.date));
                problems[slug] = prepare({ ...raw, slug, history });
                stats.added++;
                stats.historyAdded += history.length;
                history.forEach(h => newDays.add(localDayKey(h.date)));
                continue;
            }
            const result = mergeOne(existing, raw, slug);
            if (!result.changed) {
                stats.unchanged++;
                continue;
            }
            problems[slug] = prepare(result.merged);
            stats.merged++;
            stats.historyAdded += result.historyAdded;
            if (result.notesAppended) stats.notesAppended++;
            result.addedEntries.forEach(h => newDays.add(localDayKey(h.date)));
        }

        const curLog = Array.isArray(current && current.activityLog) ? current.activityLog.filter(d => DAY_RE.test(d)) : [];
        const incLog = Array.isArray(incoming && incoming.activityLog) ? incoming.activityLog.filter(d => DAY_RE.test(d)) : [];
        const logSet = new Set(curLog);
        for (const d of [...incLog, ...newDays]) {
            if (!logSet.has(d)) {
                logSet.add(d);
                stats.activityAdded++;
            }
        }
        const activityLog = Array.from(logSet).sort();

        const curTitles = isPlainObject(current && current.localizedProblemTitles) ? current.localizedProblemTitles : {};
        const incTitles = isPlainObject(incoming && incoming.localizedProblemTitles) ? incoming.localizedProblemTitles : {};
        const localizedProblemTitles = { ...curTitles };
        for (const [slug, value] of Object.entries(incTitles)) {
            if (!localizedProblemTitles[slug] && isPlainObject(value)) {
                localizedProblemTitles[slug] = value;
                stats.titlesAdded++;
            }
        }

        return { problems, activityLog, localizedProblemTitles, stats };
    }

    return { parseBackup, mergeReviewData, SCHEDULE_FIELDS };
}));
