// Mock global fetch
global.fetch = jest.fn();

// Mock chrome global
global.chrome = {
    runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
        id: 'mock-id',
        lastError: null
    },
    storage: {
        local: {
            get: jest.fn().mockImplementation((defaults) => Promise.resolve(defaults || {})),
            set: jest.fn().mockResolvedValue()
        }
    }
};

// Mock global constants
const { TOAST_THEMES } = require('../src/shared/config.js');
global.TOAST_THEMES = TOAST_THEMES;

// Mock window and document
global.window = {
    location: {
        pathname: '/problems/two-sum'
    }
};

// Advanced DOM Mocking captures created elements so we can interact with them
const createdElements = [];

global.document = {
    addEventListener: jest.fn(),
    head: { appendChild: jest.fn() },
    body: {
        appendChild: jest.fn(),
        removeChild: jest.fn()
    },
    // Mock getElementById/querySelector if needed (the completion toast looks up its stack)
    querySelector: jest.fn(),
    getElementById: jest.fn(() => null),
    cookie: '',

    createElement: jest.fn().mockImplementation((tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            classList: { add: jest.fn(), remove: jest.fn() },
            remove: jest.fn(),
            appendChild: jest.fn(),
            innerHTML: '',
            _listeners: {},
            addEventListener: jest.fn((event, handler) => {
                el._listeners[event] = handler;
            }),
            click: jest.fn(() => {
                if (el._listeners['click']) el._listeners['click']();
            }),
            // Basic querySelector support for finding buttons inside modal
            querySelector: jest.fn((selector) => {
                // Return a mock button if the selector looks like a button
                if (selector.includes('btn') || selector.includes('button')) {
                    const btn = {
                        className: selector,
                        _listeners: {},
                        addEventListener: jest.fn((evt, h) => { btn._listeners[evt] = h; }),
                        click: jest.fn(() => { if (btn._listeners.click) btn._listeners.click(); })
                    }
                    // We might need to store these to trigger them from the test
                    el._mockChildren = el._mockChildren || [];
                    el._mockChildren.push(btn);
                    return btn;
                }
                return null;
            }),
            // Helper to get children for testing
            _getMockButton: (selectorPart) => {
                return el._mockChildren?.find(c => c.className.includes(selectorPart));
            }
        };
        createdElements.push(el);
        return el;
    })
};

// Mock FSRS logic
const mockCalculateFSRS = jest.fn().mockReturnValue({
    nextInterval: 5,
    nextRepetition: 1,
    nextEaseFactor: 2.5,
    nextReviewDate: '2025-01-06T00:00:00.000Z',
    newStability: 5,
    newDifficulty: 5,
    nextState: 'Review'
});

jest.mock('../src/algorithms/fsrs_logic.js', () => ({
    calculateFSRS: mockCalculateFSRS
}));

const fsrs = require('../src/algorithms/fsrs_logic.js');
global.fsrs = fsrs; // Make it global for content.js

// Mock SM-2 logic
global.calculateNextReview = jest.fn().mockReturnValue({
    nextInterval: 1,
    nextRepetition: 1,
    nextEaseFactor: 2.5,
    nextReviewDate: '2025-01-01T00:00:00.000Z'
});



// chrome.storage.local.get supports both callback and Promise styles (like Chrome).
function storageGet(data) {
    return (keys, callback) => {
        const defaults = keys && typeof keys === 'object' && !Array.isArray(keys) ? keys : {};
        const result = { ...defaults, ...data };
        if (typeof callback === 'function') {
            callback(result);
            return undefined;
        }
        return Promise.resolve(result);
    };
}

// We need to require content.js dynamically for each test
let contentScript;

