import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as toml from '@iarna/toml';
import type { AriaDataset, AriaProject, AriaEndpoint, ApiSettings, AriaLovs, AriaBancoEsquema, EditMarker, PreviaPayload } from './core/types';
import { ARIA_EDIT_SCHEME } from './core/constants';
import { toStringSafe, toNumber, toErrorMessage, normalizeEndpointPath, normalizeTextForLookup } from './core/utils';
import { normalizeCodeTypeLabel } from './domain/endpoints/code-type-resolver';
import { resolveEndpointCodeExtension } from './domain/endpoints/code-type-resolver';
import { buildEndpointFromExampleStructure, applyLovDisplayValues } from './domain/endpoints/endpoint-normalizer';
import { validateEndpointPayload } from './domain/validation/endpoint-validator';
import { DraftStore } from './domain/assistant/draft-store';
import { AriaApiClient } from './infrastructure/api/aria-api-client';
import { EntraAuthService, getEntraSettings } from './infrastructure/auth/entra-auth-service';
import { StateStore } from './infrastructure/stores/state-store';
import { AriaTreeProvider, ProjectNode, EndpointNode } from './vscode/tree/tree-provider';
import { ARIA_METADATA_TABLE_MIME, AriaMetadataDragAndDropController, AriaMetadataTreeProvider,
  type MetadataExplorerSelection, type MetadataTableDragPayload } from './vscode/tree/metadata-tree-provider';
import { InMemoryEditFileSystemProvider } from './vscode/editors/virtual-fs-provider';
import { openFormWebview } from './vscode/editors/form-webview';
import { openPreviewParamsWebview } from './vscode/editors/preview-params-webview';
import { SqlPreviewResultViewProvider } from './vscode/editors/preview-result-view';
import { registerTools } from './vscode/assistant/tools';
import { registerChatParticipant } from './vscode/assistant/chat-participant';
import { buildSqlTemplateFromMetadataDrop, type SqlTemplateAction } from './domain/sql/sql-template-builder';

function getSettings(): ApiSettings {
  const config = vscode.workspace.getConfiguration('ariaApi');
  return {
    baseUrl: config.get<string>('baseUrl', 'https://ms-aria.appsdev.ocp.tesouro.gov.br/'),
    fetchProjectPath: config.get<string>('fetchProjectPath', ''),
    ignoreSslErrors: config.get<boolean>('ignoreSslErrors', true),
  };
}

function mergePreservingTypes(original: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const result = { ...original };
  for (const [key, value] of Object.entries(updates)) {
    if (!(key in original)) { continue; }
    result[key] = typeof original[key] === 'number' ? Number(value) : value;
  }
  return result;
}

function isValidateCodeSuccess(status: unknown): boolean {
  const s = toStringSafe(status).toLowerCase().trim();
  return s === 'sucesso' || s === 'ok' || s === 'success';
}

function toYamlText(input: unknown): string {
  const normalized = normalizeMultilineStrings(input);
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    const obj = normalized as Record<string, unknown>;
    // Handle project objects with nested REST_CUSTOM endpoints
    if (Object.prototype.hasOwnProperty.call(obj, 'REST_CUSTOM') && Array.isArray(obj.REST_CUSTOM)) {
      const withoutRest = { ...obj } as Record<string, unknown>;
      const rest = (withoutRest.REST_CUSTOM as unknown[]) || [];
      delete withoutRest.REST_CUSTOM;
      const head = yaml.dump(withoutRest, { noRefs: true, sortKeys: false, lineWidth: -1 }).trimEnd();

      const entries: string[] = [];
      for (const epRaw of rest) {
        const ep = normalizeMultilineStrings(epRaw) as Record<string, unknown>;
        const tx = ep && typeof ep === 'object' && Object.prototype.hasOwnProperty.call(ep, 'TX_CODIGO') ? toStringSafe(ep['TX_CODIGO']) : undefined;
        const epWithout = { ...(ep as Record<string, unknown>) };
        delete epWithout.TX_CODIGO;
        const dumpedEp = yaml.dump(epWithout, { noRefs: true, sortKeys: false, lineWidth: -1 }).trim();
        const baseLines = dumpedEp.length ? dumpedEp.split('\n') : [];
        const prefixedLines = baseLines.map((l, i) => i === 0 ? `  - ${l}` : `    ${l}`);
        if (tx !== undefined) {
          const normalizedTx = tx.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\u000A/g, '\n').replace(/\\u000D/g, '\r');
          const txLines = normalizedTx.split(/\r\n|\r|\n/);
          prefixedLines.push('    TX_CODIGO: |-');
          for (const l of txLines) { prefixedLines.push(`      ${l}`); }
        }
        entries.push(prefixedLines.join('\n'));
      }

      const restBlock = `REST_CUSTOM:\n${entries.join('\n')}`;
      const prefix = head && String(head).trim().length > 0 ? `${head}\n` : '';
      return `${prefix}${restBlock}\n`;
    }

    if (Object.prototype.hasOwnProperty.call(obj, 'TX_CODIGO')) {
      const tx = toStringSafe(obj['TX_CODIGO']);
      const without = { ...obj } as Record<string, unknown>;
      delete without.TX_CODIGO;
      const dumped = yaml.dump(without, { noRefs: true, sortKeys: false, lineWidth: -1 });
      // Build block literal for TX_CODIGO preserving CRLF and LF sequences
      const normalizedTx = tx.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\u000A/g, '\n').replace(/\\u000D/g, '\r');
      const lines = normalizedTx.split(/\r\n|\r|\n/);
      const indented = lines.map((l) => `  ${l}`).join('\n');
      const block = `TX_CODIGO: |-\n${indented}\n`;
      const prefix = (dumped && String(dumped).trim().length > 0) ? `${dumped.trimEnd()}\n` : '';
      return `${prefix}${block}`;
    }
  }
  return yaml.dump(normalized, { noRefs: true, sortKeys: false, lineWidth: -1 });
}

