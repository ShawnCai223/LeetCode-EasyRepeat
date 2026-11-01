const PR = require('../src/background/practice_reminder.js');

const now = new Date('2026-11-04T15:00:00Z');
const at = (min) => new Date(now.getTime() + min * 60 * 1000).toISOString();
const intensive = (slug, due, intraday = true) => ({ slug, title: slug.toUpperCase(), nextReviewDate: due, reinforce: { mode: 'intensive', intraday }, history: [] });

const problems = {
    a: intensive('a', at(-10)),
    b: intensive('b', at(90)),
    c: intensive('c', at(30)),
    d: intensive('d', at(-5), false),             // tomorrow-style due, not a same-day practice
    e: { slug: 'e', nextReviewDate: at(-60), reinforce: { mode: 'relearn' } }
};

test('only due same-day practices that were not announced yet', () => {
    expect(PR.dueForReminder(problems, now, {}).map(p => p.slug)).toEqual(['a']);
    expect(PR.dueForReminder(problems, now, { a: problems.a.nextReviewDate })).toEqual([]);
});

test('next alarm is the earliest future same-day practice', () => {
    expect(new Date(PR.nextReminderTime(problems, now)).toISOString()).toBe(at(30));
    expect(PR.nextReminderTime({ e: problems.e }, now)).toBe(null);
});

test('sent markers are dropped once the practice moves on', () => {
    const sent = { a: problems.a.nextReviewDate, b: 'old', zzz: 'x' };
    expect(PR.pruneSent(problems, sent)).toEqual({ a: problems.a.nextReviewDate });
});

test('message in both languages', () => {
    const due = [problems.a, problems.c];
    const zh = PR.buildMessage(due, 'zh', () => 2);
    expect(zh.message).toContain('今天第 2 练');
    expect(zh.message).toContain('A、C');
    const en = PR.buildMessage(due, 'en', () => null);
    expect(en.title).toMatch(/practice/i);
});
