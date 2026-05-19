import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  parseMetadataMarkdown,
  listMetadataSchemas,
  extractMetadataTableNames,
  formatMetadataForEditor,
  buildMetadataQuery,
  countProjectSchemas,
} from '../domain/metadata/metadata-parser';

// ─── parseMetadataMarkdown ────────────────────────────────────────────────────

describe('parseMetadataMarkdown', () => {
  it('parses empty markdown to empty catalog', () => {
    const catalog = parseMetadataMarkdown('', '/path/file.txt', 'key1');
    assert.equal(catalog.key, 'key1');
    assert.equal(catalog.filePath, '/path/file.txt');
    assert.deepEqual(catalog.schemas, []);
  });

  it('parses schema header (# SCHEMA)', () => {
    const md = `# PUBLIC\n`;
    const catalog = parseMetadataMarkdown(md);
    assert.equal(catalog.schemas.length, 1);
    assert.equal(catalog.schemas[0].name, 'PUBLIC');
  });

  it('parses table under current schema (## TABLE)', () => {
    const md = `# MYSCHEMA\n## MYTABLE Some comment\n`;
    const catalog = parseMetadataMarkdown(md);
    assert.equal(catalog.schemas.length, 1);
    const schema = catalog.schemas[0];
    assert.equal(schema.name, 'MYSCHEMA');
    assert.equal(schema.tables.length, 1);
    assert.equal(schema.tables[0].name, 'MYTABLE');
    assert.equal(schema.tables[0].comment, 'Some comment');
    assert.equal(schema.tables[0].fullName, 'MYSCHEMA.MYTABLE');
  });

  it('parses table with schema prefix (## SCHEMA.TABLE)', () => {
    const md = `## SCHEMA1.ORDERS Order table\n`;
    const catalog = parseMetadataMarkdown(md);
    const table = catalog.schemas[0].tables[0];
    assert.equal(table.schema, 'SCHEMA1');
    assert.equal(table.name, 'ORDERS');
    assert.equal(table.fullName, 'SCHEMA1.ORDERS');
    assert.equal(table.comment, 'Order table');
  });

  it('parses column entries under table', () => {
    const md = `# S\n## T\n- ID NUMBER Primary key\n- NAME VARCHAR2\n`;
    const catalog = parseMetadataMarkdown(md);
    const table = catalog.schemas[0].tables[0];
    assert.equal(table.columns.length, 2);
    assert.equal(table.columns[0].name, 'ID');
    assert.equal(table.columns[0].type, 'NUMBER');
    assert.equal(table.columns[0].comment, 'Primary key');
    assert.equal(table.columns[1].name, 'NAME');
    assert.equal(table.columns[1].type, 'VARCHAR2');
  });

  it('parses FK entries under table', () => {
    const md = `# S\n## T\n- FK: USER_ID -> AUTH.USERS(ID) references users\n`;
    const catalog = parseMetadataMarkdown(md);
    const table = catalog.schemas[0].tables[0];
    assert.equal(table.foreignKeys.length, 1);
    const fk = table.foreignKeys[0];
    assert.equal(fk.column, 'USER_ID');
    assert.equal(fk.targetSchema, 'AUTH');
    assert.equal(fk.targetTable, 'USERS');
    assert.equal(fk.targetColumn, 'ID');
  });

  it('handles multiple schemas and tables', () => {
    const md = [
      '# SCHEMA_A',
      '## TABLE_A1',
      '- COL1 NUMBER',
      '# SCHEMA_B',
      '## TABLE_B1',
      '- COL2 VARCHAR2',
      '## SCHEMA_A.TABLE_A2',
    ].join('\n');
    const catalog = parseMetadataMarkdown(md);
    assert.equal(catalog.schemas.length, 2);
    const a = catalog.schemas.find(s => s.name === 'SCHEMA_A');
    const b = catalog.schemas.find(s => s.name === 'SCHEMA_B');
    assert.ok(a);
    assert.ok(b);
    assert.equal(a!.tables.length, 2);
    assert.equal(b!.tables.length, 1);
  });

  it('uses filePath as key when no key provided', () => {
    const catalog = parseMetadataMarkdown('', '/my/path.txt');
    assert.equal(catalog.key, '/my/path.txt');
  });

  it('handles CRLF line endings', () => {
    const md = '# S\r\n## T\r\n- COL NUMBER\r\n';
    const catalog = parseMetadataMarkdown(md);
    assert.equal(catalog.schemas.length, 1);
    assert.equal(catalog.schemas[0].tables[0].columns.length, 1);
  });
});

// ─── listMetadataSchemas ──────────────────────────────────────────────────────

