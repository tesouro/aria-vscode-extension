"use strict";
/**
 * Integration tests — exercising multiple domain layers together to simulate
 * realistic end-to-end flows without any external dependencies.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const draft_store_1 = require("../domain/assistant/draft-store");
const project_form_template_1 = require("../domain/projects/project-form-template");
const project_resolver_1 = require("../domain/projects/project-resolver");
const endpoint_normalizer_1 = require("../domain/endpoints/endpoint-normalizer");
const endpoint_validator_1 = require("../domain/validation/endpoint-validator");
const code_type_resolver_1 = require("../domain/endpoints/code-type-resolver");
const metadata_parser_1 = require("../domain/metadata/metadata-parser");
const lovs_normalizer_1 = require("../domain/lovs/lovs-normalizer");
const sql_policy_validator_1 = require("../domain/sql/sql-policy-validator");
// ─── Fixtures ──────────────────────────────────────────────────────────────────
const SAMPLE_PROJECT = {
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
const SAMPLE_LOVS = {
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
(0, node_test_1.describe)('Integration: project creation template flow', () => {
    (0, node_test_1.it)('builds template from source project preserving non-identifier fields', () => {
        const template = (0, project_form_template_1.buildProjectCreationTemplate)(SAMPLE_PROJECT);
        assert.equal(template.ID_PROJETO, 0);
        assert.equal(template.NO_PROJETO, '');
        assert.deepEqual(template.REST_CUSTOM, []);
        // Original must not be mutated
        assert.equal(SAMPLE_PROJECT.ID_PROJETO, 100);
    });
    (0, node_test_1.it)('resolves source project by name after creating template', () => {
        const { project } = (0, project_resolver_1.resolveProjectFromInput)([SAMPLE_PROJECT], { projectName: 'Controle de Projetos' });
        assert.ok(project);
        assert.equal(project.ID_PROJETO, 100);
        const template = (0, project_form_template_1.buildProjectCreationTemplate)(project);
        assert.equal(template.ID_PROJETO, 0);
    });
});
// ─── Flow 2: Build endpoint draft → validate → import ────────────────────────
(0, node_test_1.describe)('Integration: draft lifecycle flow', () => {
    let store;
    (0, node_test_1.beforeEach)(() => { store = new draft_store_1.DraftStore(); });
    (0, node_test_1.it)('full create → validate → import flow', () => {
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
        const validated = store.get(draft.draftId);
        assert.equal(validated.status, 'validated');
        assert.deepEqual(validated.validationIssues, []);
        assert.deepEqual(validated.warnings, ['minor warning']);
        // Step 3: import
        store.markImported(draft.draftId);
        assert.equal(store.get(draft.draftId).status, 'imported');
        // Step 4: imported draft no longer in active list
        assert.deepEqual(store.listActive(), []);
    });
    (0, node_test_1.it)('full create → update → re-validate flow', () => {
        const draft = store.create(100, { NO_REST_CUSTOM: 'Initial' });
        store.markValidated(draft.draftId, ['missing TX_PATH'], []);
        assert.equal(store.get(draft.draftId).status, 'invalid');
        // Fix the endpoint
        store.updateEndpoint(draft.draftId, { NO_REST_CUSTOM: 'Initial', TX_PATH: 'fixed/path' });
        assert.equal(store.get(draft.draftId).status, 'created');
        // Re-validate successfully
        store.markValidated(draft.draftId, [], []);
        assert.equal(store.get(draft.draftId).status, 'validated');
    });
});
// ─── Flow 3: Code type detection + SQL policy check ──────────────────────────
(0, node_test_1.describe)('Integration: code type detection + SQL policies', () => {
    (0, node_test_1.it)('detects Python code and resolves extension', () => {
        const code = 'import requests\nresponse = requests.get(url)';
        const label = (0, code_type_resolver_1.inferCodeTypeLabelFromCode)(code);
        assert.equal(label, 'PYTHON');
        const ext = (0, code_type_resolver_1.resolveEndpointCodeExtension)({ TX_CODIGO: code });
        assert.equal(ext, 'py');
        assert.ok(!(0, code_type_resolver_1.isSqlEndpointCodeType)({ ID_TIPO_CODIGO: 3 }));
    });
    (0, node_test_1.it)('detects PL/SQL and resolves extension', () => {
        const code = 'DECLARE v NUMBER; BEGIN v := 1; END;';
        const label = (0, code_type_resolver_1.inferCodeTypeLabelFromCode)(code);
        assert.equal(label, 'PLSQL');
        const ext = (0, code_type_resolver_1.resolveEndpointCodeExtension)({ TX_CODIGO: code });
        assert.equal(ext, 'sql');
    });
    (0, node_test_1.it)('validates SQL alias policy on generated endpoint SQL', () => {
        const badSql = 'SELECT id, name FROM projetos';
        const goodSql = 'SELECT id AS projetoId, name AS projetoName FROM projetos';
        const badResult = (0, sql_policy_validator_1.analyzeSqlAliasIssues)(badSql);
        assert.ok(badResult.missingAlias.length > 0);
        const goodResult = (0, sql_policy_validator_1.analyzeSqlAliasIssues)(goodSql);
        assert.equal(goodResult.missingAlias.length, 0);
    });
    (0, node_test_1.it)('flags SELECT * in generated SQL (word boundary requires no space before FROM)', () => {
        assert.ok((0, sql_policy_validator_1.hasSelectStar)('SELECT *FROM projetos'));
        assert.ok(!(0, sql_policy_validator_1.hasSelectStar)('SELECT id AS projetoId FROM projetos'));
    });
});
// ─── Flow 4: Endpoint normalizer + variable extraction ───────────────────────
(0, node_test_1.describe)('Integration: endpoint building + variable extraction', () => {
    (0, node_test_1.it)('builds endpoint with variables from SQL code', () => {
        const ep = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(SAMPLE_PROJECT, {
            NO_REST_CUSTOM: 'Buscar por ID',
            TX_PATH: 'controle/projetos/:id',
            TX_CODIGO: 'SELECT id AS projetoId FROM ctrl.projetos WHERE id = :id AND usuario = :usuario',
            ID_METODO: 1,
        }, SAMPLE_LOVS, { ignoreExplicitBankFields: true });
        const variables = ep.VARIABLE;
        assert.ok(Array.isArray(variables));
        assert.ok(variables.some(v => v.NO_VARIABLE === 'id'));
        assert.ok(variables.some(v => v.NO_VARIABLE === 'usuario'));
        assert.ok(!variables.some(v => v.NO_VARIABLE.toLowerCase() === 'request_body'));
    });
    (0, node_test_1.it)('normalizeVariables reports missing origin for variables without it', () => {
        const code = 'SELECT * FROM t WHERE id = :p1 AND name = :p2';
        const rawVars = (0, endpoint_normalizer_1.extractVariablesFromCode)(code).map(v => ({
            NO_VARIABLE: v.name,
            TX_REGEX_QS: v.name,
            // no IN_ORIGEM_VARIABLE
        }));
        const { normalized, errors } = (0, endpoint_normalizer_1.normalizeVariables)(rawVars);
        assert.equal(normalized.length, 2);
        assert.ok(errors.length > 0);
    });
});
// ─── Flow 5: Metadata parsing + catalog navigation ───────────────────────────
(0, node_test_1.describe)('Integration: metadata parsing flow', () => {
    (0, node_test_1.it)('parses catalog and finds tables with columns and FKs', () => {
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(METADATA_MARKDOWN, '/metadata.txt', '5:50');
        assert.equal(catalog.key, '5:50');
        const ctrlSchema = catalog.schemas.find(s => s.name === 'CTRL');
        assert.ok(ctrlSchema);
        const projTable = ctrlSchema.tables.find(t => t.name === 'PROJETOS');
        assert.ok(projTable);
        assert.equal(projTable.columns.length, 4);
        assert.equal(projTable.foreignKeys.length, 1);
        assert.equal(projTable.foreignKeys[0].column, 'ID');
        assert.equal(projTable.foreignKeys[0].targetTable, 'USUARIOS');
    });
});
// ─── Flow 6: LOVs normalization + context summary ────────────────────────────
(0, node_test_1.describe)('Integration: LOVs normalization + summary', () => {
    (0, node_test_1.it)('normalizes wrapped LOVs response and builds summary', () => {
        const wrapped = { registros: [SAMPLE_LOVS] };
        const lovs = (0, lovs_normalizer_1.normalizeLovsResponse)(wrapped);
        assert.ok(Array.isArray(lovs.METODO));
        const summary = (0, lovs_normalizer_1.buildLovsContextSummary)(lovs);
        assert.ok(summary.includes('GET(1)'));
        assert.ok(summary.includes('POST(2)'));
        assert.ok(summary.includes('DB_CONTROLE'));
        assert.ok(summary.includes('CTRL(50)'));
    });
});
// ─── Flow 7: validateEndpointPayload with real-world validations ─────────────
(0, node_test_1.describe)('Integration: endpoint payload validation', () => {
    (0, node_test_1.it)('detects multiple missing required fields', () => {
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
        const errors = (0, endpoint_validator_1.validateEndpointPayload)({ NO_REST_CUSTOM: '', TX_PATH: '', ID_METODO: 1 }, validations);
        assert.ok(errors.includes('Nome é obrigatório'));
        assert.ok(errors.includes('Caminho é obrigatório'));
    });
    (0, node_test_1.it)('passes validation for well-formed endpoint', () => {
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
        const errors = (0, endpoint_validator_1.validateEndpointPayload)({ NO_REST_CUSTOM: 'Meu Endpoint', TX_PATH: 'api/v1/meu', ID_METODO: 1 }, validations);
        assert.deepEqual(errors, []);
    });
});
