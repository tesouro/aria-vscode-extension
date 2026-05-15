"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const code_type_resolver_1 = require("../domain/endpoints/code-type-resolver");
(0, node_test_1.describe)('normalizeCodeTypeToken', () => {
    (0, node_test_1.it)('lowercases and strips accents/punctuation', () => {
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeToken)('PL/SQL'), 'plsql');
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeToken)(' Python '), 'python');
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeToken)('Código'), 'codigo');
    });
    (0, node_test_1.it)('returns empty for null/undefined', () => {
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeToken)(null), '');
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeToken)(undefined), '');
    });
});
(0, node_test_1.describe)('normalizeCodeTypeLabel', () => {
    (0, node_test_1.it)('resolves known labels', () => {
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeLabel)('python'), 'PYTHON');
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeLabel)('PL/SQL'), 'PLSQL');
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeLabel)('SQL'), 'SQL');
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeLabel)('Jython'), 'PYTHON');
    });
    (0, node_test_1.it)('returns undefined for unknown', () => {
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeLabel)('javascript'), undefined);
        assert.equal((0, code_type_resolver_1.normalizeCodeTypeLabel)(''), undefined);
    });
});
(0, node_test_1.describe)('inferCodeTypeLabelFromCode', () => {
    (0, node_test_1.it)('detects Python', () => {
        assert.equal((0, code_type_resolver_1.inferCodeTypeLabelFromCode)('import os\nprint("hi")'), 'PYTHON');
        assert.equal((0, code_type_resolver_1.inferCodeTypeLabelFromCode)('#!/usr/bin/python\npass'), 'PYTHON');
        assert.equal((0, code_type_resolver_1.inferCodeTypeLabelFromCode)('def foo(): pass'), 'PYTHON');
    });
    (0, node_test_1.it)('detects PL/SQL', () => {
        assert.equal((0, code_type_resolver_1.inferCodeTypeLabelFromCode)('DECLARE v NUMBER; BEGIN v := 1; END;'), 'PLSQL');
        assert.equal((0, code_type_resolver_1.inferCodeTypeLabelFromCode)('x := 10'), 'PLSQL');
    });
    (0, node_test_1.it)('defaults to SQL for empty', () => {
        assert.equal((0, code_type_resolver_1.inferCodeTypeLabelFromCode)(''), 'SQL');
    });
    (0, node_test_1.it)('note: SELECT with FROM keyword triggers Python detection', () => {
        // 'from' keyword in SQL triggers Python heuristic — known limitation
        assert.equal((0, code_type_resolver_1.inferCodeTypeLabelFromCode)('SELECT id FROM t WHERE 1=1'), 'PYTHON');
    });
});
(0, node_test_1.describe)('formatCodeTypeLabel', () => {
    (0, node_test_1.it)('formats labels', () => {
        assert.equal((0, code_type_resolver_1.formatCodeTypeLabel)('PYTHON'), 'Python');
        assert.equal((0, code_type_resolver_1.formatCodeTypeLabel)('PLSQL'), 'PL/SQL');
        assert.equal((0, code_type_resolver_1.formatCodeTypeLabel)('SQL'), 'SQL');
    });
});
(0, node_test_1.describe)('resolveCodeTypeSelection', () => {
    const lovs = {
        TIPO_CODIGO: [
            { ID_TIPO_CODIGO: 1, NO_TIPO_CODIGO: 'SQL' },
            { ID_TIPO_CODIGO: 2, NO_TIPO_CODIGO: 'PL/SQL' },
            { ID_TIPO_CODIGO: 3, NO_TIPO_CODIGO: 'Python' },
        ],
    };
    (0, node_test_1.it)('uses explicit codeType', () => {
        const r = (0, code_type_resolver_1.resolveCodeTypeSelection)(lovs, { codeType: 'python' });
        assert.equal(r.label, 'PYTHON');
        assert.equal(r.id, 3);
    });
    (0, node_test_1.it)('infers from code when no codeType', () => {
        const r = (0, code_type_resolver_1.resolveCodeTypeSelection)(lovs, { code: 'DECLARE x NUMBER; BEGIN NULL; END;' });
        assert.equal(r.label, 'PLSQL');
        assert.equal(r.id, 2);
    });
    (0, node_test_1.it)('falls back to SQL', () => {
        const r = (0, code_type_resolver_1.resolveCodeTypeSelection)(lovs, {});
        assert.equal(r.label, 'SQL');
        assert.equal(r.id, 1);
    });
});
(0, node_test_1.describe)('isSqlEndpointCodeType', () => {
    (0, node_test_1.it)('true for ID 1', () => assert.ok((0, code_type_resolver_1.isSqlEndpointCodeType)({ ID_TIPO_CODIGO: 1 })));
    (0, node_test_1.it)('true for SQL label', () => assert.ok((0, code_type_resolver_1.isSqlEndpointCodeType)({ NO_TIPO_CODIGO: 'SQL' })));
    (0, node_test_1.it)('false for Python', () => assert.ok(!(0, code_type_resolver_1.isSqlEndpointCodeType)({ ID_TIPO_CODIGO: 3, NO_TIPO_CODIGO: 'Python' })));
});
(0, node_test_1.describe)('resolveEndpointCodeExtension', () => {
    (0, node_test_1.it)('returns py for Python', () => assert.equal((0, code_type_resolver_1.resolveEndpointCodeExtension)({ ID_TIPO_CODIGO: 3 }), 'py'));
    (0, node_test_1.it)('returns sql for SQL', () => assert.equal((0, code_type_resolver_1.resolveEndpointCodeExtension)({ ID_TIPO_CODIGO: 1 }), 'sql'));
    (0, node_test_1.it)('detects py from code', () => assert.equal((0, code_type_resolver_1.resolveEndpointCodeExtension)({ TX_CODIGO: 'import requests' }), 'py'));
});
