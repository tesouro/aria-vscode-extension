"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const state_store_1 = require("../infrastructure/stores/state-store");
const draft_store_1 = require("../domain/assistant/draft-store");
// ─── Stub API client ──────────────────────────────────────────────────────────
function makeStubClient(overrides = {}) {
    return {
        getLovs: async (_projectId) => overrides.lovs ?? { METODO: [{ ID_METODO: 1, NO_METODO: 'GET' }] },
        getEndpointFormItems: async () => overrides.formItems ?? [],
        getEndpointValidations: async () => overrides.validations ?? [],
        getDatasetByProjectId: async (id) => ({
            registros: [{ ID_PROJETO: id, NO_PROJETO: 'P', TX_PATH: 'p', REST_CUSTOM: [] }],
        }),
    };
}
// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeStore(withClient = false) {
    const store = new state_store_1.StateStore(new draft_store_1.DraftStore());
    if (withClient) {
        store.client = makeStubClient();
    }
    return store;
}
// ─── getClient ────────────────────────────────────────────────────────────────
(0, node_test_1.describe)('StateStore.getClient', () => {
    (0, node_test_1.it)('throws when no client is configured', () => {
        const store = makeStore(false);
        assert.throws(() => store.getClient(), /Sem conexao ativa/);
    });
    (0, node_test_1.it)('returns the client when configured', () => {
        const store = makeStore(true);
        assert.ok(store.getClient());
    });
});
// ─── resetCaches ─────────────────────────────────────────────────────────────
(0, node_test_1.describe)('StateStore.resetCaches', () => {
    (0, node_test_1.it)('clears endpointFormItemsCache', () => {
        const store = makeStore();
        store.endpointFormItemsCache = [{}];
        store.resetCaches();
        assert.equal(store.endpointFormItemsCache, undefined);
    });
    (0, node_test_1.it)('clears endpointValidationsCache', () => {
        const store = makeStore();
        store.endpointValidationsCache = [{}];
        store.resetCaches();
        assert.equal(store.endpointValidationsCache, undefined);
    });
    (0, node_test_1.it)('clears lovsCache', () => {
        const store = makeStore();
        store.lovsCache.set(0, {});
        store.resetCaches();
        assert.equal(store.lovsCache.size, 0);
    });
    (0, node_test_1.it)('clears metadataUriByEndpoint and metadataCatalogByEndpoint', () => {
        const store = makeStore();
        store.metadataUriByEndpoint.set('key', {});
        store.metadataCatalogByEndpoint.set('key', {});
        store.resetCaches();
        assert.equal(store.metadataUriByEndpoint.size, 0);
        assert.equal(store.metadataCatalogByEndpoint.size, 0);
    });
});
// ─── getEndpointFormItems ─────────────────────────────────────────────────────
(0, node_test_1.describe)('StateStore.getEndpointFormItems', () => {
    (0, node_test_1.it)('returns undefined when no client', async () => {
        const store = makeStore(false);
        const result = await store.getEndpointFormItems();
        assert.equal(result, undefined);
    });
    (0, node_test_1.it)('fetches from client on first call', async () => {
        const store = makeStore(true);
        store.client = makeStubClient({
            formItems: [{ ITEM_SEQUENCE: 1, REGION_SEQUENCE: 1, IS_REQUIRED: 'Yes', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_X' }],
        });
        const result = await store.getEndpointFormItems();
        assert.ok(Array.isArray(result));
    });
    (0, node_test_1.it)('returns cached result on second call without refetching', async () => {
        let callCount = 0;
        const store = makeStore();
        store.client = {
            getEndpointFormItems: async () => {
                callCount++;
                return [{ ITEM_SEQUENCE: 1, REGION_SEQUENCE: 1, IS_REQUIRED: 'No', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_Y' }];
            },
        };
        await store.getEndpointFormItems();
        await store.getEndpointFormItems();
        assert.equal(callCount, 1);
    });
});
// ─── getProjectLovs ───────────────────────────────────────────────────────────
(0, node_test_1.describe)('StateStore.getProjectLovs', () => {
    (0, node_test_1.it)('returns undefined when no client', async () => {
        const store = makeStore(false);
        const result = await store.getProjectLovs();
        assert.equal(result, undefined);
    });
    (0, node_test_1.it)('caches LOVs by projectId', async () => {
        let callCount = 0;
        const store = makeStore();
        store.client = {
            getLovs: async (_id) => {
                callCount++;
                return { METODO: [{ ID_METODO: 1, NO_METODO: 'GET' }] };
            },
        };
        await store.getProjectLovs(5);
        await store.getProjectLovs(5);
        assert.equal(callCount, 1);
    });
    (0, node_test_1.it)('fetches separately for different projectIds', async () => {
        let callCount = 0;
        const store = makeStore();
        store.client = {
            getLovs: async (_id) => { callCount++; return {}; },
        };
        await store.getProjectLovs(1);
        await store.getProjectLovs(2);
        assert.equal(callCount, 2);
    });
});
// ─── getProjectDetails ────────────────────────────────────────────────────────
(0, node_test_1.describe)('StateStore.getProjectDetails', () => {
    (0, node_test_1.it)('returns the matching project', async () => {
        const store = makeStore(true);
        const project = await store.getProjectDetails(42);
        // The makeStubClient returns a project with the requested ID
        assert.equal(project.ID_PROJETO, 42);
    });
    (0, node_test_1.it)('throws when project not found in dataset', async () => {
        const store = makeStore();
        store.client = {
            getDatasetByProjectId: async () => ({ registros: [] }),
        };
        await assert.rejects(() => store.getProjectDetails(99), /nao encontrado/);
    });
});
// ─── draftStore integration ───────────────────────────────────────────────────
(0, node_test_1.describe)('StateStore.draftStore integration', () => {
    (0, node_test_1.it)('draftStore is accessible and functional', () => {
        const store = makeStore();
        const draft = store.draftStore.create(10, { NO_REST_CUSTOM: 'Draft Endpoint' });
        assert.ok(draft.draftId.startsWith('draft-'));
        assert.equal(draft.projectId, 10);
        const fetched = store.draftStore.get(draft.draftId);
        assert.ok(fetched);
    });
});
