/** saveSubmission takes the review date from the three-tier rules (schedule.js). */
let stored;
global.chrome = {
    runtime: { id: 'mock' },
    storage: { local: {
        get: jest.fn(async (defaults) => ({ ...defaults, ...stored })),
        set: jest.fn(async (obj) => { stored = { ...stored, ...obj }; })
    } }
};
global.showCompletionToast = jest.fn();
global.fsrs = require('../src/algorithms/fsrs_logic.js');
global.Schedule = require('../src/algorithms/schedule.js');
const { saveSubmission } = require('../src/shared/storage.js');

const daysAhead = (iso) => Math.round((new Date(iso) - Date.now()) / 864e5);

describe('saveSubmission + schedule', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-04T10:00:00'));
        stored = { problems: {} };
    });
    afterEach(() => jest.useRealTimers());

    test('Tough on a known problem → back tomorrow, daily practice', async () => {
        stored.problems['two-sum'] = {
            slug: 'two-sum', title: 'Two Sum', difficulty: 'Easy', interval: 20, repetition: 3, easeFactor: 2.5,
            fsrs_state: 'Review', fsrs_stability: 20, fsrs_difficulty: 5,
            fsrs_last_review: '2026-10-15T10:00:00.000Z', lastSolved: '2026-10-15T10:00:00.000Z',
            history: [{ date: '2026-10-15T10:00:00.000Z', rating: 3 }]
        };
        await saveSubmission('Two Sum', 'two-sum', 'Easy', 'manual_api_scan', 1);
        const p = stored.problems['two-sum'];
        expect(p.sched.mode).toBe('daily');
        expect(daysAhead(p.nextReviewDate)).toBe(1);
    });

    test('Fine on a new problem → in 2 days', async () => {
        await saveSubmission('Two Sum', 'two-sum', 'Easy', 'manual_api_scan', 3);
        const p = stored.problems['two-sum'];
        expect(p.sched).toMatchObject({ mode: 'normal' });
        expect(daysAhead(p.nextReviewDate)).toBe(2);
        expect(p.interval).toBe(2);
    });
});
