import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { inferSqlDialectFromDatasource, buildSqlTemplateFromMetadataDrop } from '../domain/sql/sql-template-builder';

// ─── Local type (mirrors MetadataTableDragPayload) ────────────────────────────

interface TestPayload {
  schema: string;
  table: string;
  fullName: string;
  columns: string[];
  idBancoExterno: number;
  idBancoEsquema?: number;
  txDataSource?: string;
}

function payload(table: string, columns: string[], dataSource?: string): TestPayload {
  return { schema: 'S', table, fullName: `S.${table}`, columns, idBancoExterno: 1, txDataSource: dataSource };
}

// ─── inferSqlDialectFromDatasource ────────────────────────────────────────────

describe('inferSqlDialectFromDatasource', () => {
  it('detects oracle from JDBC string', () => {
    assert.equal(inferSqlDialectFromDatasource('jdbc:oracle:thin:@host:1521/svc'), 'oracle');
  });

  it('detects mssql from jdbc:sqlserver', () => {
    assert.equal(inferSqlDialectFromDatasource('jdbc:sqlserver://host;databaseName=mydb'), 'mssql');
  });

  it('detects mssql from mssql keyword', () => {
    assert.equal(inferSqlDialectFromDatasource('mssql://host/db'), 'mssql');
  });

  it('detects mysql from jdbc:mysql', () => {
    assert.equal(inferSqlDialectFromDatasource('jdbc:mysql://host:3306/db'), 'mysql');
  });

  it('detects postgres from jdbc:postgresql', () => {
    assert.equal(inferSqlDialectFromDatasource('jdbc:postgresql://host/db'), 'postgres');
  });

  it('detects postgres from postgres keyword', () => {
    assert.equal(inferSqlDialectFromDatasource('postgres://host/db'), 'postgres');
  });

  it('returns generic for empty/undefined', () => {
    assert.equal(inferSqlDialectFromDatasource(undefined), 'generic');
    assert.equal(inferSqlDialectFromDatasource(''), 'generic');
  });

  it('returns generic for unknown datasource', () => {
    assert.equal(inferSqlDialectFromDatasource('jdbc:db2://host/db'), 'generic');
  });
});

// ─── buildSqlTemplateFromMetadataDrop – SELECT ────────────────────────────────

describe('buildSqlTemplateFromMetadataDrop – select', () => {
  it('generates SELECT with listed columns (oracle = lowercase)', () => {
    const p = payload('USERS', ['ID', 'NAME'], 'jdbc:oracle:thin:@h');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'select');
    assert.ok(sql.includes('select'));
    assert.ok(sql.includes('from'));
    assert.ok(sql.includes('id'));
    assert.ok(sql.includes('name'));
  });

  it('generates SELECT with listed columns (generic = uppercase)', () => {
    const p = payload('USERS', ['ID', 'NAME']);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'select');
    assert.ok(sql.includes('SELECT'));
    assert.ok(sql.includes('FROM'));
  });

  it('falls back to ["ID"] when columns is empty', () => {
    const p = payload('USERS', []);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'select');
    assert.ok(sql.includes('ID') || sql.includes('"ID"'));
  });
});

// ─── INSERT ───────────────────────────────────────────────────────────────────

describe('buildSqlTemplateFromMetadataDrop – insert', () => {
  it('generates INSERT with VALUES block (oracle)', () => {
    const p = payload('ORDERS', ['ID', 'STATUS'], 'jdbc:oracle:thin:@h');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'insert');
    assert.ok(sql.includes('insert into'));
    assert.ok(sql.includes(':ID') || sql.includes(':id'));
    assert.ok(sql.includes(':STATUS') || sql.includes(':status'));
  });

  it('generates INSERT with positional params for postgres', () => {
    const p = payload('ORDERS', ['ID', 'STATUS'], 'postgres://h/db');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'insert');
    assert.ok(sql.includes('$1'));
    assert.ok(sql.includes('$2'));
  });

  it('generates INSERT with ? placeholders for mysql', () => {
    const p = payload('ORDERS', ['ID', 'STATUS'], 'jdbc:mysql://h/db');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'insert');
    assert.ok(sql.includes('?'));
  });

  it('generates INSERT with @PARAM placeholders for mssql', () => {
    const p = payload('ORDERS', ['ID', 'STATUS'], 'mssql://h/db');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'insert');
    assert.ok(sql.includes('@ID') || sql.includes('@STATUS'));
  });
});

