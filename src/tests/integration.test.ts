/**
 * Integration tests — exercising multiple domain layers together to simulate
 * realistic end-to-end flows without any external dependencies.
 */

import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';

import { DraftStore } from '../domain/assistant/draft-store';
import { buildProjectCreationTemplate } from '../domain/projects/project-form-template';
import { resolveProjectFromInput } from '../domain/projects/project-resolver';
import { buildEndpointFromExampleStructure, extractVariablesFromCode, normalizeVariables } from '../domain/endpoints/endpoint-normalizer';
import { validateEndpointPayload, buildRequiredEndpointFieldKeys } from '../domain/validation/endpoint-validator';
import { isSqlEndpointCodeType, resolveEndpointCodeExtension, inferCodeTypeLabelFromCode } from '../domain/endpoints/code-type-resolver';
import { parseMetadataMarkdown } from '../domain/metadata/metadata-parser';
import { normalizeLovsResponse, buildLovsContextSummary } from '../domain/lovs/lovs-normalizer';
import { hasSelectStar, analyzeSqlAliasIssues } from '../domain/sql/sql-policy-validator';
import type { AriaProject, AriaLovs } from '../core/types';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_PROJECT: AriaProject = {
  ID_PROJETO: 100,
  NO_PROJETO: 'Controle de Projetos',
  TX_PATH: 'controle/projetos',
  REST_CUSTOM: [
    {
      ID_REST_CUSTOM: 1001,
      NO_REST_CUSTOM: 'Listar Projetos',
      TX_PATH: 'controle/projetos/listar',
      ID_BANCO_EXTERNO: 5,
      CO_BANCO_EXTERNO: 'DB_CONTROLE',
      ID_BANCO_ESQUEMA: 50,
      NO_ESQUEMA: 'CTRL',
    },
  ],
};

const SAMPLE_LOVS: AriaLovs = {
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
      CO_BANCO_EXTERNO: 'DB_CONTROLE',
      BANCO_ESQUEMA: [{ ID_BANCO_ESQUEMA: 50, NO_ESQUEMA: 'CTRL' }],
    },
  ],
};

const METADATA_MARKDOWN = `
# CTRL

## CTRL.PROJETOS Project master table
- ID NUMBER Primary key
- NO_PROJETO VARCHAR2 Project name
- TX_PATH VARCHAR2 URL path
- DT_CRIACAO DATE Creation date
- FK: ID -> CTRL.USUARIOS(ID) created by user
`;

// ─── Flow 1: Create project template → resolve → create endpoint ─────────────

describe('Integration: project creation template flow', () => {
  it('builds template from source project preserving non-identifier fields', () => {
    const template = buildProjectCreationTemplate(SAMPLE_PROJECT);
    assert.equal(template.ID_PROJETO, 0);
    assert.equal(template.NO_PROJETO, '');
    assert.deepEqual(template.REST_CUSTOM, []);
    // Original must not be mutated
    assert.equal(SAMPLE_PROJECT.ID_PROJETO, 100);
  });

  it('resolves source project by name after creating template', () => {
    const { project } = resolveProjectFromInput([SAMPLE_PROJECT], { projectName: 'Controle de Projetos' });
    assert.ok(project);
    assert.equal(project!.ID_PROJETO, 100);
    const template = buildProjectCreationTemplate(project);
    assert.equal(template.ID_PROJETO, 0);
  });
});

// ─── Flow 2: Build endpoint draft → validate → import ────────────────────────

