import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  normalizeModelEndpointOutput,
  buildEndpointFromExampleStructure,
  extractVariablesFromCode,
  normalizeVariables,
  resolveRequiredBankFields,
  applyLovDisplayValues,
  compactEndpoint,
  compactProject,
} from '../domain/endpoints/endpoint-normalizer';
import type { AriaProject, AriaLovs } from '../core/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(id = 10, path = 'p/test'): AriaProject {
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

const LOVS: AriaLovs = {
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

describe('normalizeModelEndpointOutput', () => {
  it('maps friendly key "nome" to NO_REST_CUSTOM', () => {
    const result = normalizeModelEndpointOutput({ nome: 'My Endpoint' });
    assert.equal(result.NO_REST_CUSTOM, 'My Endpoint');
  });

  it('maps friendly key "caminho" to TX_PATH', () => {
    const result = normalizeModelEndpointOutput({ caminho: 'api/v1/test' });
    assert.equal(result.TX_PATH, 'api/v1/test');
  });

  it('maps friendly key "metodo" to ID_METODO', () => {
    const result = normalizeModelEndpointOutput({ metodo: 2 });
    assert.equal(result.ID_METODO, 2);
  });

  it('canonical keys pass through unchanged', () => {
    const result = normalizeModelEndpointOutput({ NO_REST_CUSTOM: 'Direct', TX_PATH: 'p/t' });
    assert.equal(result.NO_REST_CUSTOM, 'Direct');
    assert.equal(result.TX_PATH, 'p/t');
  });

  it('sets SN_DEFAULTS for missing SN_ fields', () => {
    const result = normalizeModelEndpointOutput({});
    assert.equal(result.SN_PUBLICADO, 'S');
    assert.equal(result.SN_CACHE, 'N');
    assert.equal(result.SN_PAGINADO, 'N');
  });

  it('forces SN_MODO_COMPATIBILIDADE to N', () => {
    const result = normalizeModelEndpointOutput({ SN_MODO_COMPATIBILIDADE: 'S' });
    assert.equal(result.SN_MODO_COMPATIBILIDADE, 'N');
  });

  it('sets ID_REST_CUSTOM to 0 when missing', () => {
    const result = normalizeModelEndpointOutput({});
    assert.equal(result.ID_REST_CUSTOM, 0);
  });

  it('unwraps REST_CUSTOM envelope', () => {
    const raw = { REST_CUSTOM: [{ NO_REST_CUSTOM: 'Unwrapped', TX_PATH: 'p/u' }] };
    const result = normalizeModelEndpointOutput(raw);
    assert.equal(result.NO_REST_CUSTOM, 'Unwrapped');
    assert.ok(!('REST_CUSTOM' in result));
  });

  it('deletes PROJETO and REST_CUSTOM_JSON_SCHEMA from output', () => {
    const raw = { NO_REST_CUSTOM: 'X', PROJETO: [{}], REST_CUSTOM_JSON_SCHEMA: [{}] };
    const result = normalizeModelEndpointOutput(raw);
    assert.ok(!('PROJETO' in result));
    assert.ok(!('REST_CUSTOM_JSON_SCHEMA' in result));
  });

  it('ensures CHILD_ARRAY_FIELDS (HEADER, REST_CUSTOM_PERFIL) are initialized as empty arrays', () => {
    const result = normalizeModelEndpointOutput({});
    assert.ok(Array.isArray(result.HEADER));
    assert.ok(Array.isArray(result.REST_CUSTOM_PERFIL));
  });
});

// ─── extractVariablesFromCode ─────────────────────────────────────────────────

describe('extractVariablesFromCode', () => {
  it('extracts named SQL params (:param)', () => {
    const vars = extractVariablesFromCode('SELECT * FROM t WHERE id = :user_id');
    assert.ok(vars.some(v => v.name === 'user_id'));
    const userIdVar = vars.find(v => v.name === 'user_id');
    assert.equal(userIdVar?.origem, 2);
  });

  it('extracts URL template params ({param})', () => {
    const vars = extractVariablesFromCode('GET /users/{userId}');
    assert.ok(vars.some(v => v.name === 'userId'));
    const userIdVar = vars.find(v => v.name === 'userId');
    assert.equal(userIdVar?.origem, 1);
  });

  it('extracts Python $param style', () => {
    const vars = extractVariablesFromCode('print($my_var)');
    assert.ok(vars.some(v => v.name === 'my_var'));
  });

  it('filters reserved variable names', () => {
    const vars = extractVariablesFromCode('SELECT :aria_id_usuario, :my_param');
    assert.ok(!vars.some(v => v.name === 'aria_id_usuario'));
    assert.ok(vars.some(v => v.name === 'my_param'));
  });

  it('deduplicates repeated variable names', () => {
    const vars = extractVariablesFromCode(':param AND :param AND :param');
    const paramVars = vars.filter(v => v.name === 'param');
    assert.equal(paramVars.length, 1);
  });

  it('returns empty array for empty code', () => {
    assert.deepEqual(extractVariablesFromCode(''), []);
  });

  it('does not extract reserved names (request_body)', () => {
    const vars = extractVariablesFromCode(':request_body');
    assert.equal(vars.length, 0);
  });
});

// ─── normalizeVariables ───────────────────────────────────────────────────────

describe('normalizeVariables', () => {
  it('normalizes well-formed variables', () => {
    const input = [
      { ID_VARIABLE: 1, NO_VARIABLE: 'my_param', TX_REGEX_QS: 'my_param', IN_ORIGEM_VARIABLE: 2 },
    ];
    const { normalized, errors } = normalizeVariables(input);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].NO_VARIABLE, 'my_param');
    assert.equal(errors.length, 0);
  });

  it('falls back to TX_REGEX_QS when NO_VARIABLE missing', () => {
    const input = [{ TX_REGEX_QS: 'fallback_name', IN_ORIGEM_VARIABLE: 1 }];
    const { normalized } = normalizeVariables(input);
    assert.equal(normalized[0].NO_VARIABLE, 'fallback_name');
  });

  it('filters out reserved variable names', () => {
    const input = [
      { NO_VARIABLE: 'aria_id_usuario', IN_ORIGEM_VARIABLE: 1 },
      { NO_VARIABLE: 'valid_var', IN_ORIGEM_VARIABLE: 1 },
    ];
    const { normalized } = normalizeVariables(input);
    assert.equal(normalized.length, 1);
    assert.equal(normalized[0].NO_VARIABLE, 'valid_var');
  });

  it('reports error when IN_ORIGEM_VARIABLE is missing', () => {
    const input = [{ NO_VARIABLE: 'my_param' }];
    const { errors } = normalizeVariables(input);
    assert.ok(errors.length > 0);
    assert.ok(errors[0].includes('IN_ORIGEM_VARIABLE'));
  });

  it('returns empty for empty array', () => {
    const { normalized, errors } = normalizeVariables([]);
    assert.deepEqual(normalized, []);
    assert.deepEqual(errors, []);
  });

  it('assigns fallback ID when ID_VARIABLE is missing or zero', () => {
    const input = [{ NO_VARIABLE: 'p', IN_ORIGEM_VARIABLE: 1 }];
    const { normalized } = normalizeVariables(input);
    assert.ok((normalized[0].ID_VARIABLE as number) >= 10000);
  });

  it('calls logger when origin is missing', () => {
    const messages: string[] = [];
    normalizeVariables([{ NO_VARIABLE: 'p' }], msg => messages.push(msg));
    assert.ok(messages.length > 0);
  });
});