function toTomlText(input: unknown): string {
  const normalized = normalizeMultilineStrings(input) as Record<string, unknown>;
  if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    const obj = normalized as Record<string, unknown>;
    // Handle project objects with REST_CUSTOM array -> TOML tables
    if (Object.prototype.hasOwnProperty.call(obj, 'REST_CUSTOM') && Array.isArray(obj.REST_CUSTOM)) {
      const withoutRest = { ...obj } as Record<string, unknown>;
      const rest = (withoutRest.REST_CUSTOM as unknown[]) || [];
      delete withoutRest.REST_CUSTOM;
      const head = toml.stringify(withoutRest as toml.JsonMap).trimEnd();
      const tables: string[] = [];
      for (const epRaw of rest) {
        const ep = normalizeMultilineStrings(epRaw) as Record<string, unknown>;
        const tx = ep && typeof ep === 'object' && Object.prototype.hasOwnProperty.call(ep, 'TX_CODIGO') ? toStringSafe(ep['TX_CODIGO']) : undefined;
        const epWithout = { ...(ep as Record<string, unknown>) };
        delete epWithout.TX_CODIGO;
        const dumpedEp = toml.stringify(epWithout as toml.JsonMap).trim();
        const prefix = `[[REST_CUSTOM]]\n`;
        if (tx !== undefined) {
          const normalizedTx = tx.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\u000A/g, '\n').replace(/\\u000D/g, '\r');
          const escaped = normalizedTx.replace(/"""/g, '\\"\\"\\"');
          tables.push(`${prefix}${dumpedEp}\nTX_CODIGO = """${escaped}"""`);
        } else {
          tables.push(`${prefix}${dumpedEp}`);
        }
      }
      const prefixHead = head && String(head).trim().length > 0 ? `${head}\n\n` : '';
      return `${prefixHead}${tables.join('\n\n')}\n`;
    }

    if (Object.prototype.hasOwnProperty.call(obj, 'TX_CODIGO')) {
      const tx = toStringSafe(obj['TX_CODIGO']);
      const without = { ...obj } as Record<string, unknown>;
      delete without.TX_CODIGO;
      const dumped = toml.stringify(without as toml.JsonMap);
      // Preserve CRLF and LF; escape triple quotes inside the content
      const normalizedTx = tx.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\u000A/g, '\n').replace(/\\u000D/g, '\r');
      const escaped = normalizedTx.replace(/"""/g, '\\"\\"\\"');
      const block = `TX_CODIGO = """${escaped}"""\n`;
      const prefix = (dumped && String(dumped).trim().length > 0) ? `${dumped.trimEnd()}\n` : '';
      return `${prefix}${block}`;
    }
  }
  return toml.stringify(normalized as toml.JsonMap);
}

function normalizeMultilineStrings(value: unknown): unknown {
  if (value == null) { return value; }
  if (typeof value === 'string') {
    // Convert literal backslash-n sequences into real newlines for readability
    return value.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n');
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeMultilineStrings(v));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeMultilineStrings(v);
    }
    return out;
  }
  return value;
}

function parseYamlObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (error) {
    throw new Error(`YAML invalido em ${label}: ${toErrorMessage(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`YAML invalido em ${label}: esperado um objeto no nivel raiz.`);
  }

  return parsed as Record<string, unknown>;
}

function parseTomlObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = toml.parse(text);
  } catch (error) {
    throw new Error(`TOML invalido em ${label}: ${toErrorMessage(error)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`TOML invalido em ${label}: esperado um objeto no nivel raiz.`);
  }

  return parsed as Record<string, unknown>;
}