describe('listMetadataSchemas', () => {
  it('extracts schemas from dotted table headers', () => {
    const md = '## SCHEMA1.TABLE1\n## SCHEMA2.TABLE2\n## SCHEMA1.TABLE3\n';
    const schemas = listMetadataSchemas(md);
    assert.deepEqual(schemas, ['SCHEMA1', 'SCHEMA2']);
  });

  it('ignores tables without schema prefix', () => {
    const md = '## TABLE_ONLY\n## SCHEMA.OTHER\n';
    const schemas = listMetadataSchemas(md);
    assert.deepEqual(schemas, ['SCHEMA']);
  });

  it('returns sorted list', () => {
    const md = '## Z.T\n## A.T\n## M.T\n';
    const schemas = listMetadataSchemas(md);
    assert.deepEqual(schemas, ['A', 'M', 'Z']);
  });

  it('returns empty for markdown with no tables', () => {
    assert.deepEqual(listMetadataSchemas('# Just a header\n'), []);
  });
});

// ─── extractMetadataTableNames ────────────────────────────────────────────────

describe('extractMetadataTableNames', () => {
  it('extracts table names from ## headers', () => {
    const md = '## S.TABLE1\n## S.TABLE2\n';
    const tables = extractMetadataTableNames(md);
    assert.ok(tables.includes('S.TABLE1'));
    assert.ok(tables.includes('S.TABLE2'));
  });

  it('deduplicates repeated table entries', () => {
    const md = '## S.T\n## S.T\n## S.T\n';
    const tables = extractMetadataTableNames(md);
    assert.equal(tables.length, 1);
  });

  it('returns empty for no ## lines', () => {
    assert.deepEqual(extractMetadataTableNames('# SCHEMA\n'), []);
  });
});

// ─── formatMetadataForEditor ──────────────────────────────────────────────────

describe('formatMetadataForEditor', () => {
  it('returns undefined for null', () => assert.equal(formatMetadataForEditor(null), undefined));
  it('returns undefined for undefined', () => assert.equal(formatMetadataForEditor(undefined), undefined));
  it('returns undefined for empty string', () => assert.equal(formatMetadataForEditor(''), undefined));
  it('returns trimmed string as-is', () => assert.equal(formatMetadataForEditor('  hello  '), 'hello'));
  it('stringifies objects to JSON', () => {
    const result = formatMetadataForEditor({ a: 1 });
    assert.equal(result, JSON.stringify({ a: 1 }, null, 2));
  });
  it('handles non-serializable by stringifying', () => {
    const result = formatMetadataForEditor(42);
    assert.ok(typeof result === 'string');
  });
});

// ─── buildMetadataQuery ───────────────────────────────────────────────────────

describe('buildMetadataQuery', () => {
  it('returns undefined for empty endpoint', () => {
    assert.equal(buildMetadataQuery({}), undefined);
  });

  it('adds p_id_banco_externo when present', () => {
    const q = buildMetadataQuery({ ID_BANCO_EXTERNO: 5 });
    assert.equal(q?.p_id_banco_externo, '5');
  });

  it('adds p_id_banco_esquema when present', () => {
    const q = buildMetadataQuery({ ID_BANCO_EXTERNO: 5, ID_BANCO_ESQUEMA: 3 });
    assert.equal(q?.p_id_banco_esquema, '3');
  });

  it('ignores null/undefined fields', () => {
    const q = buildMetadataQuery({ ID_BANCO_EXTERNO: null, ID_BANCO_ESQUEMA: undefined });
    assert.equal(q, undefined);
  });

  it('adds p_co_esquema when co_esquema is set (lowercase key)', () => {
    const q = buildMetadataQuery({ co_esquema: 'MYSCHEMA' });
    assert.equal(q?.p_co_esquema, 'MYSCHEMA');
  });
});

// ─── countProjectSchemas ──────────────────────────────────────────────────────

describe('countProjectSchemas', () => {
  it('counts schemas from endpoints', () => {
    const project = {
      REST_CUSTOM: [
        { ID_REST_CUSTOM: 1, NO_ESQUEMA: 'SCHEMA_A' },
        { ID_REST_CUSTOM: 2, NO_ESQUEMA: 'SCHEMA_A' },
        { ID_REST_CUSTOM: 3, NO_ESQUEMA: 'SCHEMA_B' },
      ],
    };
    const counts = countProjectSchemas(project);
    assert.equal(counts['SCHEMA_A'], 2);
    assert.equal(counts['SCHEMA_B'], 1);
  });

  it('skips endpoints with no schema', () => {
    const project = { REST_CUSTOM: [{ ID_REST_CUSTOM: 1 }] };
    assert.deepEqual(countProjectSchemas(project), {});
  });

  it('normalizes schema names to uppercase', () => {
    const project = { REST_CUSTOM: [{ ID_REST_CUSTOM: 1, no_esquema: 'my_schema' }] };
    const counts = countProjectSchemas(project);
    assert.equal(counts['MY_SCHEMA'], 1);
  });

  it('handles missing REST_CUSTOM', () => {
    assert.deepEqual(countProjectSchemas({}), {});
  });
});
