/**
 * LeetCode EasyRepeat - Same-day practice reminders (一天多练提醒)
 *
 * Intensive problems get a 2nd/3rd practice a few hours after the previous one.
 * This module keeps one chrome.alarm set for the next such practice and shows
 * a system notification when it is due. Clicking the notification opens the
 * problem(s) as review tabs (editor auto-reset).
 */
(function (root, factory) {
    const exports = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = exports;
    }
    if (typeof root !== 'undefined' && root) {
        root.PracticeReminder = exports;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    const ALARM_NAME = 'EASYREPEAT_PRACTICE_REMINDER';
    const NOTIFICATION_PREFIX = 'easyrepeat-practice:';
    const SENT_KEY = 'practiceRemindersSent';
    const ICON = 'src/assets/icons/icon128.png';
    const GRACE_MS = 30 * 1000;

    function isIntraday(problem) {
        return Boolean(problem && problem.reinforce && problem.reinforce.mode === 'intensive'
            && problem.reinforce.intraday && problem.nextReviewDate);
    }

    /** Problems whose same-day practice is due and not yet announced. */
    function dueForReminder(problems, now, sent = {}) {
        const t = now.getTime();
        return Object.values(problems || {})
            .filter(isIntraday)
            .filter(p => new Date(p.nextReviewDate).getTime() <= t + GRACE_MS)
            .filter(p => sent[p.slug] !== p.nextReviewDate)
            .sort((a, b) => new Date(a.nextReviewDate) - new Date(b.nextReviewDate));
    }

    /** Earliest future same-day practice time, or null. */
    function nextReminderTime(problems, now) {
        const t = now.getTime();
        let best = null;
        for (const p of Object.values(problems || {})) {
            if (!isIntraday(p)) continue;
            const due = new Date(p.nextReviewDate).getTime();
            if (Number.isFinite(due) && due > t + GRACE_MS && (best === null || due < best)) best = due;
        }
        return best;
    }

    function pruneSent(problems, sent) {
        const out = {};
        for (const [slug, iso] of Object.entries(sent || {})) {
            const p = problems && problems[slug];
            if (p && isIntraday(p) && p.nextReviewDate === iso) out[slug] = iso;
        }
        return out;
    }

    function buildMessage(due, language, practiceIndex) {
        const zh = String(language || '').startsWith('zh');
        const names = due.map(p => p.title || p.slug);
        const shown = names.slice(0, 3).join(zh ? '、' : ', ') + (names.length > 3 ? (zh ? ` 等 ${names.length} 题` : ` +${names.length - 3} more`) : '');
        const first = due[0];
        const idx = practiceIndex(first);
        return {
            title: zh ? 'EasyRepeat：该加练了' : 'EasyRepeat: practice time',
            message: zh
                ? `${shown}${idx ? `（今天第 ${idx} 练）` : ''}。点这里打开并重置代码。`
                : `${shown}${idx ? ` (practice #${idx} today)` : ''}. Click to open with a fresh editor.`
        };
    }

    function register() {
        if (typeof chrome === 'undefined' || !chrome.alarms || !chrome.storage) return;
        const R = () => (typeof self !== 'undefined' && self.Reinforcement) || null;
        const RR = () => (typeof self !== 'undefined' && self.ReviewReset) || null;

        async function reschedule() {
            const { problems } = await chrome.storage.local.get({ problems: {} });
            const when = nextReminderTime(problems, new Date());
            await chrome.alarms.clear(ALARM_NAME);
            if (when) chrome.alarms.create(ALARM_NAME, { when });
        }

        async function fire() {
            const state = await chrome.storage.local.get({ problems: {}, [SENT_KEY]: {}, uiLanguage: 'en' });
            const now = new Date();
            const sent = pruneSent(state.problems, state[SENT_KEY]);
            const due = dueForReminder(state.problems, now, sent);
            if (due.length && chrome.notifications) {
                const practiceIndex = (p) => {
                    const r = R();
                    return r ? r.practicesOnDay(p.history, now) + 1 : null;
                };
                const { title, message } = buildMessage(due, state.uiLanguage, practiceIndex);
                const id = NOTIFICATION_PREFIX + due.map(p => p.slug).join(',');
                chrome.notifications.create(id, {
                    type: 'basic',
                    iconUrl: chrome.runtime.getURL(ICON),
                    title,
                    message,
                    priority: 2,
                    requireInteraction: true
                });
                for (const p of due) sent[p.slug] = p.nextReviewDate;
            }
            await chrome.storage.local.set({ [SENT_KEY]: sent });
            await reschedule();
        }

        chrome.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === ALARM_NAME) void fire().catch(e => console.warn('[PracticeReminder] fire failed:', e));
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.problems) void reschedule().catch(() => {});
        });

        if (chrome.notifications && chrome.notifications.onClicked) {
            chrome.notifications.onClicked.addListener(async (notificationId) => {
                if (!notificationId.startsWith(NOTIFICATION_PREFIX)) return;
                const slugs = notificationId.slice(NOTIFICATION_PREFIX.length).split(',').filter(Boolean);
                chrome.notifications.clear(notificationId);
                const rr = RR();
                const { lastLeetCodeBase } = await chrome.storage.local.get({ lastLeetCodeBase: 'https://leetcode.com' });
                if (rr) {
                    const stored = await chrome.storage.local.get({ [rr.STORAGE_KEY]: {} });
                    await chrome.storage.local.set({ [rr.STORAGE_KEY]: rr.mark(stored[rr.STORAGE_KEY], slugs, Date.now()) });
                }
                slugs.forEach((slug, i) => {
                    const url = rr ? rr.problemUrl(lastLeetCodeBase, slug) : `${lastLeetCodeBase}/problems/${slug}/`;
                    chrome.tabs.create({ url, active: i === 0 });
                });
            });
        }

        // Catch up after browser start / service worker wake-up.
        void fire().catch(() => {});
    }

    return { ALARM_NAME, NOTIFICATION_PREFIX, dueForReminder, nextReminderTime, pruneSent, buildMessage, register };
}));