// ─── resolveRequiredBankFields ────────────────────────────────────────────────

describe('resolveRequiredBankFields', () => {
  it('uses explicit bank fields from source when not ignoring', () => {
    const source = { ID_BANCO_EXTERNO: 5, CO_BANCO_EXTERNO: 'DB_PROD', ID_BANCO_ESQUEMA: 50, NO_ESQUEMA: 'SCHEMA1' };
    const result = resolveRequiredBankFields(source, {}, LOVS, { ignoreExplicitBankFields: false });
    assert.equal(result.ID_BANCO_EXTERNO, 5);
    assert.equal(result.CO_BANCO_EXTERNO, 'DB_PROD');
    assert.equal(result.NO_ESQUEMA, 'SCHEMA1');
    assert.deepEqual(result.missing, []);
  });

  it('ignores explicit bank fields and uses LOVs when ignoreExplicitBankFields is true', () => {
    const source = { ID_BANCO_EXTERNO: 999, CO_BANCO_EXTERNO: 'WRONG' };
    const result = resolveRequiredBankFields(source, {}, LOVS, { ignoreExplicitBankFields: true });
    assert.equal(result.ID_BANCO_EXTERNO, 5);
    assert.equal(result.CO_BANCO_EXTERNO, 'DB_PROD');
  });

  it('reports missing fields when no LOVs and no source', () => {
    const result = resolveRequiredBankFields({}, {});
    assert.ok(result.missing.includes('ID_BANCO_EXTERNO'));
    assert.ok(result.missing.includes('CO_BANCO_EXTERNO'));
  });

  it('returns first schema when multiple schemas have equal score (case-mismatch prevents token match)', () => {
    const source = { NO_REST_CUSTOM: 'schema2 endpoint' };
    const lovs: AriaLovs = {
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
    const result = resolveRequiredBankFields(source, {}, lovs, { ignoreExplicitBankFields: true });
    // Both schemas score 0 (extractKeywordTokens produces uppercase but normalizeTextForLookup produces lowercase)
    // so the first schema wins by insertion order
    assert.equal(result.ID_BANCO_ESQUEMA, 50);
  });
});

// ─── applyLovDisplayValues ────────────────────────────────────────────────────

describe('applyLovDisplayValues', () => {
  it('returns payload unchanged when no LOVs provided', () => {
    const payload = { ID_METODO: 1 };
    const result = applyLovDisplayValues(payload, undefined);
    assert.deepEqual(result, payload);
  });

  it('fills NO_METODO from METODO LOVs', () => {
    const payload = { ID_METODO: 2 };
    const result = applyLovDisplayValues(payload, LOVS);
    assert.equal(result.NO_METODO, 'POST');
  });

  it('fills NO_TIPO_CODIGO from TIPO_CODIGO LOVs', () => {
    const payload = { ID_TIPO_CODIGO: 3 };
    const result = applyLovDisplayValues(payload, LOVS);
    assert.equal(result.NO_TIPO_CODIGO, 'Python');
  });

  it('fills CO_BANCO_EXTERNO from BANCO_EXTERNO LOVs', () => {
    const payload = { ID_BANCO_EXTERNO: 5 };
    const result = applyLovDisplayValues(payload, LOVS);
    assert.equal(result.CO_BANCO_EXTERNO, 'DB_PROD');
  });

  it('clears ID_BANCO_ESQUEMA when schema not found in banco', () => {
    const payload = { ID_BANCO_EXTERNO: 5, ID_BANCO_ESQUEMA: 999 };
    const result = applyLovDisplayValues(payload, LOVS);
    assert.equal(result.ID_BANCO_ESQUEMA, '');
  });
});

// ─── buildEndpointFromExampleStructure ───────────────────────────────────────

describe('buildEndpointFromExampleStructure', () => {
  it('always sets ID_REST_CUSTOM to 0 for new endpoints', () => {
    const ep = buildEndpointFromExampleStructure(makeProject(), {}, LOVS);
    assert.equal(ep.ID_REST_CUSTOM, 0);
  });

  it('sets ID_PROJETO from the project', () => {
    const ep = buildEndpointFromExampleStructure(makeProject(42), {});
    assert.equal(ep.ID_PROJETO, 42);
  });

  it('includes PROJETO array with project TX_PATH', () => {
    const ep = buildEndpointFromExampleStructure(makeProject(1, 'my/path'), {});
    const projeto = ep.PROJETO as Array<Record<string, unknown>>;
    assert.equal(projeto[0].TX_PATH, 'my/path');
  });

  it('extracts VARIABLE from TX_CODIGO overrides', () => {
    const ep = buildEndpointFromExampleStructure(
      makeProject(),
      { TX_CODIGO: 'SELECT * FROM t WHERE id = :user_id' },
      LOVS,
      { ignoreExplicitBankFields: true },
    );
    const variables = ep.VARIABLE as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(variables));
    assert.ok(variables.some(v => v.NO_VARIABLE === 'user_id'));
  });

  it('maps ID_METODO to NO_METODO via METHOD_MAP', () => {
    const ep = buildEndpointFromExampleStructure(makeProject(), { ID_METODO: 2 });
    assert.equal(ep.NO_METODO, 'POST');
  });

  it('overrides from second argument take precedence', () => {
    const ep = buildEndpointFromExampleStructure(
      makeProject(),
      { NO_REST_CUSTOM: 'Custom Name', TX_PATH: 'custom/path' },
    );
    assert.equal(ep.NO_REST_CUSTOM, 'Custom Name');
    assert.equal(ep.TX_PATH, 'custom/path');
  });
});

