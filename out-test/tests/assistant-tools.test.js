"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const endpoint_normalizer_1 = require("../domain/endpoints/endpoint-normalizer");
(0, node_test_1.describe)('Assistant tools supporting functions', () => {
    (0, node_test_1.it)('normalizeVariables returns normalized array and reports missing origin', () => {
        const input = [{ ID_VARIABLE: 1, NO_VARIABLE: 'x', TX_REGEX_QS: 'x' }, { NO_VARIABLE: 'y' }];
        const result = (0, endpoint_normalizer_1.normalizeVariables)(input);
        assert.ok(Array.isArray(result.normalized));
        assert.equal(result.normalized.length, 2);
        assert.ok(result.errors.length >= 0);
        // Each normalized entry should be an object with NO_VARIABLE
        assert.equal(typeof result.normalized[0].NO_VARIABLE, 'string');
    });
    (0, node_test_1.it)('buildEndpointFromExampleStructure produces VARIABLE as array', () => {
        const fakeProject = { ID_PROJETO: 123, TX_PATH: 'p/a', REST_CUSTOM: [{ ID_REST_CUSTOM: 1, CO_BANCO_EXTERNO: 'X' }] };
        const overrides = { NO_REST_CUSTOM: 'Test', TX_PATH: 'p/a/test' };
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(fakeProject, overrides, undefined, { ignoreExplicitBankFields: true });
        assert.ok(Array.isArray(ep.VARIABLE));
        assert.ok(ep.VARIABLE.length >= 0);
        if (ep.VARIABLE.length) {
            const v = ep.VARIABLE[0];
            assert.equal(typeof v.NO_VARIABLE, 'string');
            assert.ok(v.ID_VARIABLE > 0);
        }
    });
});