async function ensureEditFilePath(fileName: string): Promise<string> {
  const editDir = path.join(os.tmpdir(), 'aria-edit');
  await fs.promises.mkdir(editDir, { recursive: true });
  return path.join(editDir, fileName);
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('ARIA API Editor');
  // Enable debug logs for assistant/troubleshooting when requested
  process.env.ARIA_DEBUG = process.env.ARIA_DEBUG ?? '1';
  if (process.env.ARIA_DEBUG === '1') { output.appendLine('[DEBUG] ARIA_DEBUG enabled'); }
  const draftStore = new DraftStore();
  const state = new StateStore(draftStore);
  const authService = new EntraAuthService();
  const virtualEditProvider = new InMemoryEditFileSystemProvider();
  const tree = new AriaTreeProvider(() => state.dataset);
  const metadataTree = new AriaMetadataTreeProvider();
  const metadataDragAndDrop = new AriaMetadataDragAndDropController();
  const metadataTreeView = vscode.window.createTreeView('ariaMetadataView', {
    treeDataProvider: metadataTree,
    dragAndDropController: metadataDragAndDrop,
    showCollapseAll: true,
  });
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);

  const updateStatusBar = (loggedIn: boolean) => {
    void vscode.commands.executeCommand('setContext', 'aria.isLoggedIn', loggedIn);
    if (loggedIn) {
      statusBarItem.text = '$(cloud-upload) ARIA: Conectado';
      statusBarItem.command = 'aria.logout';
      statusBarItem.tooltip = 'Desconectar ARIA';
    } else {
      statusBarItem.text = '$(cloud) ARIA: Desconectado';
      statusBarItem.command = 'aria.connect';
      statusBarItem.tooltip = 'Conectar ARIA';
    }
    statusBarItem.show();
  };

  context.subscriptions.push(
    output,
    vscode.workspace.registerFileSystemProvider(ARIA_EDIT_SCHEME, virtualEditProvider, { isCaseSensitive: true, isReadonly: false }),
    vscode.window.registerTreeDataProvider('ariaProjectsView', tree),
    metadataTreeView,
    statusBarItem
  );

  // ── Helpers ─────────────────────────────────────────────────────────────

  const createVirtualEditUri = (fileName: string): vscode.Uri =>
    vscode.Uri.from({ scheme: ARIA_EDIT_SCHEME, path: `/${fileName}` });

  const shouldUsePhysicalTempFiles = (): boolean => (vscode.workspace.workspaceFolders?.length ?? 0) > 0;

  const openVirtualEditDocument = async (fileName: string, content: string, language?: string): Promise<vscode.TextDocument> => {
    const uri = createVirtualEditUri(fileName);
    virtualEditProvider.setContent(uri, content);
    const doc = await vscode.workspace.openTextDocument(uri);
    if (language && doc.languageId !== language) { await vscode.languages.setTextDocumentLanguage(doc, language); }
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc;
  };

  const openPhysicalTempEditDocument = async (fileName: string, content: string, language?: string): Promise<vscode.TextDocument> => {
    const filePath = await ensureEditFilePath(fileName);
    await fs.promises.writeFile(filePath, content, 'utf8');
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    if (language && doc.languageId !== language) { await vscode.languages.setTextDocumentLanguage(doc, language); }
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc;
  };

  const openEditableDocument = async (fileName: string, content: string, language?: string): Promise<vscode.TextDocument> =>
    openPhysicalTempEditDocument(fileName, content, language);

  const validateEndpointCodeBeforeSave = async (endpoint: Record<string, unknown>): Promise<void> => {
    const result = await state.getClient().validateCode({
      idTipoCodigo: endpoint.ID_TIPO_CODIGO,
      idBancoExterno: endpoint.ID_BANCO_EXTERNO,
      snModoCompatibilidade: endpoint.SN_MODO_COMPATIBILIDADE,
      idBancoEsquema: endpoint.ID_BANCO_ESQUEMA,
      txCodigo: toStringSafe(endpoint.TX_CODIGO),
    });
    if (!isValidateCodeSuccess(result.status)) {
      throw new Error(toStringSafe(result.mensagem) || 'Validacao remota do codigo falhou.');
    }
  };

  const extractSqlParameters = (query: string): string[] => {
    const seen = new Set<string>();
    const params: string[] = [];
    for (const match of query.matchAll(/:([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
      const name = String(match[1]).toUpperCase();
      if (seen.has(name)) { continue; }
      seen.add(name);
      params.push(name);
    }
    return params;
  };

  const buildPreviewPayload = (endpoint: Record<string, unknown>): PreviaPayload => {
    const query = toStringSafe(endpoint.TX_CODIGO).trim();
    if (!query) { throw new Error('A query SQL esta vazia.'); }
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

  const resolvePreviewContextForActiveEditor = async (editor: vscode.TextEditor): Promise<{ title: string; payload: PreviaPayload; source: Record<string, unknown> }> => {
    const marker = state.editMap.get(editor.document.uri.toString());
    if (!marker || (marker.type !== 'endpointCode' && marker.type !== 'endpointJson' && marker.type !== 'endpointYaml' && marker.type !== 'endpointToml')) {
      throw new Error('Previa disponivel apenas para editores de endpoint em codigo, JSON, YAML ou TOML.');
    }

    const project = await state.getProjectDetails(marker.projectId);
    const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === marker.id);
    if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }

    let previewSource: Record<string, unknown>;
    if (marker.type === 'endpointCode') {
      previewSource = { ...endpoint, TX_CODIGO: editor.document.getText() };
    } else {
      let parsed: Record<string, unknown>;
      if (marker.type === 'endpointJson') {
        try {
          parsed = JSON.parse(editor.document.getText()) as Record<string, unknown>;
        } catch (error) {
          throw new Error(`JSON invalido no editor: ${toErrorMessage(error)}`);
        }
      } else if (marker.type === 'endpointYaml') {
        parsed = parseYamlObject(editor.document.getText(), 'editor de endpoint');
      } else {
        parsed = parseTomlObject(editor.document.getText(), 'editor de endpoint');
      }
      previewSource = { ...endpoint, ...parsed, ID_REST_CUSTOM: endpoint.ID_REST_CUSTOM };
    }

    if (toNumber(previewSource.ID_TIPO_CODIGO) !== 1) {
      throw new Error('Previa de dados disponivel apenas para endpoints SQL.');
    }

    return {
      title: `Previa SQL: ${toStringSafe(endpoint.NO_REST_CUSTOM) || `Endpoint ${marker.id}`}`,
      source: previewSource,
      payload: buildPreviewPayload(previewSource),
    };
  };

  const resolveMetadataSelectionForActiveEditor = async (editor: vscode.TextEditor): Promise<MetadataExplorerSelection | undefined> => {
    const marker = state.editMap.get(editor.document.uri.toString());
    if (!marker || (marker.type !== 'endpointCode' && marker.type !== 'endpointJson' && marker.type !== 'endpointYaml' && marker.type !== 'endpointToml')) {
      throw new Error('Metadados disponiveis apenas para editores de endpoint em codigo, JSON, YAML ou TOML.');
    }

    const project = await state.getProjectDetails(marker.projectId);
    const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === marker.id);
    if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }

    let sourceEndpoint: Record<string, unknown> = endpoint as Record<string, unknown>;
    if (marker.type === 'endpointJson') {
      try {
        const parsed = JSON.parse(editor.document.getText()) as Record<string, unknown>;
        sourceEndpoint = { ...endpoint, ...parsed, ID_REST_CUSTOM: endpoint.ID_REST_CUSTOM };
      } catch (error) {
        throw new Error(`JSON invalido no editor: ${toErrorMessage(error)}`);
      }
    } else if (marker.type === 'endpointYaml') {
      const parsed = parseYamlObject(editor.document.getText(), 'editor de endpoint');
      sourceEndpoint = { ...endpoint, ...parsed, ID_REST_CUSTOM: endpoint.ID_REST_CUSTOM };
    } else if (marker.type === 'endpointToml') {
      const parsed = parseTomlObject(editor.document.getText(), 'editor de endpoint');
      sourceEndpoint = { ...endpoint, ...parsed, ID_REST_CUSTOM: endpoint.ID_REST_CUSTOM };
    }

    const idBancoExterno = toNumber(sourceEndpoint.ID_BANCO_EXTERNO);
    if (idBancoExterno <= 0) {
      throw new Error('O endpoint nao possui ID_BANCO_EXTERNO preenchido.');
    }

    const idBancoEsquemaRaw = toNumber(sourceEndpoint.ID_BANCO_ESQUEMA);
    const idBancoEsquema = idBancoEsquemaRaw > 0 ? idBancoEsquemaRaw : undefined;
    const lovs = await state.getProjectLovs(undefined);
    const banco = lovs?.BANCO_EXTERNO?.find((item) => item.ID_BANCO_EXTERNO === idBancoExterno);
    const schema = banco?.BANCO_ESQUEMA.find((item) => item.ID_BANCO_ESQUEMA === idBancoEsquema);

    return {
      projectId: marker.projectId,
      projectName: project.NO_PROJETO,
      idBancoExterno,
      bancoLabel: banco?.CO_BANCO_EXTERNO || `Banco ${idBancoExterno}`,
      idBancoEsquema,
      schemaLabel: schema?.NO_ESQUEMA,
      txDataSource: banco?.TX_DATASOURCE,
      sourceLabel: `${toStringSafe(sourceEndpoint.NO_REST_CUSTOM) || `Endpoint ${marker.id}`} (${toStringSafe(sourceEndpoint.TX_PATH)})`,
    };
  };

  const hasEndpointNodeShape = (value: unknown): value is EndpointNode => {
    const candidate = value as Partial<EndpointNode> | undefined;
    return !!candidate
      && typeof candidate === 'object'
      && !!candidate.project
      && typeof candidate.project === 'object'
      && typeof candidate.project.ID_PROJETO === 'number';
  };

  let activePreviewSession: { title: string; payload: PreviaPayload; source?: Record<string, unknown> } | undefined;
  let previewResultView: SqlPreviewResultViewProvider;

  const ensurePreviewPanelVisible = async (): Promise<void> => {
    await vscode.commands.executeCommand('ariaQueryResultView.focus');
  };

  const runPreviewExecution = async (payload: PreviaPayload): Promise<void> => {
    if (!state.client) { throw new Error('Sem conexao ativa com a API.'); }
    if (!activePreviewSession) { throw new Error('Sessao de previa nao inicializada.'); }
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
    } catch (error) {
      previewResultView.setError(toErrorMessage(error));
      throw error;
    }
  };

  previewResultView = new SqlPreviewResultViewProvider(async (action) => {
    if (!activePreviewSession) { return; }
    const current = activePreviewSession.payload;
    const nextPayload = action === 'prev'
      ? { ...current, pagina: Math.max((Number(current.pagina) || 1) - 1, 1) }
      : action === 'next'
        ? { ...current, pagina: (Number(current.pagina) || 1) + 1 }
        : current;
    await runPreviewExecution(nextPayload);
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('ariaQueryResultView', previewResultView, { webviewOptions: { retainContextWhenHidden: true } })
  );

  context.subscriptions.push(
    vscode.languages.registerDocumentDropEditProvider(
      [{ scheme: ARIA_EDIT_SCHEME }, { scheme: 'file' }],
      {
        provideDocumentDropEdits: async (document, _position, dataTransfer) => {
          if (!state.editMap.has(document.uri.toString())) { return undefined; }
          const fileName = path.basename(document.uri.path).toLowerCase();
          if (!/^endpoint-.*\.aria\.(json|yaml|yml|toml|sql|py)$/.test(fileName)) { return undefined; }

          const dropped = dataTransfer.get(ARIA_METADATA_TABLE_MIME);
          if (!dropped) { return undefined; }

          let payload: MetadataTableDragPayload;
          try {
            payload = JSON.parse(await dropped.asString()) as MetadataTableDragPayload;
          } catch {
            return undefined;
          }

          let endpointCodeType: 'SQL' | 'PLSQL' | 'PYTHON' = 'SQL';
          const marker = state.editMap.get(document.uri.toString());
          if (marker && (marker.type === 'endpointCode' || marker.type === 'endpointJson' || marker.type === 'endpointYaml' || marker.type === 'endpointToml')) {
            try {
              const project = await state.getProjectDetails(marker.projectId);
              const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === marker.id);
              if (endpoint) {
                const tipoCodigoId = toNumber(endpoint.ID_TIPO_CODIGO);
                const tipoCodigoLabel = normalizeCodeTypeLabel(endpoint.NO_TIPO_CODIGO);
                if (tipoCodigoId === 3 || tipoCodigoLabel === 'PYTHON') {
                  endpointCodeType = 'PYTHON';
                } else if (tipoCodigoId === 2 || tipoCodigoLabel === 'PLSQL') {
                  endpointCodeType = 'PLSQL';
                }
              }
            } catch {
              endpointCodeType = 'SQL';
            }
          }

          const sqlActions = [
            { label: 'SELECT', value: 'select' as SqlTemplateAction },
            { label: 'INSERT', value: 'insert' as SqlTemplateAction },
            { label: 'UPDATE', value: 'update' as SqlTemplateAction },
            { label: 'DELETE', value: 'delete' as SqlTemplateAction },
          ];
          const plsqlActions = [
            { label: 'PL/SQL: FOR LOOP', value: 'plsql_for_loop' as SqlTemplateAction },
            { label: 'PL/SQL: SELECT INTO %ROWTYPE', value: 'plsql_select_into_rowtype' as SqlTemplateAction },
            { label: 'PL/SQL: SELECT INTO (campos)', value: 'plsql_select_into_fields' as SqlTemplateAction },
            { label: 'PL/SQL: BULK COLLECT INTO', value: 'plsql_bulk_collect_into' as SqlTemplateAction },
          ];
          const pythonActions = [
            { label: 'Python: FOR (cursor.fetchall)', value: 'python_for_loop' as SqlTemplateAction },
            { label: 'Python: SELECT INTO objeto (fetchone)', value: 'python_select_into_obj' as SqlTemplateAction },
            { label: 'Python: SELECT INTO campos', value: 'python_select_into_fields' as SqlTemplateAction },
            { label: 'Python: BULK COLLECT (fetchall)', value: 'python_bulk_collect_into' as SqlTemplateAction },
          ];

          const quickPickItems = endpointCodeType === 'PLSQL'
            ? [...sqlActions, ...plsqlActions]
            : endpointCodeType === 'PYTHON'
              ? [...sqlActions, ...pythonActions]
              : sqlActions;
          const templateLabel = endpointCodeType === 'PLSQL'
            ? 'SQL/PLSQL'
            : endpointCodeType === 'PYTHON'
              ? 'SQL/Python'
              : 'SQL';

          const picked = await vscode.window.showQuickPick(
            quickPickItems,
            {
              placeHolder: `Inserir template ${templateLabel} para ${payload.fullName}`,
              ignoreFocusOut: true,
            }
          );

          if (!picked) { return new vscode.DocumentDropEdit(''); }
          return new vscode.DocumentDropEdit(`${buildSqlTemplateFromMetadataDrop(payload, picked.value)}\n`);
        },
      }
    )
  );

  const pickMetadataSelection = async (): Promise<MetadataExplorerSelection | undefined> => {
    const lovs = await state.getProjectLovs(undefined);
    const bancos = lovs?.BANCO_EXTERNO ?? [];
    if (bancos.length === 0) {
      vscode.window.showWarningMessage('As LOVs nao retornaram conexoes de banco externo.');
      return undefined;
    }

    const bancoItems = bancos
      .slice()
      .sort((left, right) => left.CO_BANCO_EXTERNO.localeCompare(right.CO_BANCO_EXTERNO))
      .map((banco) => ({
        label: banco.CO_BANCO_EXTERNO,
        description: `ID ${banco.ID_BANCO_EXTERNO}`,
        detail: banco.BANCO_ESQUEMA.length > 0 ? `${banco.BANCO_ESQUEMA.length} esquema(s)` : 'Sem esquemas cadastrados',
        banco,
      }));
    const pickedBanco = await vscode.window.showQuickPick(bancoItems, { placeHolder: 'Selecione o banco externo' });
    if (!pickedBanco) { return undefined; }

    const schemaItems = [
      {
        label: 'Conexão Padrão',
        description: 'Consulta sem filtro de banco esquema',
        schema: undefined as AriaBancoEsquema | undefined,
      },
      ...pickedBanco.banco.BANCO_ESQUEMA
        .slice()
        .sort((left, right) => left.NO_ESQUEMA.localeCompare(right.NO_ESQUEMA))
        .map((schema) => ({
          label: schema.NO_ESQUEMA,
          description: `ID ${schema.ID_BANCO_ESQUEMA}`,
          schema,
        })),
    ];
    const pickedSchema = await vscode.window.showQuickPick(schemaItems, { placeHolder: 'Selecione o banco esquema (opcional)' });
    if (!pickedSchema) { return undefined; }

    return {
      projectId: 0,
      projectName: 'Conexao global',
      idBancoExterno: pickedBanco.banco.ID_BANCO_EXTERNO,
      bancoLabel: pickedBanco.banco.CO_BANCO_EXTERNO,
      idBancoEsquema: pickedSchema.schema?.ID_BANCO_ESQUEMA,
      schemaLabel: pickedSchema.schema?.NO_ESQUEMA,
      txDataSource: pickedBanco.banco.TX_DATASOURCE,
    };
  };

  const loadMetadataIntoExplorer = async (
    selection: MetadataExplorerSelection,
    options?: { forceRefresh?: boolean }
  ): Promise<void> => {
    const indicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: carregando metadados...');
    try {
      const catalog = await state.ensureMetadataCatalog(selection.idBancoExterno, selection.idBancoEsquema, options);
      if (!catalog) {
        throw new Error('A API nao retornou metadados para o banco informado.');
      }
      metadataTree.setCatalog(selection, catalog);
      await vscode.commands.executeCommand('ariaMetadataView.focus');
    } finally {
      indicator.dispose();
    }
  };

  const resolveMetadataSelectionFromEndpoint = async (node: EndpointNode): Promise<MetadataExplorerSelection | undefined> => {
    const project = await state.getProjectDetails(node.project.ID_PROJETO);
    const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
    if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }

    const idBancoExterno = toNumber(endpoint.ID_BANCO_EXTERNO);
    if (idBancoExterno <= 0) {
      vscode.window.showWarningMessage('O endpoint selecionado nao possui ID_BANCO_EXTERNO preenchido.');
      return undefined;
    }

    const idBancoEsquemaRaw = toNumber(endpoint.ID_BANCO_ESQUEMA);
    const idBancoEsquema = idBancoEsquemaRaw > 0 ? idBancoEsquemaRaw : undefined;
    const lovs = await state.getProjectLovs(node.project.ID_PROJETO);
    const banco = lovs?.BANCO_EXTERNO?.find((item) => item.ID_BANCO_EXTERNO === idBancoExterno);
    const schema = banco?.BANCO_ESQUEMA.find((item) => item.ID_BANCO_ESQUEMA === idBancoEsquema);

    return {
      projectId: node.project.ID_PROJETO,
      projectName: node.project.NO_PROJETO,
      idBancoExterno,
      bancoLabel: banco?.CO_BANCO_EXTERNO || `Banco ${idBancoExterno}`,
      idBancoEsquema,
      schemaLabel: schema?.NO_ESQUEMA,
      txDataSource: banco?.TX_DATASOURCE,
      sourceLabel: `${node.endpoint.NO_REST_CUSTOM} (${node.endpoint.TX_PATH})`,
    };
  };

  const saveWithFreshDataset = async (
    source: string, projectId: number, mutate: (draft: AriaDataset) => void | Promise<void>
  ): Promise<void> => {
    const client = state.getClient();
    const freshDataset = await client.getDatasetByProjectId(projectId);
    if (freshDataset.registros.length !== 1) { throw new Error(`Esperado 1 projeto, retornados ${freshDataset.registros.length}.`); }
    const draftProject = freshDataset.registros[0];
    for (const ep of draftProject.REST_CUSTOM ?? []) {
      ep.SN_MODO_COMPATIBILIDADE = 'N';
      if (ep.IN_TIPO_TRANSFORMACAO === '') { ep.IN_TIPO_TRANSFORMACAO = null; }
    }

    await mutate(freshDataset);

    // Validate code for relevant endpoints
    if (source.startsWith('endpointCode:') || source.startsWith('endpointJson:') || source.startsWith('endpointYaml:') || source.startsWith('endpointToml:') || source.startsWith('endpointForm:')) {
      const endpointId = Number(source.split(':')[1]);
      for (const ep of draftProject.REST_CUSTOM.filter((e) => e.ID_REST_CUSTOM === endpointId)) {
        await validateEndpointCodeBeforeSave(ep as Record<string, unknown>);
      }
    } else if (source.startsWith('createEndpoint:')) {
      const previousIds = new Set(draftProject.REST_CUSTOM.map((e) => e.ID_REST_CUSTOM));
      for (const ep of draftProject.REST_CUSTOM.filter((e) => !previousIds.has(e.ID_REST_CUSTOM))) {
        await validateEndpointCodeBeforeSave(ep as Record<string, unknown>);
      }
    } else if (source.startsWith('projectJson:') || source.startsWith('projectYaml:') || source.startsWith('projectToml:')) {
      for (const ep of draftProject.REST_CUSTOM) {
        await validateEndpointCodeBeforeSave(ep as Record<string, unknown>);
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

  const saveDatasetWithFreshSnapshot = async (
    source: string,
    mutate: (draft: AriaDataset) => void | Promise<void>
  ): Promise<void> => {
    const client = state.getClient();
    const freshDataset = await client.getProjectEndpointTree();
    for (const project of freshDataset.registros) {
      for (const ep of project.REST_CUSTOM ?? []) {
        ep.SN_MODO_COMPATIBILIDADE = 'N';
        if (ep.IN_TIPO_TRANSFORMACAO === '') { ep.IN_TIPO_TRANSFORMACAO = null; }
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

  const saveProjectWithFreshSnapshot = async (
    source: string,
    projectPayload: Record<string, unknown>
  ): Promise<void> => {
    const client = state.getClient();
    const freshDataset = await client.getProjectEndpointTree();
    const projectPath = toStringSafe(projectPayload.TX_PATH).trim().toLowerCase();
    if (!projectPath) { throw new Error('Path do projeto e obrigatorio.'); }
    if (freshDataset.registros.some((project) => toStringSafe(project.TX_PATH).trim().toLowerCase() === projectPath)) {
      throw new Error(`Ja existe projeto com TX_PATH "${toStringSafe(projectPayload.TX_PATH).trim()}".`);
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

  const saveEditedDocument = async (document: vscode.TextDocument): Promise<void> => {
    const marker = state.editMap.get(document.uri.toString());
    if (!marker) { return; }
    const text = document.getText();
    const savingIndicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: salvando via API...');
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'ARIA: Salvando alteracoes via API...' },
        async () => {
          await saveWithFreshDataset(`${marker.type}:${marker.id}`, marker.projectId, async (draft) => {
            if (marker.type === 'endpointCode') {
              for (const project of draft.registros) {
                const idx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                if (idx >= 0) { project.REST_CUSTOM[idx] = { ...project.REST_CUSTOM[idx], TX_CODIGO: text }; return; }
              }
              throw new Error('Endpoint nao encontrado no cache.');
            }
            if (marker.type === 'projectJson') {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              const idx = draft.registros.findIndex((p) => p.ID_PROJETO === marker.id);
              if (idx < 0) { throw new Error('Projeto nao encontrado.'); }
              draft.registros[idx] = { ...draft.registros[idx], ...parsed, ID_PROJETO: marker.id, REST_CUSTOM: (parsed.REST_CUSTOM as AriaEndpoint[]) || draft.registros[idx].REST_CUSTOM };
              return;
            }
            if (marker.type === 'projectYaml') {
              const parsed = parseYamlObject(text, 'editor de projeto');
              const idx = draft.registros.findIndex((p) => p.ID_PROJETO === marker.id);
              if (idx < 0) { throw new Error('Projeto nao encontrado.'); }
              draft.registros[idx] = { ...draft.registros[idx], ...parsed, ID_PROJETO: marker.id, REST_CUSTOM: (parsed.REST_CUSTOM as AriaEndpoint[]) || draft.registros[idx].REST_CUSTOM };
              return;
            }
            if (marker.type === 'projectToml') {
              const parsed = parseTomlObject(text, 'editor de projeto');
              const idx = draft.registros.findIndex((p) => p.ID_PROJETO === marker.id);
              if (idx < 0) { throw new Error('Projeto nao encontrado.'); }
              draft.registros[idx] = { ...draft.registros[idx], ...parsed, ID_PROJETO: marker.id, REST_CUSTOM: (parsed.REST_CUSTOM as AriaEndpoint[]) || draft.registros[idx].REST_CUSTOM };
              return;
            }
            if (marker.type === 'endpointYaml') {
              const parsed = parseYamlObject(text, 'editor de endpoint');
              for (const project of draft.registros) {
                const idx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                if (idx >= 0) { project.REST_CUSTOM[idx] = { ...project.REST_CUSTOM[idx], ...parsed, ID_REST_CUSTOM: marker.id }; return; }
              }
              throw new Error('Endpoint nao encontrado.');
            }
            if (marker.type === 'endpointToml') {
              const parsed = parseTomlObject(text, 'editor de endpoint');
              for (const project of draft.registros) {
                const idx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                if (idx >= 0) { project.REST_CUSTOM[idx] = { ...project.REST_CUSTOM[idx], ...parsed, ID_REST_CUSTOM: marker.id }; return; }
              }
              throw new Error('Endpoint nao encontrado.');
            }
            const parsed = JSON.parse(text) as Record<string, unknown>;
            for (const project of draft.registros) {
              const idx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
              if (idx >= 0) { project.REST_CUSTOM[idx] = { ...project.REST_CUSTOM[idx], ...parsed, ID_REST_CUSTOM: marker.id }; return; }
            }
            throw new Error('Endpoint nao encontrado.');
          });
        }
      );
      vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
    } finally { savingIndicator.dispose(); }
  };

  // ── Event: save virtual document ────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (document) => {
      if (!state.editMap.has(document.uri.toString())) { return; }
      try { await saveEditedDocument(document); }
      catch (error) { vscode.window.showErrorMessage(`Falha ao salvar: ${toErrorMessage(error)}`); }
    })
  );

  // ── Login state ─────────────────────────────────────────────────────────
  const entraSettings = getEntraSettings();
  void authService.updateLoginState(!entraSettings.requireLogin);
  // check existing session without prompting: if user already logged in, set state
  void authService.ensureEntraLogin(false);
  // update status bar based on auth state and listen to changes
  updateStatusBar(authService.getIsLoggedIn());
  context.subscriptions.push(authService.onLoginStateChanged(updateStatusBar));

  // ── Commands ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('aria.connect', async () => {
      if (!(await authService.ensureEntraLogin())) { return; }
      const settings = getSettings();
      try {
        await state.client?.close();
        state.client = new AriaApiClient(settings, authService.createAccessTokenProvider(), (msg) => output.appendLine(msg));
        await state.client.connect();
        state.resetCaches();
        state.dataset = await state.client.getProjectEndpointTree();
        tree.refresh();
        metadataTree.clear();
        vscode.window.showInformationMessage(`Conectado. ${state.dataset.registros.length} projeto(s) carregados.`);
      } catch (error) { vscode.window.showErrorMessage(`Erro ao conectar: ${toErrorMessage(error)}`); }
    }),

    vscode.commands.registerCommand('aria.logout', async () => {
      try {
        await authService.logout();
        await state.client?.close();
        state.client = undefined;
        state.dataset = undefined;
        tree.refresh();
        metadataTree.clear();
        vscode.window.showInformationMessage('Desconectado.');
      } catch (error) { vscode.window.showErrorMessage(`Falha ao deslogar: ${toErrorMessage(error)}`); }
    }),

    vscode.commands.registerCommand('aria.refreshTree', async () => {
      if (!state.client) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      try { state.dataset = await state.client.getProjectEndpointTree(); tree.refresh(); }
      catch (error) { vscode.window.showErrorMessage(`Erro ao atualizar: ${toErrorMessage(error)}`); }
    }),

    vscode.commands.registerCommand('aria.searchTree', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Buscar em projetos/endpoints (ignora acentos e maiúsculas)',
        placeHolder: 'Digite nome do projeto, endpoint ou caminho',
      });
      if (value === undefined) { return; }
      if (!value.trim()) { tree.clearSearchQuery(); return; }
      tree.setSearchQuery(value);
    }),

    vscode.commands.registerCommand('aria.clearTreeSearch', () => {
      tree.clearSearchQuery();
    }),

    vscode.commands.registerCommand('aria.loadMetadataExplorer', async () => {
      if (!state.client) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      try {
        const selection = await pickMetadataSelection();
        if (!selection) { return; }
        await loadMetadataIntoExplorer(selection);
      } catch (error) {
        vscode.window.showErrorMessage(`Falha ao carregar metadados: ${toErrorMessage(error)}`);
      }
    }),

    vscode.commands.registerCommand('aria.refreshMetadataExplorer', async () => {
      if (!state.client) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      const selection = metadataTree.getSelection();
      if (!selection) {
        vscode.window.showWarningMessage('Nenhum metadata carregado no explorador.');
        return;
      }
      try {
        await loadMetadataIntoExplorer(selection, { forceRefresh: true });
      } catch (error) {
        vscode.window.showErrorMessage(`Falha ao atualizar metadados: ${toErrorMessage(error)}`);
      }
    }),

    vscode.commands.registerCommand('aria.searchMetadataExplorer', async () => {
      const value = await vscode.window.showInputBox({
        prompt: 'Buscar em schemas/tabelas/colunas (ignora acentos e maiúsculas)',
        placeHolder: 'Digite schema, tabela ou coluna',
      });
      if (value === undefined) { return; }
      if (!value.trim()) { metadataTree.clearSearchQuery(); return; }
      metadataTree.setSearchQuery(value);
    }),

    vscode.commands.registerCommand('aria.clearMetadataSearch', () => {
      metadataTree.clearSearchQuery();
    }),

    vscode.commands.registerCommand('aria.editProjectJson', async (node?: ProjectNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const doc = await openEditableDocument(`project-${node.project.ID_PROJETO}.aria.json`, JSON.stringify(project, null, 2), 'json');
      state.editMap.set(doc.uri.toString(), { type: 'projectJson', id: node.project.ID_PROJETO, projectId: node.project.ID_PROJETO });
    }),

    vscode.commands.registerCommand('aria.editProjectYaml', async (node?: ProjectNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const doc = await openEditableDocument(`project-${node.project.ID_PROJETO}.aria.yaml`, toYamlText(project), 'yaml');
      state.editMap.set(doc.uri.toString(), { type: 'projectYaml', id: node.project.ID_PROJETO, projectId: node.project.ID_PROJETO });
    }),

    vscode.commands.registerCommand('aria.editProjectToml', async (node?: ProjectNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const doc = await openEditableDocument(`project-${node.project.ID_PROJETO}.aria.toml`, toTomlText(project), 'toml');
      state.editMap.set(doc.uri.toString(), { type: 'projectToml', id: node.project.ID_PROJETO, projectId: node.project.ID_PROJETO });
    }),

    vscode.commands.registerCommand('aria.editProjectForm', async (node?: ProjectNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const lovs = await state.getProjectLovs(node.project.ID_PROJETO);
      openFormWebview(context, `Projeto: ${project.NO_PROJETO}`, project as Record<string, unknown>, ['REST_CUSTOM'], { lovs }, async (updated) => {
        const normalized = applyLovDisplayValues(updated, lovs);
        await saveWithFreshDataset(`projectForm:${node.project.ID_PROJETO}`, node.project.ID_PROJETO, async (draft) => {
          const idx = draft.registros.findIndex((p) => p.ID_PROJETO === node.project.ID_PROJETO);
          if (idx < 0) { throw new Error('Projeto nao encontrado.'); }
          draft.registros[idx] = mergePreservingTypes(draft.registros[idx] as Record<string, unknown>, normalized) as AriaProject;
        });
      });
    }),

    vscode.commands.registerCommand('aria.createProject', async () => {
      if (!state.client) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      const formData = { NO_PROJETO: '', DS_PROJETO: '', TX_PATH: '' };
      openFormWebview(context, 'Novo Projeto', formData, [], undefined, async (updated) => {
        const projectName = toStringSafe(updated.NO_PROJETO).trim();
        const projectDescription = toStringSafe(updated.DS_PROJETO).trim();
        const projectPath = toStringSafe(updated.TX_PATH).trim();
        if (!projectName || !projectPath) { throw new Error('Nome e Caminho sao obrigatorios.'); }

        const projectPayload = {
          ID_PROJETO: 0,
          IN_TIPO_PROJETO: '1',
          NO_PROJETO: projectName,
          DS_PROJETO: projectDescription,
          TX_PATH: projectPath,
        };

        await saveProjectWithFreshSnapshot('createProject', projectPayload);
      });
    }),

    vscode.commands.registerCommand('aria.editEndpointCode', async (node?: EndpointNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
      if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }
      const ext = resolveEndpointCodeExtension(endpoint);
      const lang = ext === 'py' ? 'python' : 'sql';
      const doc = await openEditableDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.${ext}`, endpoint.TX_CODIGO ?? '', lang);
      state.editMap.set(doc.uri.toString(), { type: 'endpointCode', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }),

    vscode.commands.registerCommand('aria.editEndpointJson', async (node?: EndpointNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
      if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }
      const doc = await openEditableDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.json`, JSON.stringify(endpoint, null, 2), 'json');
      state.editMap.set(doc.uri.toString(), { type: 'endpointJson', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }),

    vscode.commands.registerCommand('aria.editEndpointYaml', async (node?: EndpointNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
      if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }
      const doc = await openEditableDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.yaml`, toYamlText(endpoint), 'yaml');
      state.editMap.set(doc.uri.toString(), { type: 'endpointYaml', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }),

    vscode.commands.registerCommand('aria.editEndpointToml', async (node?: EndpointNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
      if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }
      const doc = await openEditableDocument(`endpoint-${node.endpoint.ID_REST_CUSTOM}.aria.toml`, toTomlText(endpoint), 'toml');
      state.editMap.set(doc.uri.toString(), { type: 'endpointToml', id: node.endpoint.ID_REST_CUSTOM, projectId: node.project.ID_PROJETO });
    }),

    vscode.commands.registerCommand('aria.editEndpointForm', async (node?: EndpointNode) => {
      if (!state.dataset || !node) { return; }
      const project = await state.getProjectDetails(node.project.ID_PROJETO);
      const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
      if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }
      const endpointFormItems = await state.getEndpointFormItems();
      const lovs = await state.getProjectLovs(node.project.ID_PROJETO);
      const endpointValidations = await state.getEndpointValidations();
      openFormWebview(context, `Endpoint: ${endpoint.NO_REST_CUSTOM}`, endpoint as Record<string, unknown>, [], { endpointItems: endpointFormItems, lovs }, async (updated) => {
        const normalized = applyLovDisplayValues(updated, lovs);
        await saveWithFreshDataset(`endpointForm:${node.endpoint.ID_REST_CUSTOM}`, node.project.ID_PROJETO, async (draft) => {
          for (const p of draft.registros) {
            const idx = p.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
            if (idx >= 0) {
              const merged = mergePreservingTypes(p.REST_CUSTOM[idx] as Record<string, unknown>, normalized);
              const errors = validateEndpointPayload(merged, endpointValidations);
              if (errors.length) { throw new Error(errors.join(' | ')); }
              p.REST_CUSTOM[idx] = merged as AriaEndpoint;
              return;
            }
          }
          throw new Error('Endpoint nao encontrado.');
        });
      }, async (updated) => {
        const normalized = applyLovDisplayValues(updated, lovs);
        const merged = mergePreservingTypes(endpoint as Record<string, unknown>, normalized);
        return state.getClient().validateCode({
          idTipoCodigo: merged.ID_TIPO_CODIGO,
          idBancoExterno: merged.ID_BANCO_EXTERNO,
          snModoCompatibilidade: merged.SN_MODO_COMPATIBILIDADE,
          idBancoEsquema: merged.ID_BANCO_ESQUEMA,
          txCodigo: toStringSafe(merged.TX_CODIGO),
        });
      }, async (payload) => state.getClient().getPrevia(payload));
    }),

    vscode.commands.registerCommand('aria.openEndpointMetadata', async (node?: unknown) => {
      if (!state.client || !state.dataset) { return; }
      try {
        let selection: MetadataExplorerSelection | undefined;
        if (hasEndpointNodeShape(node)) {
          selection = await resolveMetadataSelectionFromEndpoint(node);
        } else {
          const editor = vscode.window.activeTextEditor;
          if (editor) { selection = await resolveMetadataSelectionForActiveEditor(editor); }
        }
        if (!selection) { return; }
        await loadMetadataIntoExplorer(selection);
      } catch (error) {
        vscode.window.showErrorMessage(`Falha ao abrir metadados do endpoint: ${toErrorMessage(error)}`);
      }
    }),

    vscode.commands.registerCommand('aria.createEndpoint', async (node?: ProjectNode) => {
      if (!state.dataset) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      let targetProjectId: number;
      if (node) { targetProjectId = node.project.ID_PROJETO; }
      else {
        const items = state.dataset.registros.map((p) => ({ label: p.NO_PROJETO, description: p.TX_PATH, detail: `ID ${p.ID_PROJETO}`, projectId: p.ID_PROJETO }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Selecione o projeto' });
        if (!picked) { return; }
        targetProjectId = picked.projectId;
      }
      const project = state.dataset.registros.find((p) => p.ID_PROJETO === targetProjectId);
      if (!project) { return; }
      const endpointFormItems = await state.getEndpointFormItems();
      const lovs = await state.getProjectLovs(targetProjectId);
      const endpointValidations = await state.getEndpointValidations();
      const template = buildEndpointFromExampleStructure(project, { NO_REST_CUSTOM: '', TX_PATH: '', TX_CODIGO: '', DS_REST_CUSTOM_CURTA: '' }, lovs, { ignoreExplicitBankFields: true });
      openFormWebview(context, `Novo Endpoint — ${project.NO_PROJETO}`, template, ['ID_REST_CUSTOM'], { endpointItems: endpointFormItems, lovs }, async (updated) => {
        const normalized = applyLovDisplayValues(updated, lovs);
        normalized.TX_PATH = normalizeEndpointPath(normalized.TX_PATH);
        if (!normalized.NO_REST_CUSTOM || !String(normalized.TX_PATH).trim()) { throw new Error('Nome e Caminho sao obrigatorios.'); }
        if (project.REST_CUSTOM.some((e) => String(e.TX_PATH || '').toLowerCase() === String(normalized.TX_PATH).trim().toLowerCase())) {
          throw new Error(`Ja existe endpoint com TX_PATH "${normalized.TX_PATH}".`);
        }
        await saveWithFreshDataset(`createEndpoint:${targetProjectId}`, targetProjectId, async (draft) => {
          const proj = draft.registros.find((p) => p.ID_PROJETO === targetProjectId);
          if (!proj) { throw new Error('Projeto nao encontrado.'); }
          const newEp = buildEndpointFromExampleStructure(proj, normalized, lovs);
          const errors = validateEndpointPayload(newEp, endpointValidations);
          if (errors.length) { throw new Error(errors.join(' | ')); }
          proj.REST_CUSTOM.push(newEp as AriaEndpoint);
        });
      });
    }),

    vscode.commands.registerCommand('aria.saveActiveEditor', async () => {
      if (!state.client || !state.dataset) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      const editor = vscode.window.activeTextEditor;
      if (!editor || !state.editMap.has(editor.document.uri.toString())) { vscode.window.showWarningMessage('Nenhum editor ARIA ativo.'); return; }
      await editor.document.save();
    }),

    vscode.commands.registerCommand('aria.validateActiveEditor', async () => {
      if (!state.client || !state.dataset) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      const marker = state.editMap.get(editor.document.uri.toString());
      if (!marker || marker.type !== 'endpointCode') { vscode.window.showWarningMessage('Validacao disponivel apenas para editor de codigo.'); return; }
      try {
        const project = await state.getProjectDetails(marker.projectId);
        const endpoint = project.REST_CUSTOM.find((e) => e.ID_REST_CUSTOM === marker.id);
        if (!endpoint) { throw new Error('Endpoint nao encontrado.'); }
        const indicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: validando...');
        try {
          const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Validando...' }, () =>
            state.getClient().validateCode({ idTipoCodigo: endpoint.ID_TIPO_CODIGO, idBancoExterno: endpoint.ID_BANCO_EXTERNO, snModoCompatibilidade: endpoint.SN_MODO_COMPATIBILIDADE, idBancoEsquema: endpoint.ID_BANCO_ESQUEMA, txCodigo: editor.document.getText() })
          );
          const msg = toStringSafe(result.mensagem) || 'Validacao concluida.';
          if (!isValidateCodeSuccess(result.status)) { vscode.window.showErrorMessage(`Validacao falhou: ${msg}`); }
          else { vscode.window.showInformationMessage(msg); }
        } finally { indicator.dispose(); }
      } catch (error) { vscode.window.showErrorMessage(`Falha: ${toErrorMessage(error)}`); }
    }),

    vscode.commands.registerCommand('aria.previewActiveEditorData', async () => {
      if (!state.client || !state.dataset) { vscode.window.showWarningMessage('Conecte primeiro.'); return; }
      const editor = vscode.window.activeTextEditor;
      if (!editor) { return; }
      try {
        const previewContext = await resolvePreviewContextForActiveEditor(editor);
        activePreviewSession = { title: previewContext.title, payload: previewContext.payload, source: previewContext.source };

        if (previewContext.payload.parametros.length > 0) {
          openPreviewParamsWebview(previewContext.title, previewContext.payload, async (payload) => {
            activePreviewSession = { title: previewContext.title, payload, source: previewContext.source };
            await runPreviewExecution(payload);
          });
        }

        await runPreviewExecution(previewContext.payload);
      } catch (error) {
        vscode.window.showErrorMessage(`Falha ao abrir previa: ${toErrorMessage(error)}`);
      }
    }),

    vscode.commands.registerCommand('aria.openLastPayload', async () => {
      if (!state.lastPayloadPath) { vscode.window.showWarningMessage('Nenhum payload gerado ainda.'); return; }
      const doc = await vscode.workspace.openTextDocument(state.lastPayloadPath);
      await vscode.window.showTextDocument(doc, { preview: false });
      output.show(true);
    })
  );

  // ── Tools & Chat Participant ────────────────────────────────────────────
  registerTools(context, state, output);
  registerChatParticipant(context, state, () => tree.refresh(), output);

  // ── Cleanup ─────────────────────────────────────────────────────────────
  context.subscriptions.push({ dispose: () => { void state.client?.close(); } });
}

export function deactivate(): void {}
