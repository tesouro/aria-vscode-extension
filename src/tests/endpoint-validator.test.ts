import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  validateEndpointPayload,
  isMissingRequiredField,
  buildRequiredEndpointFieldKeys,
  evaluateSimplePlsqlExpression,
} from '../domain/validation/endpoint-validator';

describe('isMissingRequiredField', () => {
  it('null/undefined are missing', () => {
    assert.ok(isMissingRequiredField('X', null));
    assert.ok(isMissingRequiredField('X', undefined));
  });
  it('empty string is missing', () => assert.ok(isMissingRequiredField('X', '')));
  it('whitespace is missing', () => assert.ok(isMissingRequiredField('X', '   ')));
  it('non-empty string is present', () => assert.ok(!isMissingRequiredField('X', 'val')));
  it('ID_ fields: 0 is missing', () => assert.ok(isMissingRequiredField('ID_METODO', 0)));
  it('ID_ fields: positive is present', () => assert.ok(!isMissingRequiredField('ID_METODO', 5)));
});

describe('buildRequiredEndpointFieldKeys', () => {
  it('returns required visible fields', () => {
    const items = [
      { IS_REQUIRED: 'Yes', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_NO_REST_CUSTOM', ITEM_SOURCE: 'NO_REST_CUSTOM', ITEM_SOURCE_TYPE: 'Database Column' },
      { IS_REQUIRED: 'No', DISPLAY_AS: 'Text', ITEM_NAME: 'P1_TX_DESCRICAO', ITEM_SOURCE: 'TX_DESCRICAO', ITEM_SOURCE_TYPE: 'Database Column' },
      { IS_REQUIRED: 'Yes', DISPLAY_AS: 'Hidden', ITEM_NAME: 'P1_HIDDEN', ITEM_SOURCE: 'HIDDEN_FIELD', ITEM_SOURCE_TYPE: 'Database Column' },
    ];
    const keys = buildRequiredEndpointFieldKeys(items);
    assert.ok(keys.includes('NO_REST_CUSTOM'));
    assert.ok(!keys.includes('TX_DESCRICAO'));
    assert.ok(!keys.includes('HIDDEN_FIELD'));
  });
  it('returns empty for undefined', () => {
    assert.deepEqual(buildRequiredEndpointFieldKeys(undefined), []);
  });
});

describe('evaluateSimplePlsqlExpression', () => {
  it('evaluates IS NULL', () => {
    assert.equal(evaluateSimplePlsqlExpression(':ID_METODO is null', { ID_METODO: null }), true);
    assert.equal(evaluateSimplePlsqlExpression(':ID_METODO is null', { ID_METODO: 5 }), false);
  });
  it('evaluates IS NOT NULL', () => {
    assert.equal(evaluateSimplePlsqlExpression(':ID_METODO is not null', { ID_METODO: 5 }), true);
    assert.equal(evaluateSimplePlsqlExpression(':ID_METODO is not null', { ID_METODO: null }), false);
  });
  it('evaluates equality', () => {
    assert.equal(evaluateSimplePlsqlExpression(":ID_METODO = 'GET'", { ID_METODO: 'GET' }), true);
    assert.equal(evaluateSimplePlsqlExpression(":ID_METODO = 'GET'", { ID_METODO: 'POST' }), false);
  });
  it('evaluates AND', () => {
    assert.equal(evaluateSimplePlsqlExpression(":A is not null and :B = 1", { A: 'x', B: 1 }), true);
    assert.equal(evaluateSimplePlsqlExpression(":A is not null and :B = 1", { A: null, B: 1 }), false);
  });
  it('evaluates OR', () => {
    assert.equal(evaluateSimplePlsqlExpression(":A is null or :B = 1", { A: null, B: 0 }), true);
  });
  it('returns undefined for empty', () => {
    assert.equal(evaluateSimplePlsqlExpression('', {}), undefined);
  });
  it('returns undefined for unparseable', () => {
    assert.equal(evaluateSimplePlsqlExpression('SOME_FUNC(:X)', {}), undefined);
  });
});

describe('validateEndpointPayload', () => {
  it('returns empty for no validations', () => {
    assert.deepEqual(validateEndpointPayload({}, []), []);
    assert.deepEqual(validateEndpointPayload({}, undefined), []);
  });
  it('detects not-null violation', () => {
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
    const errors = validateEndpointPayload({ NO_REST_CUSTOM: '' }, validations as any);
    assert.ok(errors.includes('Nome obrigatorio'));
  });
});
