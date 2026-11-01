/**
 * LeetCode EasyRepeat - Options page: review plan settings + merge import.
 *
 * Card 1 (加强复习): how many stubborn problems may be in multi-practice mode
 *   at the same time, plus a short explanation of the rules.
 * Card 2 (合并导入历史记录): merge review history from a backup JSON without
 *   replacing settings (the existing "Restore" replaces everything).
 */
import '../algorithms/reinforcement.js';
import '../shared/history_import.js';

const STRINGS = {
    en: {
        rv_heading: '🔁 Reinforcement & daily plan',
        rv_rules: [
            'Rating guide: Easy = wrote it and can explain it · Good = wrote it, can\'t explain it · Hard = wrote it with hints · Again = couldn\'t write it.',
            'New problem rated Good/Easy the first time: reviewed again after 3, 8 and 20 days, then the normal schedule.',
            'Hard or Again always triggers short-term review: after 1, 3 and 7 days, then the normal schedule. A bad rating during these steps goes back one step.',
            'A problem rated Hard/Again 3 times in a row is "stubborn": practised 2× a day (3× if it keeps failing), 4 hours apart, until rated Good/Easy twice in a row. You get a notification for each extra practice.',
            'Daily budget follows your average over your last 14 active days (new problems included), or the number below. Weak problems from your history are queued and let in as the budget allows.'
        ],
        rv_budget_label: 'About how many problems a day (blank = automatic)',
        rv_budget_hint: 'Includes new problems. With 3 a day, about 2–3 new problems a week fit; with 5 a day, about 3–4. Blank = follow your recent pace (it only goes up automatically; lower it here).',
        rv_budget_invalid: 'Enter a whole number from 1 to 50, or leave it blank.',
        rv_pool_label: 'Stubborn problems practised several times a day (at once)',
        rv_pool_hint: 'Others wait in short-interval review until a slot frees up. 0 turns multi-practice off.',
        rv_save: 'Save',
        rv_saved: '✅ Saved.',
        rv_invalid: 'Enter a whole number from 0 to {max}.',
        rv_status: 'Now: {intensive} in multi-practice · {stubborn} stubborn · {relearn} in short-term review · {queued} queued',
        im_heading: '📥 Merge-import review history',
        im_hint: 'Merge the review history from a backup JSON into your current data. Unlike "Restore", nothing is replaced: histories are combined, the most recent schedule wins, notes are kept, settings and keys are not touched.',
        im_button: 'Choose Backup JSON to Merge',
        im_parse_failed: 'Could not read this file as JSON.',
        im_no_problems: 'This file has no review history (no "problems").',
        im_confirm: 'Merge this backup?\n\n• {added} new problems\n• {merged} existing problems updated\n• {historyAdded} review records imported in total\n• {unchanged} problems already up to date\n• {activityAdded} activity days added\n\nTip: export a backup first if you want to be able to undo.',
        im_nothing: 'Nothing new to import — your data already contains everything in this file.',
        im_cancelled: 'Import cancelled.',
        im_done: '✅ Merged: {added} new problems, {merged} updated, {historyAdded} review records imported.'
    },
    zh: {
        rv_heading: '🔁 加强复习与每日计划',
        rv_rules: [
            '评分含义：简单 = 会写会说 · 正常 = 会写不会说 · 困难 = 按照提示写了出来 · 重来 = 完全不会写。',
            '新题第一次就评「正常/简单」：隔 3 天、8 天、20 天各复习一次，然后回到正常排期。',
            '评「困难」或「重来」，不管以前表现如何，都会进入短期加强：隔 1 天、3 天、7 天各复习一次；加强期间再评差，退回一步。',
            '连续 3 次评「困难/重来」的题算「顽固题」：一天练 2 次（一直失败则 3 次），间隔 4 小时，直到连续 2 次评「正常/简单」。每次加练都会弹系统通知。',
            '每天的预算取你最近 14 个做题日的平均（含新题），也可以在下面填固定题数。历史里的薄弱题先排队，预算有余量时再逐步放进来。'
        ],
        rv_budget_label: '每天大概做几题（留空 = 自动）',
        rv_budget_hint: '包含新题。每天 3 题大约每周能学 2–3 道新题，每天 5 题大约 3–4 道。留空 = 跟随你最近的节奏（只会自动调高，想调低就在这里填）。',
        rv_budget_invalid: '请输入 1 到 50 的整数，或者留空。',
        rv_pool_label: '同时一天多练的顽固题数量',
        rv_pool_hint: '其余顽固题先走短间隔加强，有空位时按最顽固的顺序补进来。填 0 关闭一天多练。',
        rv_save: '保存',
        rv_saved: '✅ 已保存。',
        rv_invalid: '请输入 0 到 {max} 的整数。',
        rv_status: '当前：{intensive} 题一天多练 · {stubborn} 道顽固题 · {relearn} 题在短期加强 · {queued} 道排队中',
        im_heading: '📥 合并导入历史记录',
        im_hint: '把备份 JSON 里的做题历史合并进当前数据。和「从备份文件恢复」不同，这里不会覆盖任何东西：历史记录合并，排期以最近一次复习为准，笔记都保留，设置和密钥不动。',
        im_button: '选择要合并的备份 JSON',
        im_parse_failed: '无法把这个文件读成 JSON。',
        im_no_problems: '这个文件里没有做题记录（缺少 "problems"）。',
        im_confirm: '确定合并这个备份？\n\n• 新增 {added} 道题\n• 更新 {merged} 道已有的题\n• 共导入 {historyAdded} 条复习记录\n• {unchanged} 道题已是最新\n• 补充 {activityAdded} 个活跃日\n\n提示：如果想能撤销，先导出一份备份。',
        im_nothing: '没有需要导入的内容，当前数据已经包含这个文件里的全部记录。',
        im_cancelled: '已取消导入。',
        im_done: '✅ 合并完成：新增 {added} 道题，更新 {merged} 道，导入 {historyAdded} 条复习记录。'
    }
};

