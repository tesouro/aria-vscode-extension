"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("fs");
const os = require("os");
const path = require("path");
const constants_1 = require("./core/constants");
const utils_1 = require("./core/utils");
const code_type_resolver_1 = require("./domain/endpoints/code-type-resolver");
const endpoint_normalizer_1 = require("./domain/endpoints/endpoint-normalizer");
const endpoint_validator_1 = require("./domain/validation/endpoint-validator");
const draft_store_1 = require("./domain/assistant/draft-store");
const aria_api_client_1 = require("./infrastructure/api/aria-api-client");
const entra_auth_service_1 = require("./infrastructure/auth/entra-auth-service");
const state_store_1 = require("./infrastructure/stores/state-store");
const tree_provider_1 = require("./vscode/tree/tree-provider");
const virtual_fs_provider_1 = require("./vscode/editors/virtual-fs-provider");
const form_webview_1 = require("./vscode/editors/form-webview");
const preview_params_webview_1 = require("./vscode/editors/preview-params-webview");
const preview_result_view_1 = require("./vscode/editors/preview-result-view");
const tools_1 = require("./vscode/assistant/tools");
const chat_participant_1 = require("./vscode/assistant/chat-participant");
function getSettings() {
    const config = vscode.workspace.getConfiguration('ariaApi');
    return {
        baseUrl: config.get('baseUrl', 'https://ms-aria.appsdev.ocp.tesouro.gov.br/'),
        fetchProjectPath: config.get('fetchProjectPath', ''),
        ignoreSslErrors: config.get('ignoreSslErrors', true),
    };
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
function isValidateCodeSuccess(status) {
    const s = (0, utils_1.toStringSafe)(status).toLowerCase().trim();
    return s === 'sucesso' || s === 'ok' || s === 'success';
}
async function ensureEditFilePath(fileName) {
    const editDir = path.join(os.tmpdir(), 'aria-edit');
    await fs.promises.mkdir(editDir, { recursive: true });
    return path.join(editDir, fileName);
}
function activate(context) {
    const output = vscode.window.createOutputChannel('ARIA API Editor');
    // Enable debug logs for assistant/troubleshooting when requested
    process.env.ARIA_DEBUG = process.env.ARIA_DEBUG ?? '1';
    if (process.env.ARIA_DEBUG === '1') {
        output.appendLine('[DEBUG] ARIA_DEBUG enabled');
    }
    const draftStore = new draft_store_1.DraftStore();
    const state = new state_store_1.StateStore(draftStore);
    const authService = new entra_auth_service_1.EntraAuthService();
    const virtualEditProvider = new virtual_fs_provider_1.InMemoryEditFileSystemProvider();
    const tree = new tree_provider_1.AriaTreeProvider(() => state.dataset);
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    const updateStatusBar = (loggedIn) => {
        if (loggedIn) {
            statusBarItem.text = '$(cloud-upload) ARIA: Conectado';
            statusBarItem.command = 'aria.logout';
            statusBarItem.tooltip = 'Desconectar ARIA';
        }
        else {
            statusBarItem.text = '$(cloud) ARIA: Desconectado';
            statusBarItem.command = 'aria.connect';
            statusBarItem.tooltip = 'Conectar ARIA';
        }
        statusBarItem.show();
    };
    context.subscriptions.push(output, vscode.workspace.registerFileSystemProvider(constants_1.ARIA_EDIT_SCHEME, virtualEditProvider, { isCaseSensitive: true }), vscode.window.registerTreeDataProvider('ariaProjectsView', tree), statusBarItem);
    // ── Helpers ─────────────────────────────────────────────────────────────
    const createVirtualEditUri = (fileName) => vscode.Uri.from({ scheme: constants_1.ARIA_EDIT_SCHEME, path: `/${fileName}` });
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
    const validateEndpointCodeBeforeSave = async (endpoint) => {
        const result = await state.getClient().validateCode({
            idTipoCodigo: endpoint.ID_TIPO_CODIGO,
            idBancoExterno: endpoint.ID_BANCO_EXTERNO,
            snModoCompatibilidade: endpoint.SN_MODO_COMPATIBILIDADE,
            idBancoEsquema: endpoint.ID_BANCO_ESQUEMA,
            txCodigo: (0, utils_1.toStringSafe)(endpoint.TX_CODIGO),
        });
        if (!isValidateCodeSuccess(result.status)) {
            throw new Error((0, utils_1.toStringSafe)(result.mensagem) || 'Validacao remota do codigo falhou.');
        }
    };
    const extractSqlParameters = (query) => {
        const seen = new Set();
        const params = [];
        for (const match of query.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
            const name = String(match[1]).toUpperCase();
            if (seen.has(name)) {
                continue;
            }
            seen.add(name);
            params.push(name);
        }
        return params;
    };
    const buildPreviewPayload = (endpoint) => {
        const query = (0, utils_1.toStringSafe)(endpoint.TX_CODIGO).trim();
        if (!query) {
            throw new Error('A query SQL esta vazia.');
        }
        const idBancoExterno = endpoint.ID_BANCO_EXTERNO;
        const idBancoEsquema = endpoint.ID_BANCO_ESQUEMA == null || String(endpoint.ID_BANCO_ESQUEMA).trim() === ''
            ? undefined
            : endpoint.ID_BANCO_ESQUEMA;
        if (idBancoExterno == null || String(idBancoExterno).trim() === '') {
            throw new Error('ID_BANCO_EXTERNO e obrigatorio para executar a previa.');
        }
        return {
            idBancoExterno,
            idBancoEsquema,
            query,
            pagina: 1,
            tamanhoPagina: 20,
            parametros: extractSqlParameters(query),
            valoresParametros: [],
        };
    };
    const resolvePreviewContextForActiveEditor = async (editor) => {
        const marker = state.editMap.get(editor.document.uri.toString());
        if (!marker || (marker.type !== 'endpointCode' && marker.type !== 'endpointJson')) {
            throw new Error('Previa disponivel apenas para editores de endpoint em codigo ou JSON.');
        }
        const project = await state.getProjectDetails(marker.projectId);
        const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === marker.id);
        if (!endpoint) {
            throw new Error('Endpoint nao encontrado.');
        }
        let previewSource;
        if (marker.type === 'endpointCode') {
            previewSource = { ...endpoint, TX_CODIGO: editor.document.getText() };
        }
        else {
            let parsed;
            try {
                parsed = JSON.parse(editor.document.getText());
            }
            catch (error) {
                throw new Error(`JSON invalido no editor: ${(0, utils_1.toErrorMessage)(error)}`);
            }
            previewSource = { ...endpoint, ...parsed, ID_REST_CUSTOM: endpoint.ID_REST_CUSTOM };
        }
        if ((0, utils_1.toNumber)(previewSource.ID_TIPO_CODIGO) !== 1) {
            throw new Error('Previa de dados disponivel apenas para endpoints SQL.');
        }
        return {
            title: `Previa SQL: ${(0, utils_1.toStringSafe)(endpoint.NO_REST_CUSTOM) || `Endpoint ${marker.id}`}`,
            source: previewSource,
            payload: buildPreviewPayload(previewSource),
        };
    };
    let activePreviewSession;
    let previewResultView;
    const ensurePreviewPanelVisible = async () => {
        await vscode.commands.executeCommand('ariaQueryResultView.focus');
    };
    const runPreviewExecution = async (payload) => {
        if (!state.client) {
            throw new Error('Sem conexao ativa com a API.');
        }
        if (!activePreviewSession) {
            throw new Error('Sessao de previa nao inicializada.');
        }
        activePreviewSession.payload = payload;
        previewResultView.setSession(activePreviewSession.title, payload);
        previewResultView.setLoading();
        await ensurePreviewPanelVisible();
        try {
            if (activePreviewSession.source) {
                await validateEndpointCodeBeforeSave({ ...activePreviewSession.source, TX_CODIGO: payload.query });
            }
            const result = await state.getClient().getPrevia(payload);
            previewResultView.setResult(result);
        }
        catch (error) {
            previewResultView.setError((0, utils_1.toErrorMessage)(error));
            throw error;
        }
    };
    previewResultView = new preview_result_view_1.SqlPreviewResultViewProvider(async (action) => {
        if (!activePreviewSession) {
            return;
        }
        const current = activePreviewSession.payload;
        const nextPayload = action === 'prev'
            ? { ...current, pagina: Math.max((Number(current.pagina) || 1) - 1, 1) }
            : action === 'next'
                ? { ...current, pagina: (Number(current.pagina) || 1) + 1 }
                : current;
        await runPreviewExecution(nextPayload);
    });
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('ariaQueryResultView', previewResultView, { webviewOptions: { retainContextWhenHidden: true } }));
    const saveWithFreshDataset = async (source, projectId, mutate) => {
        const client = state.getClient();
        const freshDataset = await client.getDatasetByProjectId(projectId);
        if (freshDataset.registros.length !== 1) {
            throw new Error(`Esperado 1 projeto, retornados ${freshDataset.registros.length}.`);
        }
        const draftProject = freshDataset.registros[0];
        for (const ep of draftProject.REST_CUSTOM ?? []) {
            ep.SN_MODO_COMPATIBILIDADE = 'N';
            if (ep.IN_TIPO_TRANSFORMACAO === '') {
                ep.IN_TIPO_TRANSFORMACAO = null;
            }
        }
        await mutate(freshDataset);
        // Validate code for relevant endpoints
        if (source.startsWith('endpointCode:') || source.startsWith('endpointJson:') || source.startsWith('endpointForm:')) {
            const endpointId = Number(source.split(':')[1]);
            for (const ep of draftProject.REST_CUSTOM.filter((e) => e.ID_REST_CUSTOM === endpointId)) {
                await validateEndpointCodeBeforeSave(ep);
            }
        }
        else if (source.startsWith('createEndpoint:')) {
            const previousIds = new Set(draftProject.REST_CUSTOM.map((e) => e.ID_REST_CUSTOM));
            for (const ep of draftProject.REST_CUSTOM.filter((e) => !previousIds.has(e.ID_REST_CUSTOM))) {
                await validateEndpointCodeBeforeSave(ep);
            }
        }
        else if (source.startsWith('projectJson:')) {
            for (const ep of draftProject.REST_CUSTOM) {
                await validateEndpointCodeBeforeSave(ep);
            }
        }
        const payloadStr = JSON.stringify(freshDataset, null, 2);
        const filePath = await ensureEditFilePath('last-importa-json.aria.payload.json');
        await fs.promises.writeFile(filePath, payloadStr, 'utf8');
        state.lastPayloadPath = filePath;
        output.appendLine(`[${new Date().toISOString()}] Payload preparado: ${source}, ${payloadStr.length} bytes`);
        await client.saveDataset(freshDataset);
        state.dataset = await client.getProjectEndpointTree();
        tree.refresh();
    };
    const saveDatasetWithFreshSnapshot = async (source, mutate) => {
        const client = state.getClient();
        const freshDataset = await client.getProjectEndpointTree();
        for (const project of freshDataset.registros) {
            for (const ep of project.REST_CUSTOM ?? []) {
                ep.SN_MODO_COMPATIBILIDADE = 'N';
                if (ep.IN_TIPO_TRANSFORMACAO === '') {
                    ep.IN_TIPO_TRANSFORMACAO = null;
                }
            }
        }
        await mutate(freshDataset);
        const payloadStr = JSON.stringify(freshDataset, null, 2);
        const filePath = await ensureEditFilePath('last-importa-json.aria.payload.json');
        await fs.promises.writeFile(filePath, payloadStr, 'utf8');
        state.lastPayloadPath = filePath;
        output.appendLine(`[${new Date().toISOString()}] Payload preparado: ${source}, ${payloadStr.length} bytes`);
        await client.saveDataset(freshDataset);
        state.dataset = await client.getProjectEndpointTree();
        tree.refresh();
    };
    const saveProjectWithFreshSnapshot = async (source, projectPayload) => {
        const client = state.getClient();
        const freshDataset = await client.getProjectEndpointTree();
        const projectPath = (0, utils_1.toStringSafe)(projectPayload.TX_PATH).trim().toLowerCase();
        if (!projectPath) {
            throw new Error('Path do projeto e obrigatorio.');
        }
        if (freshDataset.registros.some((project) => (0, utils_1.toStringSafe)(project.TX_PATH).trim().toLowerCase() === projectPath)) {
            throw new Error(`Ja existe projeto com TX_PATH "${(0, utils_1.toStringSafe)(projectPayload.TX_PATH).trim()}".`);
        }
        const wrappedPayload = { registros: [projectPayload] };
        const payloadStr = JSON.stringify(wrappedPayload, null, 2);
        const filePath = await ensureEditFilePath('last-importa-json.aria.payload.json');
        await fs.promises.writeFile(filePath, payloadStr, 'utf8');
        state.lastPayloadPath = filePath;
        output.appendLine(`[${new Date().toISOString()}] Payload preparado: ${source}, ${payloadStr.length} bytes`);
        await client.saveProject(projectPayload);
        state.dataset = await client.getProjectEndpointTree();
        tree.refresh();
    };
    const saveEditedDocument = async (document) => {
        const marker = state.editMap.get(document.uri.toString());
        if (!marker) {
            return;
        }
        const text = document.getText();
        const savingIndicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: salvando via API...');
        try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'ARIA: Salvando alteracoes via API...' }, async () => {
                await saveWithFreshDataset(`${marker.type}:${marker.id}`, marker.projectId, async (draft) => {
                    if (marker.type === 'endpointCode') {
                        for (const project of draft.registros) {
                            const idx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                            if (idx >= 0) {
                                project.REST_CUSTOM[idx] = { ...project.REST_CUSTOM[idx], TX_CODIGO: text };
                                return;
                            }
                        }
                        throw new Error('Endpoint nao encontrado no cache.');
                    }
                    if (marker.type === 'projectJson') {
                        const parsed = JSON.parse(text);
                        const idx = draft.registros.findIndex((p) => p.ID_PROJETO === marker.id);
                        if (idx < 0) {
                            throw new Error('Projeto nao encontrado.');
                        }
                        draft.registros[idx] = { ...draft.registros[idx], ...parsed, ID_PROJETO: marker.id, REST_CUSTOM: parsed.REST_CUSTOM || draft.registros[idx].REST_CUSTOM };
                        return;
                    }
                    const parsed = JSON.parse(text);
                    for (const project of draft.registros) {
                        const idx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                        if (idx >= 0) {
                            project.REST_CUSTOM[idx] = { ...project.REST_CUSTOM[idx], ...parsed, ID_REST_CUSTOM: marker.id };
                            return;
                        }
                    }
                    throw new Error('Endpoint nao encontrado.');
                });
            });
            vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
        }
        finally {
            savingIndicator.dispose();
        }
    };
    // ── Event: save virtual document ────────────────────────────────────────
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.uri.scheme !== constants_1.ARIA_EDIT_SCHEME || !state.editMap.has(document.uri.toString())) {
            return;
        }
        try {
            await saveEditedDocument(document);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Falha ao salvar: ${(0, utils_1.toErrorMessage)(error)}`);
        }
    }));
    // ── Login state ─────────────────────────────────────────────────────────
    const entraSettings = (0, entra_auth_service_1.getEntraSettings)();
    void authService.updateLoginState(!entraSettings.requireLogin);
    // check existing session without prompting: if user already logged in, set state
    void authService.ensureEntraLogin(false);
    // update status bar based on auth state and listen to changes
    updateStatusBar(authService.getIsLoggedIn());
    context.subscriptions.push(authService.onLoginStateChanged(updateStatusBar));
    // ── Commands ────────────────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('aria.connect', async () => {
        if (!(await authService.ensureEntraLogin())) {
            return;
        }
        const settings = getSettings();
        try {
            await state.client?.close();
            state.client = new aria_api_client_1.AriaApiClient(settings, authService.createAccessTokenProvider(), (msg) => output.appendLine(msg));
            await state.client.connect();
            state.resetCaches();
            state.dataset = await state.client.getProjectEndpointTree();
            tree.refresh();
            vscode.window.showInformationMessage(`Conectado. ${state.dataset.registros.length} projeto(s) carregados.`);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Erro ao conectar: ${(0, utils_1.toErrorMessage)(error)}`);
        }
    }), vscode.commands.registerCommand('aria.logout', async () => {
        try {
            await authService.logout();
            await state.client?.close();
            state.client = undefined;
            state.dataset = undefined;
            tree.refresh();
            vscode.window.showInformationMessage('Desconectado.');
        }
        catch (error) {
            vscode.window.showErrorMessage(`Falha ao deslogar: ${(0, utils_1.toErrorMessage)(error)}`);
        }
    }), vscode.commands.registerCommand('aria.refreshTree', async () => {
        if (!state.client) {
            vscode.window.showWarningMessage('Conecte primeiro.');
            return;
        }
        try {
            state.dataset = await state.client.getProjectEndpointTree();
            tree.refresh();
        }
        catch (error) {
            vscode.window.showErrorMessage(`Erro ao atualizar: ${(0, utils_1.toErrorMessage)(error)}`);
        }
    }), vscode.commands.registerCommand('aria.editProjectJson', async (node) => {
        if (!state.dataset || !node) {
            return;
        }
        const project = await state.getProjectDetails(node.project.ID_PROJETO);
        const doc = await openVirtualEditDocument(`project-${node.project.ID_PROJETO}.aria.json`, JSON.stringify(project, null, 2), 'json');
        state.editMap.set(doc.uri.toString(), { type: 'projectJson', id: node.project.ID_PROJETO, projectId: node.project.ID_PROJETO });
    }), vscode.commands.registerCommand('aria.editProjectForm', async (node) => {
        if (!state.dataset || !node) {
            return;
        }
        const project = await state.getProjectDetails(node.project.ID_PROJETO);
        const lovs = await state.getProjectLovs(node.project.ID_PROJETO);
        (0, form_webview_1.openFormWebview)(context, `Projeto: ${project.NO_PROJETO}`, project, ['REST_CUSTOM'], { lovs }, async (updated) => {
            const normalized = (0, endpoint_normalizer_1.applyLovDisplayValues)(updated, lovs);
            await saveWithFreshDataset(`projectForm:${node.project.ID_PROJETO}`, node.project.ID_PROJETO, async (draft) => {
                const idx = draft.registros.findIndex((p) => p.ID_PROJETO === node.project.ID_PROJETO);
                if (idx < 0) {
                    throw new Error('Projeto nao encontrado.');
                }
                draft.registros[idx] = mergePreservingTypes(draft.registros[idx], normalized);
            });
        });
    }), vscode.commands.registerCommand('aria.createProject', async () => {
        if (!state.client) {
            vscode.window.showWarningMessage('Conecte primeiro.');
            return;
        }
        const formData = { NO_PROJETO: '', DS_PROJETO: '', TX_PATH: '' };
        (0, form_webview_1.openFormWebview)(context, 'Novo Projeto', formData, [], undefined, async (updated) => {
            const projectName = (0, utils_1.toStringSafe)(updated.NO_PROJETO).trim();
            const projectDescription = (0, utils_1.toStringSafe)(updated.DS_PROJETO).trim();
            const projectPath = (0, utils_1.toStringSafe)(updated.TX_PATH).trim();
            if (!projectName || !projectPath) {
                throw new Error('Nome e Caminho sao obrigatorios.');
            }
            const projectPayload = {
                ID_PROJETO: 0,
                IN_TIPO_PROJETO: '1',
                NO_PROJETO: projectName,
                DS_PROJETO: projectDescription,
                TX_PATH: projectPath,
            };
            await saveProjectWithFreshSnapshot('createProject', projectPayload);
        });
    }), vscode.commands.registerCommand('aria.editEndpointCode', async (node) => {
        if (!state.dataset || !node) {
            return;
        }
        const project = await state.getProjectDetails(node.project.ID_PROJETO);
        const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
        if (!endpoint) {
            throw new Error('Endpoint nao encontrado.');
        }
        const ext = (0, code_type_resolver_1.resolveEndpointCodeExtension)(endpoint);
        const lang = ext === 'py' ? 'python' : 'sql';
        const doc = await openVirtualEditDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.${ext}`, endpoint.TX_CODIGO ?? '', lang);
        state.editMap.set(doc.uri.toString(), { type: 'endpointCode', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }), vscode.commands.registerCommand('aria.editEndpointJson', async (node) => {
        if (!state.dataset || !node) {
            return;
        }
        const project = await state.getProjectDetails(node.project.ID_PROJETO);
        const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
        if (!endpoint) {
            throw new Error('Endpoint nao encontrado.');
        }
        const doc = await openVirtualEditDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.json`, JSON.stringify(endpoint, null, 2), 'json');
        state.editMap.set(doc.uri.toString(), { type: 'endpointJson', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }), vscode.commands.registerCommand('aria.editEndpointForm', async (node) => {
        if (!state.dataset || !node) {
            return;
        }
        const project = await state.getProjectDetails(node.project.ID_PROJETO);
        const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
        if (!endpoint) {
            throw new Error('Endpoint nao encontrado.');
        }
        const endpointFormItems = await state.getEndpointFormItems();
        const lovs = await state.getProjectLovs(node.project.ID_PROJETO);
        const endpointValidations = await state.getEndpointValidations();
        (0, form_webview_1.openFormWebview)(context, `Endpoint: ${endpoint.NO_REST_CUSTOM}`, endpoint, [], { endpointItems: endpointFormItems, lovs }, async (updated) => {
            const normalized = (0, endpoint_normalizer_1.applyLovDisplayValues)(updated, lovs);
            await saveWithFreshDataset(`endpointForm:${node.endpoint.ID_REST_CUSTOM}`, node.project.ID_PROJETO, async (draft) => {
                for (const p of draft.registros) {
                    const idx = p.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
                    if (idx >= 0) {
                        const merged = mergePreservingTypes(p.REST_CUSTOM[idx], normalized);
                        const errors = (0, endpoint_validator_1.validateEndpointPayload)(merged, endpointValidations);
                        if (errors.length) {
                            throw new Error(errors.join(' | '));
                        }
                        p.REST_CUSTOM[idx] = merged;
                        return;
                    }
                }
                throw new Error('Endpoint nao encontrado.');
            });
        }, async (updated) => {
            const normalized = (0, endpoint_normalizer_1.applyLovDisplayValues)(updated, lovs);
            const merged = mergePreservingTypes(endpoint, normalized);
            return state.getClient().validateCode({
                idTipoCodigo: merged.ID_TIPO_CODIGO,
                idBancoExterno: merged.ID_BANCO_EXTERNO,
                snModoCompatibilidade: merged.SN_MODO_COMPATIBILIDADE,
                idBancoEsquema: merged.ID_BANCO_ESQUEMA,
                txCodigo: (0, utils_1.toStringSafe)(merged.TX_CODIGO),
            });
        }, async (payload) => state.getClient().getPrevia(payload));
    }), vscode.commands.registerCommand('aria.createEndpoint', async (node) => {
        if (!state.dataset) {
            vscode.window.showWarningMessage('Conecte primeiro.');
            return;
        }
        let targetProjectId;
        if (node) {
            targetProjectId = node.project.ID_PROJETO;
        }
        else {
            const items = state.dataset.registros.map((p) => ({ label: p.NO_PROJETO, description: p.TX_PATH, detail: `ID ${p.ID_PROJETO}`, projectId: p.ID_PROJETO }));
            const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Selecione o projeto' });
            if (!picked) {
                return;
            }
            targetProjectId = picked.projectId;
        }
        const project = state.dataset.registros.find((p) => p.ID_PROJETO === targetProjectId);
        if (!project) {
            return;
        }
        const endpointFormItems = await state.getEndpointFormItems();
        const lovs = await state.getProjectLovs(targetProjectId);
        const endpointValidations = await state.getEndpointValidations();
        const template = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(project, { NO_REST_CUSTOM: '', TX_PATH: '', TX_CODIGO: '', DS_REST_CUSTOM_CURTA: '' }, lovs, { ignoreExplicitBankFields: true });
        (0, form_webview_1.openFormWebview)(context, `Novo Endpoint — ${project.NO_PROJETO}`, template, ['ID_REST_CUSTOM'], { endpointItems: endpointFormItems, lovs }, async (updated) => {
            const normalized = (0, endpoint_normalizer_1.applyLovDisplayValues)(updated, lovs);
            normalized.TX_PATH = (0, utils_1.normalizeEndpointPath)(normalized.TX_PATH);
            if (!normalized.NO_REST_CUSTOM || !String(normalized.TX_PATH).trim()) {
                throw new Error('Nome e Caminho sao obrigatorios.');
            }
            if (project.REST_CUSTOM.some((e) => String(e.TX_PATH || '').toLowerCase() === String(normalized.TX_PATH).trim().toLowerCase())) {
                throw new Error(`Ja existe endpoint com TX_PATH "${normalized.TX_PATH}".`);
            }
            await saveWithFreshDataset(`createEndpoint:${targetProjectId}`, targetProjectId, async (draft) => {
                const proj = draft.registros.find((p) => p.ID_PROJETO === targetProjectId);
                if (!proj) {
                    throw new Error('Projeto nao encontrado.');
                }
                const newEp = (0, endpoint_normalizer_1.buildEndpointFromExampleStructure)(proj, normalized, lovs);
                const errors = (0, endpoint_validator_1.validateEndpointPayload)(newEp, endpointValidations);
                if (errors.length) {
                    throw new Error(errors.join(' | '));
                }
                proj.REST_CUSTOM.push(newEp);
            });
        });
    }), vscode.commands.registerCommand('aria.saveActiveEditor', async () => {
        if (!state.client || !state.dataset) {
            vscode.window.showWarningMessage('Conecte primeiro.');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || !state.editMap.has(editor.document.uri.toString())) {
            vscode.window.showWarningMessage('Nenhum editor ARIA ativo.');
            return;
        }
        await editor.document.save();
    }), vscode.commands.registerCommand('aria.validateActiveEditor', async () => {
        if (!state.client || !state.dataset) {
            vscode.window.showWarningMessage('Conecte primeiro.');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        const marker = state.editMap.get(editor.document.uri.toString());
        if (!marker || marker.type !== 'endpointCode') {
            vscode.window.showWarningMessage('Validacao disponivel apenas para editor de codigo.');
            return;
        }
        try {
            const project = await state.getProjectDetails(marker.projectId);
            const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === marker.id);
            if (!endpoint) {
                throw new Error('Endpoint nao encontrado.');
            }
            const indicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: validando...');
            try {
                const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Validando...' }, () => state.getClient().validateCode({ idTipoCodigo: endpoint.ID_TIPO_CODIGO, idBancoExterno: endpoint.ID_BANCO_EXTERNO, snModoCompatibilidade: endpoint.SN_MODO_COMPATIBILIDADE, idBancoEsquema: endpoint.ID_BANCO_ESQUEMA, txCodigo: editor.document.getText() }));
                const msg = (0, utils_1.toStringSafe)(result.mensagem) || 'Validacao concluida.';
                if (!isValidateCodeSuccess(result.status)) {
                    vscode.window.showErrorMessage(`Validacao falhou: ${msg}`);
                }
                else {
                    vscode.window.showInformationMessage(msg);
                }
            }
            finally {
                indicator.dispose();
            }
        }
        catch (error) {
            vscode.window.showErrorMessage(`Falha: ${(0, utils_1.toErrorMessage)(error)}`);
        }
    }), vscode.commands.registerCommand('aria.previewActiveEditorData', async () => {
        if (!state.client || !state.dataset) {
            vscode.window.showWarningMessage('Conecte primeiro.');
            return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }
        try {
            const previewContext = await resolvePreviewContextForActiveEditor(editor);
            activePreviewSession = { title: previewContext.title, payload: previewContext.payload, source: previewContext.source };
            if (previewContext.payload.parametros.length > 0) {
                (0, preview_params_webview_1.openPreviewParamsWebview)(previewContext.title, previewContext.payload, async (payload) => {
                    activePreviewSession = { title: previewContext.title, payload, source: previewContext.source };
                    await runPreviewExecution(payload);
                });
            }
            await runPreviewExecution(previewContext.payload);
        }
        catch (error) {
            vscode.window.showErrorMessage(`Falha ao abrir previa: ${(0, utils_1.toErrorMessage)(error)}`);
        }
    }), vscode.commands.registerCommand('aria.openLastPayload', async () => {
        if (!state.lastPayloadPath) {
            vscode.window.showWarningMessage('Nenhum payload gerado ainda.');
            return;
        }
        const doc = await vscode.workspace.openTextDocument(state.lastPayloadPath);
        await vscode.window.showTextDocument(doc, { preview: false });
        output.show(true);
    }));
    // ── Tools & Chat Participant ────────────────────────────────────────────
    (0, tools_1.registerTools)(context, state, output);
    (0, chat_participant_1.registerChatParticipant)(context, state, () => tree.refresh(), output);
    // ── Cleanup ─────────────────────────────────────────────────────────────
    context.subscriptions.push({ dispose: () => { void state.client?.close(); } });
}
function deactivate() { }
//# sourceMappingURL=extension.js.map