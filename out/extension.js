"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
// Remove REST_CUSTOM_JSON_SCHEMA de cada endpoint
function compactEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== 'object')
        return endpoint;
    const { REST_CUSTOM_JSON_SCHEMA, ...rest } = endpoint;
    return rest;
}
// Remove REST_CUSTOM_JSON_SCHEMA de todos os endpoints do projeto
function compactProject(project) {
    if (!project || typeof project !== 'object')
        return project;
    const restCustom = Array.isArray(project.REST_CUSTOM)
        ? project.REST_CUSTOM.map(compactEndpoint)
        : [];
    return { ...project, REST_CUSTOM: restCustom };
}
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const REQUIRED_ENTRA_TENANT_ID = 'b5661350-c2e4-43dc-bce8-f003ddf8a3c4';
const ARIA_EDIT_SCHEME = 'aria-edit';
class InMemoryEditFileSystemProvider {
    constructor() {
        this.documents = new Map();
        this.changeEmitter = new vscode.EventEmitter();
        this.onDidChangeFile = this.changeEmitter.event;
    }
    stat(uri) {
        if (this.isRoot(uri)) {
            const now = Date.now();
            return { type: vscode.FileType.Directory, ctime: now, mtime: now, size: 0 };
        }
        const entry = this.getEntry(uri);
        return {
            type: vscode.FileType.File,
            ctime: entry.ctime,
            mtime: entry.mtime,
            size: entry.content.byteLength
        };
    }
    readDirectory(uri) {
        if (!this.isRoot(uri)) {
            return [];
        }
        return Array.from(this.documents.keys())
            .filter((item) => item.startsWith('/') && !item.slice(1).includes('/'))
            .map((item) => [item.slice(1), vscode.FileType.File]);
    }
    readFile(uri) {
        if (this.isRoot(uri)) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }
        return this.getEntry(uri).content;
    }
    writeFile(uri, content, options) {
        if (this.isRoot(uri)) {
            throw vscode.FileSystemError.FileIsADirectory(uri);
        }
        const key = this.key(uri);
        const exists = this.documents.has(key);
        if (!options.create && !exists) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        if (!options.overwrite && exists) {
            throw vscode.FileSystemError.FileExists(uri);
        }
        const previous = this.documents.get(key);
        const now = Date.now();
        this.documents.set(key, {
            content: new Uint8Array(content),
            ctime: previous?.ctime ?? now,
            mtime: now
        });
        this.changeEmitter.fire([{ type: exists ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
    }
    createDirectory(uri) {
        if (this.isRoot(uri)) {
            return;
        }
        throw vscode.FileSystemError.NoPermissions('Directories are not supported in the ARIA edit workspace.');
    }
    delete(uri) {
        if (this.isRoot(uri)) {
            throw vscode.FileSystemError.NoPermissions('Cannot delete the ARIA edit root.');
        }
        const key = this.key(uri);
        if (this.documents.delete(key)) {
            this.changeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
        }
    }
    rename(oldUri, newUri) {
        if (this.isRoot(oldUri) || this.isRoot(newUri)) {
            throw vscode.FileSystemError.NoPermissions('Cannot rename the ARIA edit root.');
        }
        const entry = this.getEntry(oldUri);
        const oldKey = this.key(oldUri);
        const newKey = this.key(newUri);
        this.documents.set(newKey, { ...entry, mtime: Date.now() });
        this.documents.delete(oldKey);
        this.changeEmitter.fire([
            { type: vscode.FileChangeType.Deleted, uri: oldUri },
            { type: vscode.FileChangeType.Created, uri: newUri }
        ]);
    }
    watch() {
        return new vscode.Disposable(() => undefined);
    }
    setContent(uri, text) {
        const key = this.key(uri);
        const previous = this.documents.get(key);
        const now = Date.now();
        this.documents.set(key, {
            content: Buffer.from(text, 'utf8'),
            ctime: previous?.ctime ?? now,
            mtime: now
        });
        this.changeEmitter.fire([{ type: previous ? vscode.FileChangeType.Changed : vscode.FileChangeType.Created, uri }]);
    }
    isRoot(uri) {
        return uri.path === '/' || uri.path === '';
    }
    key(uri) {
        return uri.path;
    }
    getEntry(uri) {
        const entry = this.documents.get(this.key(uri));
        if (!entry) {
            throw vscode.FileSystemError.FileNotFound(uri);
        }
        return entry;
    }
}
class AriaApiClient {
    constructor(settings, accessTokenProvider, logger) {
        this.settings = settings;
        this.accessTokenProvider = accessTokenProvider;
        this.logger = logger;
    }
    async connect() {
        await this.getProjectEndpointTree();
    }
    async close() {
        // sem estado de conexao persistente para API HTTP
    }
    async getDataset(fetchProjectPath = this.settings.fetchProjectPath) {
        const dataset = await this.requestDataset();
        const filter = fetchProjectPath.trim().toLowerCase();
        if (!filter) {
            return dataset;
        }
        return {
            ...dataset,
            registros: dataset.registros.filter((project) => String(project.TX_PATH || '').toLowerCase().includes(filter))
        };
    }
    async getDatasetByProjectId(projectId) {
        const dataset = await this.requestDataset(projectId);
        return {
            ...dataset,
            registros: dataset.registros.filter((project) => project.ID_PROJETO === projectId)
        };
    }
    async getProjectEndpointTree() {
        const response = await this.request('GET', '/v1/aria-vscode/custom/projetos-endpoints');
        const root = asRecord(response);
        if (Array.isArray(root?.projetos)) {
            return {
                registros: root.projetos.map((item) => this.mapProject(item))
            };
        }
        return this.normalizeDataset(response);
    }
    async saveDataset(dataset) {
        await this.request('POST', '/v1/aria-vscode/custom/importar-json', undefined, dataset);
    }
    async getEndpointMetadata(endpoint) {
        const query = buildMetadataQuery(endpoint);
        const response = await this.request('GET', '/v1/aria-vscode/custom/obtem-metadados', query);
        return formatMetadataForEditor(response);
    }
    async getEndpointFormItems() {
        const response = await this.request('GET', '/v1/aria-vscode/custom/items-apex-endpoint');
        const root = asRecord(response);
        const rows = asArray(root?.registros) || [];
        return rows.map((item) => this.mapEndpointFormItem(item)).filter(item => item.ITEM_NAME !== '');
    }
    async getEndpointValidations() {
        const validations = [];
        let endpointPath = '/v1/aria-vscode/custom/validacoes-apex';
        const visited = new Set();
        while (endpointPath && !visited.has(endpointPath)) {
            visited.add(endpointPath);
            const response = await this.request('GET', endpointPath);
            const root = asRecord(response);
            const rows = asArray(root?.registros) || [];
            validations.push(...rows.map((item) => this.mapEndpointValidation(item)));
            const next = typeof root?.next === 'string' ? root.next.trim() : '';
            endpointPath = next || '';
        }
        return validations;
    }
    async getLovs(projectId) {
        const response = await this.request('GET', '/v1/aria-vscode/custom/lovs', { id_projeto: String(projectId) });
        return normalizeLovsResponse(response);
    }
    async validateCode(payload) {
        const response = await this.request('POST', '/v1/aria-vscode/custom/valida-codigo', undefined, {
            p_id_tipo_codigo: payload.idTipoCodigo,
            p_id_banco_externo: payload.idBancoExterno,
            p_sn_modo_compatibilidade: payload.snModoCompatibilidade,
            p_id_banco_esquema: payload.idBancoEsquema,
            p_tx_codigo: payload.txCodigo
        });
        return asRecord(response) ?? {};
    }
    async requestDataset(projectId) {
        const query = projectId ? { id_projeto: String(projectId) } : undefined;
        const response = await this.request('GET', '/v1/aria-vscode/custom/gerar-json', query);
        return this.normalizeDataset(response);
    }
    normalizeDataset(payload) {
        const root = asRecord(payload);
        if (Array.isArray(root?.registros)) {
            return {
                ...root,
                registros: root.registros.map((item) => this.mapProject(item))
            };
        }
        if (Array.isArray(root?.projetos)) {
            return {
                registros: root.projetos.map((item) => this.mapProject(item))
            };
        }
        if (Array.isArray(payload)) {
            return {
                registros: payload.map((item) => this.mapProject(item))
            };
        }
        throw new Error('Resposta da API nao possui projetos no formato esperado.');
    }
    mapProject(raw) {
        const source = asRecord(raw) || {};
        const endpoints = asArray(source.REST_CUSTOM) || asArray(source.endpoints) || [];
        return {
            ...source,
            ID_PROJETO: toNumber(source.ID_PROJETO ?? source.id_projeto),
            NO_PROJETO: toStringSafe(source.NO_PROJETO ?? source.nome_projeto),
            TX_PATH: toStringSafe(source.TX_PATH ?? source.path_projeto),
            REST_CUSTOM: endpoints.map((endpoint) => this.mapEndpoint(endpoint))
        };
    }
    mapEndpoint(raw) {
        const source = asRecord(raw) || {};
        const mapped = {
            ...source,
            ID_REST_CUSTOM: toNumber(source.ID_REST_CUSTOM ?? source.id_endpoint),
            NO_REST_CUSTOM: toStringSafe(source.NO_REST_CUSTOM ?? source.nome_endpoint),
            TX_PATH: toStringSafe(source.TX_PATH ?? source.path_endpoint),
            TX_CODIGO: typeof source.TX_CODIGO === 'string' ? source.TX_CODIGO : undefined
        };
        if (mapped.ID_REST_CUSTOM <= 0) {
            throw new Error('Endpoint retornado pela API sem ID valido.');
        }
        return mapped;
    }
    mapEndpointFormItem(raw) {
        const source = asRecord(raw) || {};
        return {
            ITEM_SEQUENCE: toNumber(source.ITEM_SEQUENCE),
            REGION_SEQUENCE: toNumber(source.REGION_SEQUENCE),
            IS_REQUIRED: toStringSafe(source.IS_REQUIRED),
            DISPLAY_AS: toStringSafe(source.DISPLAY_AS),
            ITEM_SOURCE: typeof source.ITEM_SOURCE === 'string' ? source.ITEM_SOURCE : undefined,
            LABEL: typeof source.LABEL === 'string' ? source.LABEL : undefined,
            ITEM_SOURCE_TYPE: typeof source.ITEM_SOURCE_TYPE === 'string' ? source.ITEM_SOURCE_TYPE : undefined,
            ITEM_NAME: toStringSafe(source.ITEM_NAME),
            REGION: typeof source.REGION === 'string' ? source.REGION : undefined
        };
    }
    mapEndpointValidation(raw) {
        const source = asRecord(raw) || {};
        return {
            REGION_SEQUENCE: toNumber(source.REGION_SEQUENCE),
            REGION_NAME: typeof source.REGION_NAME === 'string' ? source.REGION_NAME : undefined,
            VALIDATION_SEQUENCE: toNumber(source.VALIDATION_SEQUENCE),
            VALIDATION_NAME: toStringSafe(source.VALIDATION_NAME),
            VALIDATION_TYPE: toStringSafe(source.VALIDATION_TYPE),
            VALIDATION_FAILURE_TEXT: typeof source.VALIDATION_FAILURE_TEXT === 'string' ? source.VALIDATION_FAILURE_TEXT : undefined,
            VALIDATION_EXPRESSION1: typeof source.VALIDATION_EXPRESSION1 === 'string' ? source.VALIDATION_EXPRESSION1 : undefined,
            CONDITION_TYPE: typeof source.CONDITION_TYPE === 'string' ? source.CONDITION_TYPE : undefined,
            CONDITION_EXPRESSION1: typeof source.CONDITION_EXPRESSION1 === 'string' ? source.CONDITION_EXPRESSION1 : undefined,
            CONDITION_EXPRESSION2: typeof source.CONDITION_EXPRESSION2 === 'string' ? source.CONDITION_EXPRESSION2 : undefined,
            ASSOCIATED_ITEM: typeof source.ASSOCIATED_ITEM === 'string' ? source.ASSOCIATED_ITEM : undefined
        };
    }
    async request(method, endpointPath, query, body) {
        const url = new URL(endpointPath.replace(/^\//, ''), this.withTrailingSlash(this.settings.baseUrl));
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                url.searchParams.set(key, value);
            }
        }
        const payload = body === undefined ? undefined : JSON.stringify(body);
        this.logger?.(`[${new Date().toISOString()}] ms-aria request => ${method} ${url.pathname}${url.search}\n` +
            `  query: ${summarizeForLog(query)}\n` +
            `  body: ${summarizeForLog(buildRequestBodyForLog(endpointPath, body))}`);
        const headers = {
            Accept: 'application/json'
        };
        if (payload !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload, 'utf8').toString();
        }
        const isHttps = url.protocol === 'https:';
        const requestOptions = {
            method,
            headers
        };
        if (isHttps) {
            requestOptions.rejectUnauthorized = !this.settings.ignoreSslErrors;
        }
        const requestOnce = async (token) => {
            const mergedHeaders = { ...headers };
            if (token && token.trim()) {
                mergedHeaders.Authorization = `Bearer ${token}`;
            }
            const localOptions = {
                ...requestOptions,
                headers: mergedHeaders
            };
            const client = isHttps ? https : http;
            return await new Promise((resolve, reject) => {
                const req = client.request(url, localOptions, (res) => {
                    const chunks = [];
                    res.on('data', (chunk) => {
                        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                    });
                    res.on('end', () => {
                        const responseBody = Buffer.concat(chunks).toString('utf8');
                        resolve({ statusCode: res.statusCode ?? 0, responseBody });
                    });
                    res.on('error', reject);
                });
                req.setTimeout(45000, () => {
                    req.destroy(new Error(`Timeout de 45s na chamada para ${endpointPath}. O servidor demorou demais para responder.`));
                });
                req.on('error', reject);
                if (payload !== undefined) {
                    req.write(payload);
                }
                req.end();
            });
        };
        const wait = async (delayMs) => {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        };
        let currentToken = await this.accessTokenProvider?.(false);
        const executeAttempt = async () => {
            let result = await requestOnce(currentToken);
            if (result.statusCode === 401 && this.accessTokenProvider) {
                const refreshedToken = await this.accessTokenProvider(true);
                if (refreshedToken && refreshedToken !== currentToken) {
                    currentToken = refreshedToken;
                    result = await requestOnce(currentToken);
                }
            }
            return result;
        };
        let { statusCode, responseBody } = await executeAttempt();
        // Para erros 500 em GET, faz tentativas adicionais com pequeno backoff.
        if (method === 'GET' && statusCode === 500) {
            const retryDelaysMs = [1200, 2500];
            for (let retryIndex = 0; retryIndex < retryDelaysMs.length && statusCode === 500; retryIndex++) {
                const delayMs = retryDelaysMs[retryIndex];
                this.logger?.(`[${new Date().toISOString()}] ms-aria retry => ${method} ${url.pathname}${url.search} ` +
                    `status=500 attempt=${retryIndex + 2} waitMs=${delayMs}`);
                await wait(delayMs);
                const retryResult = await executeAttempt();
                statusCode = retryResult.statusCode;
                responseBody = retryResult.responseBody;
            }
        }
        this.logger?.(`[${new Date().toISOString()}] ms-aria response <= ${method} ${url.pathname}${url.search} status=${statusCode} bytes=${responseBody.length}`);
        if (statusCode < 200 || statusCode >= 300) {
            const isHtml = responseBody.trimStart().startsWith('<');
            const bodySnippet = isHtml ? `resposta HTML (status ${statusCode}, provavelmente gateway/proxy)` : (responseBody || 'sem corpo de resposta');
            throw new Error(`API retornou ${statusCode}: ${bodySnippet}`);
        }
        if (!responseBody.trim()) {
            return undefined;
        }
        // Detecta resposta HTML inesperada em 2xx (ex: página de erro de proxy)
        if (responseBody.trimStart().startsWith('<')) {
            throw new Error(`API retornou resposta HTML inesperada (esperava JSON). Verifique se o servidor está acessível.`);
        }
        try {
            return JSON.parse(responseBody);
        }
        catch {
            return responseBody;
        }
    }
    withTrailingSlash(value) {
        const trimmed = value.trim();
        if (!trimmed) {
            throw new Error('URL base da API nao informada. Configure ariaApi.baseUrl.');
        }
        return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    }
}
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
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return numeric;
}
function toStringSafe(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
}
function normalizeCodeTypeToken(value) {
    return toStringSafe(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}
function normalizeCodeTypeLabel(value) {
    const token = normalizeCodeTypeToken(value);
    if (!token) {
        return undefined;
    }
    if (token.includes('python') || token.includes('jython') || token === 'py') {
        return 'PYTHON';
    }
    if (token.includes('plsql') || token.includes('proceduralsql')) {
        return 'PLSQL';
    }
    if (token.includes('sql')) {
        return 'SQL';
    }
    return undefined;
}
function inferCodeTypeLabelFromCode(code) {
    const normalized = code.trim().toLowerCase();
    if (!normalized) {
        return 'SQL';
    }
    if ((normalized.startsWith('#!') && normalized.includes('python')) ||
        /\b(import|from|def|class|lambda|self)\b/.test(normalized)) {
        return 'PYTHON';
    }
    if (/\b(declare|begin|exception|procedure|function|package|cursor|loop|elsif|pragma)\b/.test(normalized) ||
        /:=/.test(normalized) ||
        /\bend;\s*$/.test(normalized)) {
        return 'PLSQL';
    }
    return 'SQL';
}
function formatCodeTypeLabel(label) {
    if (label === 'PYTHON') {
        return 'Python';
    }
    if (label === 'PLSQL') {
        return 'PL/SQL';
    }
    return 'SQL';
}
function isSqlEndpointCodeType(endpoint) {
    const tipoCodigoId = toNumber(endpoint.ID_TIPO_CODIGO);
    if (tipoCodigoId === 1) {
        return true;
    }
    const tipoCodigoNome = normalizeCodeTypeLabel(endpoint.NO_TIPO_CODIGO);
    return tipoCodigoNome === 'SQL';
}
function hasSelectStar(sqlCode) {
    if (!sqlCode.trim()) {
        return false;
    }
    // Block patterns like: select * from ..., select t.* from ..., select distinct * ...
    return /\bselect\s+(?:distinct\s+)?(?:\*|[a-zA-Z_][\w$]*\s*\.\s*\*)\b/i.test(sqlCode);
}
function buildMetadataKey(idBancoExterno, idBancoEsquema) {
    return (idBancoEsquema && idBancoEsquema > 0)
        ? `${idBancoExterno}:${idBancoEsquema}`
        : `${idBancoExterno}:sem-esquema`;
}
function extractSqlReferencedTables(sqlCode) {
    const tables = new Set();
    const regex = /\b(?:from|join)\s+([^\s,;]+)/gi;
    let match;
    while ((match = regex.exec(sqlCode)) !== null) {
        let token = toStringSafe(match[1]).trim();
        token = token.replace(/[),;]+$/g, '').replace(/^\(+/g, '');
        if (!token) {
            continue;
        }
        if (/^select$/i.test(token)) {
            continue;
        }
        // Ignore links/suffixes and normalize quoted identifiers.
        token = token.replace(/@.+$/, '');
        token = token.replace(/"/g, '');
        if (!token || token.toUpperCase() === 'DUAL') {
            continue;
        }
        tables.add(token.toUpperCase());
    }
    return Array.from(tables);
}
function normalizeTableRef(tableRef) {
    return toStringSafe(tableRef)
        .trim()
        .replace(/^"|"$/g, '')
        .replace(/^\[|\]$/g, '')
        .toUpperCase();
}
function tableRefNameOnly(tableRef) {
    const normalized = normalizeTableRef(tableRef);
    if (!normalized) {
        return '';
    }
    const parts = normalized.split('.').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : normalized;
}
function hasSelectStarInText(text) {
    return /\bselect\s+(?:distinct\s+)?(?:\*|[a-zA-Z_][\w$]*\s*\.\s*\*)\b/i.test(text);
}
function extractSqlCandidateFromText(text) {
    const source = toStringSafe(text);
    if (!source.trim()) {
        return undefined;
    }
    const fencedSqlMatch = source.match(/```sql\s*([\s\S]*?)```/i);
    if (fencedSqlMatch?.[1] && /\bselect\b[\s\S]*\bfrom\b/i.test(fencedSqlMatch[1])) {
        return fencedSqlMatch[1].trim();
    }
    const genericFenceMatches = source.match(/```([\s\S]*?)```/g) ?? [];
    for (const block of genericFenceMatches) {
        const body = block.replace(/^```[a-zA-Z0-9_-]*\s*/i, '').replace(/```$/i, '').trim();
        if (/\bselect\b[\s\S]*\bfrom\b/i.test(body)) {
            return body;
        }
    }
    const selectIndex = source.search(/\bselect\b/i);
    if (selectIndex === -1) {
        return undefined;
    }
    const tail = source.slice(selectIndex);
    const stopPatterns = [
        /\n\s*(?:nome do endpoint|caminho|tx_path|metodo|metodo http|tipo de codigo|linguagem|banco externo|esquema|descricao curta|ds_rest_custom_curta|tx_comentarios|comentarios|confirma|deseja prosseguir|posso prosseguir)\b/i,
        /```/
    ];
    let endIndex = tail.length;
    for (const pattern of stopPatterns) {
        const match = tail.match(pattern);
        if (match?.index !== undefined && match.index >= 0) {
            endIndex = Math.min(endIndex, match.index);
        }
    }
    return tail.slice(0, endIndex).trim() || undefined;
}
function hasQuotedIdentifiersOutsideAliases(sql) {
    const source = toStringSafe(sql);
    if (!source.trim()) {
        return false;
    }
    const strippedAllowedAliases = source.replace(/\bAS\s+"[^"]+"/gi, 'AS __ALIAS__');
    return strippedAllowedAliases.includes('"');
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
    return toStringSafe(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '')
        .toLowerCase();
}
function isCamelCaseAlias(value) {
    const alias = toStringSafe(value).trim();
    return /^[a-z][A-Za-z0-9]*$/.test(alias);
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
        // Alias must be camelCase and meaningful for JSON mapping: not empty and not the same raw column name.
        if (!isCamelCaseAlias(alias) || !aliasNorm || (sourceNorm && aliasNorm === sourceNorm)) {
            nonMnemonicAlias.push(token);
        }
    }
    return { missingAlias, nonMnemonicAlias };
}
function hasColumnAlias(token) {
    if (!token || !token.trim())
        return false;
    const t = token.trim();
    // Accept patterns like: COL as "alias", COL as alias, COL "alias", or COL alias
    // Also accept when AS is present anywhere (case-insensitive).
    if (/\bas\b/i.test(t))
        return true;
    // Match trailing quoted alias: "alias" or 'alias'
    if (/["']\s*[^"']+\s*["']\s*$/.test(t))
        return true;
    // Match unquoted trailing alias (single identifier) after whitespace
    if (/\s+[A-Za-z_][\w]*\s*$/.test(t)) {
        // ensure token is not just a bare column (no whitespace) - here whitespace exists so last word is likely alias
        return true;
    }
    return false;
}
function isAffirmativeConfirmationPrompt(prompt) {
    const normalized = toStringSafe(prompt)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
    if (!normalized) {
        return false;
    }
    return /^(sim|s|ok|pode|pode sim|confirmo|confirmado|prosseguir|continue|segue|yes)\b/.test(normalized);
}
function isEndpointProposalCompleteForConfirmation(text) {
    const normalized = toStringSafe(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (!normalized.trim()) {
        return false;
    }
    const hasName = /(nome do endpoint|no_rest_custom|nome:)/.test(normalized);
    const hasPath = /(caminho|tx_path|path:)/.test(normalized);
    const hasMethod = /(metodo|id_metodo|http)/.test(normalized);
    const hasCodeType = /(tipo de codigo|id_tipo_codigo|linguagem|sql|plsql|python)/.test(normalized);
    const hasBank = /(banco externo|id_banco_externo|banco:)/.test(normalized);
    const hasSchema = /(esquema|id_banco_esquema|schema)/.test(normalized);
    const hasDescription = /(ds_rest_custom_curta|descricao curta|tx_comentarios|comentarios)/.test(normalized);
    const hasConfirmationAsk = /(confirma|confirmacao|deseja prosseguir|posso prosseguir|pode criar|pode prosseguir)/.test(normalized);
    const hasSql = /\bselect\b[\s\S]+\bfrom\b/.test(normalized);
    return hasName && hasPath && hasMethod && hasCodeType && hasBank && hasSchema && hasDescription && hasConfirmationAsk && hasSql;
}
function looksLikeEndpointProposalWithoutSql(text) {
    const normalized = toStringSafe(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (!normalized.trim()) {
        return false;
    }
    const proposalSignals = [
        /proposta do endpoint/i,
        /tabela base/i,
        /joins?/i,
        /campos selecionados/i,
        /método http|metodo http/i,
        /banco e esquema/i,
        /próximos passos|proximos passos/i,
        /confirme se deseja prosseguir/i
    ];
    return proposalSignals.some((pattern) => pattern.test(normalized)) && !/\bselect\b[\s\S]*\bfrom\b/i.test(normalized);
}
function isEndpointProposalReadyForImport(text) {
    if (!isEndpointProposalCompleteForConfirmation(text)) {
        return false;
    }
    const sql = extractSqlCandidateFromText(text);
    if (!sql) {
        return false;
    }
    if (hasSelectStar(sql)) {
        return false;
    }
    const aliasIssues = analyzeSqlAliasIssues(sql);
    return aliasIssues.missingAlias.length === 0 && aliasIssues.nonMnemonicAlias.length === 0;
}
function extractToolResultText(content) {
    const chunks = [];
    for (const part of content) {
        if (part instanceof vscode.LanguageModelTextPart) {
            chunks.push(part.value);
        }
    }
    return chunks.join('\n').trim();
}
function inferBestProjectForContext(projects, text) {
    if (!projects.length) {
        return undefined;
    }
    const normalizedText = toStringSafe(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    const tokens = extractKeywordTokens(text).map((item) => item.toLowerCase());
    let bestProject;
    let bestScore = -1;
    for (const project of projects) {
        const projectName = toStringSafe(project.NO_PROJETO).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const projectPath = toStringSafe(project.TX_PATH).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        let score = 0;
        if (projectName && normalizedText.includes(projectName)) {
            score += 100;
        }
        if (projectPath && normalizedText.includes(projectPath)) {
            score += 60;
        }
        const nameTokens = extractKeywordTokens(project.NO_PROJETO).map((item) => item.toLowerCase());
        for (const token of tokens) {
            if (nameTokens.includes(token)) {
                score += 15;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestProject = project;
        }
    }
    return bestProject ?? projects[0];
}
function buildImportDatasetFromProposal(proposal, baseProject, contextText) {
    const root = asRecord(proposal);
    if (!root) {
        return undefined;
    }
    if (Array.isArray(root.registros) && root.registros.length > 0) {
        return proposal;
    }
    const endpointTemplate = { ...root };
    const endpoint = buildEndpointFromExampleStructure(baseProject, endpointTemplate, undefined, { ignoreExplicitBankFields: false });
    const updatedProject = {
        ...baseProject,
        REST_CUSTOM: [...baseProject.REST_CUSTOM, endpoint]
    };
    return {
        registros: [updatedProject]
    };
}
function resolveCodeTypeSelection(lovs, input) {
    const explicitLabel = normalizeCodeTypeLabel(input.codeType);
    const inferredLabel = explicitLabel ?? inferCodeTypeLabelFromCode(input.code || '');
    const fallbackIds = {
        SQL: 1,
        PLSQL: 2,
        PYTHON: 3
    };
    const typeRows = lovs?.TIPO_CODIGO ?? [];
    for (const row of typeRows) {
        const rowLabel = normalizeCodeTypeLabel(row.NO_TIPO_CODIGO);
        if (rowLabel === inferredLabel) {
            return {
                id: row.ID_TIPO_CODIGO,
                label: inferredLabel,
                displayName: row.NO_TIPO_CODIGO
            };
        }
    }
    const fallbackRow = typeRows.find((row) => {
        const rowToken = normalizeCodeTypeToken(row.NO_TIPO_CODIGO);
        if (inferredLabel === 'PYTHON') {
            return rowToken.includes('python') || rowToken.includes('jython') || rowToken === 'py';
        }
        if (inferredLabel === 'PLSQL') {
            return rowToken.includes('plsql') || rowToken.includes('proceduralsql') || rowToken === 'plsql';
        }
        return rowToken === 'sql';
    }) || typeRows[0];
    return {
        id: fallbackRow?.ID_TIPO_CODIGO ?? fallbackIds[inferredLabel],
        label: inferredLabel,
        displayName: fallbackRow?.NO_TIPO_CODIGO ?? formatCodeTypeLabel(inferredLabel)
    };
}
class ProjectNode extends vscode.TreeItem {
    constructor(project) {
        super(`${project.NO_PROJETO} (${project.TX_PATH})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.project = project;
        this.description = `ID ${project.ID_PROJETO}`;
        this.contextValue = 'ariaProject';
        // Sem comando de clique: expande/recolhe apenas
    }
}
class EndpointNode extends vscode.TreeItem {
    constructor(project, endpoint) {
        super(`${endpoint.NO_REST_CUSTOM} (${endpoint.TX_PATH})`, vscode.TreeItemCollapsibleState.None);
        this.project = project;
        this.endpoint = endpoint;
        this.description = `ID ${endpoint.ID_REST_CUSTOM}`;
        this.contextValue = 'ariaEndpoint';
        this.command = {
            command: 'aria.editEndpointCode',
            title: 'Editar CÃ³digo',
            arguments: [this]
        };
    }
}
class AriaTreeProvider {
    constructor(datasetProvider) {
        this.datasetProvider = datasetProvider;
        this.onDidChangeTreeDataEmitter = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    }
    refresh() {
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        const dataset = this.datasetProvider();
        if (!dataset) {
            return Promise.resolve([]);
        }
        if (!element) {
            return Promise.resolve(dataset.registros
                .slice()
                .sort((a, b) => a.NO_PROJETO.localeCompare(b.NO_PROJETO))
                .map((project) => new ProjectNode(project)));
        }
        if (element instanceof ProjectNode) {
            return Promise.resolve((element.project.REST_CUSTOM || [])
                .slice()
                .sort((a, b) => a.NO_REST_CUSTOM.localeCompare(b.NO_REST_CUSTOM))
                .map((endpoint) => new EndpointNode(element.project, endpoint)));
        }
        return Promise.resolve([]);
    }
}
function activate(context) {
    let client;
    let dataset;
    let endpointFormItemsCache;
    let endpointValidationsCache;
    const lovsCache = new Map();
    let lastPayloadPath;
    let entraSession;
    let requireEntraLogin = getEntraSettings().requireLogin;
    let isLoggedIn = false;
    const editMap = new Map();
    const metadataUriByEndpoint = new Map();
    const metadataCatalogByEndpoint = new Map();
    const virtualEditProvider = new InMemoryEditFileSystemProvider();
    const output = vscode.window.createOutputChannel('ARIA API Editor');
    const tree = new AriaTreeProvider(() => dataset);
    vscode.window.registerTreeDataProvider('ariaProjectsView', tree);
    context.subscriptions.push(vscode.workspace.registerFileSystemProvider(ARIA_EDIT_SCHEME, virtualEditProvider, {
        isCaseSensitive: true,
        isReadonly: false
    }));
    const updateLoginState = async (loggedIn) => {
        isLoggedIn = loggedIn;
        await vscode.commands.executeCommand('setContext', 'aria.isLoggedIn', loggedIn);
        tree.refresh();
    };
    const getAriaClient = () => {
        if (!client) {
            throw new Error('Sem conexao ativa com a API.');
        }
        return client;
    };
    const getMetadataCatalog = async (idBancoExterno, idBancoEsquema) => {
        const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
        const cached = metadataCatalogByEndpoint.get(metadataKey);
        if (cached) {
            return cached;
        }
        const uri = metadataUriByEndpoint.get(metadataKey);
        if (!uri) {
            return undefined;
        }
        try {
            const markdown = await fs.promises.readFile(uri.fsPath, 'utf8');
            const catalog = parseMetadataMarkdown(markdown, uri.fsPath, metadataKey);
            metadataCatalogByEndpoint.set(metadataKey, catalog);
            return catalog;
        }
        catch {
            return undefined;
        }
    };
    const isValidateCodeSuccess = (status) => {
        const normalized = toStringSafe(status).trim().toLowerCase();
        return !normalized || normalized === 'sucesso' || normalized === 'success' || normalized === 'ok';
    };
    const validateEndpointCodeBeforeSave = async (endpoint) => {
        const validations = await getEndpointValidations();
        const validationErrors = validateEndpointPayload(endpoint, validations);
        if (validationErrors.length) {
            throw new Error(validationErrors.join(' | '));
        }
        const result = await getAriaClient().validateCode({
            idTipoCodigo: endpoint.ID_TIPO_CODIGO,
            idBancoExterno: endpoint.ID_BANCO_EXTERNO,
            snModoCompatibilidade: endpoint.SN_MODO_COMPATIBILIDADE,
            idBancoEsquema: endpoint.ID_BANCO_ESQUEMA,
            txCodigo: toStringSafe(endpoint.TX_CODIGO)
        });
        if (!isValidateCodeSuccess(result.status)) {
            throw new Error(toStringSafe(result.mensagem) || 'A validacao remota do codigo falhou.');
        }
    };
    const resolveEndpointsToValidate = (source, project, previousEndpointIds) => {
        if (source.startsWith('endpointCode:') || source.startsWith('endpointJson:') || source.startsWith('endpointForm:')) {
            const endpointId = Number(source.split(':')[1]);
            return project.REST_CUSTOM.filter((endpoint) => endpoint.ID_REST_CUSTOM === endpointId);
        }
        if (source.startsWith('createEndpoint:agent:') || source.startsWith('createEndpoint:')) {
            return project.REST_CUSTOM.filter((endpoint) => !previousEndpointIds.has(endpoint.ID_REST_CUSTOM));
        }
        if (source.startsWith('projectJson:')) {
            return project.REST_CUSTOM;
        }
        return [];
    };
    const validateEndpointsBeforeSave = async (source, project, previousEndpointIds) => {
        const endpoints = resolveEndpointsToValidate(source, project, previousEndpointIds);
        for (const endpoint of endpoints) {
            await validateEndpointCodeBeforeSave(endpoint);
        }
    };
    const validateSession = (session, entraSettings) => {
        const accountLabel = session.account.label || '';
        const tokenClaims = decodeJwtClaims(session.accessToken);
        const tokenTenant = typeof tokenClaims?.tid === 'string' ? tokenClaims.tid : '';
        if (!tokenTenant || tokenTenant.toLowerCase() !== REQUIRED_ENTRA_TENANT_ID.toLowerCase()) {
            return `Conta Microsoft nao autorizada para este tenant. Tenant esperado: ${REQUIRED_ENTRA_TENANT_ID}.`;
        }
        if (entraSettings.allowedEmailDomains.length > 0) {
            const email = (typeof tokenClaims?.preferred_username === 'string' && tokenClaims.preferred_username) ||
                (typeof tokenClaims?.upn === 'string' && tokenClaims.upn) ||
                accountLabel;
            const domain = email.includes('@') ? email.split('@').pop()?.toLowerCase() ?? '' : '';
            const allowed = entraSettings.allowedEmailDomains.map((item) => item.toLowerCase());
            if (!domain || !allowed.includes(domain)) {
                return `Conta Microsoft nao autorizada. Dominios permitidos: ${entraSettings.allowedEmailDomains.join(', ')}.`;
            }
        }
        return undefined;
    };
    const acquireAccessToken = async (forceRefresh = false) => {
        const entraSettings = getEntraSettings();
        requireEntraLogin = entraSettings.requireLogin;
        if (!entraSettings.requireLogin) {
            await updateLoginState(true);
            return undefined;
        }
        try {
            const session = await vscode.authentication.getSession('microsoft', ['User.Read'], {
                createIfNone: forceRefresh,
                forceNewSession: forceRefresh
            });
            if (!session) {
                await updateLoginState(false);
                return undefined;
            }
            const validationError = validateSession(session, entraSettings);
            if (validationError) {
                await updateLoginState(false);
                throw new Error(validationError);
            }
            entraSession = session;
            await updateLoginState(true);
            return session.accessToken;
        }
        catch {
            await updateLoginState(false);
            return undefined;
        }
    };
    const persistDebugPayload = async (payload, source) => {
        const filePath = await ensureEditFilePath('last-importa-json.aria.payload.json');
        await fs.promises.writeFile(filePath, payload, 'utf8');
        lastPayloadPath = filePath;
        output.appendLine(`[${new Date().toISOString()}] Payload preparado para importa_json.`);
        output.appendLine(`Origem: ${source}`);
        output.appendLine(`Arquivo: ${filePath}`);
        output.appendLine(`Bytes: ${Buffer.byteLength(payload, 'utf8')}`);
        output.appendLine('');
    };
    const saveWithFreshDataset = async (source, projectId, mutate) => {
        const ariaClient = getAriaClient();
        const freshDataset = await ariaClient.getDatasetByProjectId(projectId);
        if (freshDataset.registros.length !== 1) {
            throw new Error(`Esperado 1 projeto para salvar, mas gerar-json retornou ${freshDataset.registros.length}.`);
        }
        const draftProject = freshDataset.registros[0];
        for (const endpoint of draftProject.REST_CUSTOM ?? []) {
            endpoint.SN_MODO_COMPATIBILIDADE = 'N';
            if (endpoint.IN_TIPO_TRANSFORMACAO === '') {
                endpoint.IN_TIPO_TRANSFORMACAO = null;
            }
        }
        const previousEndpointIds = new Set(draftProject.REST_CUSTOM.map((endpoint) => endpoint.ID_REST_CUSTOM));
        await mutate(freshDataset);
        await validateEndpointsBeforeSave(source, draftProject, previousEndpointIds);
        await persistDebugPayload(JSON.stringify(freshDataset, null, 2), source);
        await ariaClient.saveDataset(freshDataset);
        dataset = await ariaClient.getProjectEndpointTree();
        tree.refresh();
    };
    const getProjectDetails = async (projectId) => {
        if (!client) {
            throw new Error('Sem conexao ativa com a API.');
        }
        const details = await client.getDatasetByProjectId(projectId);
        const project = details.registros.find((item) => item.ID_PROJETO === projectId);
        if (!project) {
            throw new Error(`Projeto ${projectId} nao encontrado no retorno de gerar-json.`);
        }
        return project;
    };
    const getEndpointFormItems = async () => {
        if (!client) {
            return undefined;
        }
        if (endpointFormItemsCache) {
            return endpointFormItemsCache;
        }
        try {
            endpointFormItemsCache = await client.getEndpointFormItems();
            return endpointFormItemsCache;
        }
        catch (error) {
            vscode.window.showWarningMessage(`Nao foi possivel carregar metadados do formulario de endpoint. Usando fallback local. Motivo: ${toErrorMessage(error)}`);
            return undefined;
        }
    };
    const getProjectLovs = async (projectId) => {
        if (!client) {
            return undefined;
        }
        if (lovsCache.has(projectId)) {
            return lovsCache.get(projectId);
        }
        try {
            const lovs = await client.getLovs(projectId);
            lovsCache.set(projectId, lovs);
            return lovs;
        }
        catch (error) {
            vscode.window.showWarningMessage(`Nao foi possivel carregar LOVs do projeto ${projectId}. Motivo: ${toErrorMessage(error)}`);
            return undefined;
        }
    };
    const getEndpointValidations = async () => {
        if (!client) {
            return undefined;
        }
        if (endpointValidationsCache) {
            return endpointValidationsCache;
        }
        try {
            endpointValidationsCache = await client.getEndpointValidations();
            return endpointValidationsCache;
        }
        catch (error) {
            vscode.window.showWarningMessage(`Nao foi possivel carregar validacoes do formulario de endpoint. Motivo: ${toErrorMessage(error)}`);
            return undefined;
        }
    };
    const createVirtualEditUri = (fileName) => vscode.Uri.from({ scheme: ARIA_EDIT_SCHEME, path: `/${fileName}` });
    const openVirtualEditDocument = async (fileName, content, language) => {
        const uri = createVirtualEditUri(fileName);
        virtualEditProvider.setContent(uri, content);
        const doc = await vscode.workspace.openTextDocument(uri);
        if (language && doc.languageId !== language) {
            await vscode.languages.setTextDocumentLanguage(doc, language);
        }
        await vscode.window.showTextDocument(doc, { preview: false });
        return doc;
    };
    const saveEditedDocument = async (document) => {
        const marker = editMap.get(document.uri.toString());
        if (!marker) {
            return;
        }
        const text = document.getText();
        const savingIndicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: salvando via API...');
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'ARIA: Salvando alteracoes via API...'
            }, async () => {
                await saveWithFreshDataset(`${marker.type}:${marker.id}`, marker.projectId, async (draft) => {
                    if (marker.type === 'endpointCode') {
                        let found = false;
                        for (const project of draft.registros) {
                            const eIdx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                            if (eIdx >= 0) {
                                project.REST_CUSTOM[eIdx] = { ...project.REST_CUSTOM[eIdx], TX_CODIGO: text };
                                found = true;
                                break;
                            }
                        }
                        if (!found) {
                            throw new Error('Endpoint nao encontrado no cache.');
                        }
                        return;
                    }
                    if (marker.type === 'projectJson') {
                        const parsed = JSON.parse(text);
                        const idx = draft.registros.findIndex((p) => p.ID_PROJETO === marker.id);
                        if (idx < 0) {
                            throw new Error('Projeto nao encontrado no cache.');
                        }
                        draft.registros[idx] = {
                            ...draft.registros[idx],
                            ...parsed,
                            ID_PROJETO: marker.id,
                            REST_CUSTOM: parsed.REST_CUSTOM || draft.registros[idx].REST_CUSTOM
                        };
                        return;
                    }
                    const parsed = JSON.parse(text);
                    let found = false;
                    for (const project of draft.registros) {
                        const eIdx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                        if (eIdx >= 0) {
                            project.REST_CUSTOM[eIdx] = { ...project.REST_CUSTOM[eIdx], ...parsed, ID_REST_CUSTOM: marker.id };
                            found = true;
                            break;
                        }
                    }
                    if (!found) {
                        throw new Error('Endpoint nao encontrado no cache.');
                    }
                });
            });
            vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
        }
        finally {
            savingIndicator.dispose();
        }
    };
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.uri.scheme !== ARIA_EDIT_SCHEME) {
            return;
        }
        if (!editMap.has(document.uri.toString())) {
            return;
        }
        try {
            await saveEditedDocument(document);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Falha ao salvar alteracoes: ${toErrorMessage(error)}`);
        }
    }));
    const ensureEntraLogin = async () => {
        const entraSettings = getEntraSettings();
        requireEntraLogin = entraSettings.requireLogin;
        if (!entraSettings.requireLogin) {
            await updateLoginState(true);
            return true;
        }
        try {
            entraSession = await vscode.authentication.getSession('microsoft', ['User.Read'], {
                createIfNone: true,
                forceNewSession: false
            });
        }
        catch (error) {
            await updateLoginState(false);
            vscode.window.showErrorMessage(`Falha ao autenticar com Microsoft Entra ID: ${toErrorMessage(error)}`);
            return false;
        }
        if (!entraSession) {
            await updateLoginState(false);
            vscode.window.showWarningMessage('Login Microsoft Entra ID e obrigatorio para usar a extensao.');
            return false;
        }
        const validationError = validateSession(entraSession, entraSettings);
        if (validationError) {
            await updateLoginState(false);
            vscode.window.showErrorMessage(validationError);
            return false;
        }
        await updateLoginState(true);
        return true;
    };
    void updateLoginState(!requireEntraLogin);
    context.subscriptions.push(output, vscode.commands.registerCommand('aria.connect', async () => {
        const authenticated = await ensureEntraLogin();
        if (!authenticated) {
            return;
        }
        const settings = getSettings();
        try {
            await client?.close();
            client = new AriaApiClient(settings, acquireAccessToken, (message) => output.appendLine(message));
            await client.connect();
            endpointFormItemsCache = undefined;
            endpointValidationsCache = undefined;
            lovsCache.clear();
            dataset = await client.getProjectEndpointTree();
            tree.refresh();
            vscode.window.showInformationMessage(`Conectado a API e carregados ${dataset.registros.length} projeto(s).`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Erro ao conectar/carregar dados da API ARIA: ${toErrorMessage(error)}`);
        }
    }), vscode.commands.registerCommand('aria.refreshTree', async () => {
        if (!client) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        try {
            dataset = await client.getProjectEndpointTree();
            tree.refresh();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Erro ao atualizar arvore: ${toErrorMessage(error)}`);
        }
    }), 
    // â”€â”€ Projeto: JSON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    vscode.commands.registerCommand('aria.editProjectJson', async (node) => {
        if (!dataset) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        if (!node) {
            return;
        }
        const project = await getProjectDetails(node.project.ID_PROJETO);
        const content = JSON.stringify(project, null, 2);
        const doc = await openVirtualEditDocument(`project-${node.project.ID_PROJETO}.aria.json`, content, 'json');
        editMap.set(doc.uri.toString(), { type: 'projectJson', id: node.project.ID_PROJETO, projectId: node.project.ID_PROJETO });
    }), 
    // â”€â”€ Projeto: FormulÃ¡rio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    vscode.commands.registerCommand('aria.editProjectForm', async (node) => {
        if (!dataset) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        if (!node) {
            return;
        }
        const project = await getProjectDetails(node.project.ID_PROJETO);
        const lovs = await getProjectLovs(node.project.ID_PROJETO);
        openFormWebview(context, `Projeto: ${project.NO_PROJETO}`, project, ['REST_CUSTOM'], { lovs }, async (updated) => {
            const normalizedUpdate = applyLovDisplayValues(updated, lovs);
            await saveWithFreshDataset(`projectForm:${node.project.ID_PROJETO}`, node.project.ID_PROJETO, async (draft) => {
                const idx = draft.registros.findIndex((p) => p.ID_PROJETO === node.project.ID_PROJETO);
                if (idx < 0) {
                    throw new Error('Projeto nao encontrado no cache.');
                }
                draft.registros[idx] = mergePreservingTypes(draft.registros[idx], normalizedUpdate);
            });
        });
    }), 
    // â”€â”€ Endpoint: TX_CODIGO (acao principal) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    vscode.commands.registerCommand('aria.editEndpointCode', async (node) => {
        if (!dataset) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        if (!node) {
            return;
        }
        const project = await getProjectDetails(node.project.ID_PROJETO);
        const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
        if (!endpoint) {
            throw new Error('Endpoint nao encontrado no retorno de gerar-json.');
        }
        const code = endpoint.TX_CODIGO ?? '';
        const codeExtension = resolveEndpointCodeExtension(endpoint);
        const language = codeExtension === 'py' ? 'python' : 'sql';
        const doc = await openVirtualEditDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.${codeExtension}`, code, language);
        editMap.set(doc.uri.toString(), { type: 'endpointCode', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }), 
    // â”€â”€ Endpoint: JSON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    vscode.commands.registerCommand('aria.editEndpointJson', async (node) => {
        if (!dataset) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        if (!node) {
            return;
        }
        const project = await getProjectDetails(node.project.ID_PROJETO);
        const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
        if (!endpoint) {
            throw new Error('Endpoint nao encontrado no retorno de gerar-json.');
        }
        const content = JSON.stringify(endpoint, null, 2);
        const doc = await openVirtualEditDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.json`, content, 'json');
        editMap.set(doc.uri.toString(), { type: 'endpointJson', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }), 
    // â”€â”€ Endpoint: FormulÃ¡rio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    vscode.commands.registerCommand('aria.editEndpointForm', async (node) => {
        if (!dataset) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        if (!node) {
            return;
        }
        const project = await getProjectDetails(node.project.ID_PROJETO);
        const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
        if (!endpoint) {
            throw new Error('Endpoint nao encontrado no retorno de gerar-json.');
        }
        const endpointFormItems = await getEndpointFormItems();
        const lovs = await getProjectLovs(node.project.ID_PROJETO);
        const endpointValidations = await getEndpointValidations();
        openFormWebview(context, `Endpoint: ${endpoint.NO_REST_CUSTOM}`, endpoint, [], { endpointItems: endpointFormItems, lovs }, async (updated) => {
            const normalizedUpdate = applyLovDisplayValues(updated, lovs);
            await saveWithFreshDataset(`endpointForm:${node.endpoint.ID_REST_CUSTOM}`, node.project.ID_PROJETO, async (draft) => {
                let found = false;
                for (const project of draft.registros) {
                    const eIdx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
                    if (eIdx >= 0) {
                        const merged = mergePreservingTypes(project.REST_CUSTOM[eIdx], normalizedUpdate);
                        const validationErrors = validateEndpointPayload(merged, endpointValidations);
                        if (validationErrors.length) {
                            throw new Error(validationErrors.join(' | '));
                        }
                        project.REST_CUSTOM[eIdx] = merged;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    throw new Error('Endpoint nao encontrado no cache.');
                }
            });
        });
    }), 
    // â”€â”€ Endpoint: Criar novo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    vscode.commands.registerCommand('aria.createEndpoint', async (node) => {
        if (!dataset) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        let targetProjectId;
        if (node) {
            targetProjectId = node.project.ID_PROJETO;
        }
        else {
            const items = dataset.registros.map((p) => ({
                label: p.NO_PROJETO,
                description: p.TX_PATH,
                detail: `ID ${p.ID_PROJETO} â€” ${p.REST_CUSTOM.length} endpoint(s)`,
                projectId: p.ID_PROJETO
            }));
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: 'Selecione o projeto onde o novo endpoint sera criado',
                matchOnDescription: true
            });
            if (!picked) {
                return;
            }
            targetProjectId = picked.projectId;
        }
        const project = dataset.registros.find((p) => p.ID_PROJETO === targetProjectId);
        if (!project) {
            return;
        }
        const endpointFormItems = await getEndpointFormItems();
        const lovs = await getProjectLovs(targetProjectId);
        const endpointValidations = await getEndpointValidations();
        const template = buildEndpointFromExampleStructure(project, {
            NO_REST_CUSTOM: '',
            TX_PATH: '',
            TX_CODIGO: '',
            DS_REST_CUSTOM_CURTA: ''
        }, lovs, { ignoreExplicitBankFields: true });
        openFormWebview(context, `Novo Endpoint â€” ${project.NO_PROJETO}`, template, ['ID_REST_CUSTOM'], { endpointItems: endpointFormItems, lovs }, async (updated) => {
            const normalizedUpdate = applyLovDisplayValues(updated, lovs);
            normalizedUpdate.TX_PATH = normalizeEndpointPath(normalizedUpdate.TX_PATH);
            const noName = !normalizedUpdate.NO_REST_CUSTOM || String(normalizedUpdate.NO_REST_CUSTOM).trim() === '';
            const noPath = !normalizedUpdate.TX_PATH || String(normalizedUpdate.TX_PATH).trim() === '';
            if (noName || noPath) {
                throw new Error('Nome (NO_REST_CUSTOM) e Caminho (TX_PATH) sao obrigatorios.');
            }
            if (project.REST_CUSTOM.some((e) => String(e.TX_PATH || '').toLowerCase() === String(normalizedUpdate.TX_PATH).trim().toLowerCase())) {
                throw new Error(`Ja existe endpoint com TX_PATH "${String(normalizedUpdate.TX_PATH).trim()}".`);
            }
            await saveWithFreshDataset(`createEndpoint:${targetProjectId}`, targetProjectId, async (draft) => {
                const proj = draft.registros.find((p) => p.ID_PROJETO === targetProjectId);
                if (!proj) {
                    throw new Error('Projeto nao encontrado.');
                }
                if (proj.REST_CUSTOM.some((e) => String(e.TX_PATH || '').toLowerCase() === String(normalizedUpdate.TX_PATH).trim().toLowerCase())) {
                    throw new Error(`Ja existe endpoint com TX_PATH "${String(normalizedUpdate.TX_PATH).trim()}".`);
                }
                const newEndpoint = buildEndpointFromExampleStructure(proj, normalizedUpdate, lovs);
                const validationErrors = validateEndpointPayload(newEndpoint, endpointValidations);
                if (validationErrors.length) {
                    throw new Error(validationErrors.join(' | '));
                }
                proj.REST_CUSTOM.push(newEndpoint);
            });
        });
    }), 
    // â”€â”€ Salvar editor ativo via API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    vscode.commands.registerCommand('aria.saveActiveEditor', async () => {
        if (!client || !dataset) {
            vscode.window.showWarningMessage('Conecte na API primeiro antes de salvar.');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Nenhum editor ativo para salvar na API.');
            return;
        }
        const docKey = editor.document.uri.toString();
        const marker = editMap.get(docKey);
        if (!marker) {
            vscode.window.showWarningMessage('Este arquivo nao foi aberto pelo ARIA Editor.');
            return;
        }
        await editor.document.save();
    }), vscode.commands.registerCommand('aria.validateActiveEditor', async () => {
        if (!client || !dataset) {
            vscode.window.showWarningMessage('Conecte na API primeiro antes de validar.');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Nenhum editor ativo para validar na API.');
            return;
        }
        const docKey = editor.document.uri.toString();
        const marker = editMap.get(docKey);
        if (!marker || marker.type !== 'endpointCode') {
            vscode.window.showWarningMessage('A validacao de codigo so esta disponivel para o editor de codigo do endpoint.');
            return;
        }
        try {
            const ariaClient = getAriaClient();
            const project = await getProjectDetails(marker.projectId);
            const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === marker.id);
            if (!endpoint) {
                throw new Error('Endpoint nao encontrado no retorno de gerar-json.');
            }
            const validatingIndicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: validando codigo via API...');
            try {
                const text = editor.document.getText();
                const result = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'ARIA: Validando codigo via API...'
                }, async () => {
                    return await ariaClient.validateCode({
                        idTipoCodigo: endpoint.ID_TIPO_CODIGO,
                        idBancoExterno: endpoint.ID_BANCO_EXTERNO,
                        snModoCompatibilidade: endpoint.SN_MODO_COMPATIBILIDADE,
                        idBancoEsquema: endpoint.ID_BANCO_ESQUEMA,
                        txCodigo: text
                    });
                });
                const message = toStringSafe(result.mensagem) || 'Validacao concluida.';
                if (!isValidateCodeSuccess(result.status)) {
                    vscode.window.showErrorMessage(`Validacao falhou: ${message}`);
                    return;
                }
                vscode.window.showInformationMessage(message);
            }
            finally {
                validatingIndicator.dispose();
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Falha ao validar codigo: ${toErrorMessage(error)}`);
        }
    }), vscode.commands.registerCommand('aria.openLastPayload', async () => {
        if (!lastPayloadPath) {
            vscode.window.showWarningMessage('Nenhum payload foi gerado ainda nesta sessao.');
            return;
        }
        const doc = await vscode.workspace.openTextDocument(lastPayloadPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        output.show(true);
    }));
    // â”€â”€ Language Model Tools (Copilot) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const notConnectedResult = () => new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart('ARIA: Nao conectado. PeÃ§a ao usuÃ¡rio para executar o comando "ARIA: Conectar na API" primeiro.')
    ]);
    context.subscriptions.push(
    // Tool: obter projetos e endpoints (de /projetos-endpoints)
    vscode.lm.registerTool('aria_obter_projetos', {
        async invoke(_options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            try {
                const projetosData = await client.getProjectEndpointTree();
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(projetosData.registros, null, 2))
                ]);
            }
            catch (error) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)
                ]);
            }
        }
    }), 
    // Tool: obter LOVs do projeto
    vscode.lm.registerTool('aria_obter_lovs', {
        async invoke(options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            const idProjeto = Number(options.input.id_projeto);
            try {
                const lovs = await client.getLovs(idProjeto);
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(lovs, null, 2))
                ]);
            }
            catch (error) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)
                ]);
            }
        }
    }), 
    // Tool: obter JSON completo do projeto (sem REST_CUSTOM_JSON_SCHEMA)
    vscode.lm.registerTool('aria_obter_json_projeto', {
        async invoke(options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            const idProjeto = Number(options.input.id_projeto);
            try {
                const ds = await client.getDatasetByProjectId(idProjeto);
                const stripped = ds.registros.map((proj) => ({
                    ...proj,
                    REST_CUSTOM: proj.REST_CUSTOM.map((ep) => {
                        const { REST_CUSTOM_JSON_SCHEMA: _ignored, ...rest } = ep;
                        return rest;
                    })
                }));
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(stripped, null, 2))
                ]);
            }
            catch (error) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)
                ]);
            }
        }
    }), 
    // Tool: obter itens apex (campos obrigatorios e metadados do formulario)
    vscode.lm.registerTool('aria_obter_itens_apex', {
        async invoke(_options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            try {
                const items = await client.getEndpointFormItems();
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(items, null, 2))
                ]);
            }
            catch (error) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)
                ]);
            }
        }
    }), 
    // Tool: obter metadados do banco (tabelas e colunas)
    vscode.lm.registerTool('aria_obter_metadados', {
        async invoke(options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            const idBancoExterno = Number(options.input.p_id_banco_externo);
            const idBancoEsquemaRaw = options.input.p_id_banco_esquema;
            const idBancoEsquema = Number(idBancoEsquemaRaw);
            const schemaPreferido = toStringSafe(options.input.schema_preferido).trim().toUpperCase();
            const termosBusca = Array.isArray(options.input.termos_busca)
                ? options.input.termos_busca.map((item) => toStringSafe(item)).filter((item) => item.trim().length > 0)
                : [];
            if (!(idBancoExterno > 0)) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Parametro invalido: p_id_banco_externo deve ser um numero maior que zero.')
                ]);
            }
            const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
            const pseudoEndpoint = {
                ID_REST_CUSTOM: 0,
                NO_REST_CUSTOM: '',
                TX_PATH: '',
                ID_BANCO_EXTERNO: idBancoExterno
            };
            if (idBancoEsquema > 0) {
                pseudoEndpoint.ID_BANCO_ESQUEMA = idBancoEsquema;
            }
            try {
                const metadata = await client.getEndpointMetadata(pseudoEndpoint);
                if (!metadata) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Nenhum metadado disponivel para os parametros informados.')
                    ]);
                }
                const metadataDir = path.join(__dirname, '..', 'resources');
                const fileName = idBancoEsquema > 0
                    ? `metadata-${idBancoExterno}-${idBancoEsquema}.aria.txt`
                    : `metadata-${idBancoExterno}.aria.txt`;
                const filePath = path.join(metadataDir, fileName);
                await fs.promises.mkdir(metadataDir, { recursive: true });
                await fs.promises.writeFile(filePath, metadata, 'utf8');
                metadataUriByEndpoint.set(metadataKey, vscode.Uri.file(filePath));
                metadataCatalogByEndpoint.set(metadataKey, parseMetadataMarkdown(metadata, filePath, metadataKey));
                const schemas = listMetadataSchemas(metadata);
                const schemaSummary = schemas.length > 0
                    ? schemas.map((schema) => `- ${schema}`).join('\n')
                    : '(nenhum schema detectado)';
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Metadados salvos em: ${filePath}\n\n` +
                        'Resumo (nivel 1 - schemas):\n' +
                        `${schemaSummary}\n\n` +
                        'Proximo passo obrigatorio (nivel 2): chame aria_obter_tabelas_metadados para o schema escolhido.\n' +
                        'Depois (nivel 3): chame aria_obter_colunas_metadados para cada tabela selecionada.\n' +
                        'Nao escreva SQL antes de concluir os niveis 2 e 3.')
                ]);
            }
            catch (error) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Erro ao obter metadados: ${toErrorMessage(error)}`)
                ]);
            }
        }
    }), 
    // Tool: listar esquemas do catalogo em memoria
    vscode.lm.registerTool('aria_obter_esquemas_metadados', {
        async invoke(options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            const idBancoExterno = Number(options.input.p_id_banco_externo);
            const idBancoEsquema = Number(options.input.p_id_banco_esquema);
            if (!(idBancoExterno > 0)) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Parametro invalido: p_id_banco_externo deve ser um numero maior que zero.')
                ]);
            }
            const catalog = await getMetadataCatalog(idBancoExterno, idBancoEsquema);
            if (!catalog) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Nenhum metadado em memoria para os parametros informados. Execute aria_obter_metadados primeiro.')
                ]);
            }
            const schemas = catalog.schemas.map((schema) => ({
                schema: schema.name,
                tableCount: schema.tables.length,
                tables: schema.tables.map((table) => table.fullName)
            }));
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    metadataKey: catalog.key,
                    schemas
                }, null, 2))
            ]);
        }
    }), 
    // Tool: listar tabelas de um schema do catalogo em memoria
    vscode.lm.registerTool('aria_obter_tabelas_metadados', {
        async invoke(options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            const idBancoExterno = Number(options.input.p_id_banco_externo);
            const idBancoEsquema = Number(options.input.p_id_banco_esquema);
            const schemaFilter = toStringSafe(options.input.schema).trim().toUpperCase();
            if (!(idBancoExterno > 0)) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Parametro invalido: p_id_banco_externo deve ser um numero maior que zero.')
                ]);
            }
            const catalog = await getMetadataCatalog(idBancoExterno, idBancoEsquema);
            if (!catalog) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Nenhum metadado em memoria para os parametros informados. Execute aria_obter_metadados primeiro.')
                ]);
            }
            const tables = catalog.schemas.flatMap((schema) => {
                if (schemaFilter && schema.name.toUpperCase() !== schemaFilter) {
                    return [];
                }
                return schema.tables.map((table) => ({
                    schema: schema.name,
                    table: table.fullName,
                    comment: table.comment ?? '',
                    columnCount: table.columns.length,
                    foreignKeyCount: table.foreignKeys.length
                }));
            });
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    metadataKey: catalog.key,
                    schema: schemaFilter || null,
                    tables
                }, null, 2))
            ]);
        }
    }), 
    // Tool: listar colunas e FKs de uma tabela do catalogo em memoria
    vscode.lm.registerTool('aria_obter_colunas_metadados', {
        async invoke(options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            const idBancoExterno = Number(options.input.p_id_banco_externo);
            const idBancoEsquema = Number(options.input.p_id_banco_esquema);
            const schemaFilter = toStringSafe(options.input.schema).trim().toUpperCase();
            const tableFilter = toStringSafe(options.input.tabela).trim().toUpperCase();
            if (!(idBancoExterno > 0) || !tableFilter) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Parametro invalido: informe p_id_banco_externo e tabela.')
                ]);
            }
            const catalog = await getMetadataCatalog(idBancoExterno, idBancoEsquema);
            if (!catalog) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Nenhum metadado em memoria para os parametros informados. Execute aria_obter_metadados primeiro.')
                ]);
            }
            const candidates = catalog.schemas.flatMap((schema) => {
                if (schemaFilter && schema.name.toUpperCase() !== schemaFilter) {
                    return [];
                }
                return schema.tables
                    .filter((table) => table.fullName.toUpperCase() === tableFilter || table.name.toUpperCase() === tableFilter)
                    .map((table) => ({
                    schema: schema.name,
                    table: table.fullName,
                    comment: table.comment ?? '',
                    columns: table.columns,
                    foreignKeys: table.foreignKeys
                }));
            });
            if (candidates.length === 0) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Tabela nao encontrada no catalogo em memoria: ${schemaFilter ? `${schemaFilter}.` : ''}${tableFilter}`)
                ]);
            }
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(JSON.stringify({
                    metadataKey: catalog.key,
                    requestedSchema: schemaFilter || null,
                    requestedTable: tableFilter,
                    tables: candidates
                }, null, 2))
            ]);
        }
    }), 
    // Tool: importar JSON do projeto (criar ou editar endpoint via importar-json)
    vscode.lm.registerTool('aria_importar_json', {
        async invoke(options, _token) {
            if (!client) {
                return notConnectedResult();
            }
            try {
                const rawInput = options.input;
                const inputPayloadRaw = (asRecord(rawInput?.json_projeto) ?? rawInput);
                const inputProjects = Array.isArray(inputPayloadRaw.registros)
                    ? inputPayloadRaw.registros
                    : [];
                if (inputProjects.length === 0) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Importacao bloqueada: json_projeto.registros esta vazio. Envie pelo menos um projeto com REST_CUSTOM.')
                    ]);
                }
                const projectCache = new Map();
                const existingEndpointIdsByProjectId = new Map();
                const enrichedProjects = [];
                for (const rawProject of inputProjects) {
                    const incomingProject = asRecord(rawProject) ?? {};
                    const projectId = toNumber(incomingProject.ID_PROJETO);
                    if (!(projectId > 0)) {
                        return new vscode.LanguageModelToolResult([
                            new vscode.LanguageModelTextPart('Importacao bloqueada: cada projeto em registros deve informar ID_PROJETO valido.')
                        ]);
                    }
                    let fullProject = projectCache.get(projectId);
                    if (!fullProject) {
                        const fullDataset = await client.getDatasetByProjectId(projectId);
                        fullProject = fullDataset.registros.find((item) => item.ID_PROJETO === projectId);
                        if (!fullProject) {
                            return new vscode.LanguageModelToolResult([
                                new vscode.LanguageModelTextPart(`Importacao bloqueada: projeto ${projectId} nao encontrado no gerar-json.`)
                            ]);
                        }
                        projectCache.set(projectId, fullProject);
                    }
                    existingEndpointIdsByProjectId.set(projectId, new Set((fullProject.REST_CUSTOM ?? []).map((endpoint) => toNumber(endpoint.ID_REST_CUSTOM))));
                    const incomingEndpoints = asArray(incomingProject.REST_CUSTOM) ?? [];
                    const normalizedEndpoints = incomingEndpoints.map((endpoint) => {
                        const endpointRecord = asRecord(endpoint) ?? {};
                        const { REST_CUSTOM_JSON_SCHEMA: _ignoredSchema, ...rest } = endpointRecord;
                        return rest;
                    });
                    const mergedProject = {
                        ...fullProject,
                        ...incomingProject,
                        ID_PROJETO: projectId,
                        TX_PATH: toStringSafe(incomingProject.TX_PATH ?? fullProject.TX_PATH),
                        REST_CUSTOM: normalizedEndpoints
                    };
                    enrichedProjects.push(mergedProject);
                }
                const payload = {
                    ...inputPayloadRaw,
                    registros: enrichedProjects
                };
                // Normalize VARIABLE entries: ensure TX_REGEX_QS exists (can be same as NO_VARIABLE)
                for (const project of payload.registros ?? []) {
                    for (const endpointRaw of project.REST_CUSTOM ?? []) {
                        const ep = endpointRaw;
                        const vars = asArray(ep.VARIABLE) ?? [];
                        if (vars.length > 0) {
                            const normalizedVars = [];
                            for (let vi = 0; vi < vars.length; vi++) {
                                const rawVar = asRecord(vars[vi]) || {};
                                const noVariable = toStringSafe(rawVar.NO_VARIABLE || rawVar.NO_VARIABLE || rawVar.TX_REGEX_QS).trim() || '';
                                const txRegex = toStringSafe(rawVar.TX_REGEX_QS).trim() || noVariable;
                                normalizedVars.push({
                                    ID_VARIABLE: toNumber(rawVar.ID_VARIABLE) || 10000 + vi,
                                    NO_VARIABLE: noVariable,
                                    TX_REGEX_QS: txRegex,
                                    IN_ORIGEM_VARIABLE: rawVar.IN_ORIGEM_VARIABLE ?? rawVar.IN_ORIGEM_VARIABLE,
                                    TX_DESCRICAO: toStringSafe(rawVar.TX_DESCRICAO)
                                });
                            }
                            ep.VARIABLE = normalizedVars;
                        }
                    }
                    // Remove trailing semicolons from TX_CODIGO only for pure SQL (not PL/SQL or Python)
                    for (const endpointRaw of project.REST_CUSTOM ?? []) {
                        const ep = endpointRaw;
                        if (isSqlEndpointCodeType(ep) && typeof ep.TX_CODIGO === 'string' && ep.TX_CODIGO.trim()) {
                            ep.TX_CODIGO = ep.TX_CODIGO.trimEnd().replace(/;+$/, '');
                        }
                    }
                }
                const metadataMissing = [];
                const metadataTableErrors = [];
                for (const project of payload.registros ?? []) {
                    const projectId = toNumber(project.ID_PROJETO);
                    const existingEndpointIds = existingEndpointIdsByProjectId.get(projectId) ?? new Set();
                    for (const endpointRaw of project.REST_CUSTOM ?? []) {
                        const endpoint = endpointRaw;
                        const endpointId = toNumber(endpoint.ID_REST_CUSTOM);
                        const isNewEndpoint = endpointId <= 0 || !existingEndpointIds.has(endpointId);
                        if (!isNewEndpoint || !isSqlEndpointCodeType(endpoint)) {
                            continue;
                        }
                        const idBancoExterno = toNumber(endpoint.ID_BANCO_EXTERNO);
                        const idBancoEsquema = toNumber(endpoint.ID_BANCO_ESQUEMA);
                        const endpointName = toStringSafe(endpoint.NO_REST_CUSTOM) || '(sem nome)';
                        const endpointPath = toStringSafe(endpoint.TX_PATH) || '(sem path)';
                        if (!(idBancoExterno > 0)) {
                            metadataMissing.push(`${endpointName} [${endpointPath}] - ID_BANCO_EXTERNO ausente`);
                            continue;
                        }
                        const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
                        const metadataUri = metadataUriByEndpoint.get(metadataKey);
                        if (!metadataUri) {
                            const suggest = idBancoEsquema > 0
                                ? `aria_obter_metadados({"p_id_banco_externo": ${idBancoExterno}, "p_id_banco_esquema": ${idBancoEsquema}})`
                                : `aria_obter_metadados({"p_id_banco_externo": ${idBancoExterno}})`;
                            metadataMissing.push(`${endpointName} [${endpointPath}] - execute ${suggest}`);
                            continue;
                        }
                        try {
                            const metadataText = await fs.promises.readFile(metadataUri.fsPath, 'utf8');
                            const catalogTables = new Set(extractMetadataTableNames(metadataText).map((item) => item.toUpperCase()));
                            const sqlTables = extractSqlReferencedTables(toStringSafe(endpoint.TX_CODIGO));
                            for (const sqlTable of sqlTables) {
                                const exact = catalogTables.has(sqlTable);
                                const bySuffix = !sqlTable.includes('.')
                                    ? Array.from(catalogTables).some((catalogTable) => catalogTable.endsWith(`.${sqlTable}`))
                                    : false;
                                if (!exact && !bySuffix) {
                                    metadataTableErrors.push(`${endpointName} [${endpointPath}] - tabela nao encontrada nos metadados: ${sqlTable}`);
                                }
                            }
                        }
                        catch (error) {
                            metadataMissing.push(`${endpointName} [${endpointPath}] - falha ao ler metadados salvos: ${toErrorMessage(error)}`);
                        }
                    }
                }
                if (metadataMissing.length > 0) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Importacao bloqueada: endpoints SQL exigem metadados carregados antes do save.\n\n' +
                            `Pendencias:\n- ${metadataMissing.join('\n- ')}`)
                    ]);
                }
                if (metadataTableErrors.length > 0) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Importacao bloqueada: SQL referencia tabela(s) que nao aparecem no catalogo de metadados carregado.\n\n' +
                            `Erros:\n- ${metadataTableErrors.join('\n- ')}`)
                    ]);
                }
                const invalidSqlEndpoints = [];
                for (const project of payload?.registros ?? []) {
                    const projectId = toNumber(project.ID_PROJETO);
                    const existingEndpointIds = existingEndpointIdsByProjectId.get(projectId) ?? new Set();
                    for (const endpointRaw of project?.REST_CUSTOM ?? []) {
                        const endpoint = endpointRaw;
                        const endpointId = toNumber(endpoint.ID_REST_CUSTOM);
                        const isNewEndpoint = endpointId <= 0 || !existingEndpointIds.has(endpointId);
                        if (!isNewEndpoint || !isSqlEndpointCodeType(endpoint)) {
                            continue;
                        }
                        const txCodigo = toStringSafe(endpoint.TX_CODIGO);
                        if (!hasSelectStar(txCodigo)) {
                            continue;
                        }
                        const endpointName = toStringSafe(endpoint.NO_REST_CUSTOM) || '(sem nome)';
                        const endpointPath = toStringSafe(endpoint.TX_PATH) || '(sem path)';
                        invalidSqlEndpoints.push(`${endpointName} [${endpointPath}]`);
                    }
                }
                if (invalidSqlEndpoints.length > 0) {
                    return new vscode.LanguageModelToolResult([
                        new vscode.LanguageModelTextPart('Importacao bloqueada: novo endpoint SQL com "select *" detectado. ' +
                            'Para endpoint novo, liste colunas explicitamente e use aliases camelCase ENTRE ASPAS DUPLAS para o JSON (ex: COLUNA AS "nomeCampo").\n\n' +
                            `Endpoints com problema:\n- ${invalidSqlEndpoints.join('\n- ')}`)
                    ]);
                }
                const payloadStr = JSON.stringify(payload, null, 2);
                const filePath = await ensureEditFilePath('last-importa-json.aria.payload.json');
                await fs.promises.writeFile(filePath, payloadStr, 'utf8');
                output.appendLine(`[${new Date().toISOString()}] aria_importar_json: ${payloadStr.length} bytes, ` +
                    `projetos=${payload.registros.length} (payload enriquecido com campos completos do projeto)`);
                await client.saveDataset(payload);
                dataset = await client.getProjectEndpointTree();
                tree.refresh();
                const importedEndpointSummaries = [];
                for (const project of payload.registros ?? []) {
                    const projectId = toNumber(project.ID_PROJETO);
                    const projectName = toStringSafe(project.NO_PROJETO) || '(sem nome)';
                    for (const endpointRaw of project.REST_CUSTOM ?? []) {
                        const endpoint = endpointRaw;
                        const endpointId = toNumber(endpoint.ID_REST_CUSTOM);
                        const action = endpointId > 0 ? 'editado' : 'criado';
                        const endpointName = toStringSafe(endpoint.NO_REST_CUSTOM) || '(sem nome)';
                        const endpointPath = toStringSafe(endpoint.TX_PATH) || '(sem path)';
                        const methodName = toStringSafe(endpoint.NO_METODO) || `ID ${toNumber(endpoint.ID_METODO)}`;
                        importedEndpointSummaries.push(`${action}: projeto ${projectId} ${projectName} | endpoint ${endpointName} ` +
                            `(ID_REST_CUSTOM=${endpointId}, TX_PATH=${endpointPath}, ID_METODO=${toNumber(endpoint.ID_METODO)} ${methodName}, ` +
                            `ID_BANCO_EXTERNO=${toNumber(endpoint.ID_BANCO_EXTERNO)}, ID_BANCO_ESQUEMA=${toNumber(endpoint.ID_BANCO_ESQUEMA)}, ` +
                            `ID_TIPO_CODIGO=${toNumber(endpoint.ID_TIPO_CODIGO)})`);
                    }
                }
                const successLines = ['JSON importado com sucesso.'];
                if (importedEndpointSummaries.length > 0) {
                    successLines.push(...importedEndpointSummaries.slice(0, 5).map((line) => `- ${line}`));
                    if (importedEndpointSummaries.length > 5) {
                        successLines.push(`- ... e mais ${importedEndpointSummaries.length - 5} endpoint(s).`);
                    }
                }
                else {
                    successLines.push('- Nenhum endpoint encontrado no payload importado.');
                }
                successLines.push('Arvore de projetos atualizada.');
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(successLines.join('\n'))
                ]);
            }
            catch (error) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Erro ao importar JSON: ${toErrorMessage(error)}`)
                ]);
            }
        }
    }));
    // ── Chat Participant @aria ──────────────────────────────────────────────────
    const REST_CUSTOM_SCHEMA_STR = `{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "REST_CUSTOM",
  "type": "object",
  "properties": {
    "ID_REST_CUSTOM":          { "type": ["number", "null"] },
    "NO_REST_CUSTOM":          { "type": ["string", "null"] },
    "TX_PATH":                 { "type": ["string", "null"] },
    "ID_TIPO_CODIGO":          { "type": ["number", "null"] },
    "NO_TIPO_CODIGO":          { "type": ["string", "null"] },
    "TX_CODIGO":               { "type": ["string", "null"] },
    "TX_COMENTARIOS":          { "type": ["string", "null"] },
    "ID_PROJETO":              { "type": ["number", "null"] },
    "NR_VERSAO":               { "type": ["number", "null"] },
    "ID_METODO":               { "type": ["number", "null"] },
    "NO_METODO":               { "type": ["string", "null"] },
    "TX_MIME_TYPE":            { "type": ["string", "null"] },
    "ID_TIPO_HEADER":          { "type": ["number", "null"] },
    "NO_TIPO_HEADER":          { "type": ["string", "null"] },
    "NR_PAGE_SIZE":            { "type": ["number", "null"] },
    "SN_PAGINADO":             { "type": ["string", "null"] },
    "IN_MODO_SEGURANCA":       { "type": ["string", "null"] },
    "ID_BANCO_EXTERNO":        { "type": ["number", "null"] },
    "CO_BANCO_EXTERNO":        { "type": ["string", "null"] },
    "IN_TIPO_TRANSFORMACAO":   { "type": ["string", "null"] },
    "SN_MODO_COMPATIBILIDADE": { "type": ["string", "null"] },
    "SN_CACHE":                { "type": ["string", "null"] },
    "NR_TEMPO_CACHE":          { "type": ["number", "null"] },
    "IN_TEMPO_CACHE":          { "type": ["string", "null"] },
    "DT_EXP_CACHE":            { "type": ["string", "null"] },
    "ID_BANCO_ESQUEMA":        { "type": ["number", "null"] },
    "NO_ESQUEMA":              { "type": ["string", "null"] },
    "SN_PUBLICADO":            { "type": ["string", "null"] },
    "TX_URL_PROXY":            { "type": ["string", "null"] },
    "TOKEN_PROXY":             { "type": ["string", "null"] },
    "SN_INCLUI_COUNT":         { "type": ["string", "null"] },
    "IN_FORMATO_SAIDA":        { "type": ["string", "null"] },
    "TX_SEPARADOR_CSV":        { "type": ["string", "null"] },
    "SN_HABILITA_META_API":    { "type": ["string", "null"] },
    "TX_SECRET_META_API":      { "type": ["string", "null"] },
    "SN_NULOS_EXPLICITOS":     { "type": ["string", "null"] },
    "DS_REST_CUSTOM_CURTA":    { "type": ["string", "null"] },
    "TX_PATH_AUX":             { "type": ["string", "null"] },
    "ID_OPERATION_OPENAPI":    { "type": ["string", "null"] },
    "SN_IGNORA_CONFIGS_DEPLOY":{ "type": ["string", "null"] },
    "SN_APENAS_INTERNO":       { "type": ["string", "null"] },
    "SN_EXIGE_OTP":            { "type": ["string", "null"] },
    "SN_IDEMPOTENTE":          { "type": ["string", "null"] },
    "IN_JANELA_TEMPO_CACHE":   { "type": ["string", "null"] },
    "PROJETO": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "TX_PATH":    { "type": ["string", "null"] },
          "CO_SISTEMA": { "type": ["string", "null"] }
        }
      }
    },
    "REST_CUSTOM_PERFIL": { "type": "array" },
    "REST_CUSTOM_RESPONSE": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "ID_REST_CUSTOM_RESPONSE": { "type": ["number", "null"] },
          "NR_CODIGO":               { "type": ["number", "null"] },
          "DS_RESPONSE":             { "type": ["string", "null"] },
          "TX_EXEMPLO_RESPOSTA":     { "type": ["string", "null"] }
        }
      }
    },
    "VARIABLE": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "ID_VARIABLE":          { "type": ["number", "null"] },
          "NO_VARIABLE":          { "type": ["string", "null"] },
          "IN_ORIGEM_VARIABLE":   { "type": ["string", "null"] },
          "TX_DESCRICAO":         { "type": ["string", "null"] },
          "VARIABLE_VALOR_POSSIVEL": { "type": "array" }
        }
      }
    },
    "HEADER":                  { "type": "array" },
    "REST_CUSTOM_IP":          { "type": "array" },
    "REST_CUSTOM_TIPO_OTP":    { "type": "array" },
    "REST_CUSTOM_ATRIBUTO_LOG":{ "type": "array" }
  }
}`;
    const ariaParticipant = vscode.chat.createChatParticipant('aria.assistant', async (request, chatContext, response, token) => {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        const model = models[0];
        if (!model) {
            response.markdown('Nenhum modelo Copilot disponivel. Verifique se o GitHub Copilot Chat esta instalado e ativo.');
            return;
        }
        if (!client) {
            response.markdown('ARIA nao esta conectado. Execute o comando **ARIA: Conectar na API** primeiro.');
            return;
        }
        // Busca projetos-endpoints e envia como contexto inicial para o modelo
        let projetosJson = '[]';
        let projetosRegistros = [];
        const knownSchemaIds = new Set();
        const knownSchemaNames = new Set();
        let schemaLockText = '';
        try {
            response.progress('Carregando contexto de projetos...');
            const projetosData = await client.getProjectEndpointTree();
            projetosRegistros = projetosData.registros;
            projetosJson = JSON.stringify(projetosData.registros, null, 2);
            schemaLockText = buildProjectSchemaLockSummary(projetosData.registros, request.prompt);
            for (const project of projetosData.registros ?? []) {
                for (const endpoint of project.REST_CUSTOM ?? []) {
                    const schemaId = toNumber(endpoint.ID_BANCO_ESQUEMA);
                    if (schemaId > 0) {
                        knownSchemaIds.add(schemaId);
                    }
                    const schemaName = toStringSafe(endpoint.NO_ESQUEMA ?? endpoint.no_esquema ?? endpoint.CO_ESQUEMA ?? endpoint.co_esquema)
                        .trim()
                        .toUpperCase();
                    if (schemaName) {
                        knownSchemaNames.add(schemaName);
                    }
                }
            }
        }
        catch (error) {
            projetosJson = `Erro ao carregar projetos: ${toErrorMessage(error)}`;
        }
        const ariaTools = vscode.lm.tools.filter((t) => t.name.startsWith('aria_'));
        const systemPrompt = [
            'Voce e um assistente especialista na plataforma ARIA (endpoints REST sobre bancos Oracle).',
            'O codigo da extensao NAO detecta projetos nem endpoints automaticamente.',
            'Voce identifica projeto, banco, esquema, tabelas e colunas EXCLUSIVAMENTE pelo contexto e pelos dados retornados pelas tools.',
            '',
            '════════════════════════════════════════',
            '## FLUXO OBRIGATORIO — execute nesta ordem exata:',
            '════════════════════════════════════════',
            '',
            '1. IDENTIFICAR PROJETO',
            '   - Os projetos e endpoints ja estao no contexto (de /projetos-endpoints).',
            '   - Identifique pelo nome ou contexto. Se ambiguo, pergunte ao usuario.',
            '',
            '2. CARREGAR LOVs: aria_obter_lovs(id_projeto)',
            '   - Fornece valores validos para ID_METODO, ID_TIPO_CODIGO, ID_TIPO_HEADER, ID_BANCO_EXTERNO (e seus esquemas), perfis, OTPs etc.',
            '   - Use-as para preencher todos os campos ID_ e NO_ do endpoint.',
            '',
            '3. CARREGAR JSON DO PROJETO: aria_obter_json_projeto(id_projeto)',
            '   - Use para entender o padrao de banco/esquema dos endpoints existentes do projeto.',
            '',
            '4. CARREGAR CAMPOS OBRIGATORIOS: aria_obter_itens_apex()',
            '',
            '5. DECIDIR BANCO E ESQUEMA',
            '   - ID_BANCO_EXTERNO: deduzido das LOVs e dos endpoints existentes do projeto.',
            '   - ID_BANCO_ESQUEMA: OPCIONAL. So preencha se houver evidencia clara (endpoints existentes do projeto ja usam esse esquema, ou usuario pediu explicitamente).',
            '   - Se nao houver evidencia, omita ID_BANCO_ESQUEMA — NAO use fallback fixo.',
            '',
            '6. CARREGAR METADADOS: aria_obter_metadados(p_id_banco_externo [, p_id_banco_esquema, schema_preferido, termos_busca])',
            '   - OBRIGATORIO antes de qualquer proposta de SQL.',
            '   - Informe termos_busca com palavras-chave do assunto do endpoint para ajudar no ranking de tabelas.',
            '   - Se o projeto usa schema especifico, informe schema_preferido.',
            '   - Apos carregar metadados, va DIRETO para a inferencia hierarquica de schema -> tabela -> colunas/FKs e so entao para a proposta completa.',
            '   - NAO emita mensagem intermediaria como "metadados carregados" ou "agora posso propor".',
            '   - Fluxo correto: executa tools silenciosamente -> apresenta proposta completa ao usuario.',
            '   - Se o schema ainda estiver incerto, use aria_obter_esquemas_metadados para listar os schemas em memoria.',
            '   - Depois use aria_obter_tabelas_metadados para listar as tabelas do schema escolhido.',
            '   - Por fim use aria_obter_colunas_metadados para confirmar colunas e FKs da tabela escolhida.',
            '   - Nunca pule do catalogo bruto direto para o SQL se houver duvida de schema/tabela.',
            '',
            '════════════════════════════════════════',
            '## COMO LER O ARQUIVO DE METADADOS',
            '════════════════════════════════════════',
            '',
            'O arquivo retornado e Markdown estruturado hierarquicamente:',
            '',
            '  # NOME_SCHEMA',
            '      Inicia um bloco de schema. Todas as tabelas seguintes pertencem a este schema ate o proximo #.',
            '',
            '  ## SCHEMA.NOME_TABELA  [comentario opcional da tabela]',
            '      Define uma tabela. As linhas seguintes sao as colunas DESTA tabela ate o proximo ##.',
            '',
            '  - NOME_COLUNA TIPO_DADO  [comentario opcional da coluna]',
            '      Define uma coluna da tabela atual. NOME_COLUNA e o nome exato a ser usado em SQL.',
            '',
            '  - FK: COLUNA_LOCAL -> SCHEMA.TABELA_DESTINO(COLUNA_DESTINO)',
            '      Define uma chave estrangeira da tabela atual.',
            '',
            'REGRAS DE INTERPRETACAO:',
            '  - Hierarquia obrigatoria: schema (#) > tabela (##) > colunas/FKs (-).',
            '  - Uma coluna pertence SOMENTE a tabela do ultimo ## lido antes dela.',
            '  - NUNCA atribua coluna a tabela diferente da que ela esta listada.',
            '  - Se o contexto do projeto trouxer um SCHEMA LOCK, ele e a verdade local para esse pedido.',
            '  - NUNCA use tabela de outro schema quando o SCHEMA LOCK apontar um schema diferente.',
            '',
            '════════════════════════════════════════',
            '## COMO ESCOLHER TABELA E ESCREVER SQL',
            '════════════════════════════════════════',
            '',
            'SELECAO DE TABELA — siga esta ordem de prioridade:',
            '  1. Match exato do nome da tabela com o assunto pedido (ex: pedido "metodos" -> tabela METODO ou METODOS).',
            '  2. Se houver schema_preferido, priorize tabelas nesse schema.',
            '  3. Se nao encontrar match exato e houver mais de uma candidata plausivel, PARE e pergunte ao usuario qual tabela usar.',
            '  4. NUNCA escolha tabela por aproximacao semantica fraca sem confirmar com o usuario.',
            '',
            'SELECAO DE COLUNAS — regras absolutas:',
            '  - Use SOMENTE colunas listadas no bloco ## da tabela escolhida.',
            '  - Verifique o nome exato de cada coluna no arquivo antes de usa-la.',
            '  - NUNCA invente coluna por semelhanca com o nome da tabela ou semantica (ex: se nao existe ds_metodo na tabela, nao use).',
            '  - Se a tabela nao tiver colunas suficientes para o pedido, diga ao usuario o que esta faltando.',
            '',
            'JOINS — regra unica:',
            '  - JOIN so e permitido quando houver uma FK explicita no arquivo ligando as duas tabelas.',
            '  - Formato do FK: - FK: COLUNA_LOCAL -> SCHEMA.TABELA_DESTINO(COLUNA_DESTINO)',
            '  - Se nao houver FK declarada entre as tabelas, NAO faca JOIN. Explique a limitacao ao usuario.',
            '  - Nunca assuma relacionamento por semelhanca de nome de coluna.',
            '',
            'ESCRITA DO SQL — REGRAS INVIOLAVEIS:',
            '  !! PROIBIDO: SELECT * ou SELECT tabela.* em qualquer situacao. Sem excecao.',
            '  - Liste TODAS as colunas do SELECT de forma explicita e atribua ALIASES MNEMÔNICOS: use `AS "alias"`, `AS alias` ou a forma abreviada `COLUNA "alias"`.',
            '    O alias definido e o NOME que sera usado no JSON de resposta (ex: `m.ID_MICRO as "idMicro"`).',
            '  - Alias obrigatorio em TODAS as colunas do SELECT, inclusive da tabela principal. Exemplo valido: `P.ID_PROJETO "id"`, `P.NO_PROJETO "nome"`.',
            '  - Exemplo invalido: `P.ID_PROJETO` (sem alias) e `O.NO_ORIGEM AS ORIGEM` (alias nao mnemônico igual ao nome da coluna).',
            '  - O alias SERA o nome do campo no JSON de resposta da API. Use obrigatoriamente camelCase ENTRE ASPAS DUPLAS: AS "idProjeto".',
            '    Essa regra vale apenas para endpoints novos incluidos pela IA; endpoints existentes editados podem preservar o alias atual.',
            '     Exemplo: m.ID_MICRO AS "idMicro", m.NO_MICRO AS "nomeMicro"',
            '  - NUNCA coloque aspas duplas em tabelas, schemas ou colunas. Aspas duplas sao permitidas somente nos aliases, por exemplo: `p.ID_PROJETO AS "idProjeto"`.',
            '  - NUNCA escreva `"p"."ID_PROJETO"` nem `"COSIS_SISGP"."PROJETO"`. Use `p.ID_PROJETO AS "idProjeto"`. Isso é muito importante. Muito importante mesmo.',
            '  - Use o nome qualificado SCHEMA.TABELA nas clausulas FROM/JOIN.',
            '  - Nao inclua coluna cuja existencia voce nao confirmou no bloco ## da tabela nos metadados.',
            '',
            '════════════════════════════════════════',
            '## PARA CRIAR ENDPOINT',
            '════════════════════════════════════════',
            '',
            '- Deduza o maximo do contexto (endpoints existentes, LOVs, metadados) antes de perguntar qualquer coisa.',
            '- Defaults sensiveis: NO_REST_CUSTOM derivado do assunto, TX_PATH em slug lowercase, ID_METODO=GET, ID_TIPO_CODIGO=SQL.',
            '- Se precisar perguntar, faca 1 pergunta objetiva por vez — nunca questionario.',
            '- Monte proposta completa de uma vez (nome, caminho, metodo, banco/esquema, SQL, descricao).',
            '- Resposta invalida: retornar apenas SQL sem os demais campos do endpoint para confirmacao.',
            '- Peca confirmacao 1 vez. Apos resposta afirmativa, execute sem nova confirmacao.',
            '',
            'JSON do endpoint:',
            '  - ID_REST_CUSTOM = 0 para endpoint novo.',
            '  - Inclua o projeto completo (todos os campos) no objeto raiz; nao envie apenas ID_PROJETO.',
            '  - TX_PATH do projeto vem do gerar-json; NUNCA comeca com /.',
            '  - PROJETO = array com { TX_PATH, CO_SISTEMA }.',
            '  - Arrays nao usados = [].',
            '',
            '  Chame: aria_importar_json({ "registros": [<projeto_completo_com_apenas_o_endpoint_em_REST_CUSTOM>] })',
            '',
            '════════════════════════════════════════',
            '## PARA EDITAR ENDPOINT',
            '════════════════════════════════════════',
            '',
            '- Identifique o endpoint pelo JSON do projeto (passo 3).',
            '- Se houver mudanca de SQL, execute aria_obter_metadados antes da proposta.',
            '- Monte JSON com o projeto completo e apenas o endpoint editado em REST_CUSTOM.',
            '- Mostre alteracoes, peca confirmacao 1 vez, execute.',
            '',
            '════════════════════════════════════════',
            '## REGRAS ABSOLUTAS',
            '════════════════════════════════════════',
            '',
            '- NUNCA invente tabela, coluna, schema ou FK que nao existam no arquivo de metadados.',
            '- NUNCA faca JOIN sem FK declarada no arquivo de metadados entre as tabelas envolvidas.',
            '- NUNCA use SELECT * ou SELECT tabela.*. Sempre liste colunas com alias camelCase ENTRE ASPAS DUPLAS: AS "nomeCampo".',
            '- NUNCA deixe coluna sem alias no SELECT.',
            '- NUNCA use alias igual ao nome bruto da coluna (ex: ORIGEM, NO_PROJETO). Use alias de resposta JSON em camelCase e entre aspas duplas (ex: AS "origem", AS "nomeProjeto").',
            '- NUNCA termine SQL puro com ponto e virgula (;). O banco executa internamente; ; causa erro de syntax. (PL/SQL e Python podem usar ; normalmente.)',
            '- NUNCA emita mensagem intermediaria entre chamadas de tools e a proposta final ao usuario.',
            '- NUNCA chute ID_BANCO_ESQUEMA sem evidencia.',
            '- NUNCA chame aria_importar_json sem confirmacao explicita do usuario.',
            '- NUNCA faca questionario; deduza e pergunte apenas o indispensavel.',
            '- Se uma tool retornar erro, nao repita com os mesmos parametros; informe o usuario.',
            '- Documente sempre: DS_REST_CUSTOM_CURTA, TX_COMENTARIOS, VARIABLE[].TX_DESCRICAO.',
            '',
            '## JSON SCHEMA DO REST_CUSTOM:',
            REST_CUSTOM_SCHEMA_STR
        ].join('\n');
        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(`CONTEXTO - Projetos e endpoints disponiveis (de /projetos-endpoints):\n${projetosJson}`)
        ];
        if (schemaLockText) {
            messages.push(vscode.LanguageModelChatMessage.User(schemaLockText));
        }
        // Adiciona historico da conversa
        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            }
            else if (turn instanceof vscode.ChatResponseTurn) {
                const text = turn.response
                    .filter((p) => p instanceof vscode.ChatResponseMarkdownPart)
                    .map((p) => p.value.value)
                    .join('');
                if (text) {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(text));
                }
            }
        }
        messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
        const chatHistoryAssistantText = chatContext.history
            .filter((turn) => turn instanceof vscode.ChatResponseTurn)
            .flatMap((turn) => turn.response)
            .filter((part) => part instanceof vscode.ChatResponseMarkdownPart)
            .map((part) => part.value.value)
            .join('\n')
            .toLowerCase();
        const lastAssistantResponseText = [...chatContext.history]
            .reverse()
            .find((turn) => turn instanceof vscode.ChatResponseTurn)
            ?.response
            .filter((part) => part instanceof vscode.ChatResponseMarkdownPart)
            .map((part) => part.value.value)
            .join('') ?? '';
        const isEndpointMutationIntent = (() => {
            const prompt = toStringSafe(request.prompt).toLowerCase();
            const hasEndpoint = prompt.includes('endpoint');
            const hasMutationVerb = /\b(criar|crie|novo|editar|edite|alterar|atualizar)\b/.test(prompt) ||
                /\b(criacao|edicao|alteracao|atualizacao)\b/.test(prompt);
            const directMutationIntent = hasEndpoint && hasMutationVerb;
            const isAffirmative = isAffirmativeConfirmationPrompt(prompt);
            const hasPendingEndpointProposal = /\b(proposta do endpoint|sql final|nome do endpoint|tx_path|id_banco_externo|confirme se deseja prosseguir)\b/.test(chatHistoryAssistantText) ||
                /\b(endpoint|sql|tx_codigo|rest_custom)\b/.test(chatHistoryAssistantText);
            const hasReadyPendingEndpointProposal = isEndpointProposalReadyForImport(lastAssistantResponseText);
            return directMutationIntent || (isAffirmative && (hasReadyPendingEndpointProposal || hasPendingEndpointProposal));
        })();
        const isAffirmativeReply = isAffirmativeConfirmationPrompt(request.prompt);
        const userPromptHistory = [
            ...chatContext.history
                .filter((turn) => turn instanceof vscode.ChatRequestTurn)
                .map((turn) => toStringSafe(turn.prompt)),
            toStringSafe(request.prompt)
        ].join('\n').toLowerCase();
        let metadataCalledInRequest = false;
        let metadataSchemasListedInRequest = false;
        let metadataTablesListedInRequest = false;
        let metadataColumnsListedInRequest = false;
        const columnMetadataRequestedTables = new Set();
        output.appendLine(`[${new Date().toISOString()}] @aria: "${request.prompt.slice(0, 120)}", ${messages.length} msgs, ${ariaTools.length} tools`);
        // Quando o usuario confirma, o modelo usa tools normais MENOS as de pipeline de metadados
        // (metadados ja foram carregados na requisicao anterior e estao em cache).
        // O modelo pode chamar aria_obter_lovs, aria_obter_json_projeto, aria_obter_itens_apex e aria_importar_json.
        const METADATA_PIPELINE_TOOLS = new Set([
            'aria_obter_metadados',
            'aria_obter_esquemas_metadados',
            'aria_obter_tabelas_metadados',
            'aria_obter_colunas_metadados'
        ]);
        const toolsForModel = (isEndpointMutationIntent && isAffirmativeReply)
            ? ariaTools.filter((t) => !METADATA_PIPELINE_TOOLS.has(t.name))
            : ariaTools;
        const hasReadyPendingEndpointProposal = isEndpointProposalReadyForImport(lastAssistantResponseText);
        if (isEndpointMutationIntent && isAffirmativeReply) {
            output.appendLine(`[${new Date().toISOString()}] @aria: affirmative reply - tools restricted to: ${toolsForModel.map((t) => t.name).join(', ')}`);
            // Metadados ja estavam carregados na requisicao anterior; marcar como presentes para os guardrails
            metadataCalledInRequest = true;
            metadataSchemasListedInRequest = true;
            metadataTablesListedInRequest = true;
            metadataColumnsListedInRequest = true;
            messages.push(vscode.LanguageModelChatMessage.User(hasReadyPendingEndpointProposal
                ? 'O usuario confirmou a proposta. ' +
                    'Use o historico da conversa para montar o JSON completo do endpoint e chamar aria_importar_json. ' +
                    'Para obter o JSON completo do projeto (com todos os campos obrigatorios), chame aria_obter_json_projeto. ' +
                    'Os metadados ja estao carregados — NAO chame aria_obter_metadados nem nenhuma tool de metadados. ' +
                    'Chame aria_importar_json com o projeto completo e apenas o endpoint novo em REST_CUSTOM (ID_REST_CUSTOM = 0).'
                : 'O usuario respondeu afirmativamente, mas a ultima proposta ainda nao estava pronta para importacao. ' +
                    'Antes de chamar aria_importar_json, corrija a proposta usando o historico: monte SQL final com aliases camelCase entre aspas duplas em todas as colunas, ' +
                    'inclua todos os campos do endpoint para confirmacao e entao gere o JSON completo do projeto. ' +
                    'Para obter o JSON completo do projeto (com todos os campos obrigatorios), chame aria_obter_json_projeto. ' +
                    'Os metadados ja estao carregados — NAO chame aria_obter_metadados nem nenhuma tool de metadados. ' +
                    'Nao peca nova confirmacao; apenas corrija internamente e execute a importacao.'));
        }
        for (let iteration = 0; iteration < 10 && !token.isCancellationRequested; iteration++) {
            let chatResponse;
            try {
                chatResponse = await model.sendRequest(messages, { tools: toolsForModel }, token);
            }
            catch (error) {
                response.markdown(`Erro ao chamar o modelo: ${toErrorMessage(error)}`);
                return;
            }
            const toolCalls = [];
            let bufferedText = '';
            for await (const chunk of chatResponse.stream) {
                if (chunk instanceof vscode.LanguageModelTextPart) {
                    bufferedText += chunk.value;
                }
                else if (chunk instanceof vscode.LanguageModelToolCallPart) {
                    toolCalls.push(chunk);
                }
            }
            if (toolCalls.length === 0) {
                const bufferedTextLower = bufferedText.toLowerCase();
                if (isEndpointMutationIntent && hasSelectStarInText(bufferedText)) {
                    output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta bloqueada por conter SELECT * em fluxo de endpoint.`);
                    messages.push(vscode.LanguageModelChatMessage.User('Regra obrigatoria: nao use SELECT * em SQL. Reescreva com colunas explicitas e aliases mnemônicos para JSON.'));
                    continue;
                }
                if (isEndpointMutationIntent &&
                    isAffirmativeReply &&
                    /(confirme|confirmacao|deseja prosseguir|posso prosseguir|quer que eu prossiga|prosseguir\?)/.test(bufferedTextLower)) {
                    output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta bloqueada por pedir confirmacao novamente apos usuario confirmar.`);
                    messages.push(vscode.LanguageModelChatMessage.User('O usuario ja confirmou. Nao peca nova confirmacao; execute imediatamente a operacao e reporte o resultado.'));
                    continue;
                }
                if (isEndpointMutationIntent && !metadataCalledInRequest) {
                    output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta bloqueada por falta de aria_obter_metadados em fluxo de criacao/edicao.`);
                    if (iteration >= 9) {
                        response.markdown('Nao consegui concluir porque faltou chamada obrigatoria de metadados. ' +
                            'Tente novamente para que eu execute aria_obter_metadados antes da proposta final.');
                        break;
                    }
                    messages.push(vscode.LanguageModelChatMessage.User('Regra obrigatoria: antes de responder ao usuario em criacao/edicao de endpoint, ' +
                        'chame aria_obter_metadados e use o catalogo retornado no contexto. Nao conclua sem essa chamada.'));
                    continue;
                }
                if (isEndpointMutationIntent &&
                    metadataCalledInRequest &&
                    (!metadataTablesListedInRequest || !metadataColumnsListedInRequest)) {
                    output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta bloqueada por pipeline de metadados incompleto (schema->tabela->colunas).`);
                    messages.push(vscode.LanguageModelChatMessage.User('Pipeline obrigatorio para este endpoint: ' +
                        '1) aria_obter_metadados (schemas), ' +
                        '2) aria_obter_tabelas_metadados (schema escolhido), ' +
                        '3) aria_obter_colunas_metadados (tabelas selecionadas). ' +
                        'Nao conclua a proposta sem concluir os 3 niveis.'));
                    continue;
                }
                if (isEndpointMutationIntent) {
                    const hasSqlCandidate = /\bselect\b[\s\S]*\bfrom\b/i.test(bufferedTextLower);
                    if (looksLikeEndpointProposalWithoutSql(bufferedText)) {
                        output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta bloqueada por proposta de endpoint sem SQL.`);
                        messages.push(vscode.LanguageModelChatMessage.User('A proposta de endpoint esta incompleta: faltou o SQL final. ' +
                            'Reescreva a resposta incluindo obrigatoriamente a query completa (SELECT ... FROM ...), ' +
                            'com aliases camelCase entre aspas duplas em todas as colunas, e so entao apresente a proposta para confirmacao.'));
                        continue;
                    }
                    if (hasSqlCandidate) {
                        const extractedSql = extractSqlCandidateFromText(bufferedText) ?? bufferedText;
                        if (hasQuotedIdentifiersOutsideAliases(extractedSql)) {
                            output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta SQL bloqueada por aspas indevidas em tabela/schema/coluna.`);
                            messages.push(vscode.LanguageModelChatMessage.User('Reescreva o SQL sem aspas duplas em tabelas, schemas ou colunas. ' +
                                'Aspas duplas sao permitidas somente nos aliases das colunas, no formato `AS "idProjeto"`. ' +
                                'Exemplo correto: `p.ID_PROJETO AS "idProjeto"`; exemplo incorreto: `"p"."ID_PROJETO" AS "idProjeto"`.'));
                            continue;
                        }
                        const sqlTables = extractSqlReferencedTables(extractedSql)
                            .map((item) => normalizeTableRef(item))
                            .filter((item) => item.length > 0);
                        // Alias camelCase continua sendo exigido para os novos endpoints, mas so analisamos SQL limpo.
                        const missingColumnContext = sqlTables.filter((tableRef) => {
                            const nameOnly = tableRefNameOnly(tableRef);
                            return !columnMetadataRequestedTables.has(tableRef) && !columnMetadataRequestedTables.has(nameOnly);
                        });
                        if (missingColumnContext.length > 0) {
                            output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta SQL bloqueada por falta de aria_obter_colunas_metadados para tabelas: ${missingColumnContext.join(', ')}`);
                            messages.push(vscode.LanguageModelChatMessage.User('Antes de propor SQL final, chame aria_obter_colunas_metadados para CADA tabela usada em FROM/JOIN e so depois reescreva a query. ' +
                                `Tabelas sem colunas carregadas: ${missingColumnContext.join(', ')}.`));
                            continue;
                        }
                        if (!isEndpointProposalCompleteForConfirmation(bufferedText)) {
                            output.appendLine(`[${new Date().toISOString()}] Guardrail: resposta SQL bloqueada por proposta incompleta (faltam campos do endpoint para confirmacao).`);
                            messages.push(vscode.LanguageModelChatMessage.User('Proposta incompleta para confirmacao do usuario. Reescreva incluindo TODOS os itens: ' +
                                'Nome do Endpoint, Caminho (TX_PATH), Metodo HTTP, Tipo de Codigo/Linguagem, Banco Externo, Esquema, ' +
                                'DS_REST_CUSTOM_CURTA, TX_COMENTARIOS, SQL completo (SELECT ... FROM ...) com aliases camelCase entre aspas duplas em TODAS as colunas e pergunta unica de confirmacao. ' +
                                'O SQL nao deve terminar com ponto e virgula (;).'));
                            continue;
                        }
                    }
                }
                if (bufferedText.trim()) {
                    response.markdown(bufferedText);
                }
                break;
            }
            messages.push(vscode.LanguageModelChatMessage.Assistant(toolCalls));
            for (const tc of toolCalls) {
                response.progress(`Executando ${tc.name}...`);
            }
            const toolResults = [];
            let finalizedAfterImport = false;
            let finalizedAfterImportMessage = '';
            for (const toolCall of toolCalls) {
                let toolInput = toolCall.input ?? {};
                if (toolCall.name === 'aria_obter_metadados') {
                    const requestedSchemaId = toNumber(toolInput.p_id_banco_esquema);
                    const requestedSchemaName = toStringSafe(toolInput.schema_preferido).trim().toUpperCase();
                    const schemaMentionedByUser = requestedSchemaId > 0
                        ? new RegExp(`\\b${requestedSchemaId}\\b`).test(userPromptHistory)
                        : false;
                    const schemaSeenInProjectContext = requestedSchemaId > 0 && knownSchemaIds.has(requestedSchemaId);
                    const schemaNameMentionedByUser = requestedSchemaName.length > 0
                        ? userPromptHistory.includes(requestedSchemaName.toLowerCase())
                        : false;
                    const schemaNameSeenInProjectContext = requestedSchemaName.length > 0
                        ? knownSchemaNames.has(requestedSchemaName)
                        : false;
                    const hasSchemaNameEvidence = schemaNameMentionedByUser || schemaNameSeenInProjectContext;
                    if (requestedSchemaId > 0 && !schemaMentionedByUser && !schemaSeenInProjectContext && !hasSchemaNameEvidence) {
                        output.appendLine(`[${new Date().toISOString()}] Guardrail: removendo p_id_banco_esquema=${requestedSchemaId} por falta de evidencia no contexto (nem por id, nem por nome de schema).`);
                        const { p_id_banco_esquema: _ignoredSchemaId, ...restInput } = toolInput;
                        toolInput = restInput;
                    }
                    // Short-circuit if we already have metadata cached for these params: avoid re-calling the API repeatedly.
                    try {
                        const idBancoExterno = Number(toolInput.p_id_banco_externo);
                        const idBancoEsquema = Number(toolInput.p_id_banco_esquema);
                        const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
                        const cachedUri = metadataUriByEndpoint.get(metadataKey);
                        if (cachedUri) {
                            const metadataText = await fs.promises.readFile(cachedUri.fsPath, 'utf8').catch(() => undefined);
                            const schemas = metadataText ? listMetadataSchemas(metadataText) : [];
                            const schemaSummary = schemas.length > 0 ? schemas.map((s) => `- ${s}`).join('\n') : '(nenhum schema detectado)';
                            const msg = `Metadados ja carregados em: ${cachedUri.fsPath}\n\n` +
                                `Resumo (nivel 1 - schemas):\n${schemaSummary}\n\n` +
                                'Proximo passo obrigatorio (nivel 2): chame aria_obter_tabelas_metadados para o schema escolhido.\n' +
                                'Depois (nivel 3): chame aria_obter_colunas_metadados para cada tabela selecionada.\n' +
                                'Nao escreva SQL antes de concluir os niveis 2 e 3.';
                            toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, [
                                new vscode.LanguageModelTextPart(msg)
                            ]));
                            metadataCalledInRequest = true;
                            metadataSchemasListedInRequest = true;
                            response.reference(cachedUri);
                            output.appendLine(`[${new Date().toISOString()}] Guardrail: usando metadados em cache para ${metadataKey}, evitando nova chamada.`);
                            continue;
                        }
                    }
                    catch (e) {
                        // se falhar no shortcut, segue para invocar a tool normalmente
                    }
                }
                output.appendLine(`[${new Date().toISOString()}] Tool: ${toolCall.name} input: ${summarizeForLog(toolInput)}`);
                try {
                    const result = await vscode.lm.invokeTool(toolCall.name, { input: toolInput, toolInvocationToken: request.toolInvocationToken }, token);
                    if (toolCall.name === 'aria_importar_json') {
                        const importText = extractToolResultText(result.content);
                        finalizedAfterImport = true;
                        finalizedAfterImportMessage = importText || 'Importacao processada.';
                        toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, result.content));
                        output.appendLine(`[${new Date().toISOString()}] Guardrail: encerrando fluxo apos aria_importar_json para evitar novas chamadas de metadados.`);
                        break;
                    }
                    toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, result.content));
                    // Se metadados foram obtidos, adiciona referencia ao arquivo no chat
                    if (toolCall.name === 'aria_obter_metadados') {
                        metadataCalledInRequest = true;
                        metadataSchemasListedInRequest = true;
                        const idBancoExterno = Number(toolInput.p_id_banco_externo);
                        const idBancoEsquema = Number(toolInput.p_id_banco_esquema);
                        const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
                        const uri = metadataUriByEndpoint.get(metadataKey);
                        if (uri) {
                            response.reference(uri);
                        }
                    }
                    else if (toolCall.name === 'aria_obter_esquemas_metadados') {
                        metadataSchemasListedInRequest = true;
                    }
                    else if (toolCall.name === 'aria_obter_tabelas_metadados') {
                        metadataTablesListedInRequest = true;
                    }
                    else if (toolCall.name === 'aria_obter_colunas_metadados') {
                        metadataColumnsListedInRequest = true;
                        const schema = toStringSafe(toolInput.schema).trim().toUpperCase();
                        const tabela = toStringSafe(toolInput.tabela).trim().toUpperCase();
                        const tableName = tableRefNameOnly(tabela);
                        if (tabela) {
                            columnMetadataRequestedTables.add(tabela);
                        }
                        if (tableName) {
                            columnMetadataRequestedTables.add(tableName);
                        }
                        if (schema && tableName) {
                            columnMetadataRequestedTables.add(`${schema}.${tableName}`);
                        }
                    }
                }
                catch (err) {
                    toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, [
                        new vscode.LanguageModelTextPart(`Erro ao executar ${toolCall.name}: ${toErrorMessage(err)}`)
                    ]));
                }
            }
            if (finalizedAfterImport) {
                response.markdown(finalizedAfterImportMessage);
                return;
            }
            messages.push(vscode.LanguageModelChatMessage.User(toolResults));
            if (isEndpointMutationIntent && !metadataCalledInRequest) {
                messages.push(vscode.LanguageModelChatMessage.User('Ainda falta chamada obrigatoria: aria_obter_metadados. Execute-a antes de concluir qualquer proposta.'));
            }
            else if (isEndpointMutationIntent &&
                metadataCalledInRequest &&
                (!metadataTablesListedInRequest || !metadataColumnsListedInRequest)) {
                messages.push(vscode.LanguageModelChatMessage.User('Ainda falta concluir o pipeline de metadados: execute aria_obter_tabelas_metadados e aria_obter_colunas_metadados antes da proposta final.'));
            }
        }
    });
    ariaParticipant.iconPath = new vscode.ThemeIcon('database');
    context.subscriptions.push(ariaParticipant);
    context.subscriptions.push({
        dispose: () => {
            void client?.close();
        }
    });
}
function deactivate() {
    // encerramento gerenciado no dispose registrado em activate
}
function buildEndpointFromExampleStructure(project, overrides, lovs, options) {
    const projectRecord = project;
    const methodFromOverrides = Number(overrides.ID_METODO ?? 1);
    const methodMap = {
        1: 'GET',
        2: 'POST',
        3: 'PUT',
        4: 'DELETE'
    };
    // Fill common infra defaults from the project when available, then fallback to safe defaults.
    const firstEndpoint = project.REST_CUSTOM[0];
    const coSistema = Number(projectRecord.CO_SISTEMA ?? firstEndpoint?.CO_BANCO_EXTERNO ?? -1);
    const bankDefaults = resolveRequiredBankFields(projectRecord, { ...firstEndpoint, ...overrides }, lovs, { ignoreExplicitBankFields: options?.ignoreExplicitBankFields ?? false });
    // Detect variables in code (TX_CODIGO)
    const code = String(overrides.TX_CODIGO ?? '');
    const variables = [];
    // JSONPath: $.variavel ou ['variavel']
    const jsonPathRegex = /\$\.(\w+)|\['([\w_]+)'\]/g;
    let match;
    while ((match = jsonPathRegex.exec(code))) {
        const name = match[1] || match[2];
        if (name && !variables.some(v => v.name === name)) {
            variables.push({ name, origem: 1 });
        }
    }
    // Query String: :variavel ou ?variavel= ou &variavel=
    const qsRegex = /[:?&]([a-zA-Z_][\w_]*)=/g;
    while ((match = qsRegex.exec(code))) {
        const name = match[1];
        if (name && !variables.some(v => v.name === name)) {
            variables.push({ name, origem: 2 });
        }
    }
    // Monta array VARIABLE
    let variableArr = [];
    if (variables.length) {
        variableArr = variables.map((v, idx) => ({
            ID_VARIABLE: 10000 + idx, // temporÃ¡rio, backend sobrescreve
            TX_REGEX_QS: v.name,
            NO_VARIABLE: v.name,
            IN_ORIGEM_VARIABLE: v.origem,
            VARIABLE_VALOR_POSSIVEL: []
        }));
    }
    const baseStructure = {
        ID_REST_CUSTOM: 0,
        NO_REST_CUSTOM: '',
        TX_PATH: '',
        ID_TIPO_CODIGO: 1,
        NO_TIPO_CODIGO: 'SQL',
        TX_CODIGO: '',
        TX_COMENTARIOS: '',
        ID_PROJETO: project.ID_PROJETO,
        NR_VERSAO: 1,
        ID_METODO: Number.isFinite(methodFromOverrides) ? methodFromOverrides : 1,
        NO_METODO: methodMap[methodFromOverrides] ?? 'GET',
        TX_MIME_TYPE: 'application/json',
        ID_TIPO_HEADER: 1,
        NO_TIPO_HEADER: 'Automatico',
        NR_PAGE_SIZE: 1000,
        SN_PAGINADO: 'S',
        IN_MODO_SEGURANCA: 1,
        ID_BANCO_EXTERNO: bankDefaults.ID_BANCO_EXTERNO,
        CO_BANCO_EXTERNO: bankDefaults.CO_BANCO_EXTERNO,
        ID_BANCO_ESQUEMA: bankDefaults.ID_BANCO_ESQUEMA,
        NO_ESQUEMA: bankDefaults.NO_ESQUEMA,
        SN_MODO_COMPATIBILIDADE: 'N',
        SN_CACHE: 'N',
        SN_PUBLICADO: 'S',
        SN_INCLUI_COUNT: 'N',
        IN_FORMATO_SAIDA: 'json',
        TX_SEPARADOR_CSV: ',',
        SN_HABILITA_META_API: 'N',
        SN_NULOS_EXPLICITOS: 'N',
        DS_REST_CUSTOM_CURTA: '',
        SN_IGNORA_CONFIGS_DEPLOY: 'N',
        SN_APENAS_INTERNO: 'N',
        SN_EXIGE_OTP: 'N',
        SN_IDEMPOTENTE: 'N',
        IN_JANELA_TEMPO_CACHE: 'FH',
        PROJETO: [
            {
                TX_PATH: project.TX_PATH,
                CO_SISTEMA: coSistema
            }
        ],
        REST_CUSTOM_PERFIL: [],
        REST_CUSTOM_RESPONSE: [],
        REST_CUSTOM_JSON_SCHEMA: [],
        VARIABLE: variableArr,
        HEADER: [],
        REST_CUSTOM_IP: [],
        REST_CUSTOM_TIPO_OTP: [],
        REST_CUSTOM_ATRIBUTO_LOG: []
    };
    return {
        ...baseStructure,
        ...overrides,
        ID_REST_CUSTOM: 0,
        ID_PROJETO: project.ID_PROJETO,
        PROJETO: [
            {
                TX_PATH: project.TX_PATH,
                CO_SISTEMA: coSistema
            }
        ],
        NO_METODO: methodMap[Number(overrides.ID_METODO ?? methodFromOverrides)] ?? 'GET',
        VARIABLE: variableArr // garante sobrescrita
    };
}
function buildEndpointsSummary(project, currentEndpointId) {
    const lines = [
        `## Projeto: ${project.NO_PROJETO}`,
        `- **ID:** ${project.ID_PROJETO}`,
        `- **Caminho base:** ${project.TX_PATH}`,
        `- **Total de endpoints:** ${project.REST_CUSTOM.length}`,
        '',
        '### Endpoints do projeto:',
        ''
    ];
    const methodNames = { 1: 'GET', 2: 'POST', 3: 'PUT', 4: 'DELETE' };
    for (const ep of project.REST_CUSTOM) {
        const isCurrent = ep.ID_REST_CUSTOM === currentEndpointId;
        const marker = isCurrent ? ' â† **(endpoint sendo editado)**' : '';
        const method = typeof ep.ID_METODO === 'number' ? ` [${methodNames[ep.ID_METODO] ?? ep.ID_METODO}]` : '';
        lines.push(`- **[ID ${ep.ID_REST_CUSTOM}]${method} ${ep.NO_REST_CUSTOM}**${marker}`);
        lines.push(`  - Caminho: \`${ep.TX_PATH}\``);
        const desc = ep.DS_REST_CUSTOM_CURTA ?? ep.DS_REST_CUSTOM ?? ep.TX_COMENTARIOS;
        if (desc && typeof desc === 'string') {
            lines.push(`  - Descricao: ${desc}`);
        }
    }
    return lines.join('\n');
}
function buildProjectsContextJson(projects, maxProjects = 60, maxEndpointsPerProject = 80) {
    const payload = {
        generatedAt: new Date().toISOString(),
        totalProjects: projects.length,
        projects: projects.slice(0, maxProjects).map((project) => ({
            id: project.ID_PROJETO,
            name: project.NO_PROJETO,
            path: project.TX_PATH,
            endpointCount: project.REST_CUSTOM.length,
            endpoints: project.REST_CUSTOM.slice(0, maxEndpointsPerProject).map((endpoint) => ({
                id: endpoint.ID_REST_CUSTOM,
                name: endpoint.NO_REST_CUSTOM,
                path: endpoint.TX_PATH,
                methodId: toNumber(endpoint.ID_METODO),
                methodName: toStringSafe(endpoint.NO_METODO)
            }))
        }))
    };
    return JSON.stringify(payload, null, 2);
}
function buildProjectReferenceJson(project, options) {
    const includeCode = options?.includeCode !== false;
    const maxCodeChars = Math.max(200, options?.maxCodeChars ?? 6000);
    const maxEndpoints = Math.max(1, options?.maxEndpoints ?? 150);
    const restCustom = project.REST_CUSTOM.slice(0, maxEndpoints).map((endpoint) => {
        const row = endpoint;
        const payload = {
            ID_REST_CUSTOM: endpoint.ID_REST_CUSTOM,
            NO_REST_CUSTOM: endpoint.NO_REST_CUSTOM,
            TX_PATH: endpoint.TX_PATH,
            ID_METODO: toNumber(row.ID_METODO),
            NO_METODO: toStringSafe(row.NO_METODO),
            ID_TIPO_CODIGO: toNumber(row.ID_TIPO_CODIGO),
            NO_TIPO_CODIGO: toStringSafe(row.NO_TIPO_CODIGO),
            DS_REST_CUSTOM_CURTA: toStringSafe(row.DS_REST_CUSTOM_CURTA)
        };
        if (includeCode) {
            const fullCode = toStringSafe(row.TX_CODIGO);
            payload.TX_CODIGO = fullCode.length > maxCodeChars ? `${fullCode.slice(0, maxCodeChars)}\n/* ...truncado... */` : fullCode;
        }
        return payload;
    });
    return JSON.stringify({
        ID_PROJETO: project.ID_PROJETO,
        NO_PROJETO: project.NO_PROJETO,
        TX_PATH: project.TX_PATH,
        REST_CUSTOM: restCustom
    }, null, 2);
}
function buildMetadataQuery(endpoint) {
    const query = {};
    addMetadataQueryValue(query, 'p_id_banco_externo', endpoint.ID_BANCO_EXTERNO ?? endpoint.id_banco_externo);
    addMetadataQueryValue(query, 'p_id_banco_esquema', endpoint.ID_BANCO_ESQUEMA ?? endpoint.id_banco_esquema);
    addMetadataQueryValue(query, 'p_co_esquema', endpoint.CO_ESQUEMA ?? endpoint.co_esquema);
    addMetadataQueryValue(query, 'p_co_tabela', endpoint.CO_TABELA ?? endpoint.co_tabela);
    return Object.keys(query).length > 0 ? query : undefined;
}
function addMetadataQueryValue(query, key, value) {
    if (value === null || value === undefined) {
        return;
    }
    const normalized = String(value).trim();
    if (!normalized) {
        return;
    }
    query[key] = normalized;
}
function formatMetadataForEditor(response) {
    if (response === null || response === undefined) {
        return undefined;
    }
    if (typeof response === 'string') {
        const trimmed = response.trim();
        return trimmed ? trimmed : undefined;
    }
    try {
        return JSON.stringify(response, null, 2);
    }
    catch {
        return String(response);
    }
}
function buildTableListMetadata(full, schemaFilters = []) {
    const lines = full.split(/\r?\n/);
    const output = [];
    const filterSet = new Set(schemaFilters.map((item) => item.toUpperCase()));
    const useFilter = filterSet.size > 0;
    for (const line of lines) {
        if (line.startsWith('# ')) {
            if (!useFilter) {
                output.push(line);
            }
        }
        else if (line.startsWith('## ')) {
            const tableOnly = line.replace(/^(## \S+).*$/, '$1');
            const tableName = tableOnly.replace(/^##\s+/, '');
            const schemaName = tableName.includes('.') ? tableName.split('.')[0].toUpperCase() : '';
            if (!useFilter || (schemaName && filterSet.has(schemaName))) {
                output.push(tableOnly);
            }
        }
    }
    return output.join('\n');
}
function listMetadataSchemas(full) {
    const lines = full.split(/\r?\n/);
    const schemas = new Set();
    for (const line of lines) {
        if (!line.startsWith('## ')) {
            continue;
        }
        const tableOnly = line.replace(/^(## \S+).*$/, '$1').replace(/^##\s+/, '');
        const schemaName = tableOnly.includes('.') ? tableOnly.split('.')[0].toUpperCase() : '';
        if (schemaName) {
            schemas.add(schemaName);
        }
    }
    return Array.from(schemas).sort((a, b) => a.localeCompare(b));
}
function extractMetadataTableNames(full) {
    const lines = full.split(/\r?\n/);
    const tables = [];
    for (const line of lines) {
        if (!line.startsWith('## ')) {
            continue;
        }
        const tableOnly = line.replace(/^(## \S+).*$/, '$1').replace(/^##\s+/, '').trim();
        if (tableOnly) {
            tables.push(tableOnly.toUpperCase());
        }
    }
    return Array.from(new Set(tables));
}
function rankMetadataTables(tables, options) {
    const preferredSchema = toStringSafe(options?.preferredSchema).trim().toUpperCase();
    const tokens = (options?.searchTerms ?? [])
        .flatMap((term) => extractKeywordTokens(term))
        .map((item) => item.toUpperCase());
    const uniqueTokens = Array.from(new Set(tokens));
    const ranked = tables.map((table) => {
        const upper = table.toUpperCase();
        const parts = upper.split('.');
        const schema = parts.length > 1 ? parts[0] : '';
        const tableName = parts.length > 1 ? parts.slice(1).join('.') : upper;
        let score = 0;
        if (preferredSchema && schema === preferredSchema) {
            score += 1000;
        }
        for (const token of uniqueTokens) {
            if (tableName === token) {
                score += 600;
            }
            else if (tableName.includes(token)) {
                score += 120;
            }
            if (upper.includes(token)) {
                score += 40;
            }
        }
        if (preferredSchema && schema !== preferredSchema) {
            score -= 60;
        }
        return { table, score };
    });
    return ranked
        .sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.table.localeCompare(b.table);
    })
        .filter((item) => item.score > 0 || !preferredSchema);
}
function inferPreferredSchemasForMetadata(endpoint, project, allSchemas, _full) {
    if (allSchemas.length === 0) {
        return [];
    }
    if (allSchemas.length === 1) {
        return [allSchemas[0]];
    }
    const schemaSet = new Set(allSchemas.map((item) => item.toUpperCase()));
    // 1. Prioridade absoluta: NO_ESQUEMA do endpoint (campo real da API).
    const endpointSchema = toStringSafe(endpoint.NO_ESQUEMA ?? endpoint.no_esquema ?? endpoint.CO_ESQUEMA ?? endpoint.co_esquema).trim().toUpperCase();
    if (endpointSchema && schemaSet.has(endpointSchema)) {
        return [endpointSchema];
    }
    // 2. Esquemas usados por OUTROS endpoints do mesmo projeto.
    const projectSchemaFrequency = countProjectSchemas(project);
    const projectSchemas = Object.entries(projectSchemaFrequency)
        .filter(([schema]) => schemaSet.has(schema))
        .sort((a, b) => b[1] - a[1])
        .map(([schema]) => schema);
    if (projectSchemas.length > 0) {
        return projectSchemas.slice(0, 2);
    }
    // 3. Fallback: schema com mais tabelas no catálogo.
    const tableFrequency = countMetadataTablesBySchema(_full);
    let preferred = '';
    let maxCount = 0;
    for (const [schema, count] of Object.entries(tableFrequency)) {
        if (!schemaSet.has(schema)) {
            continue;
        }
        if (count > maxCount) {
            preferred = schema;
            maxCount = count;
        }
    }
    return preferred ? [preferred] : [];
}
function countProjectSchemas(project) {
    const counts = {};
    for (const endpoint of project.REST_CUSTOM || []) {
        // NO_ESQUEMA é o campo real retornado pela API (ex: "COSIS_MICRO"); CO_ESQUEMA não existe no modelo.
        const schema = toStringSafe(endpoint.NO_ESQUEMA ?? endpoint.no_esquema ?? endpoint.CO_ESQUEMA ?? endpoint.co_esquema).trim().toUpperCase();
        if (!schema) {
            continue;
        }
        counts[schema] = (counts[schema] || 0) + 1;
    }
    return counts;
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
function countMetadataTablesBySchema(full) {
    const lines = full.split(/\r?\n/);
    const counts = {};
    for (const line of lines) {
        if (!line.startsWith('## ')) {
            continue;
        }
        const tableOnly = line.replace(/^(## \S+).*$/, '$1').replace(/^##\s+/, '');
        const schemaName = tableOnly.includes('.') ? tableOnly.split('.')[0].toUpperCase() : '';
        if (!schemaName) {
            continue;
        }
        counts[schemaName] = (counts[schemaName] || 0) + 1;
    }
    return counts;
}
function parseMetadataMarkdown(markdown, filePath, key) {
    const schemaMap = new Map();
    const lines = markdown.split(/\r?\n/);
    let currentSchemaName = '';
    let currentTable;
    const getOrCreateSchema = (schemaName) => {
        const normalized = schemaName.trim().toUpperCase();
        const existing = schemaMap.get(normalized);
        if (existing) {
            return existing;
        }
        const created = { name: normalized, tables: [] };
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
            if (!rest) {
                continue;
            }
            const parts = rest.split(/\s+/);
            const tableToken = toStringSafe(parts.shift()).trim().toUpperCase();
            const comment = parts.join(' ').trim();
            if (!tableToken) {
                continue;
            }
            const schemaName = tableToken.includes('.')
                ? tableToken.split('.')[0].toUpperCase()
                : currentSchemaName;
            const tableName = tableToken.includes('.')
                ? tableToken.split('.').slice(1).join('.')
                : tableToken;
            const fullName = tableToken.includes('.')
                ? tableToken
                : (schemaName ? `${schemaName}.${tableName}` : tableName);
            const schemaNode = getOrCreateSchema(schemaName || currentSchemaName || '');
            currentTable = {
                schema: schemaNode.name,
                name: tableName,
                fullName,
                comment: comment || undefined,
                columns: [],
                foreignKeys: []
            };
            schemaNode.tables.push(currentTable);
            continue;
        }
        if (line.startsWith('- ') && currentTable) {
            const entry = line.slice(2).trim();
            if (!entry) {
                continue;
            }
            const fkMatch = entry.match(/^FK:\s*(\S+)\s*->\s*([^.\s]+)\.([^\s(]+)\(([^\s)]+)\)\s*(.*)$/i);
            if (fkMatch) {
                currentTable.foreignKeys.push({
                    column: fkMatch[1].trim().toUpperCase(),
                    targetSchema: fkMatch[2].trim().toUpperCase(),
                    targetTable: fkMatch[3].trim().toUpperCase(),
                    targetColumn: fkMatch[4].trim().toUpperCase(),
                    raw: line.trim()
                });
                continue;
            }
            const columnMatch = entry.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
            if (!columnMatch) {
                continue;
            }
            currentTable.columns.push({
                name: columnMatch[1].trim().toUpperCase(),
                type: columnMatch[2].trim(),
                comment: columnMatch[3]?.trim() || undefined,
                raw: line.trim()
            });
        }
    }
    return {
        key: key ?? filePath ?? '',
        filePath,
        markdown,
        schemas: Array.from(schemaMap.values())
    };
}
function buildProjectSchemaLockSummary(projects, prompt) {
    if (!Array.isArray(projects) || projects.length === 0) {
        return '';
    }
    const normalizedPrompt = toStringSafe(prompt).toUpperCase();
    const promptTokens = new Set(extractKeywordTokens(prompt));
    const scoredProjects = projects
        .map((project) => {
        const projectName = toStringSafe(project.NO_PROJETO).trim().toUpperCase();
        const projectPath = toStringSafe(project.TX_PATH).trim().toUpperCase();
        const nameTokens = extractKeywordTokens(project.NO_PROJETO);
        const tokenHits = nameTokens.filter((token) => promptTokens.has(token)).length;
        let score = 0;
        if (projectName && normalizedPrompt.includes(projectName)) {
            score += 100;
        }
        if (projectPath && normalizedPrompt.includes(projectPath)) {
            score += 80;
        }
        score += tokenHits * 10;
        return { project, score };
    })
        .sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return toStringSafe(a.project.NO_PROJETO).localeCompare(toStringSafe(b.project.NO_PROJETO));
    });
    const selected = scoredProjects[0];
    if (!selected || selected.score <= 0) {
        return '';
    }
    const schemaSet = new Set();
    for (const endpoint of selected.project.REST_CUSTOM ?? []) {
        const schema = toStringSafe(endpoint.NO_ESQUEMA ?? endpoint.no_esquema ?? endpoint.CO_ESQUEMA ?? endpoint.co_esquema).trim().toUpperCase();
        if (schema) {
            schemaSet.add(schema);
        }
    }
    const schemas = Array.from(schemaSet).sort((a, b) => a.localeCompare(b));
    const projectLabel = toStringSafe(selected.project.NO_PROJETO).trim() || '(sem nome)';
    const projectPath = toStringSafe(selected.project.TX_PATH).trim();
    const projectRef = projectPath ? `${projectLabel} [${projectPath}]` : projectLabel;
    if (schemas.length === 0) {
        return `SCHEMA LOCK: projeto ${projectRef} nao teve schema identificado no contexto. Nao misture schemas e pergunte se precisar decidir entre tabelas de schemas diferentes.`;
    }
    return `SCHEMA LOCK: projeto ${projectRef} -> schemas permitidos neste pedido: ${schemas.join(', ')}. Use somente tabelas desses schemas. Se uma tabela candidata estiver em outro schema, descarte-a.`;
}
function extractTableColumns(full, tableKey) {
    const lines = full.split(/\r?\n/);
    let inside = false;
    const result = [];
    for (const line of lines) {
        if (line.startsWith('## ')) {
            if (inside) {
                break;
            }
            const tableHeader = line.replace(/^(## \S+).*$/, '$1').replace(/^## /, '').toUpperCase();
            if (tableHeader === tableKey || tableHeader.endsWith('.' + tableKey)) {
                inside = true;
                result.push(line.replace(/^(## \S+).*$/, '$1'));
            }
        }
        else if (inside) {
            if (line.startsWith('# ')) {
                break;
            }
            if (line.startsWith('- ')) {
                result.push(line);
            }
        }
    }
    return result.length > 0 ? result.join('\n') : undefined;
}
function getSettings() {
    const config = vscode.workspace.getConfiguration('ariaApi');
    return {
        baseUrl: config.get('baseUrl', 'https://ms-aria.appsdev.ocp.tesouro.gov.br/'),
        fetchProjectPath: config.get('fetchProjectPath', ''),
        ignoreSslErrors: config.get('ignoreSslErrors', true)
    };
}
function getEntraSettings() {
    const config = vscode.workspace.getConfiguration('ariaApi');
    return {
        requireLogin: config.get('requireEntraLogin', true),
        allowedEmailDomains: (config.get('allowedEmailDomains', []) || [])
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
    };
}
function ensureTrailingSlash(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error('URL base da API nao informada. Configure ariaApi.baseUrl.');
    }
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
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
async function ensureEditFilePath(fileName) {
    const editDir = path.join(os.tmpdir(), 'aria-edit');
    await fs.promises.mkdir(editDir, { recursive: true });
    return path.join(editDir, fileName);
}
function mergePreservingTypes(original, updates) {
    const result = { ...original };
    for (const [key, value] of Object.entries(updates)) {
        if (!(key in original)) {
            continue;
        }
        result[key] = typeof original[key] === 'number' ? Number(value) : value;
    }
    return result;
}
function applyLovDisplayValues(payload, lovs) {
    if (!lovs) {
        return payload;
    }
    const normalized = { ...payload };
    const metodoId = toNumber(normalized.ID_METODO);
    if (metodoId > 0) {
        const metodo = lovs.METODO?.find((item) => item.ID_METODO === metodoId);
        if (metodo) {
            normalized.NO_METODO = metodo.NO_METODO;
        }
    }
    const tipoCodigoId = toNumber(normalized.ID_TIPO_CODIGO);
    if (tipoCodigoId > 0) {
        const tipoCodigo = lovs.TIPO_CODIGO?.find((item) => item.ID_TIPO_CODIGO === tipoCodigoId);
        if (tipoCodigo) {
            normalized.NO_TIPO_CODIGO = tipoCodigo.NO_TIPO_CODIGO;
        }
    }
    const tipoHeaderId = toNumber(normalized.ID_TIPO_HEADER);
    if (tipoHeaderId > 0) {
        const tipoHeader = lovs.TIPO_HEADER?.find((item) => item.ID_TIPO_HEADER === tipoHeaderId);
        if (tipoHeader) {
            normalized.NO_TIPO_HEADER = tipoHeader.NO_TIPO_HEADER;
        }
    }
    const bancoId = toNumber(normalized.ID_BANCO_EXTERNO);
    if (bancoId > 0) {
        const banco = lovs.BANCO_EXTERNO?.find((item) => item.ID_BANCO_EXTERNO === bancoId);
        if (banco) {
            normalized.CO_BANCO_EXTERNO = banco.CO_BANCO_EXTERNO;
            const schemaId = toNumber(normalized.ID_BANCO_ESQUEMA);
            if (schemaId > 0 && !banco.BANCO_ESQUEMA.some((schema) => schema.ID_BANCO_ESQUEMA === schemaId)) {
                normalized.ID_BANCO_ESQUEMA = '';
            }
        }
    }
    const instanciaId = toNumber(normalized.ID_INSTANCIA);
    if (instanciaId > 0) {
        const instancia = lovs.INSTANCIA?.find((item) => item.ID_INSTANCIA === instanciaId);
        if (instancia) {
            normalized.CO_INSTANCIA = instancia.CO_INSTANCIA;
        }
    }
    if (lovs.PERFIL?.length) {
        const profileTokens = (() => {
            const rawProfiles = normalized.TX_PERFIS;
            if (Array.isArray(rawProfiles)) {
                return rawProfiles
                    .map((item) => String(item ?? '').trim())
                    .filter((item) => item.length > 0);
            }
            const rawAsString = toStringSafe(rawProfiles);
            if (!rawAsString.trim()) {
                return [];
            }
            return parseListTokens(rawAsString);
        })();
        const selectedProfiles = lovs.PERFIL.filter((profile) => {
            const profileId = String(profile.ID_PERFIL);
            const normalizedProfileName = normalizeTextForLookup(profile.NO_PERFIL);
            return profileTokens.some((token) => {
                const normalizedToken = normalizeTextForLookup(token);
                return token === profileId || normalizedToken === normalizedProfileName;
            });
        });
        normalized.TX_PERFIS = selectedProfiles.map((profile) => profile.NO_PERFIL).join(', ');
        if ('REST_CUSTOM_PERFIL' in normalized) {
            normalized.REST_CUSTOM_PERFIL = selectedProfiles.map((profile) => ({
                ID_PERFIL: profile.ID_PERFIL,
                NO_PERFIL: profile.NO_PERFIL
            }));
        }
    }
    // Tipos de OTP (multi-select)
    if (lovs.TIPO_OTP?.length) {
        const otpTokens = (() => {
            const rawOtps = normalized.ID_TIPO_OTP;
            if (Array.isArray(rawOtps)) {
                return rawOtps
                    .map((item) => String(item ?? '').trim())
                    .filter((item) => item.length > 0);
            }
            const rawAsString = toStringSafe(rawOtps);
            if (!rawAsString.trim()) {
                return [];
            }
            return parseListTokens(rawAsString);
        })();
        const selectedOtps = lovs.TIPO_OTP.filter((otp) => {
            const otpId = String(otp.ID_TIPO_OTP);
            const normalizedOtpName = normalizeTextForLookup(otp.NO_TIPO_OTP);
            return otpTokens.some((token) => {
                const normalizedToken = normalizeTextForLookup(token);
                return token === otpId || normalizedToken === normalizedOtpName;
            });
        });
        normalized.TX_TIPO_OTP = selectedOtps.map((otp) => otp.NO_TIPO_OTP).join(', ');
        if ('REST_CUSTOM_TIPO_OTP' in normalized) {
            normalized.REST_CUSTOM_TIPO_OTP = selectedOtps.map((otp) => ({
                ID_TIPO_OTP: otp.ID_TIPO_OTP,
                NO_TIPO_OTP: otp.NO_TIPO_OTP
            }));
        }
    }
    return normalized;
}
function inferMethodId(project, requestedMethod, lovs) {
    if (typeof requestedMethod === 'number' && requestedMethod > 0) {
        return requestedMethod;
    }
    const projectMethod = project.REST_CUSTOM
        .map((endpoint) => toNumber(endpoint.ID_METODO))
        .find((id) => id > 0);
    if (projectMethod) {
        return projectMethod;
    }
    const lovMethod = lovs?.METODO?.[0]?.ID_METODO;
    if (typeof lovMethod === 'number' && lovMethod > 0) {
        return lovMethod;
    }
    return 1;
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
        .map((item) => normalizeEndpointFieldKey(item.ITEM_NAME));
    return Array.from(new Set(required));
}
function isMissingRequiredField(fieldName, value) {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === 'string') {
        return value.trim().length === 0;
    }
    if (fieldName.startsWith('ID_')) {
        return toNumber(value) <= 0;
    }
    return false;
}
function validateEndpointPayload(payload, validations) {
    if (!validations?.length) {
        return [];
    }
    const sorted = validations
        .slice()
        .sort((a, b) => {
        const regionDiff = a.REGION_SEQUENCE - b.REGION_SEQUENCE;
        if (regionDiff !== 0) {
            return regionDiff;
        }
        return a.VALIDATION_SEQUENCE - b.VALIDATION_SEQUENCE;
    });
    const errors = [];
    for (const validation of sorted) {
        if (!shouldApplyValidationCondition(validation, payload)) {
            continue;
        }
        const type = (validation.VALIDATION_TYPE || '').toLowerCase();
        const failMessage = validation.VALIDATION_FAILURE_TEXT?.trim() || `${validation.VALIDATION_NAME} invalida.`;
        if (type.includes('item\\column specified is not null')) {
            const field = normalizeEndpointFieldKey(validation.VALIDATION_EXPRESSION1 || '');
            if (field && isMissingRequiredField(field, payload[field])) {
                errors.push(failMessage);
            }
            continue;
        }
        if (type.includes('pl/sql expression')) {
            const expression = validation.VALIDATION_EXPRESSION1 || '';
            const valid = evaluateSimplePlsqlExpression(expression, payload);
            if (valid === false) {
                errors.push(failMessage);
            }
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
function shouldApplyValidationCondition(validation, payload) {
    const conditionType = (validation.CONDITION_TYPE || '').trim().toLowerCase();
    if (!conditionType) {
        return true;
    }
    if (conditionType === 'never') {
        return false;
    }
    if (conditionType.includes('value of item in expression 1 = expression 2')) {
        const leftKey = normalizeEndpointFieldKey(validation.CONDITION_EXPRESSION1 || '');
        const rightRaw = toStringSafe(validation.CONDITION_EXPRESSION2 || '').trim();
        if (!leftKey) {
            return true;
        }
        return toStringSafe(payload[leftKey]).trim() === rightRaw;
    }
    return true;
}
function evaluateSimplePlsqlExpression(expression, payload) {
    const trimmed = expression.trim();
    if (!trimmed) {
        return undefined;
    }
    const tokens = tokenizeSimplePlsqlExpression(trimmed);
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
            idx += 1;
            return payload[token.value];
        }
        if (token.type === 'number') {
            idx += 1;
            return Number(token.value);
        }
        if (token.type === 'string') {
            idx += 1;
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
        idx += 1;
        const next = tokens[idx];
        if (!next) {
            return undefined;
        }
        if (next.type === 'word' && next.value === 'is') {
            idx += 1;
            const maybeNot = tokens[idx];
            let isNot = false;
            if (maybeNot?.type === 'word' && maybeNot.value === 'not') {
                isNot = true;
                idx += 1;
            }
            const nullToken = tokens[idx];
            if (!nullToken || nullToken.type !== 'word' || nullToken.value !== 'null') {
                return undefined;
            }
            idx += 1;
            const value = payload[leftKey];
            const isNull = value === null || value === undefined || String(value).trim() === '';
            return isNot ? !isNull : isNull;
        }
        if (next.type === 'symbol' && next.value === '=') {
            idx += 1;
            const rightValue = parseValue();
            const leftValue = payload[leftKey];
            if (typeof rightValue === 'number') {
                return toNumber(leftValue) === rightValue;
            }
            return toStringSafe(leftValue).trim() === toStringSafe(rightValue).trim();
        }
        return undefined;
    };
    const parsePrimary = () => {
        const token = tokens[idx];
        if (!token) {
            return undefined;
        }
        if (token.type === 'symbol' && token.value === '(') {
            idx += 1;
            const inner = parseOr();
            if (tokens[idx]?.type === 'symbol' && tokens[idx]?.value === ')') {
                idx += 1;
            }
            return inner;
        }
        return parseComparison();
    };
    const parseAnd = () => {
        let result = parsePrimary();
        while (tokens[idx]?.type === 'word' && tokens[idx]?.value === 'and') {
            idx += 1;
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
            idx += 1;
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
function tokenizeSimplePlsqlExpression(input) {
    const tokens = [];
    let index = 0;
    while (index < input.length) {
        const current = input[index];
        if (/\s/.test(current)) {
            index += 1;
            continue;
        }
        if (current === '(' || current === ')' || current === '=') {
            tokens.push({ type: 'symbol', value: current });
            index += 1;
            continue;
        }
        if (current === ':') {
            let end = index + 1;
            while (end < input.length && /[A-Za-z0-9_]/.test(input[end])) {
                end += 1;
            }
            const raw = input.slice(index + 1, end);
            tokens.push({ type: 'item', value: normalizeEndpointFieldKey(raw) });
            index = end;
            continue;
        }
        if (current === '\'') {
            let end = index + 1;
            while (end < input.length && input[end] !== '\'') {
                end += 1;
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
                end += 1;
            }
            tokens.push({ type: 'number', value: input.slice(index, end) });
            index = end;
            continue;
        }
        if (/[A-Za-z_]/.test(current)) {
            let end = index + 1;
            while (end < input.length && /[A-Za-z_]/.test(input[end])) {
                end += 1;
            }
            tokens.push({ type: 'word', value: input.slice(index, end).toLowerCase() });
            index = end;
            continue;
        }
        return undefined;
    }
    return tokens;
}
function normalizeTextForLookup(value) {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}
function normalizeEndpointPath(value) {
    const raw = toStringSafe(value).trim();
    return raw.replace(/^\/+/, '');
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
function summarizeEndpointForLog(endpoint) {
    return {
        ID_REST_CUSTOM: toNumber(endpoint.ID_REST_CUSTOM),
        NO_REST_CUSTOM: toStringSafe(endpoint.NO_REST_CUSTOM),
        TX_PATH: toStringSafe(endpoint.TX_PATH),
        ID_TIPO_CODIGO: toNumber(endpoint.ID_TIPO_CODIGO),
        ID_METODO: toNumber(endpoint.ID_METODO),
        ID_BANCO_EXTERNO: toNumber(endpoint.ID_BANCO_EXTERNO),
        CO_BANCO_EXTERNO: toStringSafe(endpoint.CO_BANCO_EXTERNO),
        ID_BANCO_ESQUEMA: toNumber(endpoint.ID_BANCO_ESQUEMA)
    };
}
function summarizeDatasetForLog(dataset) {
    const root = asRecord(dataset);
    if (!root) {
        return dataset;
    }
    const projects = asArray(root.registros) || asArray(root.projetos);
    if (!projects) {
        return root;
    }
    return {
        totalProjects: projects.length,
        projects: projects.slice(0, 3).map((item) => {
            const project = asRecord(item) || {};
            const endpoints = asArray(project.REST_CUSTOM) || [];
            return {
                ID_PROJETO: toNumber(project.ID_PROJETO),
                NO_PROJETO: toStringSafe(project.NO_PROJETO),
                TX_PATH: toStringSafe(project.TX_PATH),
                endpointCount: endpoints.length,
                REST_CUSTOM: endpoints.slice(0, 3).map((endpoint) => summarizeEndpointForLog(asRecord(endpoint) || {}))
            };
        })
    };
}
function buildRequestBodyForLog(endpointPath, body) {
    if (endpointPath.includes('/importar-json')) {
        return summarizeDatasetForLog(body);
    }
    return body;
}
function buildLovsContextSummary(lovs, maxBanks = 8, maxSchemasPerBank = 8) {
    if (!lovs) {
        return 'LOVs: indisponíveis.';
    }
    const metodo = (lovs.METODO ?? []).map((item) => `${toStringSafe(item.NO_METODO)}(${toNumber(item.ID_METODO)})`).join(', ');
    const tipoCodigo = (lovs.TIPO_CODIGO ?? []).map((item) => `${toStringSafe(item.NO_TIPO_CODIGO)}(${toNumber(item.ID_TIPO_CODIGO)})`).join(', ');
    const tipoHeader = (lovs.TIPO_HEADER ?? []).map((item) => `${toStringSafe(item.NO_TIPO_HEADER)}(${toNumber(item.ID_TIPO_HEADER)})`).join(', ');
    const bancos = (lovs.BANCO_EXTERNO ?? []).slice(0, maxBanks).map((banco) => {
        const schemas = (banco.BANCO_ESQUEMA ?? []).slice(0, maxSchemasPerBank).map((schema) => `${schema.NO_ESQUEMA}(${schema.ID_BANCO_ESQUEMA})`).join(', ');
        return `- ${banco.CO_BANCO_EXTERNO}(${banco.ID_BANCO_EXTERNO})${schemas ? ` => ${schemas}` : ' => sem esquemas'}`;
    });
    return [
        'LOVs relevantes para montar o JSON:',
        metodo ? `- METODO: ${metodo}` : '- METODO: vazio',
        tipoCodigo ? `- TIPO_CODIGO: ${tipoCodigo}` : '- TIPO_CODIGO: vazio',
        tipoHeader ? `- TIPO_HEADER: ${tipoHeader}` : '- TIPO_HEADER: vazio',
        '- BANCO_EXTERNO:',
        ...(bancos.length ? bancos : ['- sem bancos disponíveis'])
    ].join('\n');
}
function normalizeLovsResponse(response) {
    const isLovsRecord = (value) => {
        return Boolean(value.BANCO_EXTERNO || value.METODO || value.TIPO_CODIGO || value.TIPO_HEADER || value.PERFIL || value.INSTANCIA || value.TIPO_OTP);
    };
    const root = asRecord(response);
    if (root) {
        const registros = asArray(root.registros);
        if (registros && registros.length > 0) {
            for (const item of registros) {
                const record = asRecord(item);
                if (record && isLovsRecord(record)) {
                    return record;
                }
            }
            const firstRecord = asRecord(registros[0]);
            if (firstRecord) {
                return firstRecord;
            }
        }
        if (isLovsRecord(root)) {
            return root;
        }
    }
    if (Array.isArray(response)) {
        for (const item of response) {
            const record = asRecord(item);
            if (record && isLovsRecord(record)) {
                return record;
            }
        }
        const firstRecord = asRecord(response[0]);
        if (firstRecord) {
            return firstRecord;
        }
    }
    return {};
}
function resolveRequiredBankFields(source, project, lovs, options) {
    const bancos = lovs?.BANCO_EXTERNO ?? [];
    const contextText = [
        source.NO_REST_CUSTOM,
        source.TX_PATH,
        source.CO_ESQUEMA,
        source.CO_TABELA,
        project.NO_PROJETO,
        project.TX_PATH,
        project.CO_ESQUEMA,
        project.CO_TABELA
    ].map(toStringSafe).join(' ');
    const contextTokens = extractKeywordTokens(contextText) ?? [];
    let selectedBank = bancos[0];
    let selectedSchema;
    let bestScore = -1;
    for (const bank of bancos) {
        const bankText = `${toStringSafe(bank.CO_BANCO_EXTERNO)} ${bank.BANCO_ESQUEMA.map((schema) => toStringSafe(schema.NO_ESQUEMA)).join(' ')}`;
        const bankNormalized = normalizeTextForLookup(bankText);
        let bankScore = 0;
        for (const token of contextTokens) {
            if (bankNormalized.includes(token)) {
                bankScore += 2;
            }
        }
        for (const schema of bank.BANCO_ESQUEMA) {
            const schemaNormalized = normalizeTextForLookup(schema.NO_ESQUEMA);
            let schemaScore = bankScore;
            for (const token of contextTokens) {
                if (schemaNormalized.includes(token)) {
                    schemaScore += 4;
                }
            }
            if (schemaScore > bestScore) {
                bestScore = schemaScore;
                selectedBank = bank;
                selectedSchema = schema;
            }
        }
        if (!selectedSchema && bank.BANCO_ESQUEMA.length > 0 && bankScore > bestScore) {
            bestScore = bankScore;
            selectedBank = bank;
            selectedSchema = bank.BANCO_ESQUEMA[0];
        }
    }
    if (!selectedBank && bancos.length > 0) {
        selectedBank = bancos[0];
        selectedSchema = selectedBank.BANCO_ESQUEMA[0];
    }
    const ignoreExplicitBankFields = options?.ignoreExplicitBankFields ?? false;
    const resolvedIdBancoExterno = ignoreExplicitBankFields
        ? toNumber(selectedBank?.ID_BANCO_EXTERNO)
        : toNumber(source.ID_BANCO_EXTERNO ?? project.ID_BANCO_EXTERNO ?? selectedBank?.ID_BANCO_EXTERNO);
    const resolvedCoBancoExterno = ignoreExplicitBankFields
        ? toStringSafe(selectedBank?.CO_BANCO_EXTERNO).trim()
        : toStringSafe(source.CO_BANCO_EXTERNO ?? project.CO_BANCO_EXTERNO ?? selectedBank?.CO_BANCO_EXTERNO).trim();
    const resolvedIdBancoEsquema = ignoreExplicitBankFields
        ? toNumber(selectedSchema?.ID_BANCO_ESQUEMA)
        : toNumber(source.ID_BANCO_ESQUEMA ?? project.ID_BANCO_ESQUEMA ?? selectedSchema?.ID_BANCO_ESQUEMA);
    const resolvedNoEsquema = ignoreExplicitBankFields
        ? toStringSafe(selectedSchema?.NO_ESQUEMA).trim()
        : toStringSafe(source.NO_ESQUEMA ?? project.NO_ESQUEMA ?? selectedSchema?.NO_ESQUEMA).trim();
    const missing = [];
    if (!(resolvedIdBancoExterno > 0)) {
        missing.push('ID_BANCO_EXTERNO');
    }
    if (!resolvedCoBancoExterno) {
        missing.push('CO_BANCO_EXTERNO');
    }
    if (!(resolvedIdBancoEsquema > 0)) {
        missing.push('ID_BANCO_ESQUEMA');
    }
    if (!resolvedNoEsquema) {
        missing.push('NO_ESQUEMA');
    }
    return {
        ID_BANCO_EXTERNO: resolvedIdBancoExterno > 0 ? resolvedIdBancoExterno : 0,
        CO_BANCO_EXTERNO: resolvedCoBancoExterno,
        ID_BANCO_ESQUEMA: resolvedIdBancoEsquema > 0 ? resolvedIdBancoEsquema : 0,
        NO_ESQUEMA: resolvedNoEsquema,
        missing
    };
}
function validateRequiredBankFields(values) {
    const missing = [];
    if (!(toNumber(values.ID_BANCO_EXTERNO) > 0)) {
        missing.push('ID_BANCO_EXTERNO');
    }
    if (!toStringSafe(values.CO_BANCO_EXTERNO).trim()) {
        missing.push('CO_BANCO_EXTERNO');
    }
    if (!(toNumber(values.ID_BANCO_ESQUEMA) > 0)) {
        missing.push('ID_BANCO_ESQUEMA');
    }
    return missing;
}
function resolveProjectFromInput(projects, input, markerProjectId) {
    if (typeof input.projectId === 'number') {
        const byId = projects.find((p) => p.ID_PROJETO === input.projectId);
        if (!byId) {
            const ids = projects.map((p) => `${p.ID_PROJETO} (${p.NO_PROJETO})`).join(', ');
            return { error: `Projeto ID ${input.projectId} nao encontrado. Projetos carregados: ${ids}` };
        }
        return { project: byId };
    }
    const rawName = input.projectName?.trim();
    if (rawName) {
        const normalizedName = normalizeTextForLookup(rawName);
        const exactMatches = projects.filter((p) => normalizeTextForLookup(p.NO_PROJETO) === normalizedName);
        if (exactMatches.length === 1) {
            return { project: exactMatches[0] };
        }
        if (exactMatches.length > 1) {
            const names = exactMatches.map((p) => `${p.ID_PROJETO} (${p.NO_PROJETO})`).join(', ');
            return { error: `Nome de projeto ambiguo "${rawName}". Matches: ${names}` };
        }
        const containsMatches = projects.filter((p) => normalizeTextForLookup(p.NO_PROJETO).includes(normalizedName));
        if (containsMatches.length === 1) {
            return { project: containsMatches[0] };
        }
        if (containsMatches.length > 1) {
            const names = containsMatches.map((p) => `${p.ID_PROJETO} (${p.NO_PROJETO})`).join(', ');
            return { error: `Nome de projeto ambiguo "${rawName}". Matches: ${names}` };
        }
        return { error: `Projeto "${rawName}" nao encontrado na arvore de projetos.` };
    }
    if (typeof markerProjectId === 'number') {
        const byMarker = projects.find((p) => p.ID_PROJETO === markerProjectId);
        if (byMarker) {
            return { project: byMarker };
        }
    }
    if (projects.length === 1) {
        return { project: projects[0] };
    }
    return {
        error: 'Informe projectId ou projectName para identificar o projeto alvo.'
    };
}
function resolveEndpointCodeExtension(endpoint) {
    const tipoCodigo = endpoint.ID_TIPO_CODIGO;
    if (typeof tipoCodigo === 'number' && tipoCodigo === 3) {
        return 'py';
    }
    const pythonLikeValues = [
        endpoint.IN_TIPO_CODIGO,
        endpoint.NO_TIPO_CODIGO,
        endpoint.DS_TIPO_CODIGO,
        endpoint.TX_TIPO_CODIGO,
        endpoint.ID_TIPO_CODIGO
    ];
    for (const value of pythonLikeValues) {
        if (value === null || value === undefined) {
            continue;
        }
        const normalized = String(value).toLowerCase();
        if (normalized.includes('python') || normalized.includes('jython')) {
            return 'py';
        }
    }
    const code = String(endpoint.TX_CODIGO ?? '').trim().toLowerCase();
    if (code.startsWith('#!') || code.startsWith('import ') || code.startsWith('from ') || code.startsWith('def ') || code.startsWith('class ')) {
        return 'py';
    }
    return 'sql';
}
function escHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function prettifyLabel(key) {
    const explicitLabels = {
        ID_PROJETO: 'ID do Projeto',
        ID_REST_CUSTOM: 'ID do Endpoint',
        NO_PROJETO: 'Nome do Projeto',
        NO_REST_CUSTOM: 'Nome do Endpoint',
        TX_PATH: 'Caminho',
        DS_REST_CUSTOM_CURTA: 'Descricao curta',
        ID_BANCO_EXTERNO: 'Banco de Dados',
        ID_BANCO_ESQUEMA: 'Esquema',
        ID_TIPO_CODIGO: 'Linguagem',
        ID_METODO: 'Metodo',
        NR_VERSAO: 'Versao',
        IN_TIPO_TRANSFORMACAO: 'Transformacao dos nomes dos campos',
        IN_FORMATO_SAIDA: 'Formato de Saida',
        TX_SEPARADOR_CSV: 'Separador CSV',
        ID_TIPO_HEADER: 'Tipo do Header',
        TX_MIME_TYPE: 'Mime-Type Header',
        SN_PAGINADO: 'Possui paginacao?',
        NR_PAGE_SIZE: 'Tamanho da pagina',
        SN_INCLUI_COUNT: 'Incluir count na resposta',
        SN_NULOS_EXPLICITOS: 'Comportamento dos valores nulos',
        IN_MODO_SEGURANCA: 'Seguranca do Endpoint',
        TX_PERFIS: 'Perfis',
        SN_EXIGE_OTP: 'Exige OTP',
        ID_TIPO_OTP: 'Tipos de OTP aceitos',
        TX_URL: 'URL',
        SN_APENAS_INTERNO: 'Apenas interno',
        TX_CODIGO_EMBED: 'Codigo Embed',
        TX_IPS: 'Restringir aos IPs',
        SN_MODO_COMPATIBILIDADE: 'Modo de compatibilidade com Aria 1.0',
        SN_IGNORA_CONFIGS_DEPLOY: 'Ignora configuracoes de deploy',
        SN_PUBLICADO: 'Publicado na documentacao',
        SN_HABILITA_META_API: 'Habilitado na Meta-API',
        TX_SECRET_META_API: 'Secret da Meta-API',
        TX_CODIGO: 'Codigo do Endpoint',
        TX_COMENTARIOS: 'Comentarios',
        SN_SCRIPT_CUSTOM: 'Incluir JS custom no embed',
        TX_SCRIPT_CUSTOM: 'Script custom',
        SN_IDEMPOTENTE: 'Permite Idempotencia',
        SN_CACHE: 'Utiliza Cache',
        NR_TEMPO_CACHE: 'Tempo de cache',
        IN_TEMPO_CACHE: 'Unidade do cache',
        IN_JANELA_TEMPO_CACHE: 'Janela de expiracao',
        DT_EXP_CACHE: 'Momento de expiracao'
    };
    if (explicitLabels[key]) {
        return explicitLabels[key];
    }
    return key
        .replace(/^(ID|NO|TX|DS|IN|NR|SN)_/, '')
        .split('_')
        .filter(Boolean)
        .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
        .join(' ');
}
function getFieldSection(key) {
    if (/^ID_/.test(key)) {
        return 'metadata';
    }
    if ([
        'NO_PROJETO',
        'NO_REST_CUSTOM',
        'TX_PATH',
        'DS_REST_CUSTOM_CURTA',
        'ID_BANCO_EXTERNO',
        'ID_BANCO_ESQUEMA',
        'ID_TIPO_CODIGO',
        'ID_METODO',
        'NR_VERSAO'
    ].includes(key)) {
        return 'basic';
    }
    if ([
        'IN_TIPO_TRANSFORMACAO',
        'IN_FORMATO_SAIDA',
        'TX_SEPARADOR_CSV',
        'ID_TIPO_HEADER',
        'TX_MIME_TYPE',
        'SN_PAGINADO',
        'NR_PAGE_SIZE',
        'SN_INCLUI_COUNT',
        'SN_NULOS_EXPLICITOS',
        'TX_CODIGO'
    ].includes(key)) {
        return 'behavior';
    }
    if ([
        'IN_MODO_SEGURANCA',
        'TX_PERFIS',
        'SN_EXIGE_OTP',
        'ID_TIPO_OTP',
        'TX_URL',
        'SN_APENAS_INTERNO',
        'TX_CODIGO_EMBED',
        'TX_IPS',
        'SN_PUBLICADO',
        'SN_HABILITA_META_API',
        'TX_SECRET_META_API',
        'SN_MODO_COMPATIBILIDADE',
        'SN_IGNORA_CONFIGS_DEPLOY'
    ].includes(key)) {
        return 'security';
    }
    if ([
        'SN_IDEMPOTENTE',
        'SN_CACHE',
        'NR_TEMPO_CACHE',
        'IN_TEMPO_CACHE',
        'IN_JANELA_TEMPO_CACHE',
        'DT_EXP_CACHE'
    ].includes(key)) {
        return 'cache';
    }
    return 'advanced';
}
function getFieldOptions(key) {
    const options = {
        ID_METODO: [
            { value: '1', label: 'GET' },
            { value: '2', label: 'POST' },
            { value: '3', label: 'PUT' },
            { value: '4', label: 'DELETE' }
        ],
        ID_TIPO_CODIGO: [
            { value: '1', label: 'SQL' },
            { value: '2', label: 'PL/SQL' },
            { value: '3', label: 'Python' }
        ],
        IN_TIPO_TRANSFORMACAO: [
            { value: '', label: 'Sem transformacao' },
            { value: '1', label: 'LETRAS MAIUSCULAS' },
            { value: '2', label: 'letras minusculas' },
            { value: '3', label: 'camelCase' }
        ],
        IN_FORMATO_SAIDA: [
            { value: '', label: 'Selecione' },
            { value: 'json', label: 'JSON' },
            { value: 'csv', label: 'CSV' }
        ],
        ID_TIPO_HEADER: [
            { value: '1', label: 'Automatico' },
            { value: '2', label: 'Manual' }
        ],
        SN_NULOS_EXPLICITOS: [
            { value: 'S', label: 'Aparecem explicitamente no JSON' },
            { value: 'N', label: 'Nao aparecem no JSON' }
        ],
        IN_MODO_SEGURANCA: [
            { value: '', label: 'Selecione' },
            { value: '1', label: 'Publico' },
            { value: '2', label: 'Privado (Usuario, Senha e Token)' },
            { value: '3', label: 'Privado (Token)' }
        ],
        IN_TEMPO_CACHE: [
            { value: '', label: 'Selecione' },
            { value: 'S', label: 'Segundos' },
            { value: 'M', label: 'Minutos' },
            { value: 'H', label: 'Horas' }
        ],
        IN_JANELA_TEMPO_CACHE: [
            { value: '', label: 'Selecione' },
            { value: 'FS', label: 'Ate o fim do segundo' },
            { value: 'FM', label: 'Ate o fim do minuto' },
            { value: 'FH', label: 'Ate o fim da hora' },
            { value: 'FD', label: 'Ate o fim do dia' }
        ]
    };
    return options[key];
}
function buildLovOptions(key, lovs) {
    if (!lovs) {
        return undefined;
    }
    if (key === 'ID_METODO' && lovs.METODO?.length) {
        return lovs.METODO.map((e) => ({ value: String(e.ID_METODO), label: e.NO_METODO }));
    }
    if (key === 'ID_TIPO_CODIGO' && lovs.TIPO_CODIGO?.length) {
        return lovs.TIPO_CODIGO.map((e) => ({ value: String(e.ID_TIPO_CODIGO), label: e.NO_TIPO_CODIGO }));
    }
    if (key === 'ID_TIPO_HEADER' && lovs.TIPO_HEADER?.length) {
        return lovs.TIPO_HEADER.map((e) => ({ value: String(e.ID_TIPO_HEADER), label: e.NO_TIPO_HEADER }));
    }
    if (key === 'ID_BANCO_EXTERNO' && lovs.BANCO_EXTERNO?.length) {
        return lovs.BANCO_EXTERNO.map((e) => ({ value: String(e.ID_BANCO_EXTERNO), label: e.CO_BANCO_EXTERNO }));
    }
    if (key === 'ID_INSTANCIA' && lovs.INSTANCIA?.length) {
        return lovs.INSTANCIA.map((e) => ({ value: String(e.ID_INSTANCIA), label: e.CO_INSTANCIA }));
    }
    return undefined;
}
function parseListTokens(value) {
    return value
        .split(/[\n,;]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}
function getSectionMeta(section) {
    const sections = {
        basic: {
            title: 'Infos basicas',
            description: 'Campos principais do endpoint ou projeto, organizados como uma ficha de cadastro.'
        },
        behavior: {
            title: 'Comportamento e saida',
            description: 'Defina formato, paginacao, tratamento de nulos e o codigo principal.'
        },
        security: {
            title: 'Seguranca e publicacao',
            description: 'Configure acesso, publicacao, compatibilidade e dados complementares.'
        },
        cache: {
            title: 'Cache e idempotencia',
            description: 'Controles operacionais para cache e requisicoes idempotentes.'
        },
        advanced: {
            title: 'Configuracoes avancadas',
            description: 'Campos menos frequentes que ainda precisam ficar editaveis.'
        },
        metadata: {
            title: 'Metadados tecnicos',
            description: 'Identificadores do registro mantidos para referencia e consistencia do save.'
        }
    };
    return sections[section];
}
function normalizeEndpointFieldKey(itemName) {
    return itemName.replace(/^P\d+_/, '').trim().toUpperCase();
}
function buildEndpointFieldMeta(items) {
    const sorted = items
        .filter((item) => item.ITEM_NAME && item.ITEM_NAME.trim().length > 0)
        .slice()
        .sort((a, b) => {
        const regionDiff = (a.REGION_SEQUENCE ?? 0) - (b.REGION_SEQUENCE ?? 0);
        if (regionDiff !== 0) {
            return regionDiff;
        }
        const itemDiff = (a.ITEM_SEQUENCE ?? 0) - (b.ITEM_SEQUENCE ?? 0);
        if (itemDiff !== 0) {
            return itemDiff;
        }
        return a.ITEM_NAME.localeCompare(b.ITEM_NAME);
    });
    const map = new Map();
    for (const item of sorted) {
        const key = normalizeEndpointFieldKey(item.ITEM_NAME);
        if (!key || map.has(key)) {
            continue;
        }
        const displayAs = String(item.DISPLAY_AS || '').trim();
        const required = String(item.IS_REQUIRED || '').trim().toLowerCase() === 'yes';
        map.set(key, {
            key,
            label: item.LABEL?.trim() || undefined,
            required,
            displayAs,
            region: item.REGION?.trim() || 'Outros',
            itemSequence: item.ITEM_SEQUENCE ?? 0,
            regionSequence: item.REGION_SEQUENCE ?? 0,
            hidden: displayAs.toLowerCase() === 'hidden',
            displayOnly: displayAs.toLowerCase() === 'display only'
        });
    }
    return map;
}
function resolveFieldInputType(displayAs) {
    const normalized = displayAs.toLowerCase();
    if (normalized.includes('number')) {
        return 'number';
    }
    if (normalized.includes('date')) {
        return 'date';
    }
    return 'text';
}
function shouldRenderTextarea(displayAs) {
    const normalized = displayAs.toLowerCase();
    return normalized.includes('tinymce') || normalized.includes('textarea');
}
function buildFormHtml(title, data, excludeKeys, options) {
    const endpointMeta = options?.endpointItems?.length ? buildEndpointFieldMeta(options.endpointItems) : undefined;
    const scalarEntries = new Map(Object.entries(data).filter(([_, value]) => typeof value !== 'object' || value === null));
    const visibleEntries = endpointMeta
        ? Array.from(endpointMeta.values())
            .filter((meta) => !meta.hidden && !excludeKeys.includes(meta.key))
            .sort((a, b) => {
            const regionDiff = a.regionSequence - b.regionSequence;
            if (regionDiff !== 0) {
                return regionDiff;
            }
            const itemDiff = a.itemSequence - b.itemSequence;
            if (itemDiff !== 0) {
                return itemDiff;
            }
            return a.key.localeCompare(b.key);
        })
            .map((meta) => [meta.key, scalarEntries.get(meta.key)])
        : Object.entries(data)
            .filter(([key, value]) => !excludeKeys.includes(key) && (typeof value !== 'object' || value === null));
    const summaryItems = visibleEntries
        .filter(([key]) => ['NO_PROJETO', 'NO_REST_CUSTOM', 'TX_PATH', 'ID_PROJETO', 'ID_REST_CUSTOM'].includes(key))
        .map(([key, value]) => `
      <div class="summary-chip">
        <span class="summary-chip-label">${escHtml(prettifyLabel(key))}</span>
        <strong>${escHtml(value === null || value === undefined ? '-' : String(value))}</strong>
      </div>`)
        .join('');
    const sectionOrder = endpointMeta
        ? (() => {
            const regionSeqMap = new Map();
            for (const item of endpointMeta.values()) {
                if (!item.hidden && !regionSeqMap.has(item.region)) {
                    regionSeqMap.set(item.region, item.regionSequence);
                }
            }
            return Array.from(regionSeqMap.entries())
                .sort((a, b) => {
                const diff = a[1] - b[1];
                return diff !== 0 ? diff : a[0].localeCompare(b[0]);
            })
                .map(([region]) => region);
        })()
        : ['basic', 'behavior', 'security', 'cache', 'advanced', 'metadata'];
    const sectionFields = new Map();
    for (const section of sectionOrder) {
        sectionFields.set(section, []);
    }
    for (const [key, value] of visibleEntries) {
        const meta = endpointMeta?.get(key.toUpperCase());
        const strVal = value === null || value === undefined ? '' : String(value);
        const label = meta?.label || prettifyLabel(key);
        const fieldOptions = buildLovOptions(key, options?.lovs) ?? getFieldOptions(key);
        const profileOptions = key === 'TX_PERFIS' && options?.lovs?.PERFIL?.length
            ? options.lovs.PERFIL.map((profile) => ({ value: String(profile.ID_PERFIL), label: profile.NO_PERFIL }))
            : undefined;
        const selectedProfileIds = (() => {
            if (!profileOptions?.length) {
                return new Set();
            }
            const normalizedValue = value;
            const rawTokens = Array.isArray(normalizedValue)
                ? normalizedValue.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
                : parseListTokens(strVal);
            if (rawTokens.length === 0) {
                return new Set();
            }
            const selected = new Set();
            for (const profile of options?.lovs?.PERFIL ?? []) {
                const profileId = String(profile.ID_PERFIL);
                const profileName = normalizeTextForLookup(profile.NO_PERFIL);
                const matches = rawTokens.some((token) => {
                    const normalizedToken = normalizeTextForLookup(token);
                    return token === profileId || normalizedToken === profileName;
                });
                if (matches) {
                    selected.add(profileId);
                }
            }
            return selected;
        })();
        const isBancoEsquema = key === 'ID_BANCO_ESQUEMA' && Boolean(options?.lovs?.BANCO_EXTERNO?.length);
        const hasLovOptions = Boolean(fieldOptions) || isBancoEsquema;
        const isBoolean = meta
            ? meta.displayAs.toLowerCase().includes('checkbox') || ((strVal === 'S' || strVal === 'N') && /^SN_/.test(key))
            : /^SN_/.test(key) && (strVal === 'S' || strVal === 'N');
        const isReadonly = Boolean(meta?.displayOnly) || ((/^ID_/.test(key) || key === 'TX_URL') && !hasLovOptions);
        const isCode = key === 'TX_CODIGO' || key === 'TX_SCRIPT_CUSTOM';
        const isLong = isCode || shouldRenderTextarea(meta?.displayAs || '') || strVal.length > 120 || /^DS_|^TX_COMENTARIOS|^TX_PERFIS|^TX_IPS|^TX_SECRET_META_API/.test(key);
        const section = meta?.region || getFieldSection(key);
        const requiredAttr = meta?.required && !isReadonly && !isBoolean ? ' required' : '';
        const renderedLabel = meta?.required ? `${label} *` : label;
        const inputType = resolveFieldInputType(meta?.displayAs || '');
        let control = '';
        if (isBoolean) {
            const checked = strVal === 'S' ? ' checked' : '';
            control = `
        <input type="hidden" name="${escHtml(key)}" value="N" />
        <label class="toggle" for="${escHtml(key)}">
          <input id="${escHtml(key)}" name="${escHtml(key)}" type="checkbox" value="S"${checked} />
          <span class="toggle-track" aria-hidden="true"></span>
          <span class="toggle-text">${escHtml(renderedLabel)}</span>
        </label>`;
        }
        else if (profileOptions) {
            const renderedOptions = profileOptions
                .map((option) => {
                const selected = selectedProfileIds.has(option.value) ? ' selected' : '';
                return `<option value="${escHtml(option.value)}"${selected}>${escHtml(option.label)}</option>`;
            })
                .join('');
            control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <input type="hidden" name="${escHtml(key)}" value="" />
        <select id="${escHtml(key)}" name="${escHtml(key)}" multiple size="6">${renderedOptions}</select>`;
        }
        else if (key === 'ID_TIPO_OTP' && options?.lovs?.TIPO_OTP?.length) {
            const otpOptions = options.lovs.TIPO_OTP.map((otp) => ({ value: String(otp.ID_TIPO_OTP), label: otp.NO_TIPO_OTP }));
            const normalizedValue = value;
            const rawTokens = Array.isArray(normalizedValue)
                ? normalizedValue.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
                : parseListTokens(strVal);
            const selectedOtpIds = (() => {
                if (!otpOptions.length)
                    return new Set();
                if (rawTokens.length === 0)
                    return new Set();
                const selected = new Set();
                for (const otp of options.lovs.TIPO_OTP) {
                    const otpId = String(otp.ID_TIPO_OTP);
                    const otpName = normalizeTextForLookup(otp.NO_TIPO_OTP);
                    const matches = rawTokens.some((token) => {
                        const normalizedToken = normalizeTextForLookup(token);
                        return token === otpId || normalizedToken === otpName;
                    });
                    if (matches)
                        selected.add(otpId);
                }
                return selected;
            })();
            const renderedOptions = otpOptions
                .map((option) => {
                const selected = selectedOtpIds.has(option.value) ? ' selected' : '';
                return `<option value="${escHtml(option.value)}"${selected}>${escHtml(option.label)}</option>`;
            })
                .join('');
            control = `
          <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
          <input type="hidden" name="${escHtml(key)}" value="" />
          <select id="${escHtml(key)}" name="${escHtml(key)}" multiple size="6">${renderedOptions}</select>`;
        }
        else if (fieldOptions) {
            const renderedOptions = fieldOptions
                .map((option) => {
                const selected = option.value === strVal ? ' selected' : '';
                return `<option value="${escHtml(option.value)}"${selected}>${escHtml(option.label)}</option>`;
            })
                .join('');
            const onChangeCascade = key === 'ID_BANCO_EXTERNO' ? ' onchange="ariaUpdateBancoEsquema(this.value)"' : '';
            control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <select id="${escHtml(key)}" name="${escHtml(key)}"${requiredAttr}${onChangeCascade}>${renderedOptions}</select>`;
        }
        else if (isBancoEsquema) {
            const currentBancoId = String(data['ID_BANCO_EXTERNO'] ?? '');
            const bancosData = options?.lovs?.BANCO_EXTERNO ?? [];
            const currentBanco = bancosData.find((b) => String(b.ID_BANCO_EXTERNO) === currentBancoId);
            const schemas = currentBanco?.BANCO_ESQUEMA ?? [];
            const renderedOptions = [
                '<option value="">Selecione</option>',
                ...schemas.map((s) => {
                    const selected = String(s.ID_BANCO_ESQUEMA) === strVal ? ' selected' : '';
                    return `<option value="${escHtml(String(s.ID_BANCO_ESQUEMA))}"${selected}>${escHtml(s.NO_ESQUEMA)}</option>`;
                })
            ].join('');
            control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <select id="${escHtml(key)}" name="${escHtml(key)}" data-cascades-from="ID_BANCO_EXTERNO"${requiredAttr}>${renderedOptions}</select>`;
        }
        else if (isCode) {
            control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <textarea id="${escHtml(key)}" name="${escHtml(key)}" class="code-area" rows="18"${requiredAttr}>${escHtml(strVal)}</textarea>`;
        }
        else if (isLong) {
            control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <textarea id="${escHtml(key)}" name="${escHtml(key)}" rows="5"${isReadonly ? ' readonly' : ''}${requiredAttr}>${escHtml(strVal)}</textarea>`;
        }
        else {
            control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <input id="${escHtml(key)}" name="${escHtml(key)}" type="${inputType}" value="${escHtml(strVal)}"${isReadonly ? ' readonly' : ''}${requiredAttr} />`;
        }
        const widthClass = isCode || key === 'TX_URL' || key === 'TX_COMENTARIOS' ? 'field span-2' : 'field';
        sectionFields.get(section).push(`<div class="${widthClass}">${control}</div>`);
    }
    const renderedSections = sectionOrder
        .map((section) => {
        const content = sectionFields.get(section);
        if (content.length === 0) {
            return '';
        }
        const meta = endpointMeta
            ? {
                title: section,
                description: 'Agrupamento conforme metadata da tela APEX do endpoint.'
            }
            : getSectionMeta(section);
        return `
        <section class="panel-card">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Formulario JSON</p>
              <h3>${escHtml(meta.title)}</h3>
            </div>
            <p>${escHtml(meta.description)}</p>
          </div>
          <div class="fields-grid">
            ${content.join('\n')}
          </div>
        </section>`;
    })
        .join('\n');
    const bancoExternoJson = options?.lovs?.BANCO_EXTERNO?.length
        ? JSON.stringify(options.lovs.BANCO_EXTERNO)
        : undefined;
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${escHtml(title)}</title>
<style>
  :root {
    --panel-bg: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    --panel-border: var(--vscode-panel-border, #444);
    --muted: var(--vscode-descriptionForeground, var(--vscode-input-placeholderForeground));
    --accent: var(--vscode-button-background);
    --accent-strong: var(--vscode-button-hoverBackground);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: linear-gradient(180deg, var(--vscode-sideBar-background, var(--vscode-editor-background)) 0%, var(--vscode-editor-background) 100%);
  }
  .shell {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
  }
  .hero {
    display: grid;
    gap: 16px;
    padding: 22px;
    border: 1px solid var(--panel-border);
    border-radius: 18px;
    background: linear-gradient(135deg, var(--panel-bg) 0%, var(--vscode-editor-background) 100%);
    box-shadow: 0 18px 36px rgba(0, 0, 0, 0.12);
    margin-bottom: 20px;
  }
  .hero-top {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: start;
  }
  .hero h1 {
    margin: 6px 0 0;
    font-size: 1.5em;
    line-height: 1.2;
  }
  .hero p {
    margin: 0;
    color: var(--muted);
    max-width: 72ch;
  }
  .eyebrow {
    margin: 0;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.78em;
    color: var(--muted);
  }
  .summary-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 10px;
  }
  .summary-chip {
    padding: 12px 14px;
    border: 1px solid var(--panel-border);
    border-radius: 14px;
    background: var(--vscode-input-background);
  }
  .summary-chip-label {
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  form {
    display: grid;
    gap: 18px;
  }
  .panel-card {
    border: 1px solid var(--panel-border);
    border-radius: 18px;
    background: var(--panel-bg);
    overflow: hidden;
  }
  .panel-head {
    display: flex;
    justify-content: space-between;
    gap: 18px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--panel-border);
  }
  .panel-head h3 {
    margin: 6px 0 0;
    font-size: 1.08em;
  }
  .panel-head p:last-child {
    margin: 0;
    max-width: 48ch;
    color: var(--muted);
    font-size: 0.95em;
  }
  .fields-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    padding: 20px;
  }
  .field { min-width: 0; }
  .span-2 { grid-column: span 2; }
  label {
    display: block;
    font-size: 0.8em;
    font-weight: 700;
    margin-bottom: 6px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  input[type="text"], textarea, select {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 12px;
    padding: 10px 12px;
    font-family: inherit;
    font-size: inherit;
    outline: none;
  }
  select[multiple] {
    min-height: 140px;
  }
  input[type="text"]:focus, textarea:focus, select:focus {
    border-color: var(--vscode-focusBorder);
  }
  textarea { resize: vertical; min-height: 120px; }
  .code-area {
    min-height: 320px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    line-height: 1.5;
  }
  input[readonly], textarea[readonly] {
    opacity: 0.72;
    cursor: default;
  }
  .toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 12px;
    background: var(--vscode-input-background);
    cursor: pointer;
  }
  .toggle input[type="checkbox"] {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .toggle-track {
    position: relative;
    width: 42px;
    height: 24px;
    border-radius: 999px;
    background: var(--vscode-input-placeholderForeground);
    opacity: 0.45;
    transition: background 0.16s ease, opacity 0.16s ease;
    flex: 0 0 auto;
  }
  .toggle-track::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: white;
    transition: transform 0.16s ease;
  }
  .toggle input:checked + .toggle-track {
    background: var(--accent);
    opacity: 1;
  }
  .toggle input:checked + .toggle-track::after {
    transform: translateX(18px);
  }
  .toggle-text {
    font-size: 0.98em;
    font-weight: 600;
    color: var(--vscode-foreground);
    text-transform: none;
    letter-spacing: normal;
  }
  .actions {
    position: sticky;
    bottom: 0;
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border: 1px solid var(--panel-border);
    border-radius: 16px;
    background: var(--panel-bg);
  }
  .actions-copy {
    color: var(--muted);
    font-size: 0.92em;
  }
  .actions-main {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  button {
    padding: 10px 18px;
    background: var(--accent);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 999px;
    cursor: pointer;
    font-size: inherit;
    font-family: inherit;
    font-weight: 700;
  }
  button:hover { background: var(--accent-strong); }
  .status { font-size: 0.92em; min-height: 1.3em; }
  .status.ok { color: var(--vscode-testing-iconPassed, #73c991); }
  .status.err { color: var(--vscode-errorForeground, #f48771); }
  @media (max-width: 900px) {
    .hero-top, .panel-head, .actions { flex-direction: column; align-items: stretch; }
    .fields-grid { grid-template-columns: 1fr; }
    .span-2 { grid-column: auto; }
  }
</style>
</head>
<body>
<div class="shell">
  <form id="form">
    <section class="hero">
      <div class="hero-top">
        <div>
          <p class="eyebrow">Editor visual do JSON</p>
          <h1>${escHtml(title)}</h1>
        </div>
        <p>${endpointMeta ? 'Campos e obrigatoriedade carregados dinamicamente do endpoint items-apex-endpoint.' : 'Os campos foram reorganizados em secoes para ficar mais proximo da experiencia de cadastro do APEX, sem alterar o formato salvo pela API.'}</p>
      </div>
      <div class="summary-grid">${summaryItems}</div>
    </section>
    ${renderedSections}
    <div class="actions">
      <div class="actions-copy">Revise os grupos abaixo e salve quando terminar. O payload enviado continua compativel com o importa_json.</div>
      <div class="actions-main">
        <span class="status" id="status"></span>
        <button type="button" id="validateBtn">Validar CÃ³digo</button>
        <button type="submit">Salvar via API</button>
      </div>
    </div>
  </form>
</div>
<script>
const vscode = acquireVsCodeApi();
const form = document.getElementById('form');
const status = document.getElementById('status');

${bancoExternoJson ? `
var ariaBancoExternoData = ${bancoExternoJson};
function ariaUpdateBancoEsquema(bancoId) {
  var sel = document.getElementById('ID_BANCO_ESQUEMA');
  if (!sel) { return; }
  var currentVal = sel.value;
  sel.innerHTML = '<option value="">Selecione</option>';
  var banco = ariaBancoExternoData.find(function(b) { return String(b.ID_BANCO_EXTERNO) === String(bancoId); });
  if (banco && banco.BANCO_ESQUEMA) {
    banco.BANCO_ESQUEMA.forEach(function(s) {
      var opt = document.createElement('option');
      opt.value = String(s.ID_BANCO_ESQUEMA);
      opt.textContent = s.NO_ESQUEMA;
      if (String(s.ID_BANCO_ESQUEMA) === currentVal) { opt.selected = true; }
      sel.appendChild(opt);
    });
  }
}
` : 'function ariaUpdateBancoEsquema() {}'}


function collectFormData() {
  const data = {};
  new FormData(form).forEach(function(v, k) {
    if (data[k] === undefined) {
      data[k] = v;
      return;
    }
    if (Array.isArray(data[k])) {
      data[k].push(v);
      return;
    }
    data[k] = [data[k], v];
  });
  return data;
}

form.addEventListener('submit', function(e) {
  e.preventDefault();
  const data = collectFormData();
  vscode.postMessage({ command: 'save', data: data });
  status.textContent = 'Salvando...';
  status.className = 'status';
});

document.getElementById('validateBtn').addEventListener('click', function() {
  const data = collectFormData();
  vscode.postMessage({ command: 'validate', data: data });
  status.textContent = 'Validando...';
  status.className = 'status';
});

window.addEventListener('message', function(event) {
  const msg = event.data;
  if (msg.type === 'saving') {
    status.textContent = 'Salvando via API...';
    status.className = 'status';
  } else if (msg.type === 'saved') {
    status.textContent = 'Salvo com sucesso!';
    status.className = 'status ok';
  } else if (msg.type === 'error') {
    status.textContent = 'Erro: ' + msg.message;
    status.className = 'status err';
  } else if (msg.type === 'validate-result') {
    if (msg.status === 'sucesso') {
      status.textContent = 'CÃ³digo vÃ¡lido: ' + (msg.mensagem || '');
      status.className = 'status ok';
    } else {
      status.textContent = 'Erro de validaÃ§Ã£o: ' + (msg.mensagem || '');
      status.className = 'status err';
    }
  }
});
</script>
</body>
</html>`;
}
function openFormWebview(context, title, data, excludeKeys, renderOptions, onSave) {
    const panel = vscode.window.createWebviewPanel('ariaForm', title, vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = buildFormHtml(title, data, excludeKeys, renderOptions);
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'save') {
            try {
                message.data.SN_MODO_COMPATIBILIDADE = 'N';
                if (message.data.IN_TIPO_TRANSFORMACAO === '') {
                    message.data.IN_TIPO_TRANSFORMACAO = null;
                }
                void panel.webview.postMessage({ type: 'saving' });
                const savingIndicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: salvando via API...');
                try {
                    await vscode.window.withProgress({
                        location: vscode.ProgressLocation.Notification,
                        title: 'ARIA: Salvando alteracoes via API...'
                    }, async () => {
                        await onSave(message.data);
                    });
                }
                finally {
                    savingIndicator.dispose();
                }
                void panel.webview.postMessage({ type: 'saved' });
                vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
            }
            catch (error) {
                void panel.webview.postMessage({ type: 'error', message: toErrorMessage(error) });
                vscode.window.showErrorMessage(`Falha ao salvar: ${toErrorMessage(error)}`);
            }
        }
        else if (message.command === 'validate') {
            try {
                const snModoCompatibilidade = 'N';
                const inTipoTransformacao = message.data.IN_TIPO_TRANSFORMACAO === ''
                    ? null
                    : message.data.IN_TIPO_TRANSFORMACAO;
                // Monta payload para validaÃ§Ã£o
                const body = {
                    p_id_tipo_codigo: message.data.ID_TIPO_CODIGO,
                    p_id_banco_externo: message.data.ID_BANCO_EXTERNO,
                    p_sn_modo_compatibilidade: snModoCompatibilidade,
                    p_id_banco_esquema: message.data.ID_BANCO_ESQUEMA,
                    p_tx_codigo: toStringSafe(message.data.TX_CODIGO)
                };
                const url = new URL('v1/aria-vscode/custom/valida-codigo', ensureTrailingSlash(getSettings().baseUrl)).toString();
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const result = (await res.json());
                void panel.webview.postMessage({
                    type: 'validate-result',
                    status: result.status,
                    mensagem: result.mensagem,
                    codigo: result.codigo
                });
            }
            catch (error) {
                void panel.webview.postMessage({ type: 'validate-result', status: 'erro', mensagem: toErrorMessage(error) });
            }
        }
    }, undefined, context.subscriptions);
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=extension.js.map