describe('Rating Integration Flow', () => {
    beforeEach(() => {
        jest.resetModules();
        fetch.mockReset();
        mockCalculateFSRS.mockClear();
        createdElements.length = 0; // Clear tracked elements

        // Default Storage Mock
        global.chrome.storage.local.get.mockImplementation(storageGet({ problems: {} }));
        global.chrome.storage.local.set.mockResolvedValue();

        // Mock local functions from content_ui.js
        const contentUi = require('../src/content/content_ui.js');
        // IMPORTANT: Assign to global BEFORE running tests that use content.js functions
        global.showRatingModal = contentUi.showRatingModal;
        global.showCompletionToast = contentUi.showCompletionToast;
        global.document.head = { appendChild: jest.fn() }; // Required by content_ui

        const { saveSubmission } = require('../src/shared/storage.js');
        global.saveSubmission = saveSubmission;

        // Require the module under test
        // Require the module under test
        contentScript = require('../src/content/content.js');
        const leetcodeApi = require('../src/content/leetcode_api.js');
        global.checkSubmissionStatus = leetcodeApi.checkSubmissionStatus;
    });

    test('Step 1: Modal appears on Accepted submission', async () => {
        // Setup: Mock API returning "Accepted"
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ state: "SUCCESS", status_msg: "Accepted", status_code: 10 })
        });
        // Mock GraphQL question details
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                data: {
                    question: {
                        difficulty: "Medium",
                        title: "Two Sum",
                        questionFrontendId: "1",
                        topicTags: []
                    }
                }
            })
        });

        // Since checkSubmissionStatus awaits the user input, we run it without await first
        // Since checkSubmissionStatus awaits the user input, we run it without await first
        const promise = global.checkSubmissionStatus('123', 'Two Sum', 'two-sum', 'Medium');

        // Wait for async operations to hit the modal point
        await new Promise(r => setTimeout(r, 10));

        // Check if modal was added to body
        // We look for a div that was appended to body
        const appended = document.body.appendChild.mock.calls;
        // The function appends user backdrop to body
        const backdrop = appended.find(call => call[0].className.includes('lc-rating-backdrop'));

        expect(backdrop).toBeDefined();

        // Note: 'rating-modal' class needs to be added in implementation
    });

    test('Step 2: Clicking Good (3) saves submission with rating', async () => {
        // Setup: Mock API returning "Accepted"
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ state: "SUCCESS", status_msg: "Accepted", status_code: 10 })
        });
        // Mock GraphQL question details
        fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                data: {
                    question: {
                        difficulty: "Medium",
                        title: "Two Sum",
                        questionFrontendId: "1",
                        topicTags: []
                    }
                }
            })
        });

        // Setup: Spy on saveSubmission (it's internal to contentScript, but we can spy on storage.local.set)

        // Run Status Check
        // Run Status Check
        const statusPromise = global.checkSubmissionStatus('123', 'Two Sum', 'two-sum', 'Medium');
        await new Promise(r => setTimeout(r, 10));

        // Find Modal Backdrop
        const backdropInfo = document.body.appendChild.mock.calls.find(call => call[0].className.includes('lc-srs-rating-backdrop'));

        // Use createdElements to find the button
        const goodBtn = createdElements.find(el => el.className && el.className.includes('rating-btn-good'));
        expect(goodBtn).toBeDefined();

        // Simulate Click
        goodBtn.click();

        // Await the main promise to finish (it waits for the click)
        await statusPromise;

        // Verify Storage Save
        expect(global.chrome.storage.local.set).toHaveBeenCalled();
        const saveCall = global.chrome.storage.local.set.mock.calls[0][0]; // { problems: ... }
        const savedProblem = saveCall.problems['two-sum'];

        expect(savedProblem).toBeDefined();
        // Check History for rating
        const latestHistory = savedProblem.history[savedProblem.history.length - 1];
        expect(latestHistory.rating).toBe(3);

        // Check FSRS fields (from our mock fsrs_logic)
        expect(savedProblem.fsrs_stability).toBe(5);
        expect(savedProblem.fsrs_difficulty).toBe(5);
    });
});

/**
 * Focused tests for showRatingModal click handler behavior.
 * Uses callback-style chrome.storage.local.get mock to match resolveModalTheme's API.
 */
