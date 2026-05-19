"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AriaApiClient = void 0;
const http = require("http");
const https = require("https");
const utils_1 = require("../../core/utils");
const constants_1 = require("../../core/constants");
const lovs_normalizer_1 = require("../../domain/lovs/lovs-normalizer");
const metadata_parser_1 = require("../../domain/metadata/metadata-parser");
class AriaApiClient {
    settings;
    accessTokenProvider;
    logger;
    constructor(settings, accessTokenProvider, logger) {
        this.settings = settings;
        this.accessTokenProvider = accessTokenProvider;
        this.logger = logger;
    }
    async connect() {
        await this.getProjectEndpointTree();
    }
    async close() { }
    async getDataset(fetchProjectPath = this.settings.fetchProjectPath) {
        const dataset = await this.requestDataset();
        const filter = fetchProjectPath.trim().toLowerCase();
        if (!filter) {
            return dataset;
        }
        return { ...dataset, registros: dataset.registros.filter((p) => String(p.TX_PATH || '').toLowerCase().includes(filter)) };
    }
    async getDatasetByProjectId(projectId) {
        const dataset = await this.requestDataset(projectId);
        return { ...dataset, registros: dataset.registros.filter((p) => p.ID_PROJETO === projectId) };
    }
    async getProjectEndpointTree() {
        const response = await this.request('GET', '/v1/aria-vscode/custom/projetos-endpoints');
        const root = (0, utils_1.asRecord)(response);
        if (Array.isArray(root?.projetos)) {
            return { registros: root.projetos.map((item) => this.mapProject(item)) };
        }
        return this.normalizeDataset(response);
    }
    async saveDataset(dataset) {
        await this.request('POST', '/v1/aria-vscode/custom/importar-json', undefined, dataset);
    }
    async saveProject(project) {
        await this.request('POST', '/v1/aria-vscode/custom/importar-json', undefined, { registros: [project] });
    }
    async importarJsonEndpoint(projectId, endpointJson) {
        const query = { p_id_projeto: String(projectId) };
        const response = await this.request('POST', '/v1/aria-vscode/custom/importar-json-endpoint', query, endpointJson);
        const root = (0, utils_1.asRecord)(response) || {};
        return {
            status: typeof root.status === 'string' ? root.status : undefined,
            mensagem: typeof root.mensagem === 'string' ? root.mensagem : undefined,
        };
    }
    async getEndpointMetadata(endpoint) {
        const query = (0, metadata_parser_1.buildMetadataQuery)(endpoint);
        const response = await this.request('GET', '/v1/aria-vscode/custom/obtem-metadados', query);
        return (0, metadata_parser_1.formatMetadataForEditor)(response);
    }
    async getEndpointFormItems() {
        const response = await this.request('GET', '/v1/aria-vscode/custom/items-apex-endpoint');
        const root = (0, utils_1.asRecord)(response);
        const rows = (0, utils_1.asArray)(root?.registros) || [];
        return rows.map((item) => this.mapEndpointFormItem(item)).filter(item => item.ITEM_NAME !== '');
    }
    async getEndpointValidations() {
        const response = await this.request('GET', '/v1/aria-vscode/custom/validacoes-apex');
        const root = (0, utils_1.asRecord)(response);
        const rows = (0, utils_1.asArray)(root?.registros) || [];
        return rows.map((item) => this.mapEndpointValidation(item));
    }
    async getLovs(projectId) {
        const query = projectId != null && projectId > 0 ? { id_projeto: String(projectId) } : undefined;
        const response = await this.request('GET', '/v1/aria-vscode/custom/lovs', query);
        return (0, lovs_normalizer_1.normalizeLovsResponse)(response);
    }
    async validateCode(payload) {
        const body = {};
        if (payload.idTipoCodigo != null) {
            body.p_id_tipo_codigo = payload.idTipoCodigo;
        }
        if (payload.idBancoExterno != null) {
            body.p_id_banco_externo = payload.idBancoExterno;
        }
        if (payload.snModoCompatibilidade != null) {
            body.p_sn_modo_compatibilidade = payload.snModoCompatibilidade;
        }
        if (payload.idBancoEsquema != null) {
            body.p_id_banco_esquema = payload.idBancoEsquema;
        }
        if (payload.txCodigo != null) {
            body.p_tx_codigo = payload.txCodigo;
        }
        const response = await this.request('POST', '/v1/aria-vscode/custom/valida-codigo', undefined, body);
        return (0, utils_1.asRecord)(response) ?? {};
    }
    async getPrevia(payload) {
        const body = {
            idBancoExterno: payload.idBancoExterno,
            query: payload.query,
            pagina: payload.pagina,
            tamanhoPagina: payload.tamanhoPagina,
            parametros: payload.parametros,
            valoresParametros: payload.valoresParametros,
        };
        if (payload.idBancoEsquema != null && String(payload.idBancoEsquema).trim() !== '') {
            body.idBancoEsquema = payload.idBancoEsquema;
        }
        const response = await this.request('POST', '/v1/aria-vscode/custom/get-previa', undefined, body);
        const root = (0, utils_1.asRecord)(response) || {};
        return {
            pageCount: typeof root.pageCount === 'number' ? root.pageCount : undefined,
            columns: Array.isArray(root.columns) ? root.columns : undefined,
            count: typeof root.count === 'number' ? root.count : undefined,
            registros: Array.isArray(root.registros) ? root.registros : undefined,
            status: typeof root.status === 'string' ? root.status : undefined,
        };
    }
    // ─── Private ──────────────────────────────────────────────────────────────
    async requestDataset(projectId) {
        const query = projectId ? { id_projeto: String(projectId) } : undefined;
        const response = await this.request('GET', '/v1/aria-vscode/custom/gerar-json', query);
        return this.normalizeDataset(response);
    }
    normalizeDataset(payload) {
        const root = (0, utils_1.asRecord)(payload);
        if (Array.isArray(root?.registros)) {
            return { ...root, registros: root.registros.map((item) => this.mapProject(item)) };
        }
        if (Array.isArray(root?.projetos)) {
            return { registros: root.projetos.map((item) => this.mapProject(item)) };
        }
        if (Array.isArray(payload)) {
            return { registros: payload.map((item) => this.mapProject(item)) };
        }
        throw new Error('Resposta da API nao possui projetos no formato esperado.');
    }
    mapProject(raw) {
        const source = (0, utils_1.asRecord)(raw) || {};
        const endpoints = (0, utils_1.asArray)(source.REST_CUSTOM) || (0, utils_1.asArray)(source.endpoints) || [];
        return {
            ...source,
            ID_PROJETO: (0, utils_1.toNumber)(source.ID_PROJETO ?? source.id_projeto),
            NO_PROJETO: (0, utils_1.toStringSafe)(source.NO_PROJETO ?? source.nome_projeto),
            TX_PATH: (0, utils_1.toStringSafe)(source.TX_PATH ?? source.path_projeto),
            REST_CUSTOM: endpoints.map((ep) => this.mapEndpoint(ep)),
        };
    }
    mapEndpoint(raw) {
        const source = (0, utils_1.asRecord)(raw) || {};
        const mapped = {
            ...source,
            ID_REST_CUSTOM: (0, utils_1.toNumber)(source.ID_REST_CUSTOM ?? source.id_endpoint),
            NO_REST_CUSTOM: (0, utils_1.toStringSafe)(source.NO_REST_CUSTOM ?? source.nome_endpoint),
            TX_PATH: (0, utils_1.toStringSafe)(source.TX_PATH ?? source.path_endpoint),
            TX_CODIGO: typeof source.TX_CODIGO === 'string' ? source.TX_CODIGO : undefined,
        };
        if (mapped.ID_REST_CUSTOM <= 0) {
            throw new Error('Endpoint retornado pela API sem ID valido.');
        }
        return mapped;
    }
    mapEndpointFormItem(raw) {
        const source = (0, utils_1.asRecord)(raw) || {};
        return {
            ITEM_SEQUENCE: (0, utils_1.toNumber)(source.ITEM_SEQUENCE),
            REGION_SEQUENCE: (0, utils_1.toNumber)(source.REGION_SEQUENCE),
            IS_REQUIRED: (0, utils_1.toStringSafe)(source.IS_REQUIRED),
            DISPLAY_AS: (0, utils_1.toStringSafe)(source.DISPLAY_AS),
            ITEM_SOURCE: typeof source.ITEM_SOURCE === 'string' ? source.ITEM_SOURCE : undefined,
            LABEL: typeof source.LABEL === 'string' ? source.LABEL : undefined,
            ITEM_SOURCE_TYPE: typeof source.ITEM_SOURCE_TYPE === 'string' ? source.ITEM_SOURCE_TYPE : undefined,
            ITEM_NAME: (0, utils_1.toStringSafe)(source.ITEM_NAME),
            REGION: typeof source.REGION === 'string' ? source.REGION : undefined,
        };
    }
    mapEndpointValidation(raw) {
        const source = (0, utils_1.asRecord)(raw) || {};
        return {
            REGION_SEQUENCE: (0, utils_1.toNumber)(source.REGION_SEQUENCE),
            REGION_NAME: typeof source.REGION_NAME === 'string' ? source.REGION_NAME : undefined,
            VALIDATION_SEQUENCE: (0, utils_1.toNumber)(source.VALIDATION_SEQUENCE),
            VALIDATION_NAME: (0, utils_1.toStringSafe)(source.VALIDATION_NAME),
            VALIDATION_TYPE: (0, utils_1.toStringSafe)(source.VALIDATION_TYPE),
            VALIDATION_FAILURE_TEXT: typeof source.VALIDATION_FAILURE_TEXT === 'string' ? source.VALIDATION_FAILURE_TEXT : undefined,
            VALIDATION_EXPRESSION1: typeof source.VALIDATION_EXPRESSION1 === 'string' ? source.VALIDATION_EXPRESSION1 : undefined,
            CONDITION_TYPE: typeof source.CONDITION_TYPE === 'string' ? source.CONDITION_TYPE : undefined,
            CONDITION_EXPRESSION1: typeof source.CONDITION_EXPRESSION1 === 'string' ? source.CONDITION_EXPRESSION1 : undefined,
            CONDITION_EXPRESSION2: typeof source.CONDITION_EXPRESSION2 === 'string' ? source.CONDITION_EXPRESSION2 : undefined,
            ASSOCIATED_ITEM: typeof source.ASSOCIATED_ITEM === 'string' ? source.ASSOCIATED_ITEM : undefined,
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
        try {
            const bodyPreview = (endpointPath.includes('/importar-json-endpoint'))
                ? (body === undefined ? undefined : JSON.parse(JSON.stringify(body)))
                : this.buildRequestBodyForLog(endpointPath, body);
            this.logger?.(`[${new Date().toISOString()}] ms-aria request => ${method} ${url.pathname}${url.search}\n` +
                `  query: ${(0, utils_1.summarizeForLog)(query)}\n` +
                `  body: ${endpointPath.includes('/importar-json-endpoint') ? JSON.stringify(bodyPreview, null, 2) : (0, utils_1.summarizeForLog)(bodyPreview)}`);
        }
        catch (e) {
            this.logger?.(`[${new Date().toISOString()}] ms-aria request => ${method} ${url.pathname}${url.search} (failed to build log: ${String(e)})`);
        }
        const headers = { Accept: 'application/json' };
        if (payload !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload, 'utf8').toString();
        }
        const isHttps = url.protocol === 'https:';
        const requestOptions = { method, headers };
        if (isHttps) {
            requestOptions.rejectUnauthorized = !this.settings.ignoreSslErrors;
        }
        const requestOnce = async (token) => {
            const mergedHeaders = { ...headers };
            if (token && token.trim()) {
                mergedHeaders.Authorization = `Bearer ${token}`;
            }
            const localOptions = { ...requestOptions, headers: mergedHeaders };
            const client = isHttps ? https : http;
            return await new Promise((resolve, reject) => {
                const req = client.request(url, localOptions, (res) => {
                    const chunks = [];
                    res.on('data', (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
                    res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, responseBody: Buffer.concat(chunks).toString('utf8') }); });
                    res.on('error', reject);
                });
                req.setTimeout(constants_1.API_TIMEOUT_MS, () => {
                    req.destroy(new Error(`Timeout de ${constants_1.API_TIMEOUT_MS / 1000}s na chamada para ${endpointPath}.`));
                });
                req.on('error', reject);
                if (payload !== undefined) {
                    req.write(payload);
                }
                req.end();
            });
        };
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
        if (method === 'GET' && statusCode === 500) {
            for (let i = 0; i < constants_1.GET_RETRY_DELAYS_MS.length && statusCode === 500; i++) {
                this.logger?.(`[${new Date().toISOString()}] ms-aria retry => ${method} ${url.pathname}${url.search} status=500 attempt=${i + 2}`);
                await wait(constants_1.GET_RETRY_DELAYS_MS[i]);
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
        if (responseBody.trimStart().startsWith('<')) {
            throw new Error('API retornou resposta HTML inesperada (esperava JSON). Verifique se o servidor está acessível.');
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
    buildRequestBodyForLog(endpointPath, body) {
        if (endpointPath.includes('/importar-json')) {
            const root = (0, utils_1.asRecord)(body);
            if (!root) {
                return body;
            }
            const projects = (0, utils_1.asArray)(root.registros) || (0, utils_1.asArray)(root.projetos);
            if (!projects) {
                return root;
            }
            return {
                totalProjects: projects.length,
                projects: projects.slice(0, 3).map((item) => {
                    const project = (0, utils_1.asRecord)(item) || {};
                    const endpoints = (0, utils_1.asArray)(project.REST_CUSTOM) || [];
                    return {
                        ID_PROJETO: (0, utils_1.toNumber)(project.ID_PROJETO),
                        NO_PROJETO: (0, utils_1.toStringSafe)(project.NO_PROJETO),
                        endpointCount: endpoints.length,
                    };
                }),
            };
        }
        return body;
    }
}
exports.AriaApiClient = AriaApiClient;
