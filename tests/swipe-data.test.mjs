import test from 'node:test';
import assert from 'node:assert/strict';
import { activateSwipe, prepareSwipes, deleteSwipes, moveSwipe } from '../swipe-data.mjs';

function message(current = 2, length = 5) {
    const swipes = Array.from({ length }, (_, i) => `reply-${i}`);
    const swipe_info = swipes.map((_, i) => ({
        send_date: `date-${i}`, gen_started: i, gen_finished: i + 1,
        extra: { reasoning: `reason-${i}`, media: [{ url: `image-${i}` }], token_count: i + 10, custom: { index: i } },
    }));
    const result = { swipes, swipe_info, swipe_id: current };
    activateSwipe(result, current);
    return result;
}

test('deleting earlier and later candidates preserves active text and all metadata', () => {
    const m = message();
    const active = structuredClone(m.extra);
    const result = deleteSwipes(m, [4, 0]);
    assert.deepEqual(result.kept, [1, 2, 3]);
    assert.equal(m.swipe_id, 1);
    assert.equal(m.mes, 'reply-2');
    assert.deepEqual(m.extra, active);
    assert.equal(m.swipe_info[2].extra.custom.index, 3);
});

test('deleting current chooses next survivor, or previous at the end', () => {
    const m = message();
    deleteSwipes(m, [2, 3]);
    assert.equal(m.mes, 'reply-4');
    assert.equal(m.swipe_id, 2);
    deleteSwipes(m, [2]);
    assert.equal(m.mes, 'reply-1');
    assert.equal(m.swipe_id, 1);
});

test('duplicates are removed once, empty text is a valid surviving swipe', () => {
    const m = message(0, 3);
    m.swipes[1] = '';
    deleteSwipes(m, [0, 0, 2]);
    assert.deepEqual(m.swipes, ['']);
    assert.equal(m.mes, '');
    assert.equal(m.swipe_id, 0);
});

test('empty, invalid and all-selected deletion never mutate a message', () => {
    for (const indices of [[], [0, 1, 2], [-1], [3], [0.5], [NaN], ['0']]) {
        const m = message(1, 3);
        const before = structuredClone(m);
        assert.throws(() => deleteSwipes(m, indices));
        assert.deepEqual(m, before);
    }
    const m = message(0, 1);
    assert.throws(() => deleteSwipes(m, [0]));
});

test('latest current edits and metadata are snapshotted before deletion', () => {
    const m = message();
    m.mes = 'edited current';
    m.extra.reasoning = 'updated reasoning';
    m.extra.branches = ['saved-chat'];
    deleteSwipes(m, [0, 4]);
    assert.equal(m.swipes[1], 'edited current');
    assert.deepEqual(m.swipe_info[1].extra.branches, ['saved-chat']);
    assert.equal(m.swipe_info[1].extra.reasoning, 'updated reasoning');
});

test('switching replaces extra and does not share nested metadata references', () => {
    const m = message();
    m.swipe_info[1].extra = {};
    prepareSwipes(m);
    activateSwipe(m, 1);
    assert.deepEqual(m.extra, {});
    assert.equal(m.send_date, 'date-1');
    assert.equal(m.gen_started, 1);
    activateSwipe(m, 2);
    m.extra.media[0].url = 'changed';
    assert.equal(m.swipe_info[2].extra.media[0].url, 'image-2');
});

test('legacy missing or partial swipe_info stays aligned and does not inherit old media', () => {
    for (const info of [undefined, [], [null, { extra: { custom: true } }]]) {
        const m = message();
        m.swipe_info = info;
        deleteSwipes(m, [0, 2]);
        assert.equal(m.swipe_info.length, 3);
        assert.equal(m.mes, 'reply-3');
        assert.deepEqual(m.extra, {});
    }
});

test('reorder moves active index, text and metadata together', () => {
    const m = message();
    m.mes = 'updated reply-2';
    moveSwipe(m, 2, 1);
    assert.equal(m.swipe_id, 1);
    assert.equal(m.swipes[1], 'updated reply-2');
    assert.equal(m.swipe_info[1].extra.custom.index, 2);
    assert.equal(m.swipe_info[2].extra.custom.index, 1);
    moveSwipe(m, 0, 4);
    assert.equal(m.swipe_id, 1);
    assert.equal(m.mes, 'updated reply-2');
});

test('invalid reorders and activations are rejected', () => {
    const m = message();
    const before = structuredClone(m);
    for (const idx of [-1, 5, 0.5, NaN]) {
        assert.throws(() => moveSwipe(m, 0, idx));
        assert.throws(() => activateSwipe(m, idx));
    }
    assert.deepEqual(m, before);
});

test('exhaustive deletion index mapping for up to seven swipes', () => {
    for (let length = 2; length <= 7; length++) {
        for (let current = 0; current < length; current++) {
            for (let mask = 1; mask < (1 << length) - 1; mask++) {
                const m = message(current, length);
                const removed = m.swipes.map((_, i) => i).filter(i => mask & (1 << i));
                const kept = m.swipes.map((_, i) => i).filter(i => !(mask & (1 << i)));
                const expected = kept.includes(current) ? current : (kept.find(i => i > current) ?? kept.at(-1));
                deleteSwipes(m, removed);
                const sequential = message(current, length);
                for (const index of [...removed].reverse()) deleteSwipes(sequential, [index]);
                assert.deepEqual(sequential, m, 'descending event-compatible deletion matches batch result');
                assert.equal(m.swipe_id, kept.indexOf(expected));
                assert.equal(m.mes, `reply-${expected}`);
                assert.equal(m.extra.custom.index, expected);
                assert.deepEqual(m.swipe_info.map(info => info.extra.custom.index), kept);
            }
        }
    }
});
