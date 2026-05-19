"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferSqlDialectFromDatasource = inferSqlDialectFromDatasource;
exports.buildSqlTemplateFromMetadataDrop = buildSqlTemplateFromMetadataDrop;
function inferSqlDialectFromDatasource(txDataSource) {
    const raw = String(txDataSource || '').toLowerCase();
    if (!raw) {
        return 'generic';
    }
    if (raw.includes('jdbc:oracle')) {
        return 'oracle';
    }
    if (raw.includes('jdbc:sqlserver') || raw.includes('mssql')) {
        return 'mssql';
    }
    if (raw.includes('jdbc:mysql')) {
        return 'mysql';
    }
    if (raw.includes('jdbc:postgresql') || raw.includes('postgres')) {
        return 'postgres';
    }
    return 'generic';
}
function buildSqlTemplateFromMetadataDrop(payload, action) {
    const dialect = inferSqlDialectFromDatasource(payload.txDataSource);
    const table = quoteIdentifier(payload.fullName || `${payload.schema}.${payload.table}`, dialect);
    const columns = payload.columns.length > 0 ? payload.columns : ['ID'];
    const selectKeyword = keyword('select', dialect);
    const fromKeyword = keyword('from', dialect);
    const whereKeyword = keyword('where', dialect);
    if (action === 'select') {
        const list = columns.map((column) => `  ${quoteIdentifier(column, dialect)}`).join(',\n');
        return [
            selectKeyword,
            list,
            `${fromKeyword} ${table} t`,
            `${whereKeyword} 1 = 1;`,
        ].join('\n');
    }
    if (action === 'insert') {
        const quotedColumns = columns.map((column) => `  ${quoteIdentifier(column, dialect)}`).join(',\n');
        const values = buildInsertValues(columns, dialect);
        return [
            `${keyword('insert into', dialect)} ${table} (`,
            quotedColumns,
            `) ${keyword('values', dialect)} (`,
            values,
            `);`,
        ].join('\n');
    }
    if (action === 'update') {
        const assignments = buildAssignments(columns, dialect);
        return [
            `${keyword('update', dialect)} ${table}`,
            keyword('set', dialect),
            assignments,
            `${whereKeyword} /* TODO: condicao */;`,
        ].join('\n');
    }
    if (action === 'plsql_for_loop') {
        const varName = `r_${toSnakeCase(payload.table)}`;
        return [
            `for ${varName} in (`,
            `  ${selectKeyword} *`,
            `  ${fromKeyword} ${table}`,
            `)`,
            `loop`,
            `  null;`,
            `end loop;`,
        ].join('\n');
    }
    if (action === 'plsql_select_into_rowtype') {
        const varName = `r_${toSnakeCase(payload.table)}`;
        return [
            `declare`,
            `  ${varName} ${table}%rowtype;`,
            `begin`,
            `  ${selectKeyword} *`,
            `  into ${varName}`,
            `  ${fromKeyword} ${table};`,
            `end;`,
        ].join('\n');
    }
    if (action === 'plsql_select_into_fields') {
        const projected = columns.slice(0, 8);
        const declarations = projected
            .map((column) => `  v_${toSnakeCase(column)} ${table}.${quoteIdentifier(column, dialect)}%type;`)
            .join('\n');
        const selectFields = projected
            .map((column) => `    ${quoteIdentifier(column, dialect)}`)
            .join(',\n');
        const intoFields = projected
            .map((column) => `    v_${toSnakeCase(column)}`)
            .join(',\n');
        return [
            `declare`,
            declarations,
            `begin`,
            `  ${selectKeyword}`,
            selectFields,
            `  into`,
            intoFields,
            `  ${fromKeyword} ${table};`,
            `end;`,
        ].join('\n');
    }
    if (action === 'plsql_bulk_collect_into') {
        const typeName = `t_${toSnakeCase(payload.table)}_list`;
        const varName = `v_${toSnakeCase(payload.table)}_list`;
        return [
            `declare`,
            `  type ${typeName} is table of ${table}%rowtype;`,
            `  ${varName} ${typeName};`,
            `begin`,
            `  ${selectKeyword} *`,
            `  bulk collect into ${varName}`,
            `  ${fromKeyword} ${table};`,
            `end;`,
        ].join('\n');
    }
    if (action === 'python_for_loop') {
        return [
            `cursor = aria_db.cursor()`,
            `cursor.execute("""`,
            `${selectKeyword}`,
            `  *`,
            `${fromKeyword} ${table}`,
            `""")`,
            `for row in cursor.fetchall(type=\"dict\"):`,
            `    pass`,
        ].join('\n');
    }
    if (action === 'python_select_into_obj') {
        return [
            `cursor = aria_db.cursor()`,
            `cursor.execute("""`,
            `${selectKeyword}`,
            `  *`,
            `${fromKeyword} ${table}`,
            `""")`,
            `registro = cursor.fetchone(type=\"dict\")`,
        ].join('\n');
    }
    if (action === 'python_select_into_fields') {
        const projected = columns.slice(0, 8);
        const aliasLines = projected
            .map((column) => `${toSnakeCase(column)} = (registro or {}).get('${column.toLowerCase()}') or (registro or {}).get('${column.toUpperCase()}')`)
            .join('\n');
        const selectFields = projected.map((column) => `  ${quoteIdentifier(column, dialect)}`).join(',\n');
        return [
            `cursor = aria_db.cursor()`,
            `cursor.execute("""`,
            `${selectKeyword}`,
            selectFields,
            `${fromKeyword} ${table}`,
            `""")`,
            `registro = cursor.fetchone(type=\"dict\")`,
            aliasLines,
        ].join('\n');
    }
    if (action === 'python_bulk_collect_into') {
        return [
            `cursor = aria_db.cursor()`,
            `cursor.execute("""`,
            `${selectKeyword}`,
            `  *`,
            `${fromKeyword} ${table}`,
            `""")`,
            `registros = cursor.fetchall(type=\"dict\")`,
        ].join('\n');
    }
    return [
        `${keyword('delete from', dialect)} ${table}`,
        `${whereKeyword} /* TODO: condicao */;`,
    ].join('\n');
}
function buildInsertValues(columns, dialect) {
    if (dialect === 'postgres') {
        return columns.map((_, index) => `  $${index + 1}`).join(',\n');
    }
    if (dialect === 'mysql') {
        return columns.map(() => `  ?`).join(',\n');
    }
    return columns.map((column) => `  ${placeholder(column, dialect)}`).join(',\n');
}
function buildAssignments(columns, dialect) {
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
function quoteIdentifier(identifier, dialect) {
    const parts = identifier.split('.').filter((part) => part.trim().length > 0);
    const wrapped = parts.map((part) => {
        if (dialect === 'oracle') {
            return part.toLowerCase();
        }
        if (dialect === 'mssql') {
            return `[${part}]`;
        }
        if (dialect === 'mysql') {
            return `\`${part}\``;
        }
        return `"${part}"`;
    });
    return wrapped.join('.');
}
function placeholder(column, dialect) {
    const token = column.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase();
    if (dialect === 'mssql') {
        return `@${token}`;
    }
    if (dialect === 'oracle') {
        return `:${token}`;
    }
    return `:${token}`;
}
function keyword(value, dialect) {
    return dialect === 'oracle' ? value.toLowerCase() : value.toUpperCase();
}
function toSnakeCase(value) {
    return value
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
}