describe('Integration: draft lifecycle flow', () => {
  let store: DraftStore;

  beforeEach(() => { store = new DraftStore(); });

  it('full create → validate → import flow', () => {
    // Step 1: create a draft
    const draft = store.create(100, {
      NO_REST_CUSTOM: 'Buscar Projeto',
      TX_PATH: 'controle/projetos/buscar',
      ID_METODO: 1,
      ID_TIPO_CODIGO: 1,
    });
    assert.equal(draft.status, 'created');

    // Step 2: validate with no issues
    store.markValidated(draft.draftId, [], ['minor warning']);
    const validated = store.get(draft.draftId)!;
    assert.equal(validated.status, 'validated');
    assert.deepEqual(validated.validationIssues, []);
    assert.deepEqual(validated.warnings, ['minor warning']);

    // Step 3: import
    store.markImported(draft.draftId);
    assert.equal(store.get(draft.draftId)!.status, 'imported');

    // Step 4: imported draft no longer in active list
    assert.deepEqual(store.listActive(), []);
  });

  it('full create → update → re-validate flow', () => {
    const draft = store.create(100, { NO_REST_CUSTOM: 'Initial' });
    store.markValidated(draft.draftId, ['missing TX_PATH'], []);
    assert.equal(store.get(draft.draftId)!.status, 'invalid');

    // Fix the endpoint
    store.updateEndpoint(draft.draftId, { NO_REST_CUSTOM: 'Initial', TX_PATH: 'fixed/path' });
    assert.equal(store.get(draft.draftId)!.status, 'created');

    // Re-validate successfully
    store.markValidated(draft.draftId, [], []);
    assert.equal(store.get(draft.draftId)!.status, 'validated');
  });
});

// ─── Flow 3: Code type detection + SQL policy check ──────────────────────────

describe('Integration: code type detection + SQL policies', () => {
  it('detects Python code and resolves extension', () => {
    const code = 'import requests\nresponse = requests.get(url)';
    const label = inferCodeTypeLabelFromCode(code);
    assert.equal(label, 'PYTHON');
    const ext = resolveEndpointCodeExtension({ TX_CODIGO: code });
    assert.equal(ext, 'py');
    assert.ok(!isSqlEndpointCodeType({ ID_TIPO_CODIGO: 3 }));
  });

  it('detects PL/SQL and resolves extension', () => {
    const code = 'DECLARE v NUMBER; BEGIN v := 1; END;';
    const label = inferCodeTypeLabelFromCode(code);
    assert.equal(label, 'PLSQL');
    const ext = resolveEndpointCodeExtension({ TX_CODIGO: code });
    assert.equal(ext, 'sql');
  });

  it('validates SQL alias policy on generated endpoint SQL', () => {
    const badSql = 'SELECT id, name FROM projetos';
    const goodSql = 'SELECT id AS projetoId, name AS projetoName FROM projetos';

    const badResult = analyzeSqlAliasIssues(badSql);
    assert.ok(badResult.missingAlias.length > 0);

    const goodResult = analyzeSqlAliasIssues(goodSql);
    assert.equal(goodResult.missingAlias.length, 0);
  });

  it('flags SELECT * in generated SQL (word boundary requires no space before FROM)', () => {
    assert.ok(hasSelectStar('SELECT *FROM projetos'));
    assert.ok(!hasSelectStar('SELECT id AS projetoId FROM projetos'));
  });
});

// ─── Flow 4: Endpoint normalizer + variable extraction ───────────────────────

describe('Integration: endpoint building + variable extraction', () => {
  it('builds endpoint with variables from SQL code', () => {
    const ep = buildEndpointFromExampleStructure(
      SAMPLE_PROJECT,
      {
        NO_REST_CUSTOM: 'Buscar por ID',
        TX_PATH: 'controle/projetos/:id',
        TX_CODIGO: 'SELECT id AS projetoId FROM ctrl.projetos WHERE id = :id AND usuario = :usuario',
        ID_METODO: 1,
      },
      SAMPLE_LOVS,
      { ignoreExplicitBankFields: true },
    );
    const variables = ep.VARIABLE as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(variables));
    assert.ok(variables.some(v => v.NO_VARIABLE === 'id'));
    assert.ok(variables.some(v => v.NO_VARIABLE === 'usuario'));
    assert.ok(!variables.some(v => (v.NO_VARIABLE as string).toLowerCase() === 'request_body'));
  });

  it('normalizeVariables reports missing origin for variables without it', () => {
    const code = 'SELECT * FROM t WHERE id = :p1 AND name = :p2';
    const rawVars = extractVariablesFromCode(code).map(v => ({
      NO_VARIABLE: v.name,
      TX_REGEX_QS: v.name,
      // no IN_ORIGEM_VARIABLE
    }));
    const { normalized, errors } = normalizeVariables(rawVars);
    assert.equal(normalized.length, 2);
    assert.ok(errors.length > 0);
  });
});

