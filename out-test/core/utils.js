"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asRecord = asRecord;
exports.asArray = asArray;
exports.toNumber = toNumber;
exports.toStringSafe = toStringSafe;
exports.toErrorMessage = toErrorMessage;
exports.normalizeTextForLookup = normalizeTextForLookup;
exports.parseListTokens = parseListTokens;
exports.extractKeywordTokens = extractKeywordTokens;
exports.decodeJwtClaims = decodeJwtClaims;
exports.summarizeForLog = summarizeForLog;
exports.normalizeEndpointPath = normalizeEndpointPath;
exports.normalizeEndpointFieldKey = normalizeEndpointFieldKey;
exports.buildMetadataKey = buildMetadataKey;
function asRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function asArray(value) {
    return Array.isArray(value) ? value : undefined;
}
function toNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
}
function toStringSafe(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function normalizeTextForLookup(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}
function parseListTokens(value) {
    return value
        .split(/[\n,;]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}
function extractKeywordTokens(text) {
    const normalized = text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase();
    const stopwords = new Set(['API', 'ENDPOINT', 'PROJETO', 'DADOS', 'BASE', 'SISTEMA', 'SERVICO']);
    const tokens = normalized
        .split(/[^A-Z0-9]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 4 && !stopwords.has(item));
    return Array.from(new Set(tokens));
}
function decodeJwtClaims(token) {
    const parts = token.split('.');
    if (parts.length < 2) {
        return undefined;
    }
    try {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const decoded = Buffer.from(padded, 'base64').toString('utf8');
        return JSON.parse(decoded);
    }
    catch {
        return undefined;
    }
}
function summarizeForLog(value, maxDepth = 2, maxArrayItems = 5, maxStringLength = 240) {
    const seen = new WeakSet();
    const walk = (input, depth) => {
        if (input === null || input === undefined) {
            return input;
        }
        if (typeof input === 'string') {
            return input.length > maxStringLength
                ? `${input.slice(0, maxStringLength)}…<${input.length - maxStringLength} chars omitted>`
                : input;
        }
        if (typeof input === 'number' || typeof input === 'boolean') {
            return input;
        }
        if (typeof input === 'bigint') {
            return input.toString();
        }
        if (typeof input === 'function') {
            return '[Function]';
        }
        if (Array.isArray(input)) {
            if (depth >= maxDepth) {
                return `[Array(${input.length})]`;
            }
            return input.slice(0, maxArrayItems).map((item) => walk(item, depth + 1));
        }
        if (typeof input === 'object') {
            if (depth >= maxDepth) {
                return '[Object]';
            }
            if (seen.has(input)) {
                return '[Circular]';
            }
            seen.add(input);
            const record = input;
            const keys = Object.keys(record);
            const result = {};
            for (const key of keys.slice(0, maxArrayItems)) {
                result[key] = walk(record[key], depth + 1);
            }
            if (keys.length > maxArrayItems) {
                result.__moreKeys = keys.length - maxArrayItems;
            }
            return result;
        }
        try {
            return String(input);
        }
        catch {
            return '[Unserializable]';
        }
    };
    try {
        return JSON.stringify(walk(value, 0), null, 2);
    }
    catch {
        return toStringSafe(value);
    }
}
function normalizeEndpointPath(value) {
    return toStringSafe(value).trim().replace(/^\/+/, '');
}
function normalizeEndpointFieldKey(itemName) {
    return itemName.replace(/^P\d+_/, '').trim().toUpperCase();
}
function buildMetadataKey(idBancoExterno, idBancoEsquema) {
    return (idBancoEsquema && idBancoEsquema > 0)
        ? `${idBancoExterno}:${idBancoEsquema}`
        : `${idBancoExterno}:sem-esquema`;
}
