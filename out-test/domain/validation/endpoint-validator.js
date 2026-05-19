"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateEndpointPayload = validateEndpointPayload;
exports.isMissingRequiredField = isMissingRequiredField;
exports.buildRequiredEndpointFieldKeys = buildRequiredEndpointFieldKeys;
exports.evaluateSimplePlsqlExpression = evaluateSimplePlsqlExpression;
const utils_1 = require("../../core/utils");
function validateEndpointPayload(payload, validations, endpointItems) {
    if (!validations?.length) {
        return [];
    }
    const resolveFieldKey = buildEndpointFieldKeyResolver(endpointItems);
    const sorted = validations.slice().sort((a, b) => {
        const regionDiff = a.REGION_SEQUENCE - b.REGION_SEQUENCE;
        return regionDiff !== 0 ? regionDiff : a.VALIDATION_SEQUENCE - b.VALIDATION_SEQUENCE;
    });
    const errors = [];
    for (const validation of sorted) {
        if (!shouldApplyValidationCondition(validation, payload, resolveFieldKey)) {
            continue;
        }
        const type = (validation.VALIDATION_TYPE || '').toLowerCase();
        const failMessage = validation.VALIDATION_FAILURE_TEXT?.trim() || `${validation.VALIDATION_NAME} invalida.`;
        if (type.includes('item\\column specified is not null')) {
            const field = resolveFieldKey(validation.VALIDATION_EXPRESSION1 || '');
            if (field && isMissingRequiredField(field, payload[field])) {
                errors.push(failMessage);
            }
            continue;
        }
        if (type.includes('pl/sql expression')) {
            const expression = validation.VALIDATION_EXPRESSION1 || '';
            const valid = evaluateSimplePlsqlExpression(expression, payload, resolveFieldKey);
            if (valid === false) {
                errors.push(failMessage);
            }
            continue;
        }
        if (type.includes('function returning error text')) {
            const expression = (validation.VALIDATION_EXPRESSION1 || '').toLowerCase();
            if (expression.includes('import\\s+os')) {
                const code = (0, utils_1.toStringSafe)(payload.TX_CODIGO).toLowerCase();
                if (/\bimport\s+os\b/.test(code)) {
                    errors.push(validation.VALIDATION_FAILURE_TEXT?.trim() || 'Nao e permitido importar o modulo os.');
                }
            }
        }
    }
    return errors;
}
function buildEndpointFieldKeyResolver(endpointItems) {
    if (!endpointItems?.length) {
        return (rawField) => (0, utils_1.normalizeEndpointFieldKey)(rawField || '');
    }
    const itemByName = new Map();
    for (const item of endpointItems) {
        const key = (0, utils_1.normalizeEndpointFieldKey)(item.ITEM_NAME || '');
        if (key && !itemByName.has(key)) {
            itemByName.set(key, item);
        }
    }
    return (rawField) => {
        const normalizedRaw = (0, utils_1.normalizeEndpointFieldKey)(rawField || '');
        if (!normalizedRaw) {
            return '';
        }
        const item = itemByName.get(normalizedRaw);
        if (!item) {
            return normalizedRaw;
        }
        const sourceType = (0, utils_1.toStringSafe)(item.ITEM_SOURCE_TYPE).trim().toLowerCase();
        const itemSource = (0, utils_1.toStringSafe)(item.ITEM_SOURCE).trim();
        if (itemSource && sourceType.includes('database column')) {
            return (0, utils_1.normalizeEndpointFieldKey)(itemSource);
        }
        return (0, utils_1.normalizeEndpointFieldKey)(item.ITEM_NAME);
    };
}
function isMissingRequiredField(fieldName, value) {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === 'string') {
        return value.trim().length === 0;
    }
    if (fieldName.startsWith('ID_')) {
        return (0, utils_1.toNumber)(value) <= 0;
    }
    return false;
}
function buildRequiredEndpointFieldKeys(items) {
    if (!items?.length) {
        return [];
    }
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
            return (0, utils_1.normalizeEndpointFieldKey)(itemSource);
        }
        return (0, utils_1.normalizeEndpointFieldKey)(item.ITEM_NAME);
    });
    return Array.from(new Set(required)).filter(Boolean);
}
function shouldApplyValidationCondition(validation, payload, resolveFieldKey) {
    const conditionType = (validation.CONDITION_TYPE || '').trim().toLowerCase();
    if (!conditionType) {
        return true;
    }
    if (conditionType === 'never') {
        return false;
    }
    if (conditionType.includes('value of item in expression 1 = expression 2')) {
        const leftKey = resolveFieldKey(validation.CONDITION_EXPRESSION1 || '');
        const rightRaw = (0, utils_1.toStringSafe)(validation.CONDITION_EXPRESSION2 || '').trim();
        if (!leftKey) {
            return true;
        }
        return (0, utils_1.toStringSafe)(payload[leftKey]).trim() === rightRaw;
    }
    return true;
}
function tokenizeSimplePlsqlExpression(input, resolveFieldKey) {
    const tokens = [];
    let index = 0;
    while (index < input.length) {
        const current = input[index];
        if (/\s/.test(current)) {
            index++;
            continue;
        }
        if (current === '(' || current === ')' || current === '=') {
            tokens.push({ type: 'symbol', value: current });
            index++;
            continue;
        }
        if (current === ':') {
            let end = index + 1;
            while (end < input.length && /[A-Za-z0-9_]/.test(input[end])) {
                end++;
            }
            tokens.push({ type: 'item', value: resolveFieldKey(input.slice(index + 1, end)) });
            index = end;
            continue;
        }
        if (current === '\'') {
            let end = index + 1;
            while (end < input.length && input[end] !== '\'') {
                end++;
            }
            if (end >= input.length) {
                return undefined;
            }
            tokens.push({ type: 'string', value: input.slice(index + 1, end) });
            index = end + 1;
            continue;
        }
        if (/[0-9]/.test(current)) {
            let end = index + 1;
            while (end < input.length && /[0-9]/.test(input[end])) {
                end++;
            }
            tokens.push({ type: 'number', value: input.slice(index, end) });
            index = end;
            continue;
        }
        if (/[A-Za-z_]/.test(current)) {
            let end = index + 1;
            while (end < input.length && /[A-Za-z_]/.test(input[end])) {
                end++;
            }
            tokens.push({ type: 'word', value: input.slice(index, end).toLowerCase() });
            index = end;
            continue;
        }
        return undefined;
    }
    return tokens;
}
function evaluateSimplePlsqlExpression(expression, payload, resolveFieldKey) {
    const resolver = resolveFieldKey ?? utils_1.normalizeEndpointFieldKey;
    const trimmed = expression.trim();
    if (!trimmed) {
        return undefined;
    }
    const tokens = tokenizeSimplePlsqlExpression(trimmed, resolver);
    if (!tokens) {
        return undefined;
    }
    let idx = 0;
    const parseValue = () => {
        const token = tokens[idx];
        if (!token) {
            return undefined;
        }
        if (token.type === 'item') {
            idx++;
            return payload[token.value];
        }
        if (token.type === 'number') {
            idx++;
            return Number(token.value);
        }
        if (token.type === 'string') {
            idx++;
            return token.value;
        }
        return undefined;
    };
    const parseComparison = () => {
        const leftToken = tokens[idx];
        if (!leftToken || leftToken.type !== 'item') {
            return undefined;
        }
        const leftKey = leftToken.value;
        idx++;
        const next = tokens[idx];
        if (!next) {
            return undefined;
        }
        if (next.type === 'word' && next.value === 'is') {
            idx++;
            let isNot = false;
            if (tokens[idx]?.type === 'word' && tokens[idx]?.value === 'not') {
                isNot = true;
                idx++;
            }
            if (!tokens[idx] || tokens[idx].type !== 'word' || tokens[idx].value !== 'null') {
                return undefined;
            }
            idx++;
            const value = payload[leftKey];
            const isNull = value === null || value === undefined || String(value).trim() === '';
            return isNot ? !isNull : isNull;
        }
        if (next.type === 'symbol' && next.value === '=') {
            idx++;
            const rightValue = parseValue();
            const leftValue = payload[leftKey];
            if (typeof rightValue === 'number') {
                return (0, utils_1.toNumber)(leftValue) === rightValue;
            }
            return (0, utils_1.toStringSafe)(leftValue).trim() === (0, utils_1.toStringSafe)(rightValue).trim();
        }
        return undefined;
    };
    const parsePrimary = () => {
        const token = tokens[idx];
        if (!token) {
            return undefined;
        }
        if (token.type === 'symbol' && token.value === '(') {
            idx++;
            const inner = parseOr();
            if (tokens[idx]?.type === 'symbol' && tokens[idx]?.value === ')') {
                idx++;
            }
            return inner;
        }
        return parseComparison();
    };
    const parseAnd = () => {
        let result = parsePrimary();
        while (tokens[idx]?.type === 'word' && tokens[idx]?.value === 'and') {
            idx++;
            const right = parsePrimary();
            if (result === undefined || right === undefined) {
                return undefined;
            }
            result = result && right;
        }
        return result;
    };
    const parseOr = () => {
        let result = parseAnd();
        while (tokens[idx]?.type === 'word' && tokens[idx]?.value === 'or') {
            idx++;
            const right = parseAnd();
            if (result === undefined || right === undefined) {
                return undefined;
            }
            result = result || right;
        }
        return result;
    };
    const parsed = parseOr();
    if (idx < tokens.length) {
        return undefined;
    }
    return parsed;
}