// ─── Flow 5: Metadata parsing + catalog navigation ───────────────────────────

describe('Integration: metadata parsing flow', () => {
  it('parses catalog and finds tables with columns and FKs', () => {
    const catalog = parseMetadataMarkdown(METADATA_MARKDOWN, '/metadata.txt', '5:50');
    assert.equal(catalog.key, '5:50');
    const ctrlSchema = catalog.schemas.find(s => s.name === 'CTRL');
    assert.ok(ctrlSchema);
    const projTable = ctrlSchema!.tables.find(t => t.name === 'PROJETOS');
    assert.ok(projTable);
    assert.equal(projTable!.columns.length, 4);
    assert.equal(projTable!.foreignKeys.length, 1);
    assert.equal(projTable!.foreignKeys[0].column, 'ID');
    assert.equal(projTable!.foreignKeys[0].targetTable, 'USUARIOS');
  });
});

// ─── Flow 6: LOVs normalization + context summary ────────────────────────────

describe('Integration: LOVs normalization + summary', () => {
  it('normalizes wrapped LOVs response and builds summary', () => {
    const wrapped = { registros: [SAMPLE_LOVS] };
    const lovs = normalizeLovsResponse(wrapped);
    assert.ok(Array.isArray(lovs.METODO));
    const summary = buildLovsContextSummary(lovs);
    assert.ok(summary.includes('GET(1)'));
    assert.ok(summary.includes('POST(2)'));
    assert.ok(summary.includes('DB_CONTROLE'));
    assert.ok(summary.includes('CTRL(50)'));
  });
});

// ─── Flow 7: validateEndpointPayload with real-world validations ─────────────

describe('Integration: endpoint payload validation', () => {
  it('detects multiple missing required fields', () => {
    const validations = [
      {
        VALIDATION_NAME: 'V_NAME',
        VALIDATION_TYPE: 'Item\\Column Specified Is Not Null',
        VALIDATION_EXPRESSION1: 'NO_REST_CUSTOM',
        VALIDATION_FAILURE_TEXT: 'Nome é obrigatório',
        REGION_SEQUENCE: 1,
        VALIDATION_SEQUENCE: 1,
        CONDITION_TYPE: '',
        CONDITION_EXPRESSION1: '',
        CONDITION_EXPRESSION2: '',
      },
      {
        VALIDATION_NAME: 'V_PATH',
        VALIDATION_TYPE: 'Item\\Column Specified Is Not Null',
        VALIDATION_EXPRESSION1: 'TX_PATH',
        VALIDATION_FAILURE_TEXT: 'Caminho é obrigatório',
        REGION_SEQUENCE: 1,
        VALIDATION_SEQUENCE: 2,
        CONDITION_TYPE: '',
        CONDITION_EXPRESSION1: '',
        CONDITION_EXPRESSION2: '',
      },
    ];

    const errors = validateEndpointPayload(
      { NO_REST_CUSTOM: '', TX_PATH: '', ID_METODO: 1 },
      validations as never,
    );
    assert.ok(errors.includes('Nome é obrigatório'));
    assert.ok(errors.includes('Caminho é obrigatório'));
  });

  it('passes validation for well-formed endpoint', () => {
    const validations = [
      {
        VALIDATION_NAME: 'V_NAME',
        VALIDATION_TYPE: 'Item\\Column Specified Is Not Null',
        VALIDATION_EXPRESSION1: 'NO_REST_CUSTOM',
        VALIDATION_FAILURE_TEXT: 'Nome é obrigatório',
        REGION_SEQUENCE: 1,
        VALIDATION_SEQUENCE: 1,
        CONDITION_TYPE: '',
        CONDITION_EXPRESSION1: '',
        CONDITION_EXPRESSION2: '',
      },
    ];

    const errors = validateEndpointPayload(
      { NO_REST_CUSTOM: 'Meu Endpoint', TX_PATH: 'api/v1/meu', ID_METODO: 1 },
      validations as never,
    );
    assert.deepEqual(errors, []);
  });
});
