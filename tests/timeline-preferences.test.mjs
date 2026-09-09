import test from 'node:test';
import assert from 'node:assert/strict';
import { TIMELINE_PREFERENCES_KEY, DEFAULT_TIMELINE_PREFERENCES,
    normalizeTimelinePreferences, loadTimelinePreferences, saveTimelinePreferences } from '../timeline-preferences.mjs';

test('timeline preferences retain defaults without stored data or with malformed JSON', () => {
    for (const raw of [null, '', '{bad', 'null', '[]', '42', '"wrong"']) {
        assert.deepEqual(loadTimelinePreferences({ getItem: () => raw }), DEFAULT_TIMELINE_PREFERENCES);
    }
});

test('timeline preference validation keeps only supported typed fields and does not mutate input', () => {
    const input = Object.freeze({ scale: 1.1, includeCandidates: false, onlyChar: true,
        onlyBranches: true, toolsExpanded: true, query: 'do not persist', chatId: 'private' });
    assert.deepEqual(normalizeTimelinePreferences(input), {
        scale: 1.1, includeCandidates: false, onlyChar: true, onlyBranches: true, toolsExpanded: true,
    });
    assert.deepEqual(normalizeTimelinePreferences({ scale: '1.1', includeCandidates: 'false', onlyChar: 1,
        onlyBranches: null, toolsExpanded: [] }), DEFAULT_TIMELINE_PREFERENCES);
});

test('timeline zoom preferences clamp to 30..200 percent and round safely', () => {
    for (const [scale, expected] of [[-1, .3], [0, .3], [.301, .3], [1.155, 1.16], [5, 2], [1e300, 2], [NaN, 1], [Infinity, 1]]) {
        assert.equal(normalizeTimelinePreferences({ scale }).scale, expected);
    }
});

test('timeline display settings round-trip through their own storage key', () => {
    const entries = new Map([['unrelated-setting', 'unchanged']]);
    const storage = { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
    const value = { scale: 1.1, includeCandidates: false, onlyChar: true, onlyBranches: true, toolsExpanded: true };
    assert.equal(saveTimelinePreferences(value, storage), true);
    assert.deepEqual(loadTimelinePreferences(storage), value);
    assert.deepEqual([...entries.keys()], ['unrelated-setting', TIMELINE_PREFERENCES_KEY]);
    assert.equal(entries.get('unrelated-setting'), 'unchanged');
});

test('storage read/write or property access failures never prevent opening the tree', () => {
    const unavailable = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
    assert.deepEqual(loadTimelinePreferences(unavailable), DEFAULT_TIMELINE_PREFERENCES);
    assert.equal(saveTimelinePreferences({ scale: 1.1 }, unavailable), false);
    const getterThrows = Object.defineProperty({}, 'getItem', { get() { throw Error('blocked getter'); } });
    assert.deepEqual(loadTimelinePreferences(getterThrows), DEFAULT_TIMELINE_PREFERENCES);
});

test('default preference objects are not shared mutable state', () => {
    const first = loadTimelinePreferences({ getItem: () => null });
    first.scale = 2;
    assert.equal(loadTimelinePreferences({ getItem: () => null }).scale, 1);
    assert.equal(DEFAULT_TIMELINE_PREFERENCES.scale, 1);
});
