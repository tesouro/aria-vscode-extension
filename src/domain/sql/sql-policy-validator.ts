import { toStringSafe } from '../../core/utils';

export function hasSelectStar(sqlCode: string): boolean {
  if (!sqlCode.trim()) { return false; }
  return /\bselect\s+(?:distinct\s+)?(?:\*|[a-zA-Z_][\w$]*\s*\.\s*\*)\b/i.test(sqlCode);
}

export function extractSqlReferencedTables(sqlCode: string): string[] {
  const tables = new Set<string>();
  const regex = /\b(?:from|join)\s+([^\s,;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sqlCode)) !== null) {
    let token = toStringSafe(match[1]).trim();
    token = token.replace(/[),;]+$/g, '').replace(/^\(+/g, '');
    if (!token || /^select$/i.test(token)) { continue; }
    token = token.replace(/@.+$/, '').replace(/"/g, '');
    if (!token || token.toUpperCase() === 'DUAL') { continue; }
    tables.add(token.toUpperCase());
  }
  return Array.from(tables);
}

export function normalizeTableRef(tableRef: string): string {
  return toStringSafe(tableRef).trim().replace(/^"|"$/g, '').replace(/^\[|\]$/g, '').toUpperCase();
}

export function tableRefNameOnly(tableRef: string): string {
  const normalized = normalizeTableRef(tableRef);
  if (!normalized) { return ''; }
  const parts = normalized.split('.').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

export function splitSelectColumns(selectClause: string): string[] {
  const cols: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < selectClause.length; i++) {
    const ch = selectClause[i];
    if (ch === '(') { depth++; current += ch; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); current += ch; continue; }
    if (ch === ',' && depth === 0) {
      if (current.trim()) { cols.push(current.trim()); }
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) { cols.push(current.trim()); }
  return cols;
}

export function extractAliasName(token: string): string | undefined {
  const t = token.trim();
  if (!t) { return undefined; }

  const asQuoted = t.match(/\bas\s+"([^"]+)"\s*$/i) || t.match(/\bas\s+'([^']+)'\s*$/i);
  if (asQuoted?.[1]) { return asQuoted[1].trim(); }

  const asPlain = t.match(/\bas\s+([A-Za-z_][\w$]*)\s*$/i);
  if (asPlain?.[1]) { return asPlain[1].trim(); }

  const trailingQuoted = t.match(/\s+"([^"]+)"\s*$/) || t.match(/\s+'([^']+)'\s*$/);
  if (trailingQuoted?.[1]) { return trailingQuoted[1].trim(); }

  const trailingPlain = t.match(/\s+([A-Za-z_][\w$]*)\s*$/);
  if (trailingPlain?.[1]) {
    const maybeKeyword = trailingPlain[1].toLowerCase();
    if (maybeKeyword !== 'from' && maybeKeyword !== 'where' && maybeKeyword !== 'join') {
      return trailingPlain[1].trim();
    }
  }
  return undefined;
}

function normalizeAliasToken(value: string): string {
  return toStringSafe(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}

function isCamelCaseAlias(value: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(toStringSafe(value).trim());
}

function extractSourceColumnName(token: string): string {
  const t = token.trim();
  if (!t) { return ''; }
  let expr = t;
  expr = expr.replace(/\bas\s+(?:"[^"]+"|'[^']+'|[A-Za-z_][\w$]*)\s*$/i, '').trim();
  expr = expr.replace(/\s+(?:"[^"]+"|'[^']+'|[A-Za-z_][\w$]*)\s*$/, '').trim();
  const parts = expr.split('.').map((p) => p.trim()).filter(Boolean);
  const last = parts.length ? parts[parts.length - 1] : expr;
  return last.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
}

export function analyzeSqlAliasIssues(sql: string): { missingAlias: string[]; nonMnemonicAlias: string[] } {
  const selectMatch = sql.match(/\bselect\b([\s\S]*?)\bfrom\b/i);
  if (!selectMatch) { return { missingAlias: [], nonMnemonicAlias: [] }; }

  const selectClause = selectMatch[1];
  const cols = splitSelectColumns(selectClause);
  const missingAlias: string[] = [];
  const nonMnemonicAlias: string[] = [];

  for (const token of cols) {
    if (!/[A-Za-z_][\w$]*(?:\s*\.\s*[A-Za-z_][\w$]*)?|\(/.test(token)) { continue; }
    const alias = extractAliasName(token);
    if (!alias) { missingAlias.push(token); continue; }
    const sourceColumn = extractSourceColumnName(token);
    const aliasNorm = normalizeAliasToken(alias);
    const sourceNorm = normalizeAliasToken(sourceColumn);
    if (!isCamelCaseAlias(alias) || !aliasNorm || (sourceNorm && aliasNorm === sourceNorm)) {
      nonMnemonicAlias.push(token);
    }
  }
  return { missingAlias, nonMnemonicAlias };
}

export function hasQuotedIdentifiersOutsideAliases(sql: string): boolean {
  const source = toStringSafe(sql);
  if (!source.trim()) { return false; }
  const strippedAllowedAliases = source.replace(/\bAS\s+"[^"]+"/gi, 'AS __ALIAS__');
  return strippedAllowedAliases.includes('"');
}

export function hasSelectStarInText(text: string): boolean {
  return /\bselect\s+(?:distinct\s+)?(?:\*|[a-zA-Z_][\w$]*\s*\.\s*\*)\b/i.test(text);
}
