"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatParticipant = registerChatParticipant;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const utils_1 = require("../../core/utils");
const metadata_parser_1 = require("../../domain/metadata/metadata-parser");
const project_resolver_1 = require("../../domain/projects/project-resolver");
const sql_policy_validator_1 = require("../../domain/sql/sql-policy-validator");
const system_prompt_1 = require("./system-prompt");
function registerChatParticipant(context, state, treeRefresh, output) {
    const ariaParticipant = vscode.chat.createChatParticipant('aria.assistant', async (request, chatContext, response, token) => {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
        const model = models[0];
        if (!model) {
            response.markdown('Nenhum modelo Copilot disponivel.');
            return;
        }
        if (!state.client) {
            response.markdown('ARIA nao esta conectado. Execute o comando **ARIA: Conectar na API** primeiro.');
            return;
        }
        // Load projects
        let projectsJson = '[]';
        let projects = [];
        const knownSchemaIds = new Set();
        const knownSchemaNames = new Set();
        let schemaLockText = '';
        try {
            response.progress('Carregando contexto de projetos...');
            const projetosData = await state.client.getProjectEndpointTree();
            projects = projetosData.registros;
            projectsJson = JSON.stringify(projects, null, 2);
            schemaLockText = (0, project_resolver_1.buildProjectSchemaLockSummary)(projects, request.prompt);
            for (const project of projects) {
                for (const ep of project.REST_CUSTOM ?? []) {
                    const sid = (0, utils_1.toNumber)(ep.ID_BANCO_ESQUEMA);
                    if (sid > 0) {
                        knownSchemaIds.add(sid);
                    }
                    const sname = (0, utils_1.toStringSafe)(ep.NO_ESQUEMA ?? ep.no_esquema ?? ep.CO_ESQUEMA ?? ep.co_esquema).trim().toUpperCase();
                    if (sname) {
                        knownSchemaNames.add(sname);
                    }
                }
            }
        }
        catch (error) {
            projectsJson = `Erro ao carregar projetos: ${(0, utils_1.toErrorMessage)(error)}`;
        }
        const conversationPrompt = [
            ...chatContext.history
                .filter((turn) => turn instanceof vscode.ChatRequestTurn)
                .map((turn) => turn.prompt),
            request.prompt,
        ].join('\n');
        const selectedProject = (0, project_resolver_1.inferBestProjectForContext)(projects, conversationPrompt);
        const selectedProjectText = selectedProject
            ? `PROJETO ALVO RESOLVIDO PARA ESTA CONVERSA: use exatamente ID_PROJETO=${selectedProject.ID_PROJETO}, NO_PROJETO="${(0, utils_1.toStringSafe)(selectedProject.NO_PROJETO)}", TX_PATH="${(0, utils_1.toStringSafe)(selectedProject.TX_PATH)}". Em aria_create_endpoint_draft, envie OBRIGATORIAMENTE {"id_projeto": ${selectedProject.ID_PROJETO}, "endpoint": { ...json canonico do endpoint... }}. NUNCA envie apenas id_projeto.`
            : undefined;
        // Pre-load LOVs
        let lovsJson;
        let lovsData;
        let preloadedProjectId;
        try {
            const matchedProject = selectedProject ?? projects[0];
            if (matchedProject) {
                preloadedProjectId = matchedProject.ID_PROJETO;
                response.progress(`Carregando LOVs (${matchedProject.NO_PROJETO})...`);
                lovsData = await state.client.getLovs(preloadedProjectId);
                lovsJson = JSON.stringify(lovsData, null, 2);
                state.lovsCache.set(preloadedProjectId, lovsData);
            }
        }
        catch { /* ignore */ }
        // Pre-load form items
        let formItemsJson;
        try {
            response.progress('Carregando campos obrigatorios...');
            const formItems = await state.client.getEndpointFormItems();
            formItemsJson = JSON.stringify(formItems, null, 2);
        }
        catch { /* ignore */ }
        // Identify project banco connections and pre-load metadata
        const projectBancos = new Set();
        const projectForMetadata = projects.find((p) => p.ID_PROJETO === preloadedProjectId);
        for (const ep of projectForMetadata?.REST_CUSTOM ?? []) {
            const idBe = (0, utils_1.toNumber)(ep.ID_BANCO_EXTERNO);
            const idBs = (0, utils_1.toNumber)(ep.ID_BANCO_ESQUEMA);
            if (idBe > 0) {
                projectBancos.add((0, utils_1.buildMetadataKey)(idBe, idBs > 0 ? idBs : undefined));
            }
        }
        const metadataDir = path.join(__dirname, '..', '..', 'resources');
        // Pre-load metadata from API if not on disk
        for (const metadataKey of projectBancos) {
            const parts = metadataKey.split(':');
            const idBe = Number(parts[0]);
            const idBs = parts[1] !== 'sem-esquema' ? Number(parts[1]) : undefined;
            if (!(idBe > 0)) {
                continue;
            }
            const fileName = idBs && idBs > 0 ? `metadata-${idBe}-${idBs}.aria.txt` : `metadata-${idBe}.aria.txt`;
            const filePath = path.join(metadataDir, fileName);
            const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            if (!exists) {
                try {
                    response.progress(`Carregando metadados ${metadataKey}...`);
                    const pseudo = { ID_REST_CUSTOM: 0, NO_REST_CUSTOM: '', TX_PATH: '', ID_BANCO_EXTERNO: idBe, ...(idBs && idBs > 0 ? { ID_BANCO_ESQUEMA: idBs } : {}) };
                    const metadata = await state.client.getEndpointMetadata(pseudo);
                    if (metadata) {
                        await fs.promises.mkdir(metadataDir, { recursive: true });
                        await fs.promises.writeFile(filePath, metadata, 'utf8');
                    }
                }
                catch { /* ignore */ }
            }
        }
        // Scan disk for metadata files and build table context
        const allTables = [];
        try {
            const entries = await fs.promises.readdir(metadataDir).catch(() => []);
            for (const fileName of entries.filter((f) => f.startsWith('metadata-') && f.endsWith('.aria.txt'))) {
                const filePath = path.join(metadataDir, fileName);
                const content = await fs.promises.readFile(filePath, 'utf8').catch(() => '');
                if (!content) {
                    continue;
                }
                const nameClean = fileName.replace('.aria.txt', '').replace('metadata-', '');
                const pts = nameClean.split('-');
                const idBe = Number(pts[0]);
                const idBs = pts.length > 1 ? Number(pts[1]) : undefined;
                if (idBe > 0) {
                    const mk = (0, utils_1.buildMetadataKey)(idBe, idBs);
                    if (!state.metadataUriByEndpoint.has(mk)) {
                        state.metadataUriByEndpoint.set(mk, vscode.Uri.file(filePath));
                    }
                    if (projectBancos.has(mk)) {
                        allTables.push(...(0, metadata_parser_1.extractMetadataTableNames)(content));
                    }
                }
            }
        }
        catch { /* ignore */ }
        const uniqueTables = Array.from(new Set(allTables)).sort();
        let tablesContext;
        if (uniqueTables.length) {
            tablesContext = `TABELAS DISPONIVEIS NOS METADADOS (formato SCHEMA.TABELA):\n${uniqueTables.join('\n')}\n\nIdentifique quais tabelas sao necessarias e chame aria_obter_colunas_metadados para cada uma.`;
        }
        // Build draft context
        const activeDrafts = state.draftStore.listActive();
        let draftContext;
        if (activeDrafts.length) {
            const draftLines = activeDrafts.map((d) => `- draftId=${d.draftId} projeto=${d.projectId} status=${d.status} endpoint=${(0, utils_1.toStringSafe)(d.endpoint.NO_REST_CUSTOM)}`);
            draftContext = `DRAFTS ATIVOS:\n${draftLines.join('\n')}\nSe o usuario confirmar um draft validado, chame aria_import_endpoint_draft com o draftId.`;
        }
        // Build messages
        const systemPrompt = (0, system_prompt_1.buildSystemPrompt)();
        const contextMsgs = (0, system_prompt_1.buildContextMessages)({
            projectsJson, projects, schemaLockText, selectedProjectText,
            lovsJson, lovsData, formItemsJson,
            tablesContext, noBancoWarning: !tablesContext && projectBancos.size === 0,
            draftContext,
        });
        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            ...contextMsgs.map((m) => vscode.LanguageModelChatMessage.User(m.content)),
        ];
        // Add chat history
        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            }
            else if (turn instanceof vscode.ChatResponseTurn) {
                const text = turn.response
                    .filter((p) => p instanceof vscode.ChatResponseMarkdownPart)
                    .map((p) => p.value.value).join('');
                if (text) {
                    messages.push(vscode.LanguageModelChatMessage.Assistant(text));
                }
            }
        }
        messages.push(vscode.LanguageModelChatMessage.User(request.prompt));
        // Determine available tools
        const ariaTools = vscode.lm.tools.filter((t) => t.name.startsWith('aria_'));
        const hasDraftPending = activeDrafts.some((d) => d.status === 'validated');
        const TOOLS_NORMAL = new Set([
            'aria_obter_colunas_metadados',
            'aria_obter_json_projeto',
            'aria_obter_metadados',
            'aria_create_endpoint_draft',
            'aria_validate_endpoint_draft',
            ...(lovsJson ? [] : ['aria_obter_lovs']),
            ...(hasDraftPending ? ['aria_import_endpoint_draft'] : []),
            // Keep legacy tools for backwards compat
            'aria_importar_json_endpoint',
        ]);
        const toolsForModel = ariaTools.filter((t) => TOOLS_NORMAL.has(t.name));
        output.appendLine(`[${new Date().toISOString()}] @aria: "${request.prompt.slice(0, 120)}", ${messages.length} msgs, ${toolsForModel.length} tools`);
        const debugEnabled = process.env.ARIA_DEBUG === '1';
        if (debugEnabled) {
            output.appendLine('[DEBUG] messages assembled, sending to model...');
        }
        // Detect intent
        const isEndpointMutationIntent = (() => {
            const prompt = (0, utils_1.toStringSafe)(request.prompt).toLowerCase();
            return prompt.includes('endpoint') && /\b(criar|crie|novo|editar|edite|alterar|atualizar|criacao|edicao|alteracao|atualizacao)\b/.test(prompt);
        })();
        let metadataCalledInRequest = false;
        for (let iteration = 0; iteration < 5 && !token.isCancellationRequested; iteration++) {
            let chatResponse;
            try {
                chatResponse = await model.sendRequest(messages, { tools: toolsForModel }, token);
            }
            catch (error) {
                response.markdown(`Erro ao chamar o modelo: ${(0, utils_1.toErrorMessage)(error)}`);
                return;
            }
            const toolCalls = [];
            let bufferedText = '';
            for await (const chunk of chatResponse.stream) {
                try {
                    if (chunk instanceof vscode.LanguageModelTextPart) {
                        bufferedText += chunk.value;
                    }
                    else if (chunk instanceof vscode.LanguageModelToolCallPart) {
                        toolCalls.push(chunk);
                    }
                    if (debugEnabled) {
                        output.appendLine(`[DEBUG] stream chunk: type=${chunk.constructor.name} bufferedLen=${bufferedText.length} toolCalls=${toolCalls.length}`);
                    }
                }
                catch (e) {
                    if (debugEnabled) {
                        output.appendLine(`[DEBUG] error processing stream chunk: ${(0, utils_1.toErrorMessage)(e)}`);
                    }
                }
            }
            if (debugEnabled) {
                output.appendLine(`[DEBUG] model returned bufferedTextLen=${bufferedText.length} toolCalls=${toolCalls.length}`);
            }
            if (toolCalls.length === 0) {
                // Guardrails on text output
                if (isEndpointMutationIntent && (0, sql_policy_validator_1.hasSelectStarInText)(bufferedText)) {
                    messages.push(vscode.LanguageModelChatMessage.User('Regra obrigatoria: nao use SELECT * em SQL. Reescreva com colunas explicitas e aliases camelCase.'));
                    continue;
                }
                if (isEndpointMutationIntent && !metadataCalledInRequest) {
                    // Proactively load metadata for the project's bancos to avoid forcing the model
                    // to call tools (which some models may not do). This injects the metadata
                    // summary into the conversation so the model can continue.
                    try {
                        const loadedKeys = [];
                        for (const metadataKey of projectBancos) {
                            const parts = metadataKey.split(':');
                            const idBe = Number(parts[0]);
                            const idBs = parts[1] !== 'sem-esquema' ? Number(parts[1]) : undefined;
                            if (!(idBe > 0)) {
                                continue;
                            }
                            if (state.metadataUriByEndpoint.has(metadataKey)) {
                                loadedKeys.push(metadataKey);
                                continue;
                            }
                            try {
                                const pseudo = { ID_REST_CUSTOM: 0, NO_REST_CUSTOM: '', TX_PATH: '', ID_BANCO_EXTERNO: idBe };
                                if (idBs && idBs > 0) {
                                    pseudo.ID_BANCO_ESQUEMA = idBs;
                                }
                                const metadata = await state.client.getEndpointMetadata(pseudo);
                                if (metadata) {
                                    const fileName = idBs && idBs > 0 ? `metadata-${idBe}-${idBs}.aria.txt` : `metadata-${idBe}.aria.txt`;
                                    const filePath = path.join(metadataDir, fileName);
                                    await fs.promises.mkdir(metadataDir, { recursive: true });
                                    await fs.promises.writeFile(filePath, metadata, 'utf8');
                                    state.metadataUriByEndpoint.set(metadataKey, vscode.Uri.file(filePath));
                                    state.metadataCatalogByEndpoint.set(metadataKey, (0, metadata_parser_1.parseMetadataMarkdown)(metadata, filePath, metadataKey));
                                    loadedKeys.push(metadataKey);
                                }
                            }
                            catch {
                                // ignore per-key failures
                            }
                        }
                        if (loadedKeys.length) {
                            const summaries = loadedKeys.map((k) => {
                                const uri = state.metadataUriByEndpoint.get(k);
                                const text = fs.readFileSync(uri.fsPath, 'utf8');
                                const schemas = (0, metadata_parser_1.listMetadataSchemas)(text);
                                const tables = (0, metadata_parser_1.extractMetadataTableNames)(text);
                                return `Metadados carregados para ${k}: schemas=${schemas.length} tables=${tables.length}`;
                            });
                            messages.push(vscode.LanguageModelChatMessage.User(`Metadados carregados: ${summaries.join(' ; ')}`));
                            metadataCalledInRequest = true;
                            continue;
                        }
                    }
                    catch (e) {
                        // fallthrough to original behavior if proactive load fails
                        output.appendLine(`[${new Date().toISOString()}] Falha ao pre-carregar metadados: ${(0, utils_1.toErrorMessage)(e)}`);
                        messages.push(vscode.LanguageModelChatMessage.User('Regra obrigatoria: chame aria_obter_metadados antes de propor endpoint.'));
                        metadataCalledInRequest = true;
                        continue;
                    }
                    // if no projectBancos or nothing could be loaded, do not loop — let the model respond as-is
                    metadataCalledInRequest = true;
                }
                if (isEndpointMutationIntent && (0, sql_policy_validator_1.hasQuotedIdentifiersOutsideAliases)(bufferedText)) {
                    messages.push(vscode.LanguageModelChatMessage.User('Reescreva o SQL sem aspas duplas em tabelas/schemas/colunas. Aspas so nos aliases.'));
                    continue;
                }
                if (bufferedText.trim()) {
                    response.markdown(bufferedText);
                }
                break;
            }
            // Include any text the model produced alongside the tool calls so the
            // conversation history is complete (OpenAI requires text+tool_calls in one turn).
            const assistantParts = [
                ...(bufferedText ? [new vscode.LanguageModelTextPart(bufferedText)] : []),
                ...toolCalls,
            ];
            messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));
            for (const tc of toolCalls) {
                response.progress(`Executando ${tc.name}...`);
            }
            const toolResults = [];
            let finalizedAfterImport = false;
            let finalizedMessage = '';
            for (const toolCall of toolCalls) {
                const toolInput = toolCall.input ?? {};
                output.appendLine(`[${new Date().toISOString()}] Tool: ${toolCall.name} input=${JSON.stringify(toolCall.input)}`);
                try {
                    if (toolCall.name === 'aria_create_endpoint_draft') {
                        const hasEndpoint = !!toolInput.endpoint || !!toolInput.NO_REST_CUSTOM || !!toolInput.TX_PATH || !!toolInput.TX_CODIGO;
                        if (!hasEndpoint) {
                            const resolvedProjectId = selectedProject?.ID_PROJETO ?? Number(toolInput.id_projeto);
                            toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, [
                                new vscode.LanguageModelTextPart(`Chamada invalida de aria_create_endpoint_draft: faltou o campo obrigatório \"endpoint\". Use exatamente este formato: aria_create_endpoint_draft({"id_projeto": ${resolvedProjectId > 0 ? resolvedProjectId : '<ID_DO_PROJETO>'}, "endpoint": {"NO_REST_CUSTOM": "...", "TX_PATH": "...", "TX_CODIGO": "...", "ID_METODO": 1, "ID_TIPO_CODIGO": 1, "ID_BANCO_EXTERNO": 1}}). NUNCA envie apenas id_projeto.`)
                            ]));
                            continue;
                        }
                    }
                    // Cache shortcut for metadata
                    if (toolCall.name === 'aria_obter_metadados') {
                        const idBe = Number(toolInput.p_id_banco_externo);
                        const idBs = Number(toolInput.p_id_banco_esquema);
                        const mk = (0, utils_1.buildMetadataKey)(idBe, idBs);
                        const cachedUri = state.metadataUriByEndpoint.get(mk);
                        if (cachedUri) {
                            const text = await fs.promises.readFile(cachedUri.fsPath, 'utf8').catch(() => '');
                            if (text) {
                                const schemas = (0, metadata_parser_1.listMetadataSchemas)(text);
                                const tables = (0, metadata_parser_1.extractMetadataTableNames)(text);
                                toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, [
                                    new vscode.LanguageModelTextPart(`Metadados ja carregados.\n\nSchemas:\n${schemas.map((s) => `- ${s}`).join('\n')}\n\nTabelas:\n${tables.sort().join('\n')}\n\nChame aria_obter_colunas_metadados para cada tabela.`)
                                ]));
                                metadataCalledInRequest = true;
                                response.reference(cachedUri);
                                continue;
                            }
                        }
                    }
                    const result = await vscode.lm.invokeTool(toolCall.name, { input: toolInput, toolInvocationToken: request.toolInvocationToken }, token);
                    if (debugEnabled) {
                        const resultText = result.content.filter((p) => p instanceof vscode.LanguageModelTextPart).map((p) => p.value).join('').slice(0, 400);
                        output.appendLine(`[DEBUG] Tool result ${toolCall.name}: ${resultText}`);
                    }
                    if (toolCall.name === 'aria_importar_json' || toolCall.name === 'aria_importar_json_endpoint' || toolCall.name === 'aria_import_endpoint_draft') {
                        const importText = result.content.filter((p) => p instanceof vscode.LanguageModelTextPart).map((p) => p.value).join('\n');
                        finalizedAfterImport = true;
                        finalizedMessage = importText || 'Importacao processada.';
                        treeRefresh();
                        toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, result.content));
                        break;
                    }
                    toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, result.content));
                    if (toolCall.name === 'aria_obter_metadados') {
                        metadataCalledInRequest = true;
                        const idBe = Number(toolInput.p_id_banco_externo);
                        const idBs = Number(toolInput.p_id_banco_esquema);
                        const uri = state.metadataUriByEndpoint.get((0, utils_1.buildMetadataKey)(idBe, idBs));
                        if (uri) {
                            response.reference(uri);
                        }
                    }
                }
                catch (err) {
                    toolResults.push(new vscode.LanguageModelToolResultPart(toolCall.callId, [
                        new vscode.LanguageModelTextPart(`Erro ao executar ${toolCall.name}: ${(0, utils_1.toErrorMessage)(err)}`)
                    ]));
                }
            }
            if (finalizedAfterImport) {
                response.markdown(finalizedMessage);
                return;
            }
            // Tool results must be sent as User messages so the runtime maps them to the
            // correct "tool" role expected by the underlying API.
            messages.push(vscode.LanguageModelChatMessage.User(toolResults));
        }
    });
    ariaParticipant.iconPath = new vscode.ThemeIcon('database');
    context.subscriptions.push(ariaParticipant);
}