let lang = 'en';
const R = () => (typeof self !== 'undefined' ? self.Reinforcement : window.Reinforcement);
const HI = () => (typeof self !== 'undefined' ? self.HistoryImport : window.HistoryImport);

function t(key, values = {}) {
    const table = STRINGS[lang] || STRINGS.en;
    const template = table[key] ?? STRINGS.en[key] ?? key;
    if (Array.isArray(template)) return template;
    return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

function langFrom(value) {
    return String(value || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function setStatus(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = 'status-text ' + (type || '');
}

function buildReviewCard() {
    const card = document.createElement('section');
    card.className = 'card';
    card.id = 'review-plan-card';
    card.innerHTML = `
        <h2 data-rv="rv_heading"></h2>
        <ul class="hint" id="rv-rules" style="margin: 6px 0 12px; padding-left: 18px;"></ul>
        <div class="grid" style="gap: 15px;">
            <div class="field">
                <label for="rv-budget" data-rv="rv_budget_label"></label>
                <input type="number" id="rv-budget" min="1" max="50" step="1">
                <span class="hint" data-rv="rv_budget_hint"></span>
            </div>
            <div class="field">
                <label for="rv-pool" data-rv="rv_pool_label"></label>
                <input type="number" id="rv-pool" min="0" step="1">
                <span class="hint" data-rv="rv_pool_hint"></span>
            </div>
        </div>
        <div class="actions">
            <button id="rv-save-btn" class="btn" data-rv="rv_save"></button>
            <span id="rv-save-status" class="status-text"></span>
        </div>
        <p class="hint" id="rv-status" style="margin-top: 10px;"></p>
    `;
    return card;
}

function buildImportCard() {
    const card = document.createElement('section');
    card.className = 'card';
    card.id = 'history-import-card';
    card.innerHTML = `
        <h2 data-rv="im_heading"></h2>
        <p class="hint" data-rv="im_hint"></p>
        <input id="im-file" type="file" accept="application/json,.json" class="hidden" style="display:none;">
        <div class="actions">
            <button id="im-btn" class="btn secondary" data-rv="im_button"></button>
            <span id="im-status" class="status-text"></span>
        </div>
    `;
    return card;
}

async function renderReview(card) {
    const Rx = R();
    card.querySelectorAll('[data-rv]').forEach(node => { node.textContent = t(node.dataset.rv); });
    const rules = card.querySelector('#rv-rules');
    rules.innerHTML = '';
    for (const line of t('rv_rules')) {
        const li = document.createElement('li');
        li.textContent = line;
        li.style.marginBottom = '4px';
        rules.appendChild(li);
    }
    const state = await chrome.storage.local.get({ reviewSettings: null, problems: {} });
    const input = card.querySelector('#rv-pool');
    input.max = String(Rx.MAX_POOL_SIZE);
    if (document.activeElement !== input) {
        input.value = String(Rx.normalizePoolSize(state.reviewSettings ? state.reviewSettings.intensivePoolSize : undefined));
    }
    const budget = card.querySelector('#rv-budget');
    if (document.activeElement !== budget) {
        const n = Number(state.reviewSettings && state.reviewSettings.dailyProblems);
        budget.value = Number.isFinite(n) && n > 0 ? String(n) : '';
    }
    const all = Object.values(state.problems || {});
    card.querySelector('#rv-status').textContent = t('rv_status', {
        intensive: all.filter(p => p && p.reinforce && p.reinforce.mode === 'intensive').length,
        stubborn: all.filter(p => p && Rx.isStubborn(p.history)).length,
        relearn: all.filter(p => p && p.reinforce && p.reinforce.mode === 'relearn').length,
        queued: all.filter(p => p && p.reinforce && p.reinforce.mode === 'queued').length
    });
}

function renderImport(card) {
    card.querySelectorAll('[data-rv]').forEach(node => { node.textContent = t(node.dataset.rv); });
}

async function mergeFromFile(file, statusEl) {
    const hi = HI();
    const Rx = R();
    let parsed;
    try {
        parsed = JSON.parse(await file.text());
    } catch (e) {
        setStatus(statusEl, t('im_parse_failed'), 'error');
        return;
    }
    let incoming;
    try {
        incoming = hi.parseBackup(parsed);
    } catch (e) {
        setStatus(statusEl, t('im_no_problems'), 'error');
        return;
    }

    const current = await chrome.storage.local.get({ problems: {}, activityLog: [], localizedProblemTitles: {} });
    const prepareProblem = (p) => (Rx ? Rx.bootstrapProblem(p) : p);
    const preview = hi.mergeReviewData(current, incoming, { prepareProblem });
    const s = preview.stats;
    if (s.added === 0 && s.merged === 0 && s.activityAdded === 0 && s.titlesAdded === 0) {
        setStatus(statusEl, t('im_nothing'), '');
        return;
    }
    if (!window.confirm(t('im_confirm', s))) {
        setStatus(statusEl, t('im_cancelled'), '');
        return;
    }

    // Merge again against the freshest data right before writing.
    const fresh = await chrome.storage.local.get({ problems: {}, activityLog: [], localizedProblemTitles: {} });
    const result = hi.mergeReviewData(fresh, incoming, { prepareProblem });
    await chrome.storage.local.set({
        problems: result.problems,
        activityLog: result.activityLog,
        localizedProblemTitles: result.localizedProblemTitles
    });
    setStatus(statusEl, t('im_done', result.stats), 'ok');
}

async function init() {
    if (!R() || !HI() || !chrome?.storage?.local) return;

    const anchor = document.getElementById('tools-card');
    const reviewCard = buildReviewCard();
    const importCard = buildImportCard();
    const parent = anchor && anchor.parentNode ? anchor.parentNode : (document.querySelector('main') || document.body);
    parent.insertBefore(reviewCard, anchor && anchor.parentNode ? anchor : null);
    if (anchor && anchor.nextSibling) parent.insertBefore(importCard, anchor.nextSibling);
    else parent.appendChild(importCard);

    const stored = await chrome.storage.local.get({ uiLanguage: 'en' });
    lang = langFrom(stored.uiLanguage);
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.addEventListener('change', () => {
            lang = langFrom(langSelect.value);
            void renderReview(reviewCard);
            renderImport(importCard);
        });
    }

    reviewCard.querySelector('#rv-save-btn').addEventListener('click', async () => {
        const statusEl = reviewCard.querySelector('#rv-save-status');
        const raw = reviewCard.querySelector('#rv-pool').value;
        const n = Number(raw);
        const max = R().MAX_POOL_SIZE;
        if (raw === '' || !Number.isInteger(n) || n < 0 || n > max) {
            setStatus(statusEl, t('rv_invalid', { max }), 'error');
            return;
        }
        const rawBudget = reviewCard.querySelector('#rv-budget').value.trim();
        const budget = Number(rawBudget);
        if (rawBudget !== '' && (!Number.isInteger(budget) || budget < 1 || budget > 50)) {
            setStatus(statusEl, t('rv_budget_invalid'), 'error');
            return;
        }
        const cur = await chrome.storage.local.get({ reviewSettings: {}, reviewPlan: null });
        const nextSettings = { ...(cur.reviewSettings || {}), intensivePoolSize: n };
        if (rawBudget === '') delete nextSettings.dailyProblems;
        else nextSettings.dailyProblems = budget;
        // Drop today's frozen budget so the change applies right away.
        const plan = cur.reviewPlan && typeof cur.reviewPlan === 'object' ? { ...cur.reviewPlan } : null;
        if (plan) delete plan.capacityDate;
        await chrome.storage.local.set(plan ? { reviewSettings: nextSettings, reviewPlan: plan } : { reviewSettings: nextSettings });
        setStatus(statusEl, t('rv_saved'), 'ok');
        await renderReview(reviewCard);
    });

    const fileInput = importCard.querySelector('#im-file');
    importCard.querySelector('#im-btn').addEventListener('click', () => {
        fileInput.value = '';
        fileInput.click();
    });
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const statusEl = importCard.querySelector('#im-status');
        try {
            await mergeFromFile(file, statusEl);
        } catch (e) {
            setStatus(statusEl, String(e && e.message || e), 'error');
        }
        await renderReview(reviewCard);
    });

    chrome.storage.onChanged?.addListener((changes, area) => {
        if (area === 'local' && (changes.problems || changes.reviewSettings)) void renderReview(reviewCard);
    });

    await renderReview(reviewCard);
    renderImport(importCard);
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { void init(); });
    } else {
        void init();
    }
}

export { init as initReviewSettings, STRINGS as REVIEW_STRINGS };
