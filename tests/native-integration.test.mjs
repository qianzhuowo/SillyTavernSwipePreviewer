import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getNativePreviewMessage } from '../native-integration.mjs';

const preview = message => getNativePreviewMessage({ chat: [message] }, 0);

test('native strings and swipe_id are read without wrapper format conversion', () => {
    const message = { mes: 'live edit', swipes: ['first', 'stale'], swipe_id: 1,
        swipe_info: [{ extra: {} }, { extra: { reasoning: 'keep' } }], extra: { branches: ['saved'] } };
    const before = structuredClone(message);
    const result = preview(message);
    assert.equal(result.swipe_id, 1);
    assert.deepEqual(result.swipes, ['first', 'live edit']);
    assert.deepEqual(message, before);
    assert.notEqual(result, message);
    assert.notEqual(result.swipes, message.swipes);
    result.swipes.reverse();
    assert.deepEqual(message, before);
});

test('zero/single swipe, empty text, users and system messages remain previewable', () => {
    for (const swipes of [undefined, [], ['stale']]) {
        for (const flags of [{}, { is_user: true }, { is_system: true }]) {
            const message = { mes: '', swipes, ...flags };
            assert.deepEqual(preview(message).swipes, ['']);
            assert.equal(preview(message).swipe_id, 0);
            assert.equal(message.swipe_id, undefined);
        }
    }
});

test('invalid or missing native swipe indices are safely clamped without writing back', () => {
    for (const [input, expected] of [[undefined, 0], [-1, 0], [99, 1], [NaN, 0], ['1', 0], [1.5, 0]]) {
        const message = { mes: 'active', swipes: ['a', 'b'], swipe_id: input };
        assert.equal(preview(message).swipe_id, expected);
        assert.deepEqual(message.swipes, ['a', 'b']);
    }
});

test('missing messages and invalid floor IDs do not open a preview', () => {
    for (const mesId of [-1, 0.1, NaN, undefined, '0', 1]) {
        assert.equal(getNativePreviewMessage({ chat: [{ mes: 'hello' }] }, mesId), null);
    }
    assert.equal(getNativePreviewMessage(undefined, 0), null);
    assert.equal(getNativePreviewMessage({ chat: [null] }, 0), null);
});

test('production entry has no wrapper reads/registration/wait, retains native save and identity checks', async () => {
    const source = await readFile(new URL('../index.js', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /ST_API|chatHistory\.get|registerExtraMessageButton|unregisterMessageButton|setTimeout\(init/);
    assert.match(source, /import\('\/scripts\/events\.js'\)/);
    assert.match(source, /getNativePreviewMessage\(origin, mesId\)/);
    assert.match(source, /ctx\.chat !== originChat/);
    assert.match(source, /ctx\.chat\[mesId\] !== originMessage/);
    assert.match(source, /swipeData\./);
    assert.match(source, /saveChat/);
});
