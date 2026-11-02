/**
 * LeetCode EasyRepeat - Options page: review plan settings + merge import.
 *
 * Card 1 (加强复习): how many stubborn problems may be in multi-practice mode
 *   at the same time, plus a short explanation of the rules.
 * Card 2 (合并导入历史记录): merge review history from a backup JSON without
 *   replacing settings (the existing "Restore" replaces everything).
 */
import '../algorithms/reinforcement.js';
import '../algorithms/topic_mastery.js';
import '../algorithms/load_balancer.js';
import '../algorithms/forecast.js';
import '../shared/ui_i18n.js';
import '../shared/history_import.js';

function pickMode(value) {
    return value === 'grind' || value === 'free' ? value : 'learn';
}

const STRINGS = {
    en: {
        rv_heading: '🔁 Reinforcement & daily plan',
        rv_rules: [
            'Rating guide: Easy = wrote it and can explain it · Good = wrote it, can\'t explain it · Hard = wrote it with hints · Again = couldn\'t write it.',
            'New problem rated Good/Easy the first time: reviewed again after 3, 8 and 20 days, then the normal schedule.',
            'Hard or Again always triggers short-term review: after 1, 3 and 7 days, then the normal schedule. A bad rating during these steps goes back one step.',
            'A problem rated Hard/Again 3 times in a row is "stubborn": practised 2× a day (3× if it keeps failing), 4 hours apart, until rated Good/Easy twice in a row. You get a notification for each extra practice.',
            'Each day is split into new problems and reviews by mode. When more reviews are due than the review share, the popup asks whether to add them to today or roll them on; when fewer are due, whether to pull in reviews due soon or do more new problems. Weak problems from your history are queued and let in as the review share allows, most stubborn first.',
            'A multi-practice problem rated badly 6 times needs a different approach: it pauses, and the popup offers its solutions and easier problems of the same topic until you mark it understood.',
            'Free mode: no new-problem quota. The recommended reviews start from your recent review pace (5 for new users); each day it goes up 10% if you finished nearly all of what was recommended and possible over the last week, and down 10% if you finished under 70%.',
            '"Can do" = last rating Good/Easy and not in short-term review, multi-practice or the queue. The forecast uses your own last 90 days: how often the attempt after a bad rating comes out good, and the reviews already-known problems need to stay known.',
            'Mastered = reviewed Good/Easy twice in a row and next review 60+ days away.'
        ],
        rv_mode_label: 'Mode',
        rv_mode_learn: 'Learning — 70% new problems, 30% review (getting started, working through a list)',
        rv_mode_grind: 'Grinding — 50% new, 50% review (company list, interview prep)',
        rv_mode_free: 'Free — as many new problems as you like; a recommended number of reviews a day that follows how much you actually got through recently (the total below does not apply)',
        rv_split_free: 'Today: {reviewQuota} reviews recommended (moves ±10% with what you completed over the last week) · new problems: your call',
        rv_forecast: 'Of the {target} problems done before today, {done} you can do and {todo} still to fix. At {per} reviews a day: all done around {date} ({span}). For ~3 months: {need90} a day; for ~1 month: {need30} a day.',
        rv_forecast_never: 'Of the {target} problems done before today, {todo} still to fix. {per} reviews a day only keeps up with the ones you know; about {need90} a day would finish in ~3 months.',
        rv_forecast_all: 'All {target} problems done before today are ones you can do.',
        rv_span_days: '{n} days', rv_span_months: '~{n} months', rv_span_years: '~{n} years',
        rv_budget_label: 'Problems a day, new + review (blank = automatic)',
        rv_budget_hint: 'Blank = your average over the last 14 active days (10 until there is enough history; it only goes up automatically — lower it here). Multi-practice comes on top.',
        rv_split: 'Today: {total} problems = {newQuota} new + {reviewQuota} review ({source})',
        rv_source_fixed: 'your number', rv_source_auto: 'your recent pace', rv_source_default: 'default for new users',
        rv_budget_invalid: 'Enter a whole number from 1 to 50, or leave it blank.',
        rv_pool_label: 'Stubborn problems practised several times a day (at once)',
        rv_pool_hint: 'Others wait in short-interval review until a slot frees up. 0 turns multi-practice off.',
        rv_save: 'Save',
        rv_saved: '✅ Saved.',
        rv_invalid: 'Enter a whole number from 0 to {max}.',
        rv_status: 'Now: {intensive} in multi-practice · {stubborn} stubborn · {relearn} in short-term review · {queued} queued · {rethink} need a new approach · {mastered} mastered',
        tm_heading: 'Topic mastery (last 30 days)',
        tm_hint: 'A topic is weak when its Good/Easy rate is 15+ points below your overall rate ({overall}%). Weak topics come back about a third sooner and get priority. Needs 5+ problems and 8+ ratings.',
        tm_empty: 'Not enough reviews in the last 30 days yet.',
        tm_col_topic: 'Topic', tm_col_problems: 'Problems', tm_col_ratings: 'Ratings', tm_col_rate: 'Good/Easy', tm_col_status: 'Status',
        tm_weak: 'Weak', tm_normal: 'Normal', tm_strong: 'Strong',
        sp_heading: 'Sprint mode (before an interview)',
        sp_hint: 'Until the date, every problem you haven\'t reviewed since the sprint started comes up once (weak and queued ones too), ordered by forgetting risk and mixed across topics, with a bigger daily budget.',
        sp_until: 'Interview date',
        sp_daily: 'Problems a day during the sprint (blank = twice your usual)',
        sp_start: 'Start Sprint',
        sp_stop: 'End Sprint',
        sp_active: 'Sprint active until {until}.',
        sp_invalid: 'Pick a date after today.',
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
            '每天的题量按模式拆成新题和复习。到期复习比复习名额多时，弹窗会问你加进今天还是顺延；少的时候，问你提前复习快到期的题还是多做新题。历史里的薄弱题先排队，复习名额有余量时按最顽固的优先放进来。',
            '一天多练里累计评差 6 次的题说明硬刷没用：它会暂停，弹窗里给出题解和同专题的简单题，等你点「我看懂了」再继续。',
            '自由模式：不规定新题数量。推荐复习量从你最近的复习节奏起步（新用户 5 道）；最近一周把推荐且能做的复习基本做完（≥95%）就每天 +10%，完成不到 70% 就 −10%。',
            '「会做」= 最近一次评「正常/简单」，且不在短期加强、一天多练或排队中。预计日期用你自己最近 90 天的数据：评差之后下一次答好的比例，以及已会的题保持住需要的复习量。',
            '已掌握 = 连续 2 次评「正常/简单」，且下次复习在 60 天以后。'
        ],
        rv_mode_label: '模式',
        rv_mode_learn: '学习模式：70% 新题、30% 复习（入门、按题单学新知识）',
        rv_mode_grind: '刷题模式：50% 新题、50% 复习（刷公司题单、准备面试）',
        rv_mode_free: '自由模式：新题想做多少做多少；系统每天推荐复习量，按你最近实际完成的情况上下浮动（下面的总题量不适用）',
        rv_split_free: '今天：建议复习 {reviewQuota} 道（按最近一周完成情况 ±10% 浮动）· 新题随意',
        rv_forecast: '今天以前做过的 {target} 道题：已会做 {done} 道，还差 {todo} 道。按每天复习 {per} 道，预计 {date} 全部会做（{span}）；想 3 个月内完成每天约 {need90} 道，1 个月内约 {need30} 道。',
        rv_forecast_never: '今天以前做过的 {target} 道题还差 {todo} 道：每天复习 {per} 道只够维护已会的题；每天约 {need90} 道可在 3 个月内全部会做。',
        rv_forecast_all: '今天以前做过的 {target} 道题都会做了。',
        rv_span_days: '{n} 天', rv_span_months: '约 {n} 个月', rv_span_years: '约 {n} 年',
        rv_budget_label: '每天总题量，新题 + 复习（留空 = 自动）',
        rv_budget_hint: '留空 = 你最近 14 个做题日的平均（数据不够时按 10 题；自动值只升不降，想调低就在这里填）。一天多练另算。',
        rv_split: '今天：{total} 题 = {newQuota} 道新题 + {reviewQuota} 道复习（{source}）',
        rv_source_fixed: '你填的数字', rv_source_auto: '按最近节奏', rv_source_default: '新用户默认',
        rv_budget_invalid: '请输入 1 到 50 的整数，或者留空。',
        rv_pool_label: '同时一天多练的顽固题数量',
        rv_pool_hint: '其余顽固题先走短间隔加强，有空位时按最顽固的顺序补进来。填 0 关闭一天多练。',
        rv_save: '保存',
        rv_saved: '✅ 已保存。',
        rv_invalid: '请输入 0 到 {max} 的整数。',
        rv_status: '当前：{intensive} 题一天多练 · {stubborn} 道顽固题 · {relearn} 题在短期加强 · {queued} 道排队中 · {rethink} 道需要换方法 · 已掌握 {mastered} 道',
        tm_heading: '专题掌握度（最近 30 天）',
        tm_hint: '某专题的答好率比你的整体答好率（{overall}%）低 15 个百分点以上，就算弱专题：复习间隔缩短约三分之一，排题时优先。至少 5 道题、8 次评分才判定。',
        tm_empty: '最近 30 天的复习还不够多，暂时无法判定。',
        tm_col_topic: '专题', tm_col_problems: '题数', tm_col_ratings: '评分次数', tm_col_rate: '答好率', tm_col_status: '判定',
        tm_weak: '弱', tm_normal: '正常', tm_strong: '强',
        sp_heading: '冲刺模式（面试前）',
        sp_hint: '到面试日期之前，冲刺开始后还没复习过的题（包括薄弱题和排队的题）都会各出现一次，按遗忘风险排序、专题交叉，每天的预算也会加大。',
        sp_until: '面试日期',
        sp_daily: '冲刺期间每天几题（留空 = 平时的两倍）',
        sp_start: '开始冲刺',
        sp_stop: '结束冲刺',
        sp_active: '冲刺进行中，到 {until} 结束。',
        sp_invalid: '请选择今天之后的日期。',
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
        <div class="field" style="margin-bottom: 12px;">
            <label data-rv="rv_mode_label"></label>
            <label style="display:block; font-weight:normal; margin:4px 0;"><input type="radio" name="rv-mode" value="learn"> <span data-rv="rv_mode_learn"></span></label>
            <label style="display:block; font-weight:normal; margin:4px 0;"><input type="radio" name="rv-mode" value="grind"> <span data-rv="rv_mode_grind"></span></label>
            <label style="display:block; font-weight:normal; margin:4px 0;"><input type="radio" name="rv-mode" value="free"> <span data-rv="rv_mode_free"></span></label>
        </div>
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
        <p class="hint" id="rv-split" style="margin-top: 10px;"></p>
        <p class="hint" id="rv-forecast" style="margin-top: 4px;"></p>
        <p class="hint" id="rv-status" style="margin-top: 4px;"></p>
        <hr class="section-divider">
        <h3 style="margin: 12px 0 6px;" data-rv="tm_heading"></h3>
        <p class="hint" id="tm-hint"></p>
        <div id="tm-table"></div>
        <hr class="section-divider">
        <h3 style="margin: 12px 0 6px;" data-rv="sp_heading"></h3>
        <p class="hint" data-rv="sp_hint"></p>
        <div class="grid" style="gap: 15px;">
            <div class="field">
                <label for="sp-until" data-rv="sp_until"></label>
                <input type="date" id="sp-until">
            </div>
            <div class="field">
                <label for="sp-daily" data-rv="sp_daily"></label>
                <input type="number" id="sp-daily" min="1" max="50" step="1">
            </div>
        </div>
        <div class="actions">
            <button id="sp-start-btn" class="btn" data-rv="sp_start"></button>
            <button id="sp-stop-btn" class="btn secondary" data-rv="sp_stop"></button>
            <span id="sp-status" class="status-text"></span>
        </div>
    `;
    return card;
}

function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
    const modeValue = pickMode(state.reviewSettings && state.reviewSettings.mode);
    card.querySelectorAll('input[name="rv-mode"]').forEach(r => { r.checked = r.value === modeValue; });
    const LBx = (typeof self !== 'undefined' ? self.LoadBalancer : window.LoadBalancer);
    if (LBx) {
        const planState = (await chrome.storage.local.get({ reviewPlan: null })).reviewPlan || {};
        const fixed = Number(state.reviewSettings && state.reviewSettings.dailyProblems) > 0;
        const now = new Date();
        const free = modeValue === 'free';
        const rec = free ? (planState.recommendedDate === LBx.toKey(now) && planState.recommended ? planState.recommended
            : LBx.recommendReviews(state.problems || {}, now, planState.recommended, planState.dayLog)) : 0;
        const b = LBx.dailyBudget(state.problems || {}, now, state.reviewSettings || {}, fixed ? 0 : planState.autoTotal, { recommendedReviews: rec });
        card.querySelector('#rv-split').textContent = free
            ? t('rv_split_free', { reviewQuota: b.reviewQuota })
            : t('rv_split', { total: b.total, newQuota: b.newQuota, reviewQuota: b.reviewQuota, source: t(`rv_source_${b.source}`) });
        const FC = (typeof self !== 'undefined' ? self.Forecast : window.Forecast);
        const fEl = card.querySelector('#rv-forecast');
        const f = FC ? FC.estimateClearDays(state.problems || {}, now, b.reviewQuota) : null;
        if (!f || !f.target) fEl.textContent = '';
        else if (!f.todo) fEl.textContent = t('rv_forecast_all', { target: f.target });
        else if (!f.enough) fEl.textContent = t('rv_forecast_never', { target: f.target, todo: f.todo, per: b.reviewQuota, need90: f.reviewsFor90 });
        else fEl.textContent = t('rv_forecast', { target: f.target, done: f.done, todo: f.todo, per: b.reviewQuota, date: f.date, span: f.days < 60 ? t('rv_span_days', { n: f.days }) : f.days < 730 ? t('rv_span_months', { n: Math.round(f.days / 30) }) : t('rv_span_years', { n: Math.round(f.days / 365) }), need90: f.reviewsFor90, need30: f.reviewsFor30 });
    }
    const all = Object.values(state.problems || {});
    const mode = (m) => all.filter(p => p && p.reinforce && p.reinforce.mode === m).length;
    card.querySelector('#rv-status').textContent = t('rv_status', {
        intensive: mode('intensive'),
        stubborn: all.filter(p => p && Rx.isStubborn(p.history)).length,
        relearn: mode('relearn'),
        queued: mode('queued'),
        rethink: mode('rethink'),
        mastered: all.filter(p => Rx.isMastered(p)).length
    });

    // Topic mastery table
    const TM = (typeof self !== 'undefined' ? self.TopicMastery : window.TopicMastery);
    const mastery = TM ? TM.computeTopicMastery(state.problems || {}, new Date()) : null;
    const hint = card.querySelector('#tm-hint');
    const box = card.querySelector('#tm-table');
    box.innerHTML = '';
    if (!mastery || mastery.overall === null || !mastery.topics.length) {
        hint.textContent = t('tm_empty');
    } else {
        hint.textContent = t('tm_hint', { overall: mastery.overall });
        const table = document.createElement('table');
        table.style.cssText = 'width:100%; border-collapse:collapse; font-size:0.85rem;';
        const head = document.createElement('tr');
        for (const k of ['tm_col_topic', 'tm_col_problems', 'tm_col_ratings', 'tm_col_rate', 'tm_col_status']) {
            const th = document.createElement('th');
            th.textContent = t(k);
            th.style.cssText = 'text-align:left; padding:4px 6px; border-bottom:1px solid currentColor; opacity:0.8; white-space:nowrap;';
            head.appendChild(th);
        }
        table.appendChild(head);
        for (const row of mastery.topics) {
            const tr = document.createElement('tr');
            const i18n = (typeof self !== 'undefined' ? self.EasyRepeatI18n : window.EasyRepeatI18n);
            const topicName = i18n && typeof i18n.translateTopic === 'function' ? i18n.translateTopic(row.topic, lang) : row.topic;
            const cells = [topicName, row.problems, row.ratings, `${row.rate}%`, t(`tm_${row.status}`)];
            cells.forEach((v, i) => {
                const td = document.createElement('td');
                td.textContent = String(v);
                td.style.cssText = i === 0 ? 'padding:3px 6px;' : 'padding:3px 6px; white-space:nowrap;';
                if (i === 4 && row.status === 'weak') td.style.fontWeight = '700';
                if (row.status === 'weak') td.style.color = '#e5484d';
                if (row.status === 'strong') td.style.color = '#30a46c';
                tr.appendChild(td);
            });
            table.appendChild(tr);
        }
        box.appendChild(table);
    }

    // Sprint
    const sp = state.reviewSettings && state.reviewSettings.sprint;
    const until = card.querySelector('#sp-until');
    const daily = card.querySelector('#sp-daily');
    until.min = localToday();
    if (document.activeElement !== until) until.value = sp && sp.until ? sp.until : '';
    if (document.activeElement !== daily) daily.value = sp && Number(sp.dailyProblems) > 0 ? String(sp.dailyProblems) : '';
    const active = sp && sp.until && sp.until >= localToday();
    card.querySelector('#sp-stop-btn').disabled = !sp;
    setStatus(card.querySelector('#sp-status'), active ? t('sp_active', { until: sp.until }) : '', active ? 'ok' : '');
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
        const checkedMode = reviewCard.querySelector('input[name="rv-mode"]:checked');
        const nextSettings = { ...(cur.reviewSettings || {}), intensivePoolSize: n, mode: pickMode(checkedMode && checkedMode.value) };
        if (rawBudget === '') delete nextSettings.dailyProblems;
        else nextSettings.dailyProblems = budget;
        // Drop today's frozen budget so the change applies right away.
        const plan = cur.reviewPlan && typeof cur.reviewPlan === 'object' ? { ...cur.reviewPlan } : null;
        if (plan) { delete plan.capacityDate; delete plan.budgetDate; }
        await chrome.storage.local.set(plan ? { reviewSettings: nextSettings, reviewPlan: plan } : { reviewSettings: nextSettings });
        setStatus(statusEl, t('rv_saved'), 'ok');
        await renderReview(reviewCard);
    });

    reviewCard.querySelectorAll('input[name="rv-mode"]').forEach(radio => {
        radio.addEventListener('change', async () => {
            if (!radio.checked) return;
            const cur = await chrome.storage.local.get({ reviewSettings: {}, reviewPlan: null });
            const plan = cur.reviewPlan && typeof cur.reviewPlan === 'object' ? { ...cur.reviewPlan } : null;
            if (plan) delete plan.budgetDate;
            const next = { ...(cur.reviewSettings || {}), mode: pickMode(radio.value) };
            await chrome.storage.local.set(plan ? { reviewSettings: next, reviewPlan: plan } : { reviewSettings: next });
            setStatus(reviewCard.querySelector('#rv-save-status'), t('rv_saved'), 'ok');
            await renderReview(reviewCard);
        });
    });

    reviewCard.querySelector('#sp-start-btn').addEventListener('click', async () => {
        const statusEl = reviewCard.querySelector('#sp-status');
        const until = reviewCard.querySelector('#sp-until').value;
        const today = localToday();
        if (!until || until <= today) {
            setStatus(statusEl, t('sp_invalid'), 'error');
            return;
        }
        const rawDaily = reviewCard.querySelector('#sp-daily').value.trim();
        const daily = Number(rawDaily);
        if (rawDaily !== '' && (!Number.isInteger(daily) || daily < 1 || daily > 50)) {
            setStatus(statusEl, t('rv_budget_invalid'), 'error');
            return;
        }
        const cur = await chrome.storage.local.get({ reviewSettings: {} });
        const prev = cur.reviewSettings && cur.reviewSettings.sprint;
        const sprint = { start: prev && prev.until >= today ? prev.start : today, until };
        if (rawDaily !== '') sprint.dailyProblems = daily;
        await chrome.storage.local.set({ reviewSettings: { ...(cur.reviewSettings || {}), sprint } });
        await renderReview(reviewCard);
    });

    reviewCard.querySelector('#sp-stop-btn').addEventListener('click', async () => {
        const cur = await chrome.storage.local.get({ reviewSettings: {} });
        const next = { ...(cur.reviewSettings || {}) };
        delete next.sprint;
        await chrome.storage.local.set({ reviewSettings: next });
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
