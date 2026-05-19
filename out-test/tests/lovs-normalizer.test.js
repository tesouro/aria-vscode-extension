"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const lovs_normalizer_1 = require("../domain/lovs/lovs-normalizer");
// ─── Helpers ──────────────────────────────────────────────────────────────────
const FULL_LOVS = {
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
            ID_BANCO_EXTERNO: 10,
            CO_BANCO_EXTERNO: 'DB_PROD',
            BANCO_ESQUEMA: [
                { ID_BANCO_ESQUEMA: 100, NO_ESQUEMA: 'PUBLIC' },
                { ID_BANCO_ESQUEMA: 101, NO_ESQUEMA: 'PRIVATE' },
            ],
        },
    ],
};
// ─── normalizeLovsResponse ────────────────────────────────────────────────────
(0, node_test_1.describe)('normalizeLovsResponse', () => {
    (0, node_test_1.it)('returns direct LOVs record that has METODO key', () => {
        const result = (0, lovs_normalizer_1.normalizeLovsResponse)(FULL_LOVS);
        assert.ok(Array.isArray(result.METODO));
        assert.equal(result.METODO[0].NO_METODO, 'GET');
    });
    (0, node_test_1.it)('unwraps registros envelope — first LOVs-like record wins', () => {
        const wrapped = { registros: [FULL_LOVS, { OTHER: [] }] };
        const result = (0, lovs_normalizer_1.normalizeLovsResponse)(wrapped);
        assert.ok(Array.isArray(result.METODO));
    });
    (0, node_test_1.it)('handles registros with non-LOVs first item', () => {
        const wrapped = { registros: [{ unrelated: true }, FULL_LOVS] };
        const result = (0, lovs_normalizer_1.normalizeLovsResponse)(wrapped);
        assert.ok(Array.isArray(result.METODO));
    });
    (0, node_test_1.it)('handles array of LOVs objects', () => {
        const result = (0, lovs_normalizer_1.normalizeLovsResponse)([FULL_LOVS]);
        assert.ok(Array.isArray(result.METODO));
    });
    (0, node_test_1.it)('returns first item from array when no LOVs-like record found', () => {
        const result = (0, lovs_normalizer_1.normalizeLovsResponse)([{ X: 1 }]);
        assert.equal(result.X, 1);
    });
    (0, node_test_1.it)('returns empty object for null', () => {
        assert.deepEqual((0, lovs_normalizer_1.normalizeLovsResponse)(null), {});
    });
    (0, node_test_1.it)('returns empty object for undefined', () => {
        assert.deepEqual((0, lovs_normalizer_1.normalizeLovsResponse)(undefined), {});
    });
    (0, node_test_1.it)('returns empty object for empty array', () => {
        assert.deepEqual((0, lovs_normalizer_1.normalizeLovsResponse)([]), {});
    });
    (0, node_test_1.it)('returns empty object for empty registros', () => {
        assert.deepEqual((0, lovs_normalizer_1.normalizeLovsResponse)({ registros: [] }), {});
    });
    (0, node_test_1.it)('wraps the root record when it directly has BANCO_EXTERNO', () => {
        const raw = { BANCO_EXTERNO: [{ ID_BANCO_EXTERNO: 1, CO_BANCO_EXTERNO: 'X', BANCO_ESQUEMA: [] }] };
        const result = (0, lovs_normalizer_1.normalizeLovsResponse)(raw);
        assert.ok(Array.isArray(result.BANCO_EXTERNO));
    });
});
// ─── buildLovsContextSummary ──────────────────────────────────────────────────
(0, node_test_1.describe)('buildLovsContextSummary', () => {
    (0, node_test_1.it)('returns unavailable message for undefined', () => {
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(undefined);
        assert.ok(result.includes('indispon'));
    });
    (0, node_test_1.it)('includes METODO list', () => {
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(FULL_LOVS);
        assert.ok(result.includes('GET(1)'));
        assert.ok(result.includes('POST(2)'));
    });
    (0, node_test_1.it)('includes TIPO_CODIGO list', () => {
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(FULL_LOVS);
        assert.ok(result.includes('SQL(1)'));
        assert.ok(result.includes('Python(3)'));
    });
    (0, node_test_1.it)('includes TIPO_HEADER list', () => {
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(FULL_LOVS);
        assert.ok(result.includes('Automatico(1)'));
    });
    (0, node_test_1.it)('includes BANCO_EXTERNO with schemas', () => {
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(FULL_LOVS);
        assert.ok(result.includes('DB_PROD'));
        assert.ok(result.includes('PUBLIC(100)'));
        assert.ok(result.includes('PRIVATE(101)'));
    });
    (0, node_test_1.it)('shows "vazio" for empty METODO', () => {
        const lovs = { METODO: [] };
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(lovs);
        assert.ok(result.includes('METODO: vazio'));
    });
    (0, node_test_1.it)('shows "sem bancos" for empty BANCO_EXTERNO', () => {
        const lovs = { BANCO_EXTERNO: [] };
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(lovs);
        assert.ok(result.includes('sem bancos'));
    });
    (0, node_test_1.it)('shows "Sem esquemas" for banco without schemas', () => {
        const lovs = {
            BANCO_EXTERNO: [{ ID_BANCO_EXTERNO: 1, CO_BANCO_EXTERNO: 'EMPTY_DB', BANCO_ESQUEMA: [] }],
        };
        const result = (0, lovs_normalizer_1.buildLovsContextSummary)(lovs);
        assert.ok(result.includes('Sem esquemas'));
    });
});
