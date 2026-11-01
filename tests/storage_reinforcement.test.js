/**
 * @jest-environment jsdom
 *
 * saveSubmission + reinforcement integration (加强复习 on the real save path).
 */

function makeStore(initial) {
    const store = JSON.parse(JSON.stringify(initial));
    return {
        store,
        get: jest.fn(async (defaults) => {
            const out = {};
            for (const [k, v] of Object.entries(defaults || {})) {
                out[k] = store[k] !== undefined ? JSON.parse(JSON.stringify(store[k])) : v;
            }
            return out;
        }),
        set: jest.fn(async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); })
    };
}

describe('saveSubmission with reinforcement', () => {
    let saveSubmission;
    let mock;

    function load(initial) {
        jest.resetModules();
        mock = makeStore(initial);
        global.chrome = { runtime: { id: 'x', onMessage: { addListener: jest.fn() } }, storage: { local: { get: mock.get, set: mock.set } } };
        global.fsrs = require('../src/algorithms/fsrs_logic.js');
        global.Reinforcement = require('../src/algorithms/reinforcement.js');
        global.showCompletionToast = jest.fn();
        saveSubmission = require('../src/shared/storage.js').saveSubmission;
    }

    afterEach(() => {
        delete global.Reinforcement;
    });

    const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
    const DAY = 24 * 3600 * 1000;

    test('a Hard rating on a well-known problem starts relearn (review tomorrow)', async () => {
        load({
            problems: {
                p: {
                    slug: 'p', title: 'P', difficulty: 'Medium', interval: 30, repetition: 5, easeFactor: 2.5,
                    fsrs_state: 'Review', fsrs_stability: 40, fsrs_difficulty: 4, fsrs_last_review: iso(30 * DAY),
                    lastSolved: iso(30 * DAY), nextReviewDate: iso(0),
                    history: [{ date: iso(60 * DAY), rating: 4 }, { date: iso(30 * DAY), rating: 3 }]
                }
            }
        });
        await saveSubmission('P', 'p', 'Medium', 'test', 2, []);
        const p = mock.store.problems.p;
        expect(p.reinforce).toMatchObject({ mode: 'relearn', step: 0 });
        const days = (new Date(p.nextReviewDate) - Date.now()) / DAY;
        expect(days).toBeGreaterThan(0.5);
        expect(days).toBeLessThan(1.5);
    });

    test('3rd weak rating in a row joins the intensive pool and the plan is updated', async () => {
        load({
            reviewPlan: { intensive: [], capacity: 10, capacityDate: 'x' },
            problems: {
                s: {
                    slug: 's', title: 'S', difficulty: 'Hard', interval: 1, repetition: 2,
                    fsrs_state: 'Relearning', fsrs_stability: 0.5, fsrs_difficulty: 9, fsrs_last_review: iso(2 * DAY),
                    lastSolved: iso(2 * DAY), nextReviewDate: iso(DAY),
                    history: [{ date: iso(3 * DAY), rating: 1 }, { date: iso(2 * DAY), rating: 2 }]
                }
            }
        });
        await saveSubmission('S', 's', 'Hard', 'test', 1, []);
        expect(mock.store.problems.s.reinforce.mode).toBe('intensive');
        expect(mock.store.reviewPlan.intensive).toEqual(['s']);
        expect(mock.store.reviewPlan.capacity).toBe(10);
    });

    test('same-day repeat is recorded only when an intensive practice is due', async () => {
        const base = {
            slug: 'i', title: 'I', difficulty: 'Medium', interval: 1, repetition: 3,
            fsrs_state: 'Relearning', fsrs_stability: 0.5, fsrs_difficulty: 9,
            lastSolved: iso(60 * 1000), fsrs_last_review: iso(60 * 1000),
            history: [{ date: iso(3 * DAY), rating: 1 }, { date: iso(2 * DAY), rating: 1 }, { date: iso(60 * 1000), rating: 1 }]
        };

        // Not due yet -> duplicate, nothing recorded
        load({ problems: { i: { ...base, nextReviewDate: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), reinforce: { mode: 'intensive', intraday: true, goodStreak: 0 } } } });
        const r1 = await saveSubmission('I', 'i', 'Medium', 'test', 3, []);
        expect(r1).toMatchObject({ duplicate: true });
        expect(mock.store.problems.i.history).toHaveLength(3);

        // Due now -> recorded
        load({ problems: { i: { ...base, nextReviewDate: iso(1000), reinforce: { mode: 'intensive', intraday: true, goodStreak: 0 } } } });
        const r2 = await saveSubmission('I', 'i', 'Medium', 'test', 3, []);
        expect(r2).toMatchObject({ success: true });
        expect(mock.store.problems.i.history).toHaveLength(4);
        expect(mock.store.problems.i.history[3].extra).toBe(true); // multi-practice is outside the daily budget
        expect(mock.store.problems.i.reinforce).toMatchObject({ mode: 'intensive', goodStreak: 1 });
    });

    test('ordinary same-day repeat is still ignored', async () => {
        load({ problems: { o: { slug: 'o', title: 'O', difficulty: 'Easy', lastSolved: iso(60 * 1000), nextReviewDate: iso(-5 * DAY), history: [{ date: iso(60 * 1000), rating: 3 }] } } });
        const r = await saveSubmission('O', 'o', 'Easy', 'test', 4, []);
        expect(r).toMatchObject({ duplicate: true });
    });
});
