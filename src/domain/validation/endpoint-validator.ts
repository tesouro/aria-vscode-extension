import type { EndpointValidationItem } from '../../core/types';
import { toNumber, toStringSafe, normalizeEndpointFieldKey } from '../../core/utils';

export function validateEndpointPayload(
  payload: Record<string, unknown>,
  validations?: EndpointValidationItem[]
): string[] {
  if (!validations?.length) { return []; }

  const sorted = validations.slice().sort((a, b) => {
    const regionDiff = a.REGION_SEQUENCE - b.REGION_SEQUENCE;
    return regionDiff !== 0 ? regionDiff : a.VALIDATION_SEQUENCE - b.VALIDATION_SEQUENCE;
  });

  const errors: string[] = [];
  for (const validation of sorted) {
    if (!shouldApplyValidationCondition(validation, payload)) { continue; }
    const type = (validation.VALIDATION_TYPE || '').toLowerCase();
    const failMessage = validation.VALIDATION_FAILURE_TEXT?.trim() || `${validation.VALIDATION_NAME} invalida.`;

    if (type.includes('item\\column specified is not null')) {
      const field = normalizeEndpointFieldKey(validation.VALIDATION_EXPRESSION1 || '');
      if (field && isMissingRequiredField(field, payload[field])) { errors.push(failMessage); }
      continue;
    }

    if (type.includes('pl/sql expression')) {
      const expression = validation.VALIDATION_EXPRESSION1 || '';
      const valid = evaluateSimplePlsqlExpression(expression, payload);
      if (valid === false) { errors.push(failMessage); }
      continue;
    }

    if (type.includes('function returning error text')) {
      const expression = (validation.VALIDATION_EXPRESSION1 || '').toLowerCase();
      if (expression.includes('import\\s+os')) {
        const code = toStringSafe(payload.TX_CODIGO).toLowerCase();
        if (/\bimport\s+os\b/.test(code)) {
          errors.push(validation.VALIDATION_FAILURE_TEXT?.trim() || 'Nao e permitido importar o modulo os.');
        }
      }
    }
  }
  return errors;
}

export function isMissingRequiredField(fieldName: string, value: unknown): boolean {
  if (value === null || value === undefined) { return true; }
  if (typeof value === 'string') { return value.trim().length === 0; }
  if (fieldName.startsWith('ID_')) { return toNumber(value) <= 0; }
  return false;
}

export function buildRequiredEndpointFieldKeys(items?: { IS_REQUIRED: string; DISPLAY_AS: string; ITEM_SOURCE?: string; ITEM_SOURCE_TYPE?: string; ITEM_NAME: string }[]): string[] {
  if (!items?.length) { return []; }
  const required = items
    .filter((item) => String(item.IS_REQUIRED || '').trim().toLowerCase() === 'yes')
    .filter((item) => {
      const displayAs = String(item.DISPLAY_AS || '').trim().toLowerCase();
      return displayAs !== 'hidden' && displayAs !== 'display only';
    })
    .map((item) => {
      const sourceType = String(item.ITEM_SOURCE_TYPE || '').trim().toLowerCase();
      const itemSource = typeof item.ITEM_SOURCE === 'string' ? item.ITEM_SOURCE.trim() : '';
      if (itemSource && sourceType.includes('database column')) {
        return normalizeEndpointFieldKey(itemSource);
      }
      return normalizeEndpointFieldKey(item.ITEM_NAME);
    });
  return Array.from(new Set(required)).filter(Boolean);
}

function shouldApplyValidationCondition(validation: EndpointValidationItem, payload: Record<string, unknown>): boolean {
  const conditionType = (validation.CONDITION_TYPE || '').trim().toLowerCase();
  if (!conditionType) { return true; }
  if (conditionType === 'never') { return false; }
  if (conditionType.includes('value of item in expression 1 = expression 2')) {
    const leftKey = normalizeEndpointFieldKey(validation.CONDITION_EXPRESSION1 || '');
    const rightRaw = toStringSafe(validation.CONDITION_EXPRESSION2 || '').trim();
    if (!leftKey) { return true; }
    return toStringSafe(payload[leftKey]).trim() === rightRaw;
  }
  return true;
}

// ─── Simple PL/SQL expression evaluator ──────────────────────────────────────

type SimpleToken =
  | { type: 'item'; value: string }
  | { type: 'word'; value: string }
  | { type: 'number'; value: string }
  | { type: 'string'; value: string }
  | { type: 'symbol'; value: '(' | ')' | '=' };

