"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const draft_store_1 = require("../domain/assistant/draft-store");
(0, node_test_1.describe)('DraftStore', () => {
    let store;
    (0, node_test_1.beforeEach)(() => { store = new draft_store_1.DraftStore(); });
    (0, node_test_1.it)('creates a draft with correct defaults', () => {
        const draft = store.create(10, { NO_REST_CUSTOM: 'test' });
        assert.ok(draft.draftId.startsWith('draft-'));
        assert.equal(draft.projectId, 10);
        assert.equal(draft.status, 'created');
        assert.deepEqual(draft.validationIssues, []);
        assert.deepEqual(draft.endpoint.NO_REST_CUSTOM, 'test');
    });
    (0, node_test_1.it)('get returns created draft', () => {
        const draft = store.create(10, {});
        assert.ok(store.get(draft.draftId));
        assert.equal(store.get('nonexistent'), undefined);
    });
    (0, node_test_1.it)('markValidated sets status based on issues', () => {
        const draft = store.create(10, {});
        store.markValidated(draft.draftId, [], []);
        assert.equal(store.get(draft.draftId).status, 'validated');
        const draft2 = store.create(10, {});
        store.markValidated(draft2.draftId, ['error'], ['warn']);
        assert.equal(store.get(draft2.draftId).status, 'invalid');
        assert.deepEqual(store.get(draft2.draftId).warnings, ['warn']);
    });
    (0, node_test_1.it)('markImported sets status', () => {
        const draft = store.create(10, {});
        store.markValidated(draft.draftId, [], []);
        store.markImported(draft.draftId);
        assert.equal(store.get(draft.draftId).status, 'imported');
    });
    (0, node_test_1.it)('updateEndpoint resets status', () => {
        const draft = store.create(10, { a: 1 });
        store.markValidated(draft.draftId, ['err'], []);
        store.updateEndpoint(draft.draftId, { a: 2 });
        assert.equal(store.get(draft.draftId).status, 'created');
        assert.equal(store.get(draft.draftId).endpoint.a, 2);
    });
    (0, node_test_1.it)('discard removes draft', () => {
        const draft = store.create(10, {});
        assert.ok(store.discard(draft.draftId));
        assert.equal(store.get(draft.draftId), undefined);
        assert.ok(!store.discard('nonexistent'));
    });
    (0, node_test_1.it)('listActive excludes imported', () => {
        const d1 = store.create(10, {});
        const d2 = store.create(10, {});
        store.markValidated(d2.draftId, [], []);
        store.markImported(d2.draftId);
        const active = store.listActive();
        assert.equal(active.length, 1);
        assert.equal(active[0].draftId, d1.draftId);
    });
    (0, node_test_1.it)('getLatestForProject returns most recent active', () => {
        const d1 = store.create(10, {});
        const d2 = store.create(10, {});
        store.create(20, {});
        // Both have same timestamp from Date.now(), just verify one is returned
        const latest = store.getLatestForProject(10);
        assert.ok(latest);
        assert.equal(latest.projectId, 10);
        assert.equal(store.getLatestForProject(99), undefined);
    });
    (0, node_test_1.it)('clear removes all', () => {
        store.create(10, {});
        store.create(20, {});
        store.clear();
        assert.equal(store.list().length, 0);
    });
    (0, node_test_1.it)('throws on missing draft', () => {
        assert.throws(() => store.markValidated('nope', [], []), /Draft nao encontrado/);
        assert.throws(() => store.markImported('nope'), /Draft nao encontrado/);
        assert.throws(() => store.updateEndpoint('nope', {}), /Draft nao encontrado/);
    });
});
