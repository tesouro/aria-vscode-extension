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
  hasSelectStarInText,
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
  it('false for empty string', () => assert.ok(!hasQuotedIdentifiersOutsideAliases('')));
  it('false for no quotes at all', () => assert.ok(!hasQuotedIdentifiersOutsideAliases('SELECT id FROM t WHERE 1=1')));
  it('multiple AS aliases stripped before check', () => {
    assert.ok(!hasQuotedIdentifiersOutsideAliases('SELECT a AS "aliasA", b AS "aliasB" FROM t'));
  });
});

describe('hasSelectStarInText', () => {
  it('detects SELECT *FROM (no space before FROM)', () => assert.ok(hasSelectStarInText('some text SELECT *FROM t rest')));
  it('does not match SELECT * FROM with space (word boundary requires next word char)', () => assert.ok(!hasSelectStarInText('SELECT * FROM t')));
  it('returns false for named columns', () => assert.ok(!hasSelectStarInText('SELECT id, name FROM t')));
  it('returns false for empty', () => assert.ok(!hasSelectStarInText('')));
});

describe('hasSelectStar – additional cases', () => {
  it('detects table.*FROM pattern', () => assert.ok(hasSelectStar('SELECT t.*FROM t')));
  it('does not match SELECT DISTINCT * FROM with trailing space', () => assert.ok(!hasSelectStar('SELECT DISTINCT * FROM t')));
  it('false for no SELECT', () => assert.ok(!hasSelectStar('UPDATE t SET x = 1')));
});

describe('extractSqlReferencedTables – additional cases', () => {
  it('handles multiple JOINs', () => {
    const tables = extractSqlReferencedTables('SELECT a FROM t1 INNER JOIN t2 ON 1=1 LEFT JOIN t3 ON 1=1');
    assert.ok(tables.includes('T1'));
    assert.ok(tables.includes('T2'));
    assert.ok(tables.includes('T3'));
  });

  it('strips trailing comma from table name', () => {
    const tables = extractSqlReferencedTables('SELECT * FROM table1, table2');
    assert.ok(tables.some(t => t === 'TABLE1' || t === 'TABLE2'));
  });

  it('returns empty for empty SQL', () => {
    assert.deepEqual(extractSqlReferencedTables(''), []);
  });
});

describe('splitSelectColumns – edge cases', () => {
  it('handles nested function calls', () => {
    const cols = splitSelectColumns('NVL(a, 0), b');
    assert.equal(cols.length, 2);
    assert.ok(cols[0].includes('NVL'));
  });

  it('handles single column', () => {
    const cols = splitSelectColumns('id');
    assert.deepEqual(cols, ['id']);
  });

  it('handles empty', () => {
    assert.deepEqual(splitSelectColumns(''), []);
  });
});

describe('extractAliasName – edge cases', () => {
  it('returns undefined for empty string', () => assert.equal(extractAliasName(''), undefined));
  it('returns undefined for column without alias', () => assert.equal(extractAliasName('schema.column'), undefined));
  it('returns plain trailing identifier as alias', () => {
    const alias = extractAliasName('some_expr myAlias');
    assert.equal(alias, 'myAlias');
  });
  it('does not pick FROM as alias', () => assert.equal(extractAliasName('t FROM'), undefined));
});

describe('analyzeSqlAliasIssues – edge cases', () => {
  it('returns empty for SQL with no SELECT', () => {
    const r = analyzeSqlAliasIssues('UPDATE t SET x = 1');
    assert.deepEqual(r.missingAlias, []);
    assert.deepEqual(r.nonMnemonicAlias, []);
  });

  it('reports multiple missing aliases', () => {
    const r = analyzeSqlAliasIssues('SELECT col1, col2, col3 FROM t');
    assert.ok(r.missingAlias.length >= 2);
  });
});
