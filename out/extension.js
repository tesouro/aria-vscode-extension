"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const vscode = require("vscode");
const REQUIRED_ENTRA_TENANT_ID = 'b5661350-c2e4-43dc-bce8-f003ddf8a3c4';
class AriaApiClient {
    constructor(settings, accessTokenProvider) {
        this.settings = settings;
        this.accessTokenProvider = accessTokenProvider;
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
    async request(method, endpointPath, query, body) {
        const url = new URL(endpointPath.replace(/^\//, ''), this.withTrailingSlash(this.settings.baseUrl));
        if (query) {
            for (const [key, value] of Object.entries(query)) {
                url.searchParams.set(key, value);
            }
        }
        const payload = body === undefined ? undefined : JSON.stringify(body);
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
                req.on('error', reject);
                if (payload !== undefined) {
                    req.write(payload);
                }
                req.end();
            });
        };
        const token = await this.accessTokenProvider?.(false);
        let { statusCode, responseBody } = await requestOnce(token);
        if (statusCode === 401 && this.accessTokenProvider) {
            const refreshedToken = await this.accessTokenProvider(true);
            if (refreshedToken && refreshedToken !== token) {
                const retryResult = await requestOnce(refreshedToken);
                statusCode = retryResult.statusCode;
                responseBody = retryResult.responseBody;
            }
        }
        if (statusCode < 200 || statusCode >= 300) {
            throw new Error(`API retornou ${statusCode}: ${responseBody || 'sem corpo de resposta'}`);
        }
        if (!responseBody.trim()) {
            return undefined;
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
            title: 'Editar TX_CODIGO',
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
    let lastPayloadPath;
    let entraSession;
    let requireEntraLogin = getEntraSettings().requireLogin;
    let isLoggedIn = false;
    const editMap = new Map();
    const output = vscode.window.createOutputChannel('ARIA API Editor');
    const tree = new AriaTreeProvider(() => dataset);
    vscode.window.registerTreeDataProvider('ariaProjectsView', tree);
    const updateLoginState = async (loggedIn) => {
        isLoggedIn = loggedIn;
        await vscode.commands.executeCommand('setContext', 'aria.isLoggedIn', loggedIn);
        tree.refresh();
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
        if (!client) {
            throw new Error('Sem conexao ativa com a API.');
        }
        const freshDataset = await client.getDatasetByProjectId(projectId);
        if (freshDataset.registros.length !== 1) {
            throw new Error(`Esperado 1 projeto para salvar, mas gerar-json retornou ${freshDataset.registros.length}.`);
        }
        await mutate(freshDataset);
        await persistDebugPayload(JSON.stringify(freshDataset, null, 2), source);
        await client.saveDataset(freshDataset);
        dataset = await client.getProjectEndpointTree();
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
            client = new AriaApiClient(settings, acquireAccessToken);
            await client.connect();
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
    // ── Projeto: JSON ────────────────────────────────────────────────────────
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
        const filePath = await ensureEditFilePath(`project-${node.project.ID_PROJETO}.aria.json`);
        await fs.promises.writeFile(filePath, content, 'utf8');
        editMap.set(filePath, { type: 'projectJson', id: node.project.ID_PROJETO, projectId: node.project.ID_PROJETO });
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }), 
    // ── Projeto: Formulário ──────────────────────────────────────────────────
    vscode.commands.registerCommand('aria.editProjectForm', async (node) => {
        if (!dataset) {
            vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
            return;
        }
        if (!node) {
            return;
        }
        const project = await getProjectDetails(node.project.ID_PROJETO);
        openFormWebview(context, `Projeto: ${project.NO_PROJETO}`, project, ['REST_CUSTOM'], async (updated) => {
            await saveWithFreshDataset(`projectForm:${node.project.ID_PROJETO}`, node.project.ID_PROJETO, async (draft) => {
                const idx = draft.registros.findIndex((p) => p.ID_PROJETO === node.project.ID_PROJETO);
                if (idx < 0) {
                    throw new Error('Projeto nao encontrado no cache.');
                }
                draft.registros[idx] = mergePreservingTypes(draft.registros[idx], updated);
            });
        });
    }), 
    // ── Endpoint: TX_CODIGO (acao principal) ─────────────────────────────────
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
        const filePath = await ensureEditFilePath(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.${codeExtension}`);
        await fs.promises.writeFile(filePath, code, 'utf8');
        editMap.set(filePath, { type: 'endpointCode', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }), 
    // ── Endpoint: JSON ───────────────────────────────────────────────────────
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
        const filePath = await ensureEditFilePath(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.json`);
        await fs.promises.writeFile(filePath, content, 'utf8');
        editMap.set(filePath, { type: 'endpointJson', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
        const doc = await vscode.workspace.openTextDocument(filePath);
        await vscode.window.showTextDocument(doc, { preview: false });
    }), 
    // ── Endpoint: Formulário ─────────────────────────────────────────────────
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
        openFormWebview(context, `Endpoint: ${endpoint.NO_REST_CUSTOM}`, endpoint, [], async (updated) => {
            await saveWithFreshDataset(`endpointForm:${node.endpoint.ID_REST_CUSTOM}`, node.project.ID_PROJETO, async (draft) => {
                let found = false;
                for (const project of draft.registros) {
                    const eIdx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
                    if (eIdx >= 0) {
                        project.REST_CUSTOM[eIdx] = mergePreservingTypes(project.REST_CUSTOM[eIdx], updated);
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
    // ── Salvar editor ativo via API ──────────────────────────────────────────
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
        const filePath = editor.document.uri.fsPath;
        const marker = editMap.get(filePath);
        if (!marker) {
            vscode.window.showWarningMessage('Este arquivo nao foi aberto pelo ARIA Editor.');
            return;
        }
        await editor.document.save();
        try {
            const text = editor.document.getText();
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
            }
            finally {
                savingIndicator.dispose();
            }
            vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
        }
        catch (error) {
            vscode.window.showErrorMessage(`Falha ao salvar alteracoes: ${toErrorMessage(error)}`);
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
    context.subscriptions.push({
        dispose: () => {
            void client?.close();
        }
    });
}
function deactivate() {
    // encerramento gerenciado no dispose registrado em activate
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
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const editDir = workspaceFolder
        ? path.join(workspaceFolder.uri.fsPath, '.aria-edit')
        : path.join(os.tmpdir(), 'aria-edit');
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
            { value: '1', label: 'SQL' }
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
function buildFormHtml(title, data, excludeKeys) {
    const visibleEntries = Object.entries(data)
        .filter(([key, value]) => !excludeKeys.includes(key) && (typeof value !== 'object' || value === null));
    const summaryItems = visibleEntries
        .filter(([key]) => ['NO_PROJETO', 'NO_REST_CUSTOM', 'TX_PATH', 'ID_PROJETO', 'ID_REST_CUSTOM'].includes(key))
        .map(([key, value]) => `
      <div class="summary-chip">
        <span class="summary-chip-label">${escHtml(prettifyLabel(key))}</span>
        <strong>${escHtml(value === null || value === undefined ? '-' : String(value))}</strong>
      </div>`)
        .join('');
    const sectionOrder = [
        'basic',
        'behavior',
        'security',
        'cache',
        'advanced',
        'metadata'
    ];
    const sectionFields = new Map();
    for (const section of sectionOrder) {
        sectionFields.set(section, []);
    }
    for (const [key, value] of visibleEntries) {
        const strVal = value === null || value === undefined ? '' : String(value);
        const label = prettifyLabel(key);
        const options = getFieldOptions(key);
        const isBoolean = /^SN_/.test(key) && (strVal === 'S' || strVal === 'N');
        const isReadonly = /^ID_/.test(key) || key === 'TX_URL';
        const isCode = key === 'TX_CODIGO' || key === 'TX_SCRIPT_CUSTOM';
        const isLong = isCode || strVal.length > 120 || /^DS_|^TX_COMENTARIOS|^TX_PERFIS|^TX_IPS|^TX_SECRET_META_API/.test(key);
        const section = getFieldSection(key);
        let control = '';
        if (isBoolean) {
            const checked = strVal === 'S' ? ' checked' : '';
            control = `
        <input type="hidden" name="${escHtml(key)}" value="N" />
        <label class="toggle" for="${escHtml(key)}">
          <input id="${escHtml(key)}" name="${escHtml(key)}" type="checkbox" value="S"${checked} />
          <span class="toggle-track" aria-hidden="true"></span>
          <span class="toggle-text">${escHtml(label)}</span>
        </label>`;
        }
        else if (options) {
            const renderedOptions = options
                .map((option) => {
                const selected = option.value === strVal ? ' selected' : '';
                return `<option value="${escHtml(option.value)}"${selected}>${escHtml(option.label)}</option>`;
            })
                .join('');
            control = `
        <label for="${escHtml(key)}">${escHtml(label)}</label>
        <select id="${escHtml(key)}" name="${escHtml(key)}">${renderedOptions}</select>`;
        }
        else if (isCode) {
            control = `
        <label for="${escHtml(key)}">${escHtml(label)}</label>
        <textarea id="${escHtml(key)}" name="${escHtml(key)}" class="code-area" rows="18">${escHtml(strVal)}</textarea>`;
        }
        else if (isLong) {
            control = `
        <label for="${escHtml(key)}">${escHtml(label)}</label>
        <textarea id="${escHtml(key)}" name="${escHtml(key)}" rows="5"${isReadonly ? ' readonly' : ''}>${escHtml(strVal)}</textarea>`;
        }
        else {
            control = `
        <label for="${escHtml(key)}">${escHtml(label)}</label>
        <input id="${escHtml(key)}" name="${escHtml(key)}" type="text" value="${escHtml(strVal)}"${isReadonly ? ' readonly' : ''} />`;
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
        const meta = getSectionMeta(section);
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
        <p>Os campos foram reorganizados em secoes para ficar mais proximo da experiencia de cadastro do APEX, sem alterar o formato salvo pela API.</p>
      </div>
      <div class="summary-grid">${summaryItems}</div>
    </section>
    ${renderedSections}
    <div class="actions">
      <div class="actions-copy">Revise os grupos abaixo e salve quando terminar. O payload enviado continua compativel com o importa_json.</div>
      <div class="actions-main">
        <span class="status" id="status"></span>
        <button type="submit">Salvar via API</button>
      </div>
    </div>
  </form>
</div>
<script>
const vscode = acquireVsCodeApi();
const form = document.getElementById('form');
const status = document.getElementById('status');

form.addEventListener('submit', function(e) {
  e.preventDefault();
  const data = {};
  new FormData(form).forEach(function(v, k) { data[k] = v; });
  vscode.postMessage({ command: 'save', data: data });
  status.textContent = 'Salvando...';
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
  }
});
</script>
</body>
</html>`;
}
function openFormWebview(context, title, data, excludeKeys, onSave) {
    const panel = vscode.window.createWebviewPanel('ariaForm', title, vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = buildFormHtml(title, data, excludeKeys);
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command === 'save') {
            try {
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
    }, undefined, context.subscriptions);
}
function toErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=extension.js.map