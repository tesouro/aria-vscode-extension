import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { StateStore } from '../infrastructure/stores/state-store';
import { DraftStore } from '../domain/assistant/draft-store';
import type { AriaLovs, EndpointFormItem, EndpointValidationItem } from '../core/types';

// ─── Stub API client ──────────────────────────────────────────────────────────

function makeStubClient(overrides: Partial<{
  lovs: AriaLovs;
  formItems: EndpointFormItem[];
  validations: EndpointValidationItem[];
}> = {}) {
  return {
    getLovs: async (_projectId?: number): Promise<AriaLovs> =>
      overrides.lovs ?? { METODO: [{ ID_METODO: 1, NO_METODO: 'GET' }] },
    getEndpointFormItems: async (): Promise<EndpointFormItem[]> =>
      overrides.formItems ?? [],
    getEndpointValidations: async (): Promise<EndpointValidationItem[]> =>
      overrides.validations ?? [],
    getDatasetByProjectId: async (id: number) => ({
      registros: [{ ID_PROJETO: id, NO_PROJETO: 'P', TX_PATH: 'p', REST_CUSTOM: [] }],
    }),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeStore(withClient = false) {
  const store = new StateStore(new DraftStore());
  if (withClient) {
    store.client = makeStubClient() as unknown as typeof store.client;
  }
  return store;
}

// ─── getClient ────────────────────────────────────────────────────────────────

describe('StateStore.getClient', () => {
  it('throws when no client is configured', () => {
    const store = makeStore(false);
    assert.throws(() => store.getClient(), /Sem conexao ativa/);
  });

  it('returns the client when configured', () => {
    const store = makeStore(true);
    assert.ok(store.getClient());
  });
});

// ─── resetCaches ─────────────────────────────────────────────────────────────

describe('StateStore.resetCaches', () => {
  it('clears endpointFormItemsCache', () => {
    const store = makeStore();
    (store as unknown as Record<string, unknown>).endpointFormItemsCache = [{}];
    store.resetCaches();
    assert.equal(store.endpointFormItemsCache, undefined);
  });

  it('clears endpointValidationsCache', () => {
    const store = makeStore();
    (store as unknown as Record<string, unknown>).endpointValidationsCache = [{}];
    store.resetCaches();
    assert.equal(store.endpointValidationsCache, undefined);
  });

  it('clears lovsCache', () => {
    const store = makeStore();
    store.lovsCache.set(0, {});
    store.resetCaches();
    assert.equal(store.lovsCache.size, 0);
  });

  it('clears metadataUriByEndpoint and metadataCatalogByEndpoint', () => {
    const store = makeStore();
    store.metadataUriByEndpoint.set('key', {} as never);
    store.metadataCatalogByEndpoint.set('key', {} as never);
    store.resetCaches();
    assert.equal(store.metadataUriByEndpoint.size, 0);
    assert.equal(store.metadataCatalogByEndpoint.size, 0);
  });
});

// ─── getEndpointFormItems ─────────────────────────────────────────────────────

describe('StateStore.getEndpointFormItems', () => {
  it('returns undefined when no client', async () => {
    const store = makeStore(false);
    const result = await store.getEndpointFormItems();
    assert.equal(result, undefined);
  });

  it('fetches from client on first call', async () => {
    const store = makeStore(true);
    store.client = makeStubClient({
      formItems: [{ ITEM_SEQUENCE: 1, REGION_SEQUENCE: 1, IS_REQUIRED: 'Yes', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_X' }],
    }) as unknown as typeof store.client;
    const result = await store.getEndpointFormItems();
    assert.ok(Array.isArray(result));
  });

  it('returns cached result on second call without refetching', async () => {
    let callCount = 0;
    const store = makeStore();
    store.client = {
      getEndpointFormItems: async () => {
        callCount++;
        return [{ ITEM_SEQUENCE: 1, REGION_SEQUENCE: 1, IS_REQUIRED: 'No', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_Y' }];
      },
    } as unknown as typeof store.client;
    await store.getEndpointFormItems();
    await store.getEndpointFormItems();
    assert.equal(callCount, 1);
  });
});

// ─── getProjectLovs ───────────────────────────────────────────────────────────

describe('StateStore.getProjectLovs', () => {
  it('returns undefined when no client', async () => {
    const store = makeStore(false);
    const result = await store.getProjectLovs();
    assert.equal(result, undefined);
  });

  it('caches LOVs by projectId', async () => {
    let callCount = 0;
    const store = makeStore();
    store.client = {
      getLovs: async (_id?: number) => {
        callCount++;
        return { METODO: [{ ID_METODO: 1, NO_METODO: 'GET' }] };
      },
    } as unknown as typeof store.client;
    await store.getProjectLovs(5);
    await store.getProjectLovs(5);
    assert.equal(callCount, 1);
  });

  it('fetches separately for different projectIds', async () => {
    let callCount = 0;
    const store = makeStore();
    store.client = {
      getLovs: async (_id?: number) => { callCount++; return {}; },
    } as unknown as typeof store.client;
    await store.getProjectLovs(1);
    await store.getProjectLovs(2);
    assert.equal(callCount, 2);
  });
});

// ─── getProjectDetails ────────────────────────────────────────────────────────

describe('StateStore.getProjectDetails', () => {
  it('returns the matching project', async () => {
    const store = makeStore(true);
    const project = await store.getProjectDetails(42);
    // The makeStubClient returns a project with the requested ID
    assert.equal(project.ID_PROJETO, 42);
  });

  it('throws when project not found in dataset', async () => {
    const store = makeStore();
    store.client = {
      getDatasetByProjectId: async () => ({ registros: [] }),
    } as unknown as typeof store.client;
    await assert.rejects(() => store.getProjectDetails(99), /nao encontrado/);
  });
});

// ─── draftStore integration ───────────────────────────────────────────────────

describe('StateStore.draftStore integration', () => {
  it('draftStore is accessible and functional', () => {
    const store = makeStore();
    const draft = store.draftStore.create(10, { NO_REST_CUSTOM: 'Draft Endpoint' });
    assert.ok(draft.draftId.startsWith('draft-'));
    assert.equal(draft.projectId, 10);
    const fetched = store.draftStore.get(draft.draftId);
    assert.ok(fetched);
  });
});
