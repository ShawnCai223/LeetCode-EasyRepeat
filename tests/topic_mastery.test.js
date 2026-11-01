const TM = require('../src/algorithms/topic_mastery.js');

const today = new Date('2026-11-01T12:00:00');
const daysAgo = (n) => new Date(today.getTime() - n * 864e5).toISOString();
let k = 0;
const prob = (topics, ratings, ago = 5) => ({ slug: `p${k++}`, topics, history: ratings.map((r, i) => ({ date: daysAgo(ago + i), rating: r })) });

function build() {
    const list = [];
    // overall ~50%: DP weak (20%), Graph strong (80%), Tree normal (50%); Array on everything (broad)
    for (let i = 0; i < 5; i++) list.push(prob(['Array', 'Dynamic Programming'], [1, 2, 1, 2, 3]));
    for (let i = 0; i < 5; i++) list.push(prob(['Array', 'Graph'], [3, 4, 3, 3, 1]));
    for (let i = 0; i < 5; i++) list.push(prob(['Array', 'Tree'], [3, 1, 3, 1]));
    list.push(prob(['Trie'], [1, 1, 1, 1, 1, 1, 1, 1, 1])); // too few problems
    list.push(prob(['Old'], [1, 1], 40));                    // outside the 30-day window
    return Object.fromEntries(list.map(p => [p.slug, p]));
}

test('weak/strong is relative to the user\'s own overall rate', () => {
    const m = TM.computeTopicMastery(build(), today);
    expect(m.overall).toBe(44); // 35 good of 79 ratings (Trie counts for the overall rate)
    const by = Object.fromEntries(m.topics.map(t => [t.topic, t]));
    expect(by['Dynamic Programming']).toMatchObject({ rate: 20, status: 'weak', problems: 5, ratings: 25 });
    expect(by.Graph).toMatchObject({ rate: 80, status: 'strong' });
    expect(by.Tree.status).toBe('normal');
    expect(m.weak).toEqual(['Dynamic Programming']);
    expect(m.strong).toEqual(['Graph']);
});

test('broad tags, small samples and old reviews are left out', () => {
    const m = TM.computeTopicMastery(build(), today);
    const names = m.topics.map(t => t.topic);
    expect(names).not.toContain('Array');
    expect(names).not.toContain('Trie');
    expect(names).not.toContain('Old');
});

test('empty history', () => {
    expect(TM.computeTopicMastery({}, today)).toEqual({ overall: null, ratings: 0, topics: [], weak: [], strong: [] });
});

test('helpers', () => {
    expect(TM.isInWeakTopic({ topics: ['Tree', 'Dynamic Programming'] }, ['Dynamic Programming'])).toBe(true);
    expect(TM.isInWeakTopic({ topics: ['Tree'] }, [])).toBe(false);
    expect(TM.topicUrl('https://leetcode.com/', 'Heap (Priority Queue)')).toBe('https://leetcode.com/problem-list/heap-priority-queue/');
});
