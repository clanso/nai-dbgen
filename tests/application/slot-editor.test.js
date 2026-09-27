import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createSlotEditorService } from '../../src/application/slot-editor.service.js';
import { Ok, Err } from '../../src/infra/result.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';

function fixture() {
    let chat = 'a';
    let text = 'before <IMG>1</IMG> middle <IMG>2</IMG> after';
    let records = [1, 2].map((slotId) => ({
        schemaVersion: 1, messageId: 5, slotId,
        caption: emptyNaiCaption(),
        anchorSentence: 'before', images: [{ imageRef: `ref-${slotId}`, createdAt: 't0', naiConfigId: null, artistId: null }],
        createdAt: 't0', presetId: null, llmConfigId: null,
    }));
    let busy = false;
    let failBody = false;
    let notifications = 0;
    const service = createSlotEditorService({
        host: {
            getCurrentChatId: () => chat, getSessionId: () => chat,
            getMessage: () => ({ text }),
            replaceMessageText: async (_, next) => {
                if (failBody) return Err({ message: 'write failed' });
                text = next; return Ok();
            },
        },
        slotRepo: {
            getByMessage: async () => Ok(records),
            replaceMessageRecords: async (_, next) => { records = next; return Ok(next); },
        },
        isBusy: () => busy, onSaved: () => notifications++,
    });
    return { service, get records() { return records; }, get text() { return text; },
        get notifications() { return notifications; },
        switchChat: () => { chat = 'b'; }, busy: () => { busy = true; },
        failBody: () => { failBody = true; }, changeText: () => { text = 'changed'; } };
}

it('editing preserves image history, deleting removes only the corresponding body marker', async () => {
    const f = fixture();
    const snapshot = (await f.service.open(5)).value;
    const caption = emptyNaiCaption();
    caption.v4_prompt.caption.base_caption = 'mountains';
    const result = await f.service.save(snapshot, [{ ...snapshot.records[1], caption }]);
    assert.equal(result.ok, true);
    assert.equal(f.records[0].caption.v4_prompt.caption.base_caption, 'mountains');
    assert.deepEqual(f.records[0].images, snapshot.records[1].images);
    assert.equal(f.text, 'before  middle <IMG>2</IMG> after');
    assert.equal(f.notifications, 1);
});

it('delete-all removes this message markers, without rewriting prose', async () => {
    const f = fixture();
    assert.equal((await f.service.save((await f.service.open(5)).value, [])).ok, true);
    assert.equal(f.text, 'before  middle  after');
    assert.equal(f.records.length, 0);
});

it('immediate deletions can be repeated using the returned text and records snapshot', async () => {
    const f = fixture();
    let snapshot = (await f.service.open(5)).value;
    const first = await f.service.save(snapshot, [snapshot.records[1]]);
    assert.equal(first.ok, true);
    snapshot = { ...snapshot, text: first.value.text, records: first.value.records };
    const second = await f.service.save(snapshot, []);
    assert.equal(second.ok, true);
    assert.equal(f.text, 'before  middle  after');
    assert.equal(f.records.length, 0);
    assert.equal(f.notifications, 2);
});

for (const action of ['switchChat', 'busy', 'changeText']) {
    it(`refuses saving after ${action}`, async () => {
        const f = fixture();
        const snapshot = (await f.service.open(5)).value;
        f[action]();
        assert.equal((await f.service.save(snapshot, [])).ok, false);
        assert.equal(f.records.length, 2);
        assert.equal(f.notifications, 0);
    });
}

it('body write failure restores the original records', async () => {
    const f = fixture();
    const snapshot = (await f.service.open(5)).value;
    f.failBody();
    assert.equal((await f.service.save(snapshot, [])).ok, false);
    assert.deepEqual(f.records, snapshot.records);
    assert.equal(f.service.isSaving(5), false);
});