// ─── compactEndpoint / compactProject ─────────────────────────────────────────

describe('compactEndpoint', () => {
  it('removes REST_CUSTOM_JSON_SCHEMA', () => {
    const ep = { NO_REST_CUSTOM: 'X', REST_CUSTOM_JSON_SCHEMA: [{ schema: true }] };
    const result = compactEndpoint(ep);
    assert.ok(!('REST_CUSTOM_JSON_SCHEMA' in result));
    assert.equal(result.NO_REST_CUSTOM, 'X');
  });

  it('leaves endpoint without JSON_SCHEMA unchanged', () => {
    const ep = { NO_REST_CUSTOM: 'Y', TX_PATH: 'p/y' };
    const result = compactEndpoint(ep);
    assert.deepEqual(result, ep);
  });
});

describe('compactProject', () => {
  it('compacts all endpoints in REST_CUSTOM', () => {
    const proj = {
      ID_PROJETO: 1,
      REST_CUSTOM: [
        { NO_REST_CUSTOM: 'ep1', REST_CUSTOM_JSON_SCHEMA: [{}] },
        { NO_REST_CUSTOM: 'ep2' },
      ],
    };
    const result = compactProject(proj);
    const endpoints = result.REST_CUSTOM as Array<Record<string, unknown>>;
    assert.ok(!endpoints[0].REST_CUSTOM_JSON_SCHEMA);
    assert.equal(endpoints[0].NO_REST_CUSTOM, 'ep1');
  });

  it('returns empty REST_CUSTOM when not an array', () => {
    const result = compactProject({ ID_PROJETO: 1 });
    assert.deepEqual(result.REST_CUSTOM, []);
  });
});
