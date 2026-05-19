"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const endpoint_validator_1 = require("../domain/validation/endpoint-validator");
(0, node_test_1.describe)('isMissingRequiredField', () => {
    (0, node_test_1.it)('null/undefined are missing', () => {
        assert.ok((0, endpoint_validator_1.isMissingRequiredField)('X', null));
        assert.ok((0, endpoint_validator_1.isMissingRequiredField)('X', undefined));
    });
    (0, node_test_1.it)('empty string is missing', () => assert.ok((0, endpoint_validator_1.isMissingRequiredField)('X', '')));
    (0, node_test_1.it)('whitespace is missing', () => assert.ok((0, endpoint_validator_1.isMissingRequiredField)('X', '   ')));
    (0, node_test_1.it)('non-empty string is present', () => assert.ok(!(0, endpoint_validator_1.isMissingRequiredField)('X', 'val')));
    (0, node_test_1.it)('ID_ fields: 0 is missing', () => assert.ok((0, endpoint_validator_1.isMissingRequiredField)('ID_METODO', 0)));
    (0, node_test_1.it)('ID_ fields: positive is present', () => assert.ok(!(0, endpoint_validator_1.isMissingRequiredField)('ID_METODO', 5)));
});
(0, node_test_1.describe)('buildRequiredEndpointFieldKeys', () => {
    (0, node_test_1.it)('returns required visible fields', () => {
        const items = [
            { IS_REQUIRED: 'Yes', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_NO_REST_CUSTOM', ITEM_SOURCE: 'NO_REST_CUSTOM', ITEM_SOURCE_TYPE: 'Database Column' },
            { IS_REQUIRED: 'No', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_TX_DESCRICAO', ITEM_SOURCE: 'TX_DESCRICAO', ITEM_SOURCE_TYPE: 'Database Column' },
            { IS_REQUIRED: 'Yes', DISPLAY_AS: 'Hidden', ITEM_NAME: 'P1_HIDDEN', ITEM_SOURCE: 'HIDDEN_FIELD', ITEM_SOURCE_TYPE: 'Database Column' },
        ];
        const keys = (0, endpoint_validator_1.buildRequiredEndpointFieldKeys)(items);
        assert.ok(keys.includes('NO_REST_CUSTOM'));
        assert.ok(!keys.includes('TX_DESCRICAO'));
        assert.ok(!keys.includes('HIDDEN_FIELD'));
    });
    (0, node_test_1.it)('returns empty for undefined', () => {
        assert.deepEqual((0, endpoint_validator_1.buildRequiredEndpointFieldKeys)(undefined), []);
    });
});
(0, node_test_1.describe)('evaluateSimplePlsqlExpression', () => {
    (0, node_test_1.it)('evaluates IS NULL', () => {
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(':ID_METODO is null', { ID_METODO: null }), true);
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(':ID_METODO is null', { ID_METODO: 5 }), false);
    });
    (0, node_test_1.it)('evaluates IS NOT NULL', () => {
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(':ID_METODO is not null', { ID_METODO: 5 }), true);
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(':ID_METODO is not null', { ID_METODO: null }), false);
    });
    (0, node_test_1.it)('evaluates equality', () => {
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(":ID_METODO = 'GET'", { ID_METODO: 'GET' }), true);
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(":ID_METODO = 'GET'", { ID_METODO: 'POST' }), false);
    });
    (0, node_test_1.it)('evaluates AND', () => {
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(":A is not null and :B = 1", { A: 'x', B: 1 }), true);
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(":A is not null and :B = 1", { A: null, B: 1 }), false);
    });
    (0, node_test_1.it)('evaluates OR', () => {
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)(":A is null or :B = 1", { A: null, B: 0 }), true);
    });
    (0, node_test_1.it)('returns undefined for empty', () => {
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)('', {}), undefined);
    });
    (0, node_test_1.it)('returns undefined for unparseable', () => {
        assert.equal((0, endpoint_validator_1.evaluateSimplePlsqlExpression)('SOME_FUNC(:X)', {}), undefined);
    });
});
(0, node_test_1.describe)('validateEndpointPayload', () => {
    (0, node_test_1.it)('returns empty for no validations', () => {
        assert.deepEqual((0, endpoint_validator_1.validateEndpointPayload)({}, []), []);
        assert.deepEqual((0, endpoint_validator_1.validateEndpointPayload)({}, undefined), []);
    });
    (0, node_test_1.it)('detects not-null violation', () => {
        const validations = [{
                VALIDATION_NAME: 'V1',
                VALIDATION_TYPE: 'Item\\Column Specified Is Not Null',
                VALIDATION_EXPRESSION1: 'NO_REST_CUSTOM',
                VALIDATION_FAILURE_TEXT: 'Nome obrigatorio',
                REGION_SEQUENCE: 1,
                VALIDATION_SEQUENCE: 1,
                CONDITION_TYPE: '',
                CONDITION_EXPRESSION1: '',
                CONDITION_EXPRESSION2: '',
            }];
        const errors = (0, endpoint_validator_1.validateEndpointPayload)({ NO_REST_CUSTOM: '' }, validations);
        assert.ok(errors.includes('Nome obrigatorio'));
    });
    (0, node_test_1.it)('skips validation when condition type is "never"', () => {
        const validations = [{
                VALIDATION_NAME: 'V2',
                VALIDATION_TYPE: 'Item\\Column Specified Is Not Null',
                VALIDATION_EXPRESSION1: 'TX_PATH',
                VALIDATION_FAILURE_TEXT: 'Path obrigatorio',
                REGION_SEQUENCE: 1,
                VALIDATION_SEQUENCE: 2,
                CONDITION_TYPE: 'never',
                CONDITION_EXPRESSION1: '',
                CONDITION_EXPRESSION2: '',
            }];
        const errors = (0, endpoint_validator_1.validateEndpointPayload)({ TX_PATH: '' }, validations);
        assert.ok(!errors.includes('Path obrigatorio'));
    });
});
(0, node_test_1.describe)('isMissingRequiredField – additional edge cases', () => {
    (0, node_test_1.it)('number 1 is present', () => assert.ok(!(0, endpoint_validator_1.isMissingRequiredField)('ID_METODO', 1)));
    (0, node_test_1.it)('ID_ prefix: negative is missing (<=0)', () => assert.ok((0, endpoint_validator_1.isMissingRequiredField)('ID_METODO', -1)));
    (0, node_test_1.it)('ID_ prefix: 0 is missing', () => assert.ok((0, endpoint_validator_1.isMissingRequiredField)('ID_TIPO_CODIGO', 0)));
    (0, node_test_1.it)('non-ID_ field: 0 is present (number)', () => assert.ok(!(0, endpoint_validator_1.isMissingRequiredField)('NR_VERSAO', 0)));
    (0, node_test_1.it)('false boolean is present', () => assert.ok(!(0, endpoint_validator_1.isMissingRequiredField)('SN_FLAG', false)));
    (0, node_test_1.it)('object is present', () => assert.ok(!(0, endpoint_validator_1.isMissingRequiredField)('OBJ', {})));
});
