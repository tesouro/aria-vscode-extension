"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const sql_template_builder_1 = require("../domain/sql/sql-template-builder");
function payload(table, columns, dataSource) {
    return { schema: 'S', table, fullName: `S.${table}`, columns, idBancoExterno: 1, txDataSource: dataSource };
}
// ─── inferSqlDialectFromDatasource ────────────────────────────────────────────
(0, node_test_1.describe)('inferSqlDialectFromDatasource', () => {
    (0, node_test_1.it)('detects oracle from JDBC string', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)('jdbc:oracle:thin:@host:1521/svc'), 'oracle');
    });
    (0, node_test_1.it)('detects mssql from jdbc:sqlserver', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)('jdbc:sqlserver://host;databaseName=mydb'), 'mssql');
    });
    (0, node_test_1.it)('detects mssql from mssql keyword', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)('mssql://host/db'), 'mssql');
    });
    (0, node_test_1.it)('detects mysql from jdbc:mysql', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)('jdbc:mysql://host:3306/db'), 'mysql');
    });
    (0, node_test_1.it)('detects postgres from jdbc:postgresql', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)('jdbc:postgresql://host/db'), 'postgres');
    });
    (0, node_test_1.it)('detects postgres from postgres keyword', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)('postgres://host/db'), 'postgres');
    });
    (0, node_test_1.it)('returns generic for empty/undefined', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)(undefined), 'generic');
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)(''), 'generic');
    });
    (0, node_test_1.it)('returns generic for unknown datasource', () => {
        assert.equal((0, sql_template_builder_1.inferSqlDialectFromDatasource)('jdbc:db2://host/db'), 'generic');
    });
});
// ─── buildSqlTemplateFromMetadataDrop – SELECT ────────────────────────────────
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – select', () => {
    (0, node_test_1.it)('generates SELECT with listed columns (oracle = lowercase)', () => {
        const p = payload('USERS', ['ID', 'NAME'], 'jdbc:oracle:thin:@h');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'select');
        assert.ok(sql.includes('select'));
        assert.ok(sql.includes('from'));
        assert.ok(sql.includes('id'));
        assert.ok(sql.includes('name'));
    });
    (0, node_test_1.it)('generates SELECT with listed columns (generic = uppercase)', () => {
        const p = payload('USERS', ['ID', 'NAME']);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'select');
        assert.ok(sql.includes('SELECT'));
        assert.ok(sql.includes('FROM'));
    });
    (0, node_test_1.it)('falls back to ["ID"] when columns is empty', () => {
        const p = payload('USERS', []);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'select');
        assert.ok(sql.includes('ID') || sql.includes('"ID"'));
    });
});
// ─── INSERT ───────────────────────────────────────────────────────────────────
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – insert', () => {
    (0, node_test_1.it)('generates INSERT with VALUES block (oracle)', () => {
        const p = payload('ORDERS', ['ID', 'STATUS'], 'jdbc:oracle:thin:@h');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'insert');
        assert.ok(sql.includes('insert into'));
        assert.ok(sql.includes(':ID') || sql.includes(':id'));
        assert.ok(sql.includes(':STATUS') || sql.includes(':status'));
    });
    (0, node_test_1.it)('generates INSERT with positional params for postgres', () => {
        const p = payload('ORDERS', ['ID', 'STATUS'], 'postgres://h/db');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'insert');
        assert.ok(sql.includes('$1'));
        assert.ok(sql.includes('$2'));
    });
    (0, node_test_1.it)('generates INSERT with ? placeholders for mysql', () => {
        const p = payload('ORDERS', ['ID', 'STATUS'], 'jdbc:mysql://h/db');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'insert');
        assert.ok(sql.includes('?'));
    });
    (0, node_test_1.it)('generates INSERT with @PARAM placeholders for mssql', () => {
        const p = payload('ORDERS', ['ID', 'STATUS'], 'mssql://h/db');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'insert');
        assert.ok(sql.includes('@ID') || sql.includes('@STATUS'));
    });
});
// ─── UPDATE ───────────────────────────────────────────────────────────────────
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – update', () => {
    (0, node_test_1.it)('generates UPDATE SET block', () => {
        const p = payload('ITEMS', ['ID', 'VALUE'], 'jdbc:oracle:thin:@h');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'update');
        assert.ok(sql.includes('update'));
        assert.ok(sql.includes('set'));
        assert.ok(sql.includes('where'));
    });
});
// ─── DELETE ───────────────────────────────────────────────────────────────────
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – delete', () => {
    (0, node_test_1.it)('generates DELETE FROM with TODO comment', () => {
        const p = payload('ITEMS', ['ID']);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'delete');
        assert.ok(sql.toUpperCase().includes('DELETE FROM') || sql.toLowerCase().includes('delete from'));
        assert.ok(sql.includes('TODO'));
    });
});
// ─── PL/SQL actions ───────────────────────────────────────────────────────────
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – plsql_for_loop', () => {
    (0, node_test_1.it)('generates FOR LOOP block', () => {
        const p = payload('EMPLOYEES', ['ID']);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'plsql_for_loop');
        assert.ok(sql.includes('loop'));
        assert.ok(sql.includes('end loop'));
        assert.ok(sql.includes('r_'));
    });
});
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – plsql_select_into_rowtype', () => {
    (0, node_test_1.it)('generates DECLARE / SELECT INTO / ROWTYPE block', () => {
        const p = payload('EMP', ['ID']);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'plsql_select_into_rowtype');
        assert.ok(sql.includes('declare'));
        assert.ok(sql.includes('%rowtype'));
        assert.ok(sql.includes('begin'));
        assert.ok(sql.includes('end;'));
    });
});
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – plsql_select_into_fields', () => {
    (0, node_test_1.it)('generates field-level DECLARE and SELECT INTO', () => {
        const p = payload('EMP', ['ID', 'NAME', 'DEPT'], 'jdbc:oracle:thin:@h');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'plsql_select_into_fields');
        assert.ok(sql.includes('declare'));
        assert.ok(sql.includes('v_id'));
        assert.ok(sql.includes('v_name'));
        assert.ok(sql.includes('into'));
    });
});
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – plsql_bulk_collect_into', () => {
    (0, node_test_1.it)('generates BULK COLLECT INTO block', () => {
        const p = payload('ORDERS', ['ID']);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'plsql_bulk_collect_into');
        assert.ok(sql.includes('bulk collect into'));
        assert.ok(sql.includes('is table of'));
    });
});
// ─── Python actions ───────────────────────────────────────────────────────────
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – python_for_loop', () => {
    (0, node_test_1.it)('generates Python cursor.execute + for row loop', () => {
        const p = payload('USERS', ['ID'], 'jdbc:oracle:thin:@h');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'python_for_loop');
        assert.ok(sql.includes('cursor'));
        assert.ok(sql.includes('for row in'));
    });
});
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – python_select_into_obj', () => {
    (0, node_test_1.it)('generates fetchone into registro', () => {
        const p = payload('USERS', ['ID']);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'python_select_into_obj');
        assert.ok(sql.includes('fetchone'));
        assert.ok(sql.includes('registro'));
    });
});
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – python_select_into_fields', () => {
    (0, node_test_1.it)('generates field alias lines', () => {
        const p = payload('USERS', ['ID', 'EMAIL'], 'jdbc:oracle:thin:@h');
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'python_select_into_fields');
        assert.ok(sql.includes('id ='));
        assert.ok(sql.includes('email ='));
    });
});
(0, node_test_1.describe)('buildSqlTemplateFromMetadataDrop – python_bulk_collect_into', () => {
    (0, node_test_1.it)('generates fetchall into registros list', () => {
        const p = payload('USERS', ['ID']);
        const sql = (0, sql_template_builder_1.buildSqlTemplateFromMetadataDrop)(p, 'python_bulk_collect_into');
        assert.ok(sql.includes('fetchall'));
        assert.ok(sql.includes('registros'));
    });
});
