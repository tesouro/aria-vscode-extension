import type { MetadataTableDragPayload } from '../../vscode/tree/metadata-tree-provider';

export type SqlTemplateAction = 'select' | 'insert' | 'update' | 'delete';
export type SqlDialect = 'oracle' | 'mssql' | 'mysql' | 'postgres' | 'generic';

export function inferSqlDialectFromDatasource(txDataSource: string | undefined): SqlDialect {
  const raw = String(txDataSource || '').toLowerCase();
  if (!raw) { return 'generic'; }
  if (raw.includes('jdbc:oracle')) { return 'oracle'; }
  if (raw.includes('jdbc:sqlserver') || raw.includes('mssql')) { return 'mssql'; }
  if (raw.includes('jdbc:mysql')) { return 'mysql'; }
  if (raw.includes('jdbc:postgresql') || raw.includes('postgres')) { return 'postgres'; }
  return 'generic';
}

export function buildSqlTemplateFromMetadataDrop(payload: MetadataTableDragPayload, action: SqlTemplateAction): string {
  const dialect = inferSqlDialectFromDatasource(payload.txDataSource);
  const table = quoteIdentifier(payload.fullName || `${payload.schema}.${payload.table}`, dialect);
  const columns = payload.columns.length > 0 ? payload.columns : ['ID'];

  if (action === 'select') {
    const list = columns.map((column) => `  ${quoteIdentifier(column, dialect)}`).join(',\n');
    return [
      `SELECT`,
      list,
      `FROM ${table} t`,
      `WHERE 1 = 1;`,
    ].join('\n');
  }

  if (action === 'insert') {
    const quotedColumns = columns.map((column) => `  ${quoteIdentifier(column, dialect)}`).join(',\n');
    const values = buildInsertValues(columns, dialect);
    return [
      `INSERT INTO ${table} (`,
      quotedColumns,
      `) VALUES (`,
      values,
      `);`,
    ].join('\n');
  }

  if (action === 'update') {
    const assignments = buildAssignments(columns, dialect);
    return [
      `UPDATE ${table}`,
      `SET`,
      assignments,
      `WHERE /* TODO: condicao */;`,
    ].join('\n');
  }

  return [
    `DELETE FROM ${table}`,
    `WHERE /* TODO: condicao */;`,
  ].join('\n');
}

function buildInsertValues(columns: string[], dialect: SqlDialect): string {
  if (dialect === 'postgres') {
    return columns.map((_, index) => `  $${index + 1}`).join(',\n');
  }
  if (dialect === 'mysql') {
    return columns.map(() => `  ?`).join(',\n');
  }
  return columns.map((column) => `  ${placeholder(column, dialect)}`).join(',\n');
}

function buildAssignments(columns: string[], dialect: SqlDialect): string {
  if (dialect === 'postgres') {
    return columns
      .map((column, index) => `  ${quoteIdentifier(column, dialect)} = $${index + 1}`)
      .join(',\n');
  }
  if (dialect === 'mysql') {
    return columns
      .map((column) => `  ${quoteIdentifier(column, dialect)} = ?`)
      .join(',\n');
  }
  return columns
    .map((column) => `  ${quoteIdentifier(column, dialect)} = ${placeholder(column, dialect)}`)
    .join(',\n');
}

function quoteIdentifier(identifier: string, dialect: SqlDialect): string {
  const parts = identifier.split('.').filter((part) => part.trim().length > 0);
  const wrapped = parts.map((part) => {
    if (dialect === 'mssql') { return `[${part}]`; }
    if (dialect === 'mysql') { return `\`${part}\``; }
    return `"${part}"`;
  });
  return wrapped.join('.');
}

function placeholder(column: string, dialect: SqlDialect): string {
  const token = column.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
  if (dialect === 'mssql') { return `@${token}`; }
  if (dialect === 'oracle') { return `:${token}`; }
  return `:${token}`;
}
