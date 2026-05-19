"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const endpoint_normalizer_1 = require("../domain/endpoints/endpoint-normalizer");
// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeProject(id = 10, path = 'p/test') {
    return {
        ID_PROJETO: id,
        NO_PROJETO: 'Test Project',
        TX_PATH: path,
        REST_CUSTOM: [
            {
                ID_REST_CUSTOM: 1,
                NO_REST_CUSTOM: 'ep1',
                TX_PATH: `${path}/ep1`,
                CO_BANCO_EXTERNO: 'DB_PROD',
                ID_BANCO_EXTERNO: 5,
                ID_BANCO_ESQUEMA: 50,
                NO_ESQUEMA: 'SCHEMA1',
            },
        ],
    };
}
const LOVS = {
    METODO: [
        { ID_METODO: 1, NO_METODO: 'GET' },
        { ID_METODO: 2, NO_METODO: 'POST' },
    ],
    TIPO_CODIGO: [
        { ID_TIPO_CODIGO: 1, NO_TIPO_CODIGO: 'SQL' },
        { ID_TIPO_CODIGO: 3, NO_TIPO_CODIGO: 'Python' },
    ],
    TIPO_HEADER: [{ ID_TIPO_HEADER: 1, NO_TIPO_HEADER: 'Automatico' }],
    BANCO_EXTERNO: [
        {
            ID_BANCO_EXTERNO: 5,
            CO_BANCO_EXTERNO: 'DB_PROD',
            BANCO_ESQUEMA: [
                { ID_BANCO_ESQUEMA: 50, NO_ESQUEMA: 'SCHEMA1' },
                { ID_BANCO_ESQUEMA: 51, NO_ESQUEMA: 'SCHEMA2' },
            ],
        },
    ],
};
// ─── normalizeModelEndpointOutput ─────────────────────────────────────────────
(0, node_test_1.describe)('normalizeModelEndpointOutput', () => {
    (0, node_test_1.it)('maps friendly key "nome" to NO_REST_CUSTOM', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({ nome: 'My Endpoint' });
        assert.equal(result.NO_REST_CUSTOM, 'My Endpoint');
    });
    (0, node_test_1.it)('maps friendly key "caminho" to TX_PATH', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({ caminho: 'api/v1/test' });
        assert.equal(result.TX_PATH, 'api/v1/test');
    });
    (0, node_test_1.it)('maps friendly key "metodo" to ID_METODO', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({ metodo: 2 });
        assert.equal(result.ID_METODO, 2);
    });
    (0, node_test_1.it)('canonical keys pass through unchanged', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({ NO_REST_CUSTOM: 'Direct', TX_PATH: 'p/t' });
        assert.equal(result.NO_REST_CUSTOM, 'Direct');
        assert.equal(result.TX_PATH, 'p/t');
    });
    (0, node_test_1.it)('sets SN_DEFAULTS for missing SN_ fields', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({});
        assert.equal(result.SN_PUBLICADO, 'S');
        assert.equal(result.SN_CACHE, 'N');
        assert.equal(result.SN_PAGINADO, 'N');
    });
    (0, node_test_1.it)('forces SN_MODO_COMPATIBILIDADE to N', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({ SN_MODO_COMPATIBILIDADE: 'S' });
        assert.equal(result.SN_MODO_COMPATIBILIDADE, 'N');
    });
    (0, node_test_1.it)('sets ID_REST_CUSTOM to 0 when missing', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({});
        assert.equal(result.ID_REST_CUSTOM, 0);
    });
    (0, node_test_1.it)('unwraps REST_CUSTOM envelope', () => {
        const raw = { REST_CUSTOM: [{ NO_REST_CUSTOM: 'Unwrapped', TX_PATH: 'p/u' }] };
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)(raw);
        assert.equal(result.NO_REST_CUSTOM, 'Unwrapped');
        assert.ok(!('REST_CUSTOM' in result));
    });
    (0, node_test_1.it)('deletes PROJETO and REST_CUSTOM_JSON_SCHEMA from output', () => {
        const raw = { NO_REST_CUSTOM: 'X', PROJETO: [{}], REST_CUSTOM_JSON_SCHEMA: [{}] };
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)(raw);
        assert.ok(!('PROJETO' in result));
        assert.ok(!('REST_CUSTOM_JSON_SCHEMA' in result));
    });
    (0, node_test_1.it)('ensures CHILD_ARRAY_FIELDS (HEADER, REST_CUSTOM_PERFIL) are initialized as empty arrays', () => {
        const result = (0, endpoint_normalizer_1.normalizeModelEndpointOutput)({});
        assert.ok(Array.isArray(result.HEADER));
        assert.ok(Array.isArray(result.REST_CUSTOM_PERFIL));
    });
});
// ─── extractVariablesFromCode ─────────────────────────────────────────────────
(0, node_test_1.describe)('extractVariablesFromCode', () => {
    (0, node_test_1.it)('extracts named SQL params (:param)', () => {
        const vars = (0, endpoint_normalizer_1.extractVariablesFromCode)('SELECT * FROM t WHERE id = :user_id');
        assert.ok(vars.some(v => v.name === 'user_id'));
        const userIdVar = vars.find(v => v.name === 'user_id');
        assert.equal(userIdVar?.origem, 2);
    });
    (0, node_test_1.it)('extracts URL template params ({param})', () => {
        const vars = (0, endpoint_normalizer_1.extractVariablesFromCode)('GET /users/{userId}');
        assert.ok(vars.some(v => v.name === 'userId'));
        const userIdVar = vars.find(v => v.name === 'userId');
        assert.equal(userIdVar?.origem, 1);
    });
    (0, node_test_1.it)('extracts Python $param style', () => {
        const vars = (0, endpoint_normalizer_1.extractVariablesFromCode)('print($my_var)');
        assert.ok(vars.some(v => v.name === 'my_var'));
    });
    (0, node_test_1.it)('filters reserved variable names', () => {
        const vars = (0, endpoint_normalizer_1.extractVariablesFromCode)('SELECT :aria_id_usuario, :my_param');
        assert.ok(!vars.some(v => v.name === 'aria_id_usuario'));
        assert.ok(vars.some(v => v.name === 'my_param'));
    });
    (0, node_test_1.it)('deduplicates repeated variable names', () => {
        const vars = (0, endpoint_normalizer_1.extractVariablesFromCode)(':param AND :param AND :param');
        const paramVars = vars.filter(v => v.name === 'param');
        assert.equal(paramVars.length, 1);
    });
    (0, node_test_1.it)('returns empty array for empty code', () => {
        assert.deepEqual((0, endpoint_normalizer_1.extractVariablesFromCode)(''), []);
    });
    (0, node_test_1.it)('does not extract reserved names (request_body)', () => {
        const vars = (0, endpoint_normalizer_1.extractVariablesFromCode)(':request_body');
        assert.equal(vars.length, 0);
    });
});
// ─── normalizeVariables ───────────────────────────────────────────────────────
(0, node_test_1.describe)('normalizeVariables', () => {
    (0, node_test_1.it)('normalizes well-formed variables', () => {
        const input = [
            { ID_VARIABLE: 1, NO_VARIABLE: 'my_param', TX_REGEX_QS: 'my_param', IN_ORIGEM_VARIABLE: 2 },
        ];
        const { normalized, errors } = (0, endpoint_normalizer_1.normalizeVariables)(input);
        assert.equal(normalized.length, 1);
        assert.equal(normalized[0].NO_VARIABLE, 'my_param');
        assert.equal(errors.length, 0);
    });
    (0, node_test_1.it)('falls back to TX_REGEX_QS when NO_VARIABLE missing', () => {
        const input = [{ TX_REGEX_QS: 'fallback_name', IN_ORIGEM_VARIABLE: 1 }];
        const { normalized } = (0, endpoint_normalizer_1.normalizeVariables)(input);
        assert.equal(normalized[0].NO_VARIABLE, 'fallback_name');
    });
    (0, node_test_1.it)('filters out reserved variable names', () => {
        const input = [
            { NO_VARIABLE: 'aria_id_usuario', IN_ORIGEM_VARIABLE: 1 },
            { NO_VARIABLE: 'valid_var', IN_ORIGEM_VARIABLE: 1 },
        ];
        const { normalized } = (0, endpoint_normalizer_1.normalizeVariables)(input);
        assert.equal(normalized.length, 1);
        assert.equal(normalized[0].NO_VARIABLE, 'valid_var');
    });
    (0, node_test_1.it)('reports error when IN_ORIGEM_VARIABLE is missing', () => {
        const input = [{ NO_VARIABLE: 'my_param' }];
        const { errors } = (0, endpoint_normalizer_1.normalizeVariables)(input);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes('IN_ORIGEM_VARIABLE'));
    });
    (0, node_test_1.it)('returns empty for empty array', () => {
        const { normalized, errors } = (0, endpoint_normalizer_1.normalizeVariables)([]);
        assert.deepEqual(normalized, []);
        assert.deepEqual(errors, []);
    });
    (0, node_test_1.it)('assigns fallback ID when ID_VARIABLE is missing or zero', () => {
        const input = [{ NO_VARIABLE: 'p', IN_ORIGEM_VARIABLE: 1 }];
        const { normalized } = (0, endpoint_normalizer_1.normalizeVariables)(input);
        assert.ok(normalized[0].ID_VARIABLE >= 10000);
    });
    (0, node_test_1.it)('calls logger when origin is missing', () => {
        const messages = [];
        (0, endpoint_normalizer_1.normalizeVariables)([{ NO_VARIABLE: 'p' }], msg => messages.push(msg));
        assert.ok(messages.length > 0);
    });
});
// ─── resolveRequiredBankFields ────────────────────────────────────────────────
(0, node_test_1.describe)('resolveRequiredBankFields', () => {
    (0, node_test_1.it)('uses explicit bank fields from source when not ignoring', () => {
        const source = { ID_BANCO_EXTERNO: 5, CO_BANCO_EXTERNO: 'DB_PROD', ID_BANCO_ESQUEMA: 50, NO_ESQUEMA: 'SCHEMA1' };
        const result = (0, endpoint_normalizer_1.resolveRequiredBankFields)(source, {}, LOVS, { ignoreExplicitBankFields: false });
        assert.equal(result.ID_BANCO_EXTERNO, 5);
        assert.equal(result.CO_BANCO_EXTERNO, 'DB_PROD');
        assert.equal(result.NO_ESQUEMA, 'SCHEMA1');
        assert.deepEqual(result.missing, []);
    });
    (0, node_test_1.it)('ignores explicit bank fields and uses LOVs when ignoreExplicitBankFields is true', () => {
        const source = { ID_BANCO_EXTERNO: 999, CO_BANCO_EXTERNO: 'WRONG' };
        const result = (0, endpoint_normalizer_1.resolveRequiredBankFields)(source, {}, LOVS, { ignoreExplicitBankFields: true });
        assert.equal(result.ID_BANCO_EXTERNO, 5);
        assert.equal(result.CO_BANCO_EXTERNO, 'DB_PROD');
    });
    (0, node_test_1.it)('reports missing fields when no LOVs and no source', () => {
        const result = (0, endpoint_normalizer_1.resolveRequiredBankFields)({}, {});
        assert.ok(result.missing.includes('ID_BANCO_EXTERNO'));
        assert.ok(result.missing.includes('CO_BANCO_EXTERNO'));
    });
    (0, node_test_1.it)('returns first schema when multiple schemas have equal score (case-mismatch prevents token match)', () => {
        const source = { NO_REST_CUSTOM: 'schema2 endpoint' };
        const lovs = {
            BANCO_EXTERNO: [
                {
                    ID_BANCO_EXTERNO: 5,
                    CO_BANCO_EXTERNO: 'DB',
                    BANCO_ESQUEMA: [
                        { ID_BANCO_ESQUEMA: 50, NO_ESQUEMA: 'SCHEMA1' },
                        { ID_BANCO_ESQUEMA: 51, NO_ESQUEMA: 'SCHEMA2' },
                    ],
                },
            ],
        };
        const result = (0, endpoint_normalizer_1.resolveRequiredBankFields)(source, {}, lovs, { ignoreExplicitBankFields: true });
        // Both schemas score 0 (extractKeywordTokens produces uppercase but normalizeTextForLookup produces lowercase)
        // so the first schema wins by insertion order
        assert.equal(result.ID_BANCO_ESQUEMA, 50);
    });
});
// ─── applyLovDisplayValues ────────────────────────────────────────────────────
(0, node_test_1.describe)('applyLovDisplayValues', () => {
    (0, node_test_1.it)('returns payload unchanged when no LOVs provided', () => {
        const payload = { ID_METODO: 1 };
        const result = (0, endpoint_normalizer_1.applyLovDisplayValues)(payload, undefined);
        assert.deepEqual(result, payload);
    });
    (0, node_test_1.it)('fills NO_METODO from METODO LOVs', () => {
        const payload = { ID_METODO: 2 };
        const result = (0, endpoint_normalizer_1.applyLovDisplayValues)(payload, LOVS);
        assert.equal(result.NO_METODO, 'POST');
    });
    (0, node_test_1.it)('fills NO_TIPO_CODIGO from TIPO_CODIGO LOVs', () => {
        const payload = { ID_TIPO_CODIGO: 3 };
        const result = (0, endpoint_normalizer_1.applyLovDisplayValues)(payload, LOVS);
        assert.equal(result.NO_TIPO_CODIGO, 'Python');
    });
    (0, node_test_1.it)('fills CO_BANCO_EXTERNO from BANCO_EXTERNO LOVs', () => {
        const payload = { ID_BANCO_EXTERNO: 5 };
        const result = (0, endpoint_normalizer_1.applyLovDisplayValues)(payload, LOVS);
        assert.equal(result.CO_BANCO_EXTERNO, 'DB_PROD');
    });
    (0, node_test_1.it)('clears ID_BANCO_ESQUEMA when schema not found in banco', () => {
        const payload = { ID_BANCO_EXTERNO: 5, ID_BANCO_ESQUEMA: 999 };
        const result = (0, endpoint_normalizer_1.applyLovDisplayValues)(payload, LOVS);
        assert.equal(result.ID_BANCO_ESQUEMA, '');
    });
});
// ─── buildEndpointFromExampleStructure ───────────────────────────────────────
(0, node_test_1.describe)('buildEndpointFromExampleStructure', () => {
    (0, node_test_1.it)('always sets ID_REST_CUSTOM to 0 for new endpoints', () => {
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(makeProject(), {}, LOVS);
        assert.equal(ep.ID_REST_CUSTOM, 0);
    });
    (0, node_test_1.it)('sets ID_PROJETO from the project', () => {
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(makeProject(42), {});
        assert.equal(ep.ID_PROJETO, 42);
    });
    (0, node_test_1.it)('includes PROJETO array with project TX_PATH', () => {
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(makeProject(1, 'my/path'), {});
        const projeto = ep.PROJETO;
        assert.equal(projeto[0].TX_PATH, 'my/path');
    });
    (0, node_test_1.it)('extracts VARIABLE from TX_CODIGO overrides', () => {
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(makeProject(), { TX_CODIGO: 'SELECT * FROM t WHERE id = :user_id' }, LOVS, { ignoreExplicitBankFields: true });
        const variables = ep.VARIABLE;
        assert.ok(Array.isArray(variables));
        assert.ok(variables.some(v => v.NO_VARIABLE === 'user_id'));
    });
    (0, node_test_1.it)('maps ID_METODO to NO_METODO via METHOD_MAP', () => {
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(makeProject(), { ID_METODO: 2 });
        assert.equal(ep.NO_METODO, 'POST');
    });
    (0, node_test_1.it)('overrides from second argument take precedence', () => {
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(makeProject(), { NO_REST_CUSTOM: 'Custom Name', TX_PATH: 'custom/path' });
        assert.equal(ep.NO_REST_CUSTOM, 'Custom Name');
        assert.equal(ep.TX_PATH, 'custom/path');
    });
});
// ─── compactEndpoint / compactProject ─────────────────────────────────────────
(0, node_test_1.describe)('compactEndpoint', () => {
    (0, node_test_1.it)('removes REST_CUSTOM_JSON_SCHEMA', () => {
        const ep = { NO_REST_CUSTOM: 'X', REST_CUSTOM_JSON_SCHEMA: [{ schema: true }] };
        const result = (0, endpoint_normalizer_1.compactEndpoint)(ep);
        assert.ok(!('REST_CUSTOM_JSON_SCHEMA' in result));
        assert.equal(result.NO_REST_CUSTOM, 'X');
    });
    (0, node_test_1.it)('leaves endpoint without JSON_SCHEMA unchanged', () => {
        const ep = { NO_REST_CUSTOM: 'Y', TX_PATH: 'p/y' };
        const result = (0, endpoint_normalizer_1.compactEndpoint)(ep);
        assert.deepEqual(result, ep);
    });
});
(0, node_test_1.describe)('compactProject', () => {
    (0, node_test_1.it)('compacts all endpoints in REST_CUSTOM', () => {
        const proj = {
            ID_PROJETO: 1,
            REST_CUSTOM: [
                { NO_REST_CUSTOM: 'ep1', REST_CUSTOM_JSON_SCHEMA: [{}] },
                { NO_REST_CUSTOM: 'ep2' },
            ],
        };
        const result = (0, endpoint_normalizer_1.compactProject)(proj);
        const endpoints = result.REST_CUSTOM;
        assert.ok(!endpoints[0].REST_CUSTOM_JSON_SCHEMA);
        assert.equal(endpoints[0].NO_REST_CUSTOM, 'ep1');
    });
    (0, node_test_1.it)('returns empty REST_CUSTOM when not an array', () => {
        const result = (0, endpoint_normalizer_1.compactProject)({ ID_PROJETO: 1 });
        assert.deepEqual(result.REST_CUSTOM, []);
    });
});
