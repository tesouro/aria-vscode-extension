import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  hasSelectStar,
  extractSqlReferencedTables,
  normalizeTableRef,
  tableRefNameOnly,
  splitSelectColumns,
  extractAliasName,
  analyzeSqlAliasIssues,
  hasQuotedIdentifiersOutsideAliases,
} from '../domain/sql/sql-policy-validator';

describe('hasSelectStar', () => {
  it('detects SELECT* without space (regex word boundary)', () => assert.ok(hasSelectStar('SELECT *FROM t')));
  it('rejects named columns', () => assert.ok(!hasSelectStar('SELECT id, name FROM t')));
  it('empty string', () => assert.ok(!hasSelectStar('')));
});

describe('extractSqlReferencedTables', () => {
  it('extracts FROM and JOIN tables', () => {
    const tables = extractSqlReferencedTables('SELECT a FROM tabela1 JOIN schema.tabela2 ON 1=1');
    assert.ok(tables.includes('TABELA1'));
    assert.ok(tables.includes('SCHEMA.TABELA2'));
  });
  it('skips DUAL', () => {
    assert.deepEqual(extractSqlReferencedTables('SELECT 1 FROM DUAL'), []);
  });
});

describe('normalizeTableRef', () => {
  it('uppercases and strips double quotes', () => {
    assert.equal(normalizeTableRef('"my_table"'), 'MY_TABLE');
  });
  it('strips brackets from start/end only', () => {
    assert.equal(normalizeTableRef('[table]'), 'TABLE');
  });
});

describe('tableRefNameOnly', () => {
  it('extracts last part', () => {
    assert.equal(tableRefNameOnly('SCHEMA.TABLE'), 'TABLE');
    assert.equal(tableRefNameOnly('TABLE'), 'TABLE');
  });
});

describe('splitSelectColumns', () => {
  it('splits on commas respecting parens', () => {
    const cols = splitSelectColumns('a, FUNC(b, c), d');
    assert.deepEqual(cols, ['a', 'FUNC(b, c)', 'd']);
  });
});

describe('extractAliasName', () => {
  it('extracts AS alias', () => assert.equal(extractAliasName('col AS myAlias'), 'myAlias'));
  it('extracts quoted AS alias', () => assert.equal(extractAliasName('col AS "My Alias"'), 'My Alias'));
  it('returns undefined for bare column', () => assert.equal(extractAliasName('col'), undefined));
});

describe('analyzeSqlAliasIssues', () => {
  it('finds missing aliases', () => {
    const r = analyzeSqlAliasIssues('SELECT col1, col2 FROM t');
    assert.ok(r.missingAlias.length >= 1);
  });
  it('finds non-mnemonic aliases', () => {
    const r = analyzeSqlAliasIssues('SELECT col1 AS COL1 FROM t');
    assert.ok(r.nonMnemonicAlias.length >= 1);
  });
  it('accepts good camelCase aliases', () => {
    const r = analyzeSqlAliasIssues('SELECT col1 AS myCol FROM t');
    assert.equal(r.nonMnemonicAlias.length, 0);
  });
});

describe('hasQuotedIdentifiersOutsideAliases', () => {
  it('false for AS "alias"', () => assert.ok(!hasQuotedIdentifiersOutsideAliases('SELECT x AS "myAlias" FROM t')));
  it('true for quoted table', () => assert.ok(hasQuotedIdentifiersOutsideAliases('SELECT x FROM "my_table"')));
});
