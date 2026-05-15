import type { ParsedMetadataCatalog, ParsedMetadataSchema, ParsedMetadataTable } from '../../core/types';
import { toStringSafe } from '../../core/utils';

export function parseMetadataMarkdown(markdown: string, filePath?: string, key?: string): ParsedMetadataCatalog {
  const schemaMap = new Map<string, ParsedMetadataSchema>();
  const lines = markdown.split(/\r?\n/);
  let currentSchemaName = '';
  let currentTable: ParsedMetadataTable | undefined;

  const getOrCreateSchema = (schemaName: string): ParsedMetadataSchema => {
    const normalized = schemaName.trim().toUpperCase();
    const existing = schemaMap.get(normalized);
    if (existing) { return existing; }
    const created: ParsedMetadataSchema = { name: normalized, tables: [] };
    schemaMap.set(normalized, created);
    return created;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.startsWith('# ') && !line.startsWith('## ')) {
      const schemaName = line.slice(2).trim().split(/\s+/)[0];
      if (schemaName) {
        currentSchemaName = schemaName.toUpperCase();
        getOrCreateSchema(currentSchemaName);
        currentTable = undefined;
      }
      continue;
    }

    if (line.startsWith('## ')) {
      const rest = line.slice(3).trim();
      if (!rest) { continue; }
      const parts = rest.split(/\s+/);
      const tableToken = toStringSafe(parts.shift()).trim().toUpperCase();
      const comment = parts.join(' ').trim();
      if (!tableToken) { continue; }

      const schemaName = tableToken.includes('.') ? tableToken.split('.')[0].toUpperCase() : currentSchemaName;
      const tableName = tableToken.includes('.') ? tableToken.split('.').slice(1).join('.') : tableToken;
      const fullName = tableToken.includes('.') ? tableToken : (schemaName ? `${schemaName}.${tableName}` : tableName);

      const schemaNode = getOrCreateSchema(schemaName || currentSchemaName || '');
      currentTable = { schema: schemaNode.name, name: tableName, fullName, comment: comment || undefined, columns: [], foreignKeys: [] };
      schemaNode.tables.push(currentTable);
      continue;
    }

    if (line.startsWith('- ') && currentTable) {
      const entry = line.slice(2).trim();
      if (!entry) { continue; }

      const fkMatch = entry.match(/^FK:\s*(\S+)\s*->\s*([^.\s]+)\.([^\s(]+)\(([^\s)]+)\)\s*(.*)$/i);
      if (fkMatch) {
        currentTable.foreignKeys.push({
          column: fkMatch[1].trim().toUpperCase(),
          targetSchema: fkMatch[2].trim().toUpperCase(),
          targetTable: fkMatch[3].trim().toUpperCase(),
          targetColumn: fkMatch[4].trim().toUpperCase(),
          raw: line.trim(),
        });
        continue;
      }

      const columnMatch = entry.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
      if (!columnMatch) { continue; }
      currentTable.columns.push({
        name: columnMatch[1].trim().toUpperCase(),
        type: columnMatch[2].trim(),
        comment: columnMatch[3]?.trim() || undefined,
        raw: line.trim(),
      });
    }
  }

  return { key: key ?? filePath ?? '', filePath, markdown, schemas: Array.from(schemaMap.values()) };
}

export function listMetadataSchemas(full: string): string[] {
  const lines = full.split(/\r?\n/);
  const schemas = new Set<string>();
  for (const line of lines) {
    if (!line.startsWith('## ')) { continue; }
    const tableOnly = line.replace(/^(## \S+).*$/, '$1').replace(/^##\s+/, '');
    const schemaName = tableOnly.includes('.') ? tableOnly.split('.')[0].toUpperCase() : '';
    if (schemaName) { schemas.add(schemaName); }
  }
  return Array.from(schemas).sort();
}

export function extractMetadataTableNames(full: string): string[] {
  const lines = full.split(/\r?\n/);
  const tables: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('## ')) { continue; }
    const tableOnly = line.replace(/^(## \S+).*$/, '$1').replace(/^##\s+/, '').trim();
    if (tableOnly) { tables.push(tableOnly.toUpperCase()); }
  }
  return Array.from(new Set(tables));
}

export function formatMetadataForEditor(response: unknown): string | undefined {
  if (response === null || response === undefined) { return undefined; }
  if (typeof response === 'string') {
    const trimmed = response.trim();
    return trimmed ? trimmed : undefined;
  }
  try { return JSON.stringify(response, null, 2); } catch { return String(response); }
}

export function buildMetadataQuery(endpoint: Record<string, unknown>): Record<string, string> | undefined {
  const query: Record<string, string> = {};
  addMetadataQueryValue(query, 'p_id_banco_externo', endpoint.ID_BANCO_EXTERNO ?? endpoint.id_banco_externo);
  addMetadataQueryValue(query, 'p_id_banco_esquema', endpoint.ID_BANCO_ESQUEMA ?? endpoint.id_banco_esquema);
  addMetadataQueryValue(query, 'p_co_esquema', endpoint.CO_ESQUEMA ?? endpoint.co_esquema);
  addMetadataQueryValue(query, 'p_co_tabela', endpoint.CO_TABELA ?? endpoint.co_tabela);
  return Object.keys(query).length > 0 ? query : undefined;
}

function addMetadataQueryValue(query: Record<string, string>, key: string, value: unknown): void {
  if (value === null || value === undefined) { return; }
  const normalized = String(value).trim();
  if (!normalized) { return; }
  query[key] = normalized;
}

export function countProjectSchemas(project: { REST_CUSTOM?: Array<Record<string, unknown>> }): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const endpoint of project.REST_CUSTOM || []) {
    const schema = toStringSafe(endpoint.NO_ESQUEMA ?? endpoint.no_esquema ?? endpoint.CO_ESQUEMA ?? endpoint.co_esquema).trim().toUpperCase();
    if (schema) { counts[schema] = (counts[schema] || 0) + 1; }
  }
  return counts;
}
