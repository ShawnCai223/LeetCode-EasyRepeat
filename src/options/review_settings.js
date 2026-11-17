/**
 * LeetCode EasyRepeat - Review settings card on the options page:
 * how reviews are scheduled, and the daily maximum.
 *
 * Self-contained like leave_settings.js: own strings, follows `uiLanguage`.
 */
import '../algorithms/schedule.js';
import '../algorithms/daily_reviews.js';

const STRINGS = {
    en: {
        heading: '🔁 Reviews',
        rules: [
            'Rate what happened this time: Couldn\'t (couldn\'t write it, or used hints), Stuck (got it, but got stuck or fixed bugs a few times), Solved (wrote it yourself, fairly smoothly). The rating window suggests one from your submissions: Solved if accepted on the first try, Stuck if there were wrong submissions.',
            'Couldn\'t: practise it every day until a day you don\'t rate it Couldn\'t, then one more day to confirm; after that it goes back to the normal schedule. At most 5 problems in daily practice and 5 on their confirm day come up on the same day.',
            'Stuck: again in 2 days. Solved: the gap roughly doubles — 3, 7, 15, 30, 60 days. Stuck steps the gap back one; Couldn\'t starts it over.',
            'Reviews a day start from what you have been doing (your average on the days you reviewed) and go up by 1 after a day you finished them all, never above your maximum. New problems are not limited. Problems that don\'t fit today come up on the next days; the backlog isn\'t shown.'
        ],
        max_label: 'Most reviews a day',
        max_hint: 'A whole number from 3 to 60 (default 15).',
        save: 'Save',
        saved: '✅ Saved.',
        invalid: 'Enter a whole number from 3 to 60.',
        today: 'Today: {target} reviews (most {max}).'
    },
    zh: {
        heading: '🔁 复习',
        rules: [
            '按这次的实际情况评分：不会（写不出来，或看了提示）、卡壳（写出来了，但卡了很久或改了好几次 bug）、写出来了（自己写出来，过程比较顺）。评分窗口会按你的提交给出建议：一次就通过建议「写出来了」，提交错过建议「卡壳」。',
            '不会：每天都练，直到某天不再评「不会」，再练一天确认，之后回到正常间隔。每天最多 5 道「每天练」、5 道「再练一天」。',
            '卡壳：两天后再做。写出来了：间隔大约翻倍——3、7、15、30、60 天。评「卡壳」间隔退回一档，评「不会」从头开始。',
            '每天复习量从你平时做得到的量起步（你复习那些天的平均），某天全部做完后第二天 +1，不超过你设的上限。新题不限量。今天放不下的题会排到后面几天，不显示积压。'
        ],
        max_label: '每天最多复习',
        max_hint: '3 到 60 的整数（默认 15）。',
        save: '保存',
        saved: '✅ 已保存。',
        invalid: '请输入 3 到 60 的整数。',
        today: '今天：复习 {target} 道（最多 {max} 道）。'
    }
};

const DR = () => (typeof self !== 'undefined' ? self.DailyReviews : window.DailyReviews);
let lang = 'en';

function t(key, values = {}) {
    const table = STRINGS[lang] || STRINGS.en;
    const template = table[key] ?? STRINGS.en[key] ?? key;
    if (Array.isArray(template)) return template;
    return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

function langFrom(value) {
    return String(value || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function buildCard() {
    const card = document.createElement('section');
    card.className = 'card';
    card.id = 'review-card';
    card.innerHTML = `
        <h2 data-rv="heading"></h2>
        <ul class="hint" id="rv-rules" style="margin: 6px 0 12px; padding-left: 18px;"></ul>
        <div class="grid" style="gap: 15px;">
            <div class="field">
                <label for="rv-max" data-rv="max_label"></label>
                <input type="number" id="rv-max" min="3" max="60" step="1">
                <span class="hint" data-rv="max_hint"></span>
            </div>
        </div>
        <div class="actions">
            <button id="rv-save-btn" class="btn" data-rv="save"></button>
            <span id="rv-save-status" class="status-text"></span>
        </div>
        <p class="hint" id="rv-today" style="margin-top: 10px;"></p>
    `;
    return card;
}

async function render(card) {
    card.querySelectorAll('[data-rv]').forEach(el => { el.textContent = t(el.dataset.rv); });
    const rules = card.querySelector('#rv-rules');
    rules.innerHTML = '';
    for (const line of t('rules')) {
        const li = document.createElement('li');
        li.textContent = line;
        rules.appendChild(li);
    }
    const state = await chrome.storage.local.get({ problems: {}, dailyReviews: null, dailyReviewSettings: null });
    const D = DR();
    if (!D) return;
    const input = card.querySelector('#rv-max');
    if (document.activeElement !== input) input.value = String(D.maxOf(state.dailyReviewSettings));
    const day = D.today(state.problems || {}, new Date(), state.dailyReviews, state.dailyReviewSettings);
    card.querySelector('#rv-today').textContent = t('today', { target: day.target, max: day.max });
}

async function init() {
    if (!chrome?.storage?.local) return;
    const anchor = document.getElementById('leave-card') || document.getElementById('tools-card');
    const card = buildCard();
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor);
    else (document.querySelector('main') || document.body).appendChild(card);

    const stored = await chrome.storage.local.get({ uiLanguage: 'en' });
    lang = langFrom(stored.uiLanguage);
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.addEventListener('change', () => {
            lang = langFrom(langSelect.value);
            void render(card);
        });
    }

    card.querySelector('#rv-save-btn').addEventListener('click', async () => {
        const status = card.querySelector('#rv-save-status');
        const n = Number(card.querySelector('#rv-max').value.trim());
        if (!Number.isInteger(n) || n < 3 || n > 60) {
            status.textContent = t('invalid');
            status.className = 'status-text error';
            return;
        }
        await chrome.storage.local.set({ dailyReviewSettings: { max: n } });
        status.textContent = t('saved');
        status.className = 'status-text success';
        await render(card);
    });

    chrome.storage.onChanged?.addListener((changes, area) => {
        if (area === 'local' && (changes.dailyReviews || changes.dailyReviewSettings)) void render(card);
    });

    await render(card);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { void init(); });
    } else {
        void init();
    }
}

export { init as initReviewSettings, STRINGS as REVIEW_STRINGS };
