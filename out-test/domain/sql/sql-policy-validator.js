"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasSelectStar = hasSelectStar;
exports.extractSqlReferencedTables = extractSqlReferencedTables;
exports.normalizeTableRef = normalizeTableRef;
exports.tableRefNameOnly = tableRefNameOnly;
exports.splitSelectColumns = splitSelectColumns;
exports.extractAliasName = extractAliasName;
exports.analyzeSqlAliasIssues = analyzeSqlAliasIssues;
exports.hasQuotedIdentifiersOutsideAliases = hasQuotedIdentifiersOutsideAliases;
exports.hasSelectStarInText = hasSelectStarInText;
const utils_1 = require("../../core/utils");
function hasSelectStar(sqlCode) {
    if (!sqlCode.trim()) {
        return false;
    }
    return /\bselect\s+(?:distinct\s+)?(?:\*|[a-zA-Z_][\w$]*\s*\.\s*\*)\b/i.test(sqlCode);
}
function extractSqlReferencedTables(sqlCode) {
    const tables = new Set();
    const regex = /\b(?:from|join)\s+([^\s,;]+)/gi;
    let match;
    while ((match = regex.exec(sqlCode)) !== null) {
        let token = (0, utils_1.toStringSafe)(match[1]).trim();
        token = token.replace(/[),;]+$/g, '').replace(/^\(+/g, '');
        if (!token || /^select$/i.test(token)) {
            continue;
        }
        token = token.replace(/@.+$/, '').replace(/"/g, '');
        if (!token || token.toUpperCase() === 'DUAL') {
            continue;
        }
        tables.add(token.toUpperCase());
    }
    return Array.from(tables);
}
function normalizeTableRef(tableRef) {
    return (0, utils_1.toStringSafe)(tableRef).trim().replace(/^"|"$/g, '').replace(/^\[|\]$/g, '').toUpperCase();
}
function tableRefNameOnly(tableRef) {
    const normalized = normalizeTableRef(tableRef);
    if (!normalized) {
        return '';
    }
    const parts = normalized.split('.').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : normalized;
}
function splitSelectColumns(selectClause) {
    const cols = [];
    let current = '';
    let depth = 0;
    for (let i = 0; i < selectClause.length; i++) {
        const ch = selectClause[i];
        if (ch === '(') {
            depth++;
            current += ch;
            continue;
        }
        if (ch === ')') {
            depth = Math.max(0, depth - 1);
            current += ch;
            continue;
        }
        if (ch === ',' && depth === 0) {
            if (current.trim()) {
                cols.push(current.trim());
            }
            current = '';
            continue;
        }
        current += ch;
    }
    if (current.trim()) {
        cols.push(current.trim());
    }
    return cols;
}
function extractAliasName(token) {
    const t = token.trim();
    if (!t) {
        return undefined;
    }
    const asQuoted = t.match(/\bas\s+"([^"]+)"\s*$/i) || t.match(/\bas\s+'([^']+)'\s*$/i);
    if (asQuoted?.[1]) {
        return asQuoted[1].trim();
    }
    const asPlain = t.match(/\bas\s+([A-Za-z_][\w$]*)\s*$/i);
    if (asPlain?.[1]) {
        return asPlain[1].trim();
    }
    const trailingQuoted = t.match(/\s+"([^"]+)"\s*$/) || t.match(/\s+'([^']+)'\s*$/);
    if (trailingQuoted?.[1]) {
        return trailingQuoted[1].trim();
    }
    const trailingPlain = t.match(/\s+([A-Za-z_][\w$]*)\s*$/);
    if (trailingPlain?.[1]) {
        const maybeKeyword = trailingPlain[1].toLowerCase();
        if (maybeKeyword !== 'from' && maybeKeyword !== 'where' && maybeKeyword !== 'join') {
            return trailingPlain[1].trim();
        }
    }
    return undefined;
}
function normalizeAliasToken(value) {
    return (0, utils_1.toStringSafe)(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '').toLowerCase();
}
function isCamelCaseAlias(value) {
    return /^[a-z][A-Za-z0-9]*$/.test((0, utils_1.toStringSafe)(value).trim());
}
function extractSourceColumnName(token) {
    const t = token.trim();
    if (!t) {
        return '';
    }
    let expr = t;
    expr = expr.replace(/\bas\s+(?:"[^"]+"|'[^']+'|[A-Za-z_][\w$]*)\s*$/i, '').trim();
    expr = expr.replace(/\s+(?:"[^"]+"|'[^']+'|[A-Za-z_][\w$]*)\s*$/, '').trim();
    const parts = expr.split('.').map((p) => p.trim()).filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : expr;
    return last.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim();
}
function analyzeSqlAliasIssues(sql) {
    const selectMatch = sql.match(/\bselect\b([\s\S]*?)\bfrom\b/i);
    if (!selectMatch) {
        return { missingAlias: [], nonMnemonicAlias: [] };
    }
    const selectClause = selectMatch[1];
    const cols = splitSelectColumns(selectClause);
    const missingAlias = [];
    const nonMnemonicAlias = [];
    for (const token of cols) {
        if (!/[A-Za-z_][\w$]*(?:\s*\.\s*[A-Za-z_][\w$]*)?|\(/.test(token)) {
            continue;
        }
        const alias = extractAliasName(token);
        if (!alias) {
            missingAlias.push(token);
            continue;
        }
        const sourceColumn = extractSourceColumnName(token);
        const aliasNorm = normalizeAliasToken(alias);
        const sourceNorm = normalizeAliasToken(sourceColumn);
        if (!isCamelCaseAlias(alias) || !aliasNorm || (sourceNorm && aliasNorm === sourceNorm)) {
            nonMnemonicAlias.push(token);
        }
    }
    return { missingAlias, nonMnemonicAlias };
}
function hasQuotedIdentifiersOutsideAliases(sql) {
    const source = (0, utils_1.toStringSafe)(sql);
    if (!source.trim()) {
        return false;
    }
    const strippedAllowedAliases = source.replace(/\bAS\s+"[^"]+"/gi, 'AS __ALIAS__');
    return strippedAllowedAliases.includes('"');
}
function hasSelectStarInText(text) {
    return /\bselect\s+(?:distinct\s+)?(?:\*|[a-zA-Z_][\w$]*\s*\.\s*\*)\b/i.test(text);
}