describe('Rating Modal - suggestion from this submission', () => {
    let showRatingModal;

    const setup = (stored = {}) => {
        jest.resetModules();
        createdElements.length = 0;
        // Callback-style storage mock (used by resolveModalTheme and the preference read)
        global.chrome.storage.local.get = jest.fn((defaults, callback) => {
            const result = { ...(typeof defaults === 'object' ? defaults : {}), ...stored };
            if (typeof callback === 'function') { callback(result); return; }
            return Promise.resolve(result);
        });
        global.chrome.storage.local.set = jest.fn();
        showRatingModal = require('../src/content/content_ui.js').showRatingModal;
    };
    const find = (cls) => createdElements.find(el => el.className && el.className.includes(cls));
    const findAll = (cls) => createdElements.filter(el => el.className && el.className.includes(cls));
    const tick = () => new Promise(r => setTimeout(r, 10));

    beforeEach(() => setup());

    test('three buttons: Couldn\'t (1), Stuck (3), Solved (4); no Hard', async () => {
        showRatingModal('Two Sum', { slug: 'two-sum', failCount: 0 });
        await tick();
        expect(find('rating-btn-again')).toBeDefined();
        expect(find('rating-btn-good')).toBeDefined();
        expect(find('rating-btn-easy')).toBeDefined();
        expect(find('rating-btn-hard')).toBeUndefined();
    });

    test('accepted on the first try → Solved is suggested', async () => {
        showRatingModal('Two Sum', { slug: 'two-sum', failCount: 0 });
        await tick();
        const suggested = findAll('lc-rating-btn-suggested');
        expect(suggested).toHaveLength(1);
        expect(suggested[0].className).toContain('rating-btn-easy');
        expect(find('lc-rating-reason').innerText).toMatch(/first try|content_rating_reason_clean/);
    });

    test('wrong submissions → Stuck is suggested, and nothing is disabled', async () => {
        const promise = showRatingModal('Two Sum', { slug: 'two-sum', maxRating: 2, failCount: 4 });
        await tick();
        const suggested = findAll('lc-rating-btn-suggested');
        expect(suggested).toHaveLength(1);
        expect(suggested[0].className).toContain('rating-btn-good');
        expect(find('lc-rating-reason').innerText).toMatch(/4 wrong|content_rating_reason_fails/);
        const solved = find('rating-btn-easy');
        expect(solved.disabled).toBeFalsy();
        solved.click();
        await expect(promise).resolves.toBe(4);
    });

    test('older callers without failCount: maxRating < 4 suggests Stuck', async () => {
        showRatingModal('Two Sum', { slug: 'two-sum', maxRating: 3 });
        await tick();
        expect(findAll('lc-rating-btn-suggested')[0].className).toContain('rating-btn-good');
    });

    test('clicking a button resolves with its value', async () => {
        const promise = showRatingModal('Two Sum', { slug: 'two-sum', failCount: 1 });
        await tick();
        find('rating-btn-again').click();
        await expect(promise).resolves.toBe(1);
    });

    test('suggestions turned off (stored preference) → no highlight, no reason', async () => {
        setup({ difficultyRecommendations: false });
        showRatingModal('Two Sum', { slug: 'two-sum', failCount: 0 });
        await tick();
        expect(findAll('lc-rating-btn-suggested')).toHaveLength(0);
        expect(find('lc-rating-reason').innerText).toBe('');
    });

    test('the checkbox toggles the highlight and saves the preference', async () => {
        showRatingModal('Two Sum', { slug: 'two-sum', failCount: 0 });
        await tick();
        const checkbox = createdElements.find(el => el.tagName === 'INPUT' && el.id === 'lc-difficulty-rec');
        expect(checkbox.checked).toBe(true);
        checkbox.checked = false;
        checkbox._listeners['change']();
        expect(findAll('lc-rating-btn-suggested')).toHaveLength(0);
        expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ difficultyRecommendations: false });
        checkbox.checked = true;
        checkbox._listeners['change']();
        expect(findAll('lc-rating-btn-suggested')).toHaveLength(1);
    });
});
