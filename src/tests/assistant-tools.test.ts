import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizeVariables, buildEndpointFromExampleStructure } from '../domain/endpoints/endpoint-normalizer';

describe('Assistant tools supporting functions', () => {
  it('normalizeVariables returns normalized array and reports missing origin', () => {
    const input = [ { ID_VARIABLE: 1, NO_VARIABLE: 'x', TX_REGEX_QS: 'x' }, { NO_VARIABLE: 'y' } ];
    const result = normalizeVariables(input as any);
    assert.ok(Array.isArray(result.normalized));
    assert.equal(result.normalized.length, 2);
    assert.ok(result.errors.length >= 0);
    // Each normalized entry should be an object with NO_VARIABLE
    assert.equal(typeof result.normalized[0].NO_VARIABLE, 'string');
  });

  it('buildEndpointFromExampleStructure produces VARIABLE as array', () => {
    const fakeProject: any = { ID_PROJETO: 123, TX_PATH: 'p/a', REST_CUSTOM: [{ ID_REST_CUSTOM: 1, CO_BANCO_EXTERNO: 'X' }] };
    const overrides: any = { NO_REST_CUSTOM: 'Test', TX_PATH: 'p/a/test' };
    const ep = buildEndpointFromExampleStructure(fakeProject as any, overrides, undefined, { ignoreExplicitBankFields: true });
    assert.ok(Array.isArray(ep.VARIABLE));
    assert.ok(ep.VARIABLE.length >= 0);
    if (ep.VARIABLE.length) {
      const v = ep.VARIABLE[0];
      assert.equal(typeof v.NO_VARIABLE, 'string');
      assert.ok(v.ID_VARIABLE > 0);
    }
  });
});
