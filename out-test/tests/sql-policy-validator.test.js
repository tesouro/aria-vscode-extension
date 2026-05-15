"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const sql_policy_validator_1 = require("../domain/sql/sql-policy-validator");
(0, node_test_1.describe)('hasSelectStar', () => {
    (0, node_test_1.it)('detects SELECT* without space (regex word boundary)', () => assert.ok((0, sql_policy_validator_1.hasSelectStar)('SELECT *FROM t')));
    (0, node_test_1.it)('rejects named columns', () => assert.ok(!(0, sql_policy_validator_1.hasSelectStar)('SELECT id, name FROM t')));
    (0, node_test_1.it)('empty string', () => assert.ok(!(0, sql_policy_validator_1.hasSelectStar)('')));
});
(0, node_test_1.describe)('extractSqlReferencedTables', () => {
    (0, node_test_1.it)('extracts FROM and JOIN tables', () => {
        const tables = (0, sql_policy_validator_1.extractSqlReferencedTables)('SELECT a FROM tabela1 JOIN schema.tabela2 ON 1=1');
        assert.ok(tables.includes('TABELA1'));
        assert.ok(tables.includes('SCHEMA.TABELA2'));
    });
    (0, node_test_1.it)('skips DUAL', () => {
        assert.deepEqual((0, sql_policy_validator_1.extractSqlReferencedTables)('SELECT 1 FROM DUAL'), []);
    });
});
(0, node_test_1.describe)('normalizeTableRef', () => {
    (0, node_test_1.it)('uppercases and strips double quotes', () => {
        assert.equal((0, sql_policy_validator_1.normalizeTableRef)('"my_table"'), 'MY_TABLE');
    });
    (0, node_test_1.it)('strips brackets from start/end only', () => {
        assert.equal((0, sql_policy_validator_1.normalizeTableRef)('[table]'), 'TABLE');
    });
});
(0, node_test_1.describe)('tableRefNameOnly', () => {
    (0, node_test_1.it)('extracts last part', () => {
        assert.equal((0, sql_policy_validator_1.tableRefNameOnly)('SCHEMA.TABLE'), 'TABLE');
        assert.equal((0, sql_policy_validator_1.tableRefNameOnly)('TABLE'), 'TABLE');
    });
});
(0, node_test_1.describe)('splitSelectColumns', () => {
    (0, node_test_1.it)('splits on commas respecting parens', () => {
        const cols = (0, sql_policy_validator_1.splitSelectColumns)('a, FUNC(b, c), d');
        assert.deepEqual(cols, ['a', 'FUNC(b, c)', 'd']);
    });
});
(0, node_test_1.describe)('extractAliasName', () => {
    (0, node_test_1.it)('extracts AS alias', () => assert.equal((0, sql_policy_validator_1.extractAliasName)('col AS myAlias'), 'myAlias'));
    (0, node_test_1.it)('extracts quoted AS alias', () => assert.equal((0, sql_policy_validator_1.extractAliasName)('col AS "My Alias"'), 'My Alias'));
    (0, node_test_1.it)('returns undefined for bare column', () => assert.equal((0, sql_policy_validator_1.extractAliasName)('col'), undefined));
});
(0, node_test_1.describe)('analyzeSqlAliasIssues', () => {
    (0, node_test_1.it)('finds missing aliases', () => {
        const r = (0, sql_policy_validator_1.analyzeSqlAliasIssues)('SELECT col1, col2 FROM t');
        assert.ok(r.missingAlias.length >= 1);
    });
    (0, node_test_1.it)('finds non-mnemonic aliases', () => {
        const r = (0, sql_policy_validator_1.analyzeSqlAliasIssues)('SELECT col1 AS COL1 FROM t');
        assert.ok(r.nonMnemonicAlias.length >= 1);
    });
    (0, node_test_1.it)('accepts good camelCase aliases', () => {
        const r = (0, sql_policy_validator_1.analyzeSqlAliasIssues)('SELECT col1 AS myCol FROM t');
        assert.equal(r.nonMnemonicAlias.length, 0);
    });
});
(0, node_test_1.describe)('hasQuotedIdentifiersOutsideAliases', () => {
    (0, node_test_1.it)('false for AS "alias"', () => assert.ok(!(0, sql_policy_validator_1.hasQuotedIdentifiersOutsideAliases)('SELECT x AS "myAlias" FROM t')));
    (0, node_test_1.it)('true for quoted table', () => assert.ok((0, sql_policy_validator_1.hasQuotedIdentifiersOutsideAliases)('SELECT x FROM "my_table"')));
});