// ─── UPDATE ───────────────────────────────────────────────────────────────────

describe('buildSqlTemplateFromMetadataDrop – update', () => {
  it('generates UPDATE SET block', () => {
    const p = payload('ITEMS', ['ID', 'VALUE'], 'jdbc:oracle:thin:@h');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'update');
    assert.ok(sql.includes('update'));
    assert.ok(sql.includes('set'));
    assert.ok(sql.includes('where'));
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('buildSqlTemplateFromMetadataDrop – delete', () => {
  it('generates DELETE FROM with TODO comment', () => {
    const p = payload('ITEMS', ['ID']);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'delete');
    assert.ok(sql.toUpperCase().includes('DELETE FROM') || sql.toLowerCase().includes('delete from'));
    assert.ok(sql.includes('TODO'));
  });
});

// ─── PL/SQL actions ───────────────────────────────────────────────────────────

describe('buildSqlTemplateFromMetadataDrop – plsql_for_loop', () => {
  it('generates FOR LOOP block', () => {
    const p = payload('EMPLOYEES', ['ID']);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'plsql_for_loop');
    assert.ok(sql.includes('loop'));
    assert.ok(sql.includes('end loop'));
    assert.ok(sql.includes('r_'));
  });
});

describe('buildSqlTemplateFromMetadataDrop – plsql_select_into_rowtype', () => {
  it('generates DECLARE / SELECT INTO / ROWTYPE block', () => {
    const p = payload('EMP', ['ID']);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'plsql_select_into_rowtype');
    assert.ok(sql.includes('declare'));
    assert.ok(sql.includes('%rowtype'));
    assert.ok(sql.includes('begin'));
    assert.ok(sql.includes('end;'));
  });
});

describe('buildSqlTemplateFromMetadataDrop – plsql_select_into_fields', () => {
  it('generates field-level DECLARE and SELECT INTO', () => {
    const p = payload('EMP', ['ID', 'NAME', 'DEPT'], 'jdbc:oracle:thin:@h');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'plsql_select_into_fields');
    assert.ok(sql.includes('declare'));
    assert.ok(sql.includes('v_id'));
    assert.ok(sql.includes('v_name'));
    assert.ok(sql.includes('into'));
  });
});

describe('buildSqlTemplateFromMetadataDrop – plsql_bulk_collect_into', () => {
  it('generates BULK COLLECT INTO block', () => {
    const p = payload('ORDERS', ['ID']);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'plsql_bulk_collect_into');
    assert.ok(sql.includes('bulk collect into'));
    assert.ok(sql.includes('is table of'));
  });
});

// ─── Python actions ───────────────────────────────────────────────────────────

describe('buildSqlTemplateFromMetadataDrop – python_for_loop', () => {
  it('generates Python cursor.execute + for row loop', () => {
    const p = payload('USERS', ['ID'], 'jdbc:oracle:thin:@h');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'python_for_loop');
    assert.ok(sql.includes('cursor'));
    assert.ok(sql.includes('for row in'));
  });
});

describe('buildSqlTemplateFromMetadataDrop – python_select_into_obj', () => {
  it('generates fetchone into registro', () => {
    const p = payload('USERS', ['ID']);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'python_select_into_obj');
    assert.ok(sql.includes('fetchone'));
    assert.ok(sql.includes('registro'));
  });
});

describe('buildSqlTemplateFromMetadataDrop – python_select_into_fields', () => {
  it('generates field alias lines', () => {
    const p = payload('USERS', ['ID', 'EMAIL'], 'jdbc:oracle:thin:@h');
    const sql = buildSqlTemplateFromMetadataDrop(p, 'python_select_into_fields');
    assert.ok(sql.includes('id ='));
    assert.ok(sql.includes('email ='));
  });
});

describe('buildSqlTemplateFromMetadataDrop – python_bulk_collect_into', () => {
  it('generates fetchall into registros list', () => {
    const p = payload('USERS', ['ID']);
    const sql = buildSqlTemplateFromMetadataDrop(p, 'python_bulk_collect_into');
    assert.ok(sql.includes('fetchall'));
    assert.ok(sql.includes('registros'));
  });
});
