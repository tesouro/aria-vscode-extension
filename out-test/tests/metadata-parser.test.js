"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const metadata_parser_1 = require("../domain/metadata/metadata-parser");
// ─── parseMetadataMarkdown ────────────────────────────────────────────────────
(0, node_test_1.describe)('parseMetadataMarkdown', () => {
    (0, node_test_1.it)('parses empty markdown to empty catalog', () => {
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)('', '/path/file.txt', 'key1');
        assert.equal(catalog.key, 'key1');
        assert.equal(catalog.filePath, '/path/file.txt');
        assert.deepEqual(catalog.schemas, []);
    });
    (0, node_test_1.it)('parses schema header (# SCHEMA)', () => {
        const md = `# PUBLIC\n`;
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(md);
        assert.equal(catalog.schemas.length, 1);
        assert.equal(catalog.schemas[0].name, 'PUBLIC');
    });
    (0, node_test_1.it)('parses table under current schema (## TABLE)', () => {
        const md = `# MYSCHEMA\n## MYTABLE Some comment\n`;
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(md);
        assert.equal(catalog.schemas.length, 1);
        const schema = catalog.schemas[0];
        assert.equal(schema.name, 'MYSCHEMA');
        assert.equal(schema.tables.length, 1);
        assert.equal(schema.tables[0].name, 'MYTABLE');
        assert.equal(schema.tables[0].comment, 'Some comment');
        assert.equal(schema.tables[0].fullName, 'MYSCHEMA.MYTABLE');
    });
    (0, node_test_1.it)('parses table with schema prefix (## SCHEMA.TABLE)', () => {
        const md = `## SCHEMA1.ORDERS Order table\n`;
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(md);
        const table = catalog.schemas[0].tables[0];
        assert.equal(table.schema, 'SCHEMA1');
        assert.equal(table.name, 'ORDERS');
        assert.equal(table.fullName, 'SCHEMA1.ORDERS');
        assert.equal(table.comment, 'Order table');
    });
    (0, node_test_1.it)('parses column entries under table', () => {
        const md = `# S\n## T\n- ID NUMBER Primary key\n- NAME VARCHAR2\n`;
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(md);
        const table = catalog.schemas[0].tables[0];
        assert.equal(table.columns.length, 2);
        assert.equal(table.columns[0].name, 'ID');
        assert.equal(table.columns[0].type, 'NUMBER');
        assert.equal(table.columns[0].comment, 'Primary key');
        assert.equal(table.columns[1].name, 'NAME');
        assert.equal(table.columns[1].type, 'VARCHAR2');
    });
    (0, node_test_1.it)('parses FK entries under table', () => {
        const md = `# S\n## T\n- FK: USER_ID -> AUTH.USERS(ID) references users\n`;
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(md);
        const table = catalog.schemas[0].tables[0];
        assert.equal(table.foreignKeys.length, 1);
        const fk = table.foreignKeys[0];
        assert.equal(fk.column, 'USER_ID');
        assert.equal(fk.targetSchema, 'AUTH');
        assert.equal(fk.targetTable, 'USERS');
        assert.equal(fk.targetColumn, 'ID');
    });
    (0, node_test_1.it)('handles multiple schemas and tables', () => {
        const md = [
            '# SCHEMA_A',
            '## TABLE_A1',
            '- COL1 NUMBER',
            '# SCHEMA_B',
            '## TABLE_B1',
            '- COL2 VARCHAR2',
            '## SCHEMA_A.TABLE_A2',
        ].join('\n');
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(md);
        assert.equal(catalog.schemas.length, 2);
        const a = catalog.schemas.find(s => s.name === 'SCHEMA_A');
        const b = catalog.schemas.find(s => s.name === 'SCHEMA_B');
        assert.ok(a);
        assert.ok(b);
        assert.equal(a.tables.length, 2);
        assert.equal(b.tables.length, 1);
    });
    (0, node_test_1.it)('uses filePath as key when no key provided', () => {
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)('', '/my/path.txt');
        assert.equal(catalog.key, '/my/path.txt');
    });
    (0, node_test_1.it)('handles CRLF line endings', () => {
        const md = '# S\r\n## T\r\n- COL NUMBER\r\n';
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(md);
        assert.equal(catalog.schemas.length, 1);
        assert.equal(catalog.schemas[0].tables[0].columns.length, 1);
    });
});
// ─── listMetadataSchemas ──────────────────────────────────────────────────────
(0, node_test_1.describe)('listMetadataSchemas', () => {
    (0, node_test_1.it)('extracts schemas from dotted table headers', () => {
        const md = '## SCHEMA1.TABLE1\n## SCHEMA2.TABLE2\n## SCHEMA1.TABLE3\n';
        const schemas = (0, metadata_parser_1.listMetadataSchemas)(md);
        assert.deepEqual(schemas, ['SCHEMA1', 'SCHEMA2']);
    });
    (0, node_test_1.it)('ignores tables without schema prefix', () => {
        const md = '## TABLE_ONLY\n## SCHEMA.OTHER\n';
        const schemas = (0, metadata_parser_1.listMetadataSchemas)(md);
        assert.deepEqual(schemas, ['SCHEMA']);
    });
    (0, node_test_1.it)('returns sorted list', () => {
        const md = '## Z.T\n## A.T\n## M.T\n';
        const schemas = (0, metadata_parser_1.listMetadataSchemas)(md);
        assert.deepEqual(schemas, ['A', 'M', 'Z']);
    });
    (0, node_test_1.it)('returns empty for markdown with no tables', () => {
        assert.deepEqual((0, metadata_parser_1.listMetadataSchemas)('# Just a header\n'), []);
    });
});
// ─── extractMetadataTableNames ────────────────────────────────────────────────
(0, node_test_1.describe)('extractMetadataTableNames', () => {
    (0, node_test_1.it)('extracts table names from ## headers', () => {
        const md = '## S.TABLE1\n## S.TABLE2\n';
        const tables = (0, metadata_parser_1.extractMetadataTableNames)(md);
        assert.ok(tables.includes('S.TABLE1'));
        assert.ok(tables.includes('S.TABLE2'));
    });
    (0, node_test_1.it)('deduplicates repeated table entries', () => {
        const md = '## S.T\n## S.T\n## S.T\n';
        const tables = (0, metadata_parser_1.extractMetadataTableNames)(md);
        assert.equal(tables.length, 1);
    });
    (0, node_test_1.it)('returns empty for no ## lines', () => {
        assert.deepEqual((0, metadata_parser_1.extractMetadataTableNames)('# SCHEMA\n'), []);
    });
});
// ─── formatMetadataForEditor ──────────────────────────────────────────────────
(0, node_test_1.describe)('formatMetadataForEditor', () => {
    (0, node_test_1.it)('returns undefined for null', () => assert.equal((0, metadata_parser_1.formatMetadataForEditor)(null), undefined));
    (0, node_test_1.it)('returns undefined for undefined', () => assert.equal((0, metadata_parser_1.formatMetadataForEditor)(undefined), undefined));
    (0, node_test_1.it)('returns undefined for empty string', () => assert.equal((0, metadata_parser_1.formatMetadataForEditor)(''), undefined));
    (0, node_test_1.it)('returns trimmed string as-is', () => assert.equal((0, metadata_parser_1.formatMetadataForEditor)('  hello  '), 'hello'));
    (0, node_test_1.it)('stringifies objects to JSON', () => {
        const result = (0, metadata_parser_1.formatMetadataForEditor)({ a: 1 });
        assert.equal(result, JSON.stringify({ a: 1 }, null, 2));
    });
    (0, node_test_1.it)('handles non-serializable by stringifying', () => {
        const result = (0, metadata_parser_1.formatMetadataForEditor)(42);
        assert.ok(typeof result === 'string');
    });
});
// ─── buildMetadataQuery ───────────────────────────────────────────────────────
(0, node_test_1.describe)('buildMetadataQuery', () => {
    (0, node_test_1.it)('returns undefined for empty endpoint', () => {
        assert.equal((0, metadata_parser_1.buildMetadataQuery)({}), undefined);
    });
    (0, node_test_1.it)('adds p_id_banco_externo when present', () => {
        const q = (0, metadata_parser_1.buildMetadataQuery)({ ID_BANCO_EXTERNO: 5 });
        assert.equal(q?.p_id_banco_externo, '5');
    });
    (0, node_test_1.it)('adds p_id_banco_esquema when present', () => {
        const q = (0, metadata_parser_1.buildMetadataQuery)({ ID_BANCO_EXTERNO: 5, ID_BANCO_ESQUEMA: 3 });
        assert.equal(q?.p_id_banco_esquema, '3');
    });
    (0, node_test_1.it)('ignores null/undefined fields', () => {
        const q = (0, metadata_parser_1.buildMetadataQuery)({ ID_BANCO_EXTERNO: null, ID_BANCO_ESQUEMA: undefined });
        assert.equal(q, undefined);
    });
    (0, node_test_1.it)('adds p_co_esquema when co_esquema is set (lowercase key)', () => {
        const q = (0, metadata_parser_1.buildMetadataQuery)({ co_esquema: 'MYSCHEMA' });
        assert.equal(q?.p_co_esquema, 'MYSCHEMA');
    });
});
// ─── countProjectSchemas ──────────────────────────────────────────────────────
(0, node_test_1.describe)('countProjectSchemas', () => {
    (0, node_test_1.it)('counts schemas from endpoints', () => {
        const project = {
            REST_CUSTOM: [
                { ID_REST_CUSTOM: 1, NO_ESQUEMA: 'SCHEMA_A' },
                { ID_REST_CUSTOM: 2, NO_ESQUEMA: 'SCHEMA_A' },
                { ID_REST_CUSTOM: 3, NO_ESQUEMA: 'SCHEMA_B' },
            ],
        };
        const counts = (0, metadata_parser_1.countProjectSchemas)(project);
        assert.equal(counts['SCHEMA_A'], 2);
        assert.equal(counts['SCHEMA_B'], 1);
    });
    (0, node_test_1.it)('skips endpoints with no schema', () => {
        const project = { REST_CUSTOM: [{ ID_REST_CUSTOM: 1 }] };
        assert.deepEqual((0, metadata_parser_1.countProjectSchemas)(project), {});
    });
    (0, node_test_1.it)('normalizes schema names to uppercase', () => {
        const project = { REST_CUSTOM: [{ ID_REST_CUSTOM: 1, no_esquema: 'my_schema' }] };
        const counts = (0, metadata_parser_1.countProjectSchemas)(project);
        assert.equal(counts['MY_SCHEMA'], 1);
    });
    (0, node_test_1.it)('handles missing REST_CUSTOM', () => {
        assert.deepEqual((0, metadata_parser_1.countProjectSchemas)({}), {});
    });
});
