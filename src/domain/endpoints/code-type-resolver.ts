import { CodeTypeLabel } from '../../core/types';
import { toStringSafe, toNumber } from '../../core/utils';
import type { AriaLovs } from '../../core/types';

export function normalizeCodeTypeToken(value: unknown): string {
  return toStringSafe(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function normalizeCodeTypeLabel(value: unknown): CodeTypeLabel | undefined {
  const token = normalizeCodeTypeToken(value);
  if (!token) { return undefined; }
  if (token.includes('python') || token.includes('jython') || token === 'py') { return 'PYTHON'; }
  if (token.includes('plsql') || token.includes('proceduralsql')) { return 'PLSQL'; }
  if (token.includes('sql')) { return 'SQL'; }
  return undefined;
}

export function inferCodeTypeLabelFromCode(code: string): CodeTypeLabel {
  const normalized = code.trim().toLowerCase();
  if (!normalized) { return 'SQL'; }
  if (
    (normalized.startsWith('#!') && normalized.includes('python')) ||
    /\b(import|from|def|class|lambda|self)\b/.test(normalized)
  ) { return 'PYTHON'; }
  if (
    /\b(declare|begin|exception|procedure|function|package|cursor|loop|elsif|pragma)\b/.test(normalized) ||
    /:=/.test(normalized) ||
    /\bend;\s*$/.test(normalized)
  ) { return 'PLSQL'; }
  return 'SQL';
}

export function formatCodeTypeLabel(label: CodeTypeLabel): string {
  if (label === 'PYTHON') { return 'Python'; }
  if (label === 'PLSQL') { return 'PL/SQL'; }
  return 'SQL';
}

export function resolveCodeTypeSelection(
  lovs: AriaLovs | undefined,
  input: { codeType?: unknown; code?: string }
): { id: number; label: CodeTypeLabel; displayName: string } {
  const explicitLabel = normalizeCodeTypeLabel(input.codeType);
  const inferredLabel = explicitLabel ?? inferCodeTypeLabelFromCode(input.code || '');
  const fallbackIds: Record<CodeTypeLabel, number> = { SQL: 1, PLSQL: 2, PYTHON: 3 };
  const typeRows = lovs?.TIPO_CODIGO ?? [];

  for (const row of typeRows) {
    const rowLabel = normalizeCodeTypeLabel(row.NO_TIPO_CODIGO);
    if (rowLabel === inferredLabel) {
      return { id: row.ID_TIPO_CODIGO, label: inferredLabel, displayName: row.NO_TIPO_CODIGO };
    }
  }

  const fallbackRow = typeRows.find((row) => {
    const rowToken = normalizeCodeTypeToken(row.NO_TIPO_CODIGO);
    if (inferredLabel === 'PYTHON') { return rowToken.includes('python') || rowToken.includes('jython') || rowToken === 'py'; }
    if (inferredLabel === 'PLSQL') { return rowToken.includes('plsql') || rowToken.includes('proceduralsql') || rowToken === 'plsql'; }
    return rowToken === 'sql';
  }) || typeRows[0];

  return {
    id: fallbackRow?.ID_TIPO_CODIGO ?? fallbackIds[inferredLabel],
    label: inferredLabel,
    displayName: fallbackRow?.NO_TIPO_CODIGO ?? formatCodeTypeLabel(inferredLabel),
  };
}

export function isSqlEndpointCodeType(endpoint: Record<string, unknown>): boolean {
  const tipoCodigoId = toNumber(endpoint.ID_TIPO_CODIGO);
  if (tipoCodigoId === 1) { return true; }
  const tipoCodigoNome = normalizeCodeTypeLabel(endpoint.NO_TIPO_CODIGO);
  return tipoCodigoNome === 'SQL';
}

export function resolveEndpointCodeExtension(endpoint: Record<string, unknown>): 'sql' | 'py' {
  const tipoCodigo = endpoint.ID_TIPO_CODIGO;
  if (typeof tipoCodigo === 'number' && tipoCodigo === 3) { return 'py'; }

  const pythonLikeValues = [
    endpoint.IN_TIPO_CODIGO, endpoint.NO_TIPO_CODIGO,
    endpoint.DS_TIPO_CODIGO, endpoint.TX_TIPO_CODIGO, endpoint.ID_TIPO_CODIGO,
  ];
  for (const value of pythonLikeValues) {
    if (value === null || value === undefined) { continue; }
    const normalized = String(value).toLowerCase();
    if (normalized.includes('python') || normalized.includes('jython')) { return 'py'; }
  }

  const code = String(endpoint.TX_CODIGO ?? '').trim().toLowerCase();
  if (code.startsWith('#!') || code.startsWith('import ') || code.startsWith('from ') || code.startsWith('def ') || code.startsWith('class ')) {
    return 'py';
  }
  return 'sql';
}