function tokenizeSimplePlsqlExpression(input: string): SimpleToken[] | undefined {
  const tokens: SimpleToken[] = [];
  let index = 0;
  while (index < input.length) {
    const current = input[index];
    if (/\s/.test(current)) { index++; continue; }
    if (current === '(' || current === ')' || current === '=') {
      tokens.push({ type: 'symbol', value: current as '(' | ')' | '=' });
      index++; continue;
    }
    if (current === ':') {
      let end = index + 1;
      while (end < input.length && /[A-Za-z0-9_]/.test(input[end])) { end++; }
      tokens.push({ type: 'item', value: normalizeEndpointFieldKey(input.slice(index + 1, end)) });
      index = end; continue;
    }
    if (current === '\'') {
      let end = index + 1;
      while (end < input.length && input[end] !== '\'') { end++; }
      if (end >= input.length) { return undefined; }
      tokens.push({ type: 'string', value: input.slice(index + 1, end) });
      index = end + 1; continue;
    }
    if (/[0-9]/.test(current)) {
      let end = index + 1;
      while (end < input.length && /[0-9]/.test(input[end])) { end++; }
      tokens.push({ type: 'number', value: input.slice(index, end) });
      index = end; continue;
    }
    if (/[A-Za-z_]/.test(current)) {
      let end = index + 1;
      while (end < input.length && /[A-Za-z_]/.test(input[end])) { end++; }
      tokens.push({ type: 'word', value: input.slice(index, end).toLowerCase() });
      index = end; continue;
    }
    return undefined;
  }
  return tokens;
}

export function evaluateSimplePlsqlExpression(expression: string, payload: Record<string, unknown>): boolean | undefined {
  const trimmed = expression.trim();
  if (!trimmed) { return undefined; }
  const tokens = tokenizeSimplePlsqlExpression(trimmed);
  if (!tokens) { return undefined; }

  let idx = 0;

  const parseValue = (): unknown => {
    const token = tokens[idx];
    if (!token) { return undefined; }
    if (token.type === 'item') { idx++; return payload[token.value]; }
    if (token.type === 'number') { idx++; return Number(token.value); }
    if (token.type === 'string') { idx++; return token.value; }
    return undefined;
  };

  const parseComparison = (): boolean | undefined => {
    const leftToken = tokens[idx];
    if (!leftToken || leftToken.type !== 'item') { return undefined; }
    const leftKey = leftToken.value;
    idx++;
    const next = tokens[idx];
    if (!next) { return undefined; }
    if (next.type === 'word' && next.value === 'is') {
      idx++;
      let isNot = false;
      if (tokens[idx]?.type === 'word' && tokens[idx]?.value === 'not') { isNot = true; idx++; }
      if (!tokens[idx] || tokens[idx].type !== 'word' || tokens[idx].value !== 'null') { return undefined; }
      idx++;
      const value = payload[leftKey];
      const isNull = value === null || value === undefined || String(value).trim() === '';
      return isNot ? !isNull : isNull;
    }
    if (next.type === 'symbol' && next.value === '=') {
      idx++;
      const rightValue = parseValue();
      const leftValue = payload[leftKey];
      if (typeof rightValue === 'number') { return toNumber(leftValue) === rightValue; }
      return toStringSafe(leftValue).trim() === toStringSafe(rightValue).trim();
    }
    return undefined;
  };

  const parsePrimary = (): boolean | undefined => {
    const token = tokens[idx];
    if (!token) { return undefined; }
    if (token.type === 'symbol' && token.value === '(') {
      idx++;
      const inner = parseOr();
      if (tokens[idx]?.type === 'symbol' && tokens[idx]?.value === ')') { idx++; }
      return inner;
    }
    return parseComparison();
  };

  const parseAnd = (): boolean | undefined => {
    let result = parsePrimary();
    while (tokens[idx]?.type === 'word' && tokens[idx]?.value === 'and') {
      idx++;
      const right = parsePrimary();
      if (result === undefined || right === undefined) { return undefined; }
      result = result && right;
    }
    return result;
  };

  const parseOr = (): boolean | undefined => {
    let result = parseAnd();
    while (tokens[idx]?.type === 'word' && tokens[idx]?.value === 'or') {
      idx++;
      const right = parseAnd();
      if (result === undefined || right === undefined) { return undefined; }
      result = result || right;
    }
    return result;
  };

  const parsed = parseOr();
  if (idx < tokens.length) { return undefined; }
  return parsed;
}
