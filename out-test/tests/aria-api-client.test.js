"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const aria_api_client_1 = require("../infrastructure/api/aria-api-client");
function makeClient() {
    return new aria_api_client_1.AriaApiClient({ baseUrl: 'https://test.example.com/', fetchProjectPath: '', ignoreSslErrors: true });
}
// ─── normalizeDataset (private, accessed via cast) ────────────────────────────
(0, node_test_1.describe)('AriaApiClient.normalizeDataset', () => {
    (0, node_test_1.it)('normalizes { registros: [...] } format', () => {
        const client = makeClient();
        const raw = {
            registros: [
                { ID_PROJETO: 1, NO_PROJETO: 'P1', TX_PATH: 'p/1', REST_CUSTOM: [{ ID_REST_CUSTOM: 5, NO_REST_CUSTOM: 'E1', TX_PATH: 'p/1/e1' }] },
            ],
        };
        const result = client.normalizeDataset(raw);
        assert.equal(result.registros.length, 1);
        assert.equal(result.registros[0].ID_PROJETO, 1);
        assert.equal(result.registros[0].REST_CUSTOM.length, 1);
    });
    (0, node_test_1.it)('normalizes { projetos: [...] } format', () => {
        const client = makeClient();
        const raw = {
            projetos: [
                { ID_PROJETO: 2, NO_PROJETO: 'P2', TX_PATH: 'p/2', REST_CUSTOM: [{ ID_REST_CUSTOM: 6, NO_REST_CUSTOM: 'E2', TX_PATH: 'p/2/e2' }] },
            ],
        };
        const result = client.normalizeDataset(raw);
        assert.equal(result.registros.length, 1);
        assert.equal(result.registros[0].NO_PROJETO, 'P2');
    });
    (0, node_test_1.it)('normalizes array format', () => {
        const client = makeClient();
        const raw = [
            { ID_PROJETO: 3, NO_PROJETO: 'P3', TX_PATH: 'p/3', REST_CUSTOM: [{ ID_REST_CUSTOM: 7, NO_REST_CUSTOM: 'E3', TX_PATH: 'p/3/e3' }] },
        ];
        const result = client.normalizeDataset(raw);
        assert.equal(result.registros.length, 1);
        assert.equal(result.registros[0].TX_PATH, 'p/3');
    });
    (0, node_test_1.it)('throws for unrecognized format', () => {
        const client = makeClient();
        assert.throws(() => client.normalizeDataset({ unexpected: true }), /formato esperado/);
    });
});
// ─── mapProject (private) ────────────────────────────────────────────────────
(0, node_test_1.describe)('AriaApiClient.mapProject', () => {
    (0, node_test_1.it)('maps numeric ID and string fields', () => {
        const client = makeClient();
        const raw = {
            ID_PROJETO: '42',
            NO_PROJETO: 'My Project',
            TX_PATH: 'my/path',
            REST_CUSTOM: [{ ID_REST_CUSTOM: 10, NO_REST_CUSTOM: 'EP1', TX_PATH: 'my/path/ep1' }],
        };
        const project = client.mapProject(raw);
        assert.equal(project.ID_PROJETO, 42);
        assert.equal(project.NO_PROJETO, 'My Project');
        assert.equal(project.TX_PATH, 'my/path');
        assert.equal(project.REST_CUSTOM.length, 1);
    });
    (0, node_test_1.it)('uses lower-case aliases (id_projeto, nome_projeto, path_projeto)', () => {
        const client = makeClient();
        const raw = {
            id_projeto: 99,
            nome_projeto: 'Alias Project',
            path_projeto: 'alias/path',
            REST_CUSTOM: [{ ID_REST_CUSTOM: 11, NO_REST_CUSTOM: 'EP2', TX_PATH: 'alias/path/ep2' }],
        };
        const project = client.mapProject(raw);
        assert.equal(project.ID_PROJETO, 99);
        assert.equal(project.NO_PROJETO, 'Alias Project');
    });
    (0, node_test_1.it)('maps endpoints array from "endpoints" key', () => {
        const client = makeClient();
        const raw = {
            ID_PROJETO: 1,
            NO_PROJETO: 'P',
            TX_PATH: 'p',
            endpoints: [{ ID_REST_CUSTOM: 20, NO_REST_CUSTOM: 'EAlt', TX_PATH: 'p/alt' }],
        };
        const project = client.mapProject(raw);
        assert.equal(project.REST_CUSTOM.length, 1);
        assert.equal(project.REST_CUSTOM[0].NO_REST_CUSTOM, 'EAlt');
    });
    (0, node_test_1.it)('produces empty REST_CUSTOM when neither key exists', () => {
        const client = makeClient();
        const project = client.mapProject({ ID_PROJETO: 1, NO_PROJETO: 'P', TX_PATH: 'p' });
        assert.deepEqual(project.REST_CUSTOM, []);
    });
});
// ─── mapEndpoint (private) ───────────────────────────────────────────────────
(0, node_test_1.describe)('AriaApiClient.mapEndpoint', () => {
    (0, node_test_1.it)('maps canonical fields', () => {
        const client = makeClient();
        const raw = { ID_REST_CUSTOM: 5, NO_REST_CUSTOM: 'EP', TX_PATH: 'p/ep', TX_CODIGO: 'SELECT 1' };
        const ep = client.mapEndpoint(raw);
        assert.equal(ep.ID_REST_CUSTOM, 5);
        assert.equal(ep.NO_REST_CUSTOM, 'EP');
        assert.equal(ep.TX_PATH, 'p/ep');
        assert.equal(ep.TX_CODIGO, 'SELECT 1');
    });
    (0, node_test_1.it)('uses lower-case alias id_endpoint, nome_endpoint', () => {
        const client = makeClient();
        const raw = { id_endpoint: 7, nome_endpoint: 'AliasEP', path_endpoint: 'p/alias' };
        const ep = client.mapEndpoint(raw);
        assert.equal(ep.ID_REST_CUSTOM, 7);
        assert.equal(ep.NO_REST_CUSTOM, 'AliasEP');
    });
    (0, node_test_1.it)('throws when ID_REST_CUSTOM is 0 or missing', () => {
        const client = makeClient();
        assert.throws(() => client.mapEndpoint({ ID_REST_CUSTOM: 0, NO_REST_CUSTOM: 'X', TX_PATH: 'x' }), /sem ID valido/);
        assert.throws(() => client.mapEndpoint({ NO_REST_CUSTOM: 'X', TX_PATH: 'x' }), /sem ID valido/);
    });
    (0, node_test_1.it)('sets TX_CODIGO to undefined when not a string', () => {
        const client = makeClient();
        const ep = client.mapEndpoint({ ID_REST_CUSTOM: 3, NO_REST_CUSTOM: 'E', TX_PATH: 'e', TX_CODIGO: null });
        assert.equal(ep.TX_CODIGO, undefined);
    });
});
// ─── mapEndpointFormItem (private) ───────────────────────────────────────────
(0, node_test_1.describe)('AriaApiClient.mapEndpointFormItem', () => {
    (0, node_test_1.it)('maps all expected fields', () => {
        const client = makeClient();
        const raw = {
            ITEM_SEQUENCE: '10',
            REGION_SEQUENCE: '5',
            IS_REQUIRED: 'Yes',
            DISPLAY_AS: 'Text Field',
            ITEM_SOURCE: 'NO_REST_CUSTOM',
            LABEL: 'Name',
            ITEM_SOURCE_TYPE: 'Database Column',
            ITEM_NAME: 'P1_NO_REST_CUSTOM',
            REGION: 'Endpoint',
        };
        const item = client.mapEndpointFormItem(raw);
        assert.equal(item.ITEM_SEQUENCE, 10);
        assert.equal(item.IS_REQUIRED, 'Yes');
        assert.equal(item.ITEM_NAME, 'P1_NO_REST_CUSTOM');
        assert.equal(item.LABEL, 'Name');
    });
    (0, node_test_1.it)('returns empty ITEM_NAME for missing input', () => {
        const client = makeClient();
        const item = client.mapEndpointFormItem({});
        assert.equal(item.ITEM_NAME, '');
    });
});
// ─── mapEndpointValidation (private) ─────────────────────────────────────────
(0, node_test_1.describe)('AriaApiClient.mapEndpointValidation', () => {
    (0, node_test_1.it)('maps validation fields', () => {
        const client = makeClient();
        const raw = {
            REGION_SEQUENCE: 1,
            REGION_NAME: 'Header',
            VALIDATION_SEQUENCE: 2,
            VALIDATION_NAME: 'Required Check',
            VALIDATION_TYPE: 'NOT_NULL',
            VALIDATION_FAILURE_TEXT: 'Field required',
            VALIDATION_EXPRESSION1: ':NO_REST_CUSTOM',
            CONDITION_TYPE: 'IS NULL',
            ASSOCIATED_ITEM: 'P1_NO_REST_CUSTOM',
        };
        const v = client.mapEndpointValidation(raw);
        assert.equal(v.VALIDATION_NAME, 'Required Check');
        assert.equal(v.VALIDATION_TYPE, 'NOT_NULL');
        assert.equal(v.REGION_NAME, 'Header');
        assert.equal(v.ASSOCIATED_ITEM, 'P1_NO_REST_CUSTOM');
    });
    (0, node_test_1.it)('sets optional fields to undefined when missing', () => {
        const client = makeClient();
        const v = client.mapEndpointValidation({
            VALIDATION_SEQUENCE: 1,
            VALIDATION_NAME: 'X',
            VALIDATION_TYPE: 'Y',
        });
        assert.equal(v.VALIDATION_FAILURE_TEXT, undefined);
        assert.equal(v.ASSOCIATED_ITEM, undefined);
    });
});
