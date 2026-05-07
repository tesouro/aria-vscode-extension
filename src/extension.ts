import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

interface AriaDataset {
  registros: AriaProject[];
  listasValores?: unknown;
}

interface AriaProject {
  ID_PROJETO: number;
  NO_PROJETO: string;
  TX_PATH: string;
  REST_CUSTOM: AriaEndpoint[];
  [key: string]: unknown;
}

interface AriaEndpoint {
  ID_REST_CUSTOM: number;
  NO_REST_CUSTOM: string;
  TX_PATH: string;
  TX_CODIGO?: string;
  [key: string]: unknown;
}

interface EndpointFormItem {
  ITEM_SEQUENCE: number;
  REGION_SEQUENCE: number;
  IS_REQUIRED: string;
  DISPLAY_AS: string;
  ITEM_SOURCE?: string;
  LABEL?: string;
  ITEM_SOURCE_TYPE?: string;
  ITEM_NAME: string;
  REGION?: string;
}

interface EndpointValidationItem {
  REGION_SEQUENCE: number;
  REGION_NAME?: string;
  VALIDATION_SEQUENCE: number;
  VALIDATION_NAME: string;
  VALIDATION_TYPE: string;
  VALIDATION_FAILURE_TEXT?: string;
  VALIDATION_EXPRESSION1?: string;
  CONDITION_TYPE?: string;
  CONDITION_EXPRESSION1?: string;
  CONDITION_EXPRESSION2?: string;
  ASSOCIATED_ITEM?: string;
}

interface AriaBancoEsquema {
  ID_BANCO_ESQUEMA: number;
  NO_ESQUEMA: string;
}

interface AriaBancoExterno {
  ID_BANCO_EXTERNO: number;
  CO_BANCO_EXTERNO: string;
  BANCO_ESQUEMA: AriaBancoEsquema[];
}

type AriaLovs = {
  METODO?: Array<{ ID_METODO: number; NO_METODO: string }>;
  TIPO_CODIGO?: Array<{ ID_TIPO_CODIGO: number; NO_TIPO_CODIGO: string }>;
  TIPO_HEADER?: Array<{ ID_TIPO_HEADER: number; NO_TIPO_HEADER: string }>;
  BANCO_EXTERNO?: AriaBancoExterno[];
  PERFIL?: Array<{ ID_PERFIL: number; NO_PERFIL: string }>;
  INSTANCIA?: Array<{ ID_INSTANCIA: number; CO_INSTANCIA: string }>;
  TIPO_OTP?: Array<{ ID_TIPO_OTP: number; NO_TIPO_OTP: string }>;
  SISTEMA?: Array<{ ID_SISTEMA: number; CO_SISTEMA: number }>;
};

interface ApiSettings {
  baseUrl: string;
  fetchProjectPath: string;
  ignoreSslErrors: boolean;
}

interface EntraSettings {
  requireLogin: boolean;
  allowedEmailDomains: string[];
}

const REQUIRED_ENTRA_TENANT_ID = 'b5661350-c2e4-43dc-bce8-f003ddf8a3c4';

type AccessTokenProvider = (forceRefresh?: boolean) => Promise<string | undefined>;

type AriaNode = ProjectNode | EndpointNode;

type EditMarker =
  | { type: 'projectJson'; id: number; projectId: number }
  | { type: 'endpointJson'; id: number; projectId: number }
  | { type: 'endpointCode'; id: number; projectId: number };

class AriaApiClient {
  public constructor(private readonly settings: ApiSettings, private readonly accessTokenProvider?: AccessTokenProvider) {}

  public async connect(): Promise<void> {
    await this.getProjectEndpointTree();
  }

  public async close(): Promise<void> {
    // sem estado de conexao persistente para API HTTP
  }

  public async getDataset(fetchProjectPath = this.settings.fetchProjectPath): Promise<AriaDataset> {
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

  public async getDatasetByProjectId(projectId: number): Promise<AriaDataset> {
    const dataset = await this.requestDataset(projectId);
    return {
      ...dataset,
      registros: dataset.registros.filter((project) => project.ID_PROJETO === projectId)
    };
  }

  public async getProjectEndpointTree(): Promise<AriaDataset> {
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/projetos-endpoints');
    const root = asRecord(response);
    if (Array.isArray(root?.projetos)) {
      return {
        registros: root.projetos.map((item) => this.mapProject(item))
      };
    }

    return this.normalizeDataset(response);
  }

  public async saveDataset(dataset: AriaDataset): Promise<void> {
    await this.request('POST', '/v1/aria-vscode/custom/importar-json', undefined, dataset);
  }

  public async getEndpointFormItems(): Promise<EndpointFormItem[]> {
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/items-apex-endpoint');
    const root = asRecord(response);
    const rows = asArray(root?.registros) || [];
    return rows.map((item) => this.mapEndpointFormItem(item));
  }

  public async getEndpointValidations(): Promise<EndpointValidationItem[]> {
    const validations: EndpointValidationItem[] = [];
    let endpointPath = '/v1/aria-vscode/custom/validacoes-apex';
    const visited = new Set<string>();

    while (endpointPath && !visited.has(endpointPath)) {
      visited.add(endpointPath);
      const response = await this.request<unknown>('GET', endpointPath);
      const root = asRecord(response);
      const rows = asArray(root?.registros) || [];
      validations.push(...rows.map((item) => this.mapEndpointValidation(item)));

      const next = typeof root?.next === 'string' ? root.next.trim() : '';
      endpointPath = next || '';
    }

    return validations;
  }

  public async getLovs(projectId: number): Promise<AriaLovs> {
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/lovs', { id_projeto: String(projectId) });
    return (asRecord(response) as AriaLovs | undefined) ?? {};
  }

  private async requestDataset(projectId?: number): Promise<AriaDataset> {
    const query = projectId ? { id_projeto: String(projectId) } : undefined;
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/gerar-json', query);
    return this.normalizeDataset(response);
  }

  private normalizeDataset(payload: unknown): AriaDataset {
    const root = asRecord(payload);

    if (Array.isArray(root?.registros)) {
      return {
        ...root,
        registros: root.registros.map((item) => this.mapProject(item))
      } as AriaDataset;
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

  private mapProject(raw: unknown): AriaProject {
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

  private mapEndpoint(raw: unknown): AriaEndpoint {
    const source = asRecord(raw) || {};

    const mapped: AriaEndpoint = {
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

  private mapEndpointFormItem(raw: unknown): EndpointFormItem {
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

  private mapEndpointValidation(raw: unknown): EndpointValidationItem {
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

  private async request<T>(
    method: 'GET' | 'POST',
    endpointPath: string,
    query?: Record<string, string>,
    body?: unknown
  ): Promise<T> {
    const url = new URL(endpointPath.replace(/^\//, ''), this.withTrailingSlash(this.settings.baseUrl));
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }

    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {
      Accept: 'application/json'
    };

    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload, 'utf8').toString();
    }

    const isHttps = url.protocol === 'https:';
    const requestOptions: https.RequestOptions = {
      method,
      headers
    };

    if (isHttps) {
      requestOptions.rejectUnauthorized = !this.settings.ignoreSslErrors;
    }

    const requestOnce = async (token?: string): Promise<{ statusCode: number; responseBody: string }> => {
      const mergedHeaders = { ...headers };
      if (token && token.trim()) {
        mergedHeaders.Authorization = `Bearer ${token}`;
      }

      const localOptions: https.RequestOptions = {
        ...requestOptions,
        headers: mergedHeaders
      };

      const client = isHttps ? https : http;

      return await new Promise<{ statusCode: number; responseBody: string }>((resolve, reject) => {
        const req = client.request(url, localOptions as http.RequestOptions, (res) => {
          const chunks: Buffer[] = [];
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
      return undefined as T;
    }

    try {
      return JSON.parse(responseBody) as T;
    } catch {
      return responseBody as unknown as T;
    }
  }

  private withTrailingSlash(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error('URL base da API nao informada. Configure ariaApi.baseUrl.');
    }
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function toNumber(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return numeric;
}

function toStringSafe(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

class ProjectNode extends vscode.TreeItem {
  public constructor(public readonly project: AriaProject) {
    super(`${project.NO_PROJETO} (${project.TX_PATH})`, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `ID ${project.ID_PROJETO}`;
    this.contextValue = 'ariaProject';
    // Sem comando de clique: expande/recolhe apenas
  }
}

class EndpointNode extends vscode.TreeItem {
  public constructor(public readonly project: AriaProject, public readonly endpoint: AriaEndpoint) {
    super(`${endpoint.NO_REST_CUSTOM} (${endpoint.TX_PATH})`, vscode.TreeItemCollapsibleState.None);
    this.description = `ID ${endpoint.ID_REST_CUSTOM}`;
    this.contextValue = 'ariaEndpoint';
    this.command = {
      command: 'aria.editEndpointCode',
      title: 'Editar TX_CODIGO',
      arguments: [this]
    };
  }
}

class AriaTreeProvider implements vscode.TreeDataProvider<AriaNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<AriaNode | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public constructor(private readonly datasetProvider: () => AriaDataset | undefined) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: AriaNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: AriaNode): Thenable<AriaNode[]> {
    const dataset = this.datasetProvider();
    if (!dataset) {
      return Promise.resolve([]);
    }

    if (!element) {
      return Promise.resolve(
        dataset.registros
          .slice()
          .sort((a, b) => a.NO_PROJETO.localeCompare(b.NO_PROJETO))
          .map((project) => new ProjectNode(project))
      );
    }

    if (element instanceof ProjectNode) {
      return Promise.resolve(
        (element.project.REST_CUSTOM || [])
          .slice()
          .sort((a, b) => a.NO_REST_CUSTOM.localeCompare(b.NO_REST_CUSTOM))
          .map((endpoint) => new EndpointNode(element.project, endpoint))
      );
    }

    return Promise.resolve([]);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  let client: AriaApiClient | undefined;
  let dataset: AriaDataset | undefined;
  let endpointFormItemsCache: EndpointFormItem[] | undefined;
  let endpointValidationsCache: EndpointValidationItem[] | undefined;
  const lovsCache = new Map<number, AriaLovs>();
  let lastPayloadPath: string | undefined;
  let entraSession: vscode.AuthenticationSession | undefined;
  let requireEntraLogin = getEntraSettings().requireLogin;
  let isLoggedIn = false;
  const editMap = new Map<string, EditMarker>();
  const output = vscode.window.createOutputChannel('ARIA API Editor');

  const tree = new AriaTreeProvider(() => dataset);
  vscode.window.registerTreeDataProvider('ariaProjectsView', tree);

  const updateLoginState = async (loggedIn: boolean): Promise<void> => {
    isLoggedIn = loggedIn;
    await vscode.commands.executeCommand('setContext', 'aria.isLoggedIn', loggedIn);
    tree.refresh();
  };

  const validateSession = (
    session: vscode.AuthenticationSession,
    entraSettings: EntraSettings
  ): string | undefined => {
    const accountLabel = session.account.label || '';
    const tokenClaims = decodeJwtClaims(session.accessToken);

    const tokenTenant = typeof tokenClaims?.tid === 'string' ? tokenClaims.tid : '';
    if (!tokenTenant || tokenTenant.toLowerCase() !== REQUIRED_ENTRA_TENANT_ID.toLowerCase()) {
      return `Conta Microsoft nao autorizada para este tenant. Tenant esperado: ${REQUIRED_ENTRA_TENANT_ID}.`;
    }

    if (entraSettings.allowedEmailDomains.length > 0) {
      const email =
        (typeof tokenClaims?.preferred_username === 'string' && tokenClaims.preferred_username) ||
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

  const acquireAccessToken: AccessTokenProvider = async (forceRefresh = false): Promise<string | undefined> => {
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
    } catch {
      await updateLoginState(false);
      return undefined;
    }
  };

  const persistDebugPayload = async (payload: string, source: string): Promise<void> => {
    const filePath = await ensureEditFilePath('last-importa-json.aria.payload.json');
    await fs.promises.writeFile(filePath, payload, 'utf8');
    lastPayloadPath = filePath;

    output.appendLine(`[${new Date().toISOString()}] Payload preparado para importa_json.`);
    output.appendLine(`Origem: ${source}`);
    output.appendLine(`Arquivo: ${filePath}`);
    output.appendLine(`Bytes: ${Buffer.byteLength(payload, 'utf8')}`);
    output.appendLine('');
  };

  const saveWithFreshDataset = async (
    source: string,
    projectId: number,
    mutate: (draft: AriaDataset) => void | Promise<void>
  ): Promise<void> => {
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

  const getProjectDetails = async (projectId: number): Promise<AriaProject> => {
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

  const getEndpointFormItems = async (): Promise<EndpointFormItem[] | undefined> => {
    if (!client) {
      return undefined;
    }

    if (endpointFormItemsCache) {
      return endpointFormItemsCache;
    }

    try {
      endpointFormItemsCache = await client.getEndpointFormItems();
      return endpointFormItemsCache;
    } catch (error) {
      vscode.window.showWarningMessage(
        `Nao foi possivel carregar metadados do formulario de endpoint. Usando fallback local. Motivo: ${toErrorMessage(error)}`
      );
      return undefined;
    }
  };

  const getProjectLovs = async (projectId: number): Promise<AriaLovs | undefined> => {
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
    } catch (error) {
      vscode.window.showWarningMessage(
        `Nao foi possivel carregar LOVs do projeto ${projectId}. Motivo: ${toErrorMessage(error)}`
      );
      return undefined;
    }
  };

  const getEndpointValidations = async (): Promise<EndpointValidationItem[] | undefined> => {
    if (!client) {
      return undefined;
    }

    if (endpointValidationsCache) {
      return endpointValidationsCache;
    }

    try {
      endpointValidationsCache = await client.getEndpointValidations();
      return endpointValidationsCache;
    } catch (error) {
      vscode.window.showWarningMessage(
        `Nao foi possivel carregar validacoes do formulario de endpoint. Motivo: ${toErrorMessage(error)}`
      );
      return undefined;
    }
  };

  const ensureEntraLogin = async (): Promise<boolean> => {
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
    } catch (error) {
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

  context.subscriptions.push(
    output,

    vscode.commands.registerCommand('aria.connect', async () => {
      const authenticated = await ensureEntraLogin();
      if (!authenticated) {
        return;
      }

      const settings = getSettings();

      try {
        await client?.close();
        client = new AriaApiClient(settings, acquireAccessToken);
        await client.connect();
        endpointFormItemsCache = undefined;
        endpointValidationsCache = undefined;
        lovsCache.clear();
        dataset = await client.getProjectEndpointTree();
        tree.refresh();
        vscode.window.showInformationMessage(`Conectado a API e carregados ${dataset.registros.length} projeto(s).`);
      } catch (error) {
        vscode.window.showErrorMessage(`Erro ao conectar/carregar dados da API ARIA: ${toErrorMessage(error)}`);
      }
    }),

    vscode.commands.registerCommand('aria.refreshTree', async () => {
      if (!client) {
        vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.');
        return;
      }

      try {
        dataset = await client.getProjectEndpointTree();
        tree.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Erro ao atualizar arvore: ${toErrorMessage(error)}`);
      }
    }),

    // ── Projeto: JSON ────────────────────────────────────────────────────────
    vscode.commands.registerCommand('aria.editProjectJson', async (node?: ProjectNode) => {
      if (!dataset) { vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.'); return; }
      if (!node) { return; }

      const project = await getProjectDetails(node.project.ID_PROJETO);
      const content = JSON.stringify(project, null, 2);
      const filePath = await ensureEditFilePath(`project-${node.project.ID_PROJETO}.aria.json`);
      await fs.promises.writeFile(filePath, content, 'utf8');
      editMap.set(filePath, { type: 'projectJson', id: node.project.ID_PROJETO, projectId: node.project.ID_PROJETO });

      const doc = await vscode.workspace.openTextDocument(filePath);
      await vscode.window.showTextDocument(doc, { preview: false });
    }),

    // ── Projeto: Formulário ──────────────────────────────────────────────────
    vscode.commands.registerCommand('aria.editProjectForm', async (node?: ProjectNode) => {
      if (!dataset) { vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.'); return; }
      if (!node) { return; }

      const project = await getProjectDetails(node.project.ID_PROJETO);
      const lovs = await getProjectLovs(node.project.ID_PROJETO);

      openFormWebview(
        context,
        `Projeto: ${project.NO_PROJETO}`,
        project as Record<string, unknown>,
        ['REST_CUSTOM'],
        { lovs },
        async (updated) => {
          const normalizedUpdate = applyLovDisplayValues(updated, lovs);
          await saveWithFreshDataset(`projectForm:${node.project.ID_PROJETO}`, node.project.ID_PROJETO, async (draft) => {
            const idx = draft.registros.findIndex((p) => p.ID_PROJETO === node.project.ID_PROJETO);
            if (idx < 0) { throw new Error('Projeto nao encontrado no cache.'); }
            draft.registros[idx] = mergePreservingTypes(draft.registros[idx] as Record<string, unknown>, normalizedUpdate) as AriaProject;
          });
        }
      );
    }),

    // ── Endpoint: TX_CODIGO (acao principal) ─────────────────────────────────
    vscode.commands.registerCommand('aria.editEndpointCode', async (node?: EndpointNode) => {
      if (!dataset) { vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.'); return; }
      if (!node) { return; }

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
    vscode.commands.registerCommand('aria.editEndpointJson', async (node?: EndpointNode) => {
      if (!dataset) { vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.'); return; }
      if (!node) { return; }

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
    vscode.commands.registerCommand('aria.editEndpointForm', async (node?: EndpointNode) => {
      if (!dataset) { vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.'); return; }
      if (!node) { return; }

      const project = await getProjectDetails(node.project.ID_PROJETO);
      const endpoint = project.REST_CUSTOM.find((item) => item.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
      if (!endpoint) {
        throw new Error('Endpoint nao encontrado no retorno de gerar-json.');
      }

      const endpointFormItems = await getEndpointFormItems();
      const lovs = await getProjectLovs(node.project.ID_PROJETO);
      const endpointValidations = await getEndpointValidations();

      openFormWebview(
        context,
        `Endpoint: ${endpoint.NO_REST_CUSTOM}`,
        endpoint as Record<string, unknown>,
        [],
        { endpointItems: endpointFormItems, lovs },
        async (updated) => {
          const normalizedUpdate = applyLovDisplayValues(updated, lovs);
          await saveWithFreshDataset(`endpointForm:${node.endpoint.ID_REST_CUSTOM}`, node.project.ID_PROJETO, async (draft) => {
            let found = false;
            for (const project of draft.registros) {
              const eIdx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === node.endpoint.ID_REST_CUSTOM);
              if (eIdx >= 0) {
                const merged = mergePreservingTypes(project.REST_CUSTOM[eIdx] as Record<string, unknown>, normalizedUpdate);
                const validationErrors = validateEndpointPayload(merged, endpointValidations);
                if (validationErrors.length) {
                  throw new Error(validationErrors.join(' | '));
                }
                project.REST_CUSTOM[eIdx] = merged as AriaEndpoint;
                found = true;
                break;
              }
            }
            if (!found) { throw new Error('Endpoint nao encontrado no cache.'); }
          });
        }
      );
    }),

    // ── Endpoint: Criar novo ─────────────────────────────────────────────────
    vscode.commands.registerCommand('aria.createEndpoint', async (node?: ProjectNode) => {
      if (!dataset) { vscode.window.showWarningMessage('Conecte primeiro usando ARIA: Conectar na API.'); return; }

      let targetProjectId: number;

      if (node) {
        targetProjectId = node.project.ID_PROJETO;
      } else {
        const items = dataset.registros.map((p) => ({
          label: p.NO_PROJETO,
          description: p.TX_PATH,
          detail: `ID ${p.ID_PROJETO} — ${p.REST_CUSTOM.length} endpoint(s)`,
          projectId: p.ID_PROJETO
        }));
        const picked = await vscode.window.showQuickPick(items, {
          placeHolder: 'Selecione o projeto onde o novo endpoint sera criado',
          matchOnDescription: true
        });
        if (!picked) { return; }
        targetProjectId = picked.projectId;
      }

      const project = dataset.registros.find((p) => p.ID_PROJETO === targetProjectId);
      if (!project) { return; }

      const template = buildEndpointFromExampleStructure(project, {
        NO_REST_CUSTOM: '',
        TX_PATH: '',
        TX_CODIGO: '',
        DS_REST_CUSTOM_CURTA: ''
      });

      const endpointFormItems = await getEndpointFormItems();
      const lovs = await getProjectLovs(targetProjectId);
      const endpointValidations = await getEndpointValidations();

      openFormWebview(
        context,
        `Novo Endpoint — ${project.NO_PROJETO}`,
        template,
        ['ID_REST_CUSTOM'],
        { endpointItems: endpointFormItems, lovs },
        async (updated) => {
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
            if (!proj) { throw new Error('Projeto nao encontrado.'); }

            if (proj.REST_CUSTOM.some((e) => String(e.TX_PATH || '').toLowerCase() === String(normalizedUpdate.TX_PATH).trim().toLowerCase())) {
              throw new Error(`Ja existe endpoint com TX_PATH "${String(normalizedUpdate.TX_PATH).trim()}".`);
            }

            const newEndpoint = buildEndpointFromExampleStructure(proj, normalizedUpdate);
            const validationErrors = validateEndpointPayload(newEndpoint, endpointValidations);
            if (validationErrors.length) {
              throw new Error(validationErrors.join(' | '));
            }
            proj.REST_CUSTOM.push(newEndpoint as AriaEndpoint);
          });
        }
      );
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
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'ARIA: Salvando alteracoes via API...'
            },
            async () => {
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
                  if (!found) { throw new Error('Endpoint nao encontrado no cache.'); }
                  return;
                }

                if (marker.type === 'projectJson') {
                  const parsed = JSON.parse(text) as Record<string, unknown>;
                  const idx = draft.registros.findIndex((p) => p.ID_PROJETO === marker.id);
                  if (idx < 0) { throw new Error('Projeto nao encontrado no cache.'); }
                  draft.registros[idx] = {
                    ...draft.registros[idx],
                    ...parsed,
                    ID_PROJETO: marker.id,
                    REST_CUSTOM: (parsed.REST_CUSTOM as AriaEndpoint[]) || draft.registros[idx].REST_CUSTOM
                  };
                  return;
                }

                const parsed = JSON.parse(text) as Record<string, unknown>;
                let found = false;
                for (const project of draft.registros) {
                  const eIdx = project.REST_CUSTOM.findIndex((e) => e.ID_REST_CUSTOM === marker.id);
                  if (eIdx >= 0) {
                    project.REST_CUSTOM[eIdx] = { ...project.REST_CUSTOM[eIdx], ...parsed, ID_REST_CUSTOM: marker.id };
                    found = true;
                    break;
                  }
                }
                if (!found) { throw new Error('Endpoint nao encontrado no cache.'); }
              });
            }
          );
        } finally {
          savingIndicator.dispose();
        }

        vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
      } catch (error) {
        vscode.window.showErrorMessage(`Falha ao salvar alteracoes: ${toErrorMessage(error)}`);
      }
    }),

    vscode.commands.registerCommand('aria.openLastPayload', async () => {
      if (!lastPayloadPath) {
        vscode.window.showWarningMessage('Nenhum payload foi gerado ainda nesta sessao.');
        return;
      }

      const doc = await vscode.workspace.openTextDocument(lastPayloadPath);
      await vscode.window.showTextDocument(doc, { preview: false });
      output.show(true);
    })
  );

  // ── Copilot: Language Model Tool ─────────────────────────────────────────
  interface ListEndpointsInput {
    projectId?: number;
  }

  interface CreateEndpointInput {
    projectId?: number;
    projectName?: string;
    name: string;
    path: string;
    code?: string;
    method?: number;
    description?: string;
  }

  context.subscriptions.push(
    vscode.lm.registerTool<ListEndpointsInput>('aria_list_endpoints', {
      prepareInvocation(_options, _token) {
        return { invocationMessage: 'Buscando endpoints do projeto ARIA...' };
      },
      async invoke(options, _token) {
        const projects = dataset?.registros ?? [];
        let targetProject: AriaProject | undefined;

        if (options.input.projectId !== undefined) {
          targetProject = projects.find((p) => p.ID_PROJETO === options.input.projectId);
        } else {
          const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
          if (activeFile) {
            const marker = editMap.get(activeFile);
            if (marker) {
              targetProject = projects.find((p) => p.ID_PROJETO === marker.projectId);
            }
          }
        }

        if (!targetProject) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              'Nenhum projeto ARIA carregado ou detectado. Abra um arquivo de endpoint pelo painel ARIA primeiro.'
            )
          ]);
        }

        const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
        const currentEndpointId = activeFile ? editMap.get(activeFile)?.id : undefined;
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(buildEndpointsSummary(targetProject, currentEndpointId))
        ]);
      }
    }),

    vscode.lm.registerTool<CreateEndpointInput>('aria_create_endpoint', {
      prepareInvocation(options, _token) {
        const { name, path: epPath, projectId, projectName } = options.input;
        const target = projectId !== undefined ? `ID ${projectId}` : (projectName?.trim() || 'detectado automaticamente');
        return { invocationMessage: `Criando endpoint "${name}" (${epPath}) no projeto ${target}...` };
      },
      async invoke(options, _token) {
        if (!client) {
          client = new AriaApiClient(getSettings(), acquireAccessToken);
        }

        if (!dataset) {
          try {
            dataset = await client.getProjectEndpointTree();
            tree.refresh();
          } catch (error) {
            return new vscode.LanguageModelToolResult([
              new vscode.LanguageModelTextPart(`Nao foi possivel carregar a arvore de projetos automaticamente: ${toErrorMessage(error)}`)
            ]);
          }
        }

        if (!dataset) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Sem conexao ativa com a API ARIA e nao foi possivel carregar a arvore de projetos.')
          ]);
        }

        const { name, path: epPath, code, method, description } = options.input;

        if (!name?.trim() || !epPath?.trim()) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Erro: "name" e "path" sao obrigatorios.')
          ]);
        }

        const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
        const markerProjectId = activeFile ? editMap.get(activeFile)?.projectId : undefined;
        const resolved = resolveProjectFromInput(dataset.registros, options.input, markerProjectId);
        const project = resolved.project;
        if (!project) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(resolved.error || 'Nao foi possivel identificar o projeto alvo.')
          ]);
        }

        const projectId = project.ID_PROJETO;

        const normalizedPath = normalizeEndpointPath(epPath);

        if (project.REST_CUSTOM.some((e) => String(e.TX_PATH || '').toLowerCase() === normalizedPath.toLowerCase())) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Ja existe endpoint com TX_PATH "${normalizedPath}". Use um path novo para inclusao.`)
          ]);
        }

        try {
          const endpointFormItems = await getEndpointFormItems();
          const requiredFields = buildRequiredEndpointFieldKeys(endpointFormItems);
          const lovs = await getProjectLovs(projectId);
          const endpointValidations = await getEndpointValidations();

          await saveWithFreshDataset(`createEndpoint:agent:${projectId}`, projectId, async (draft) => {
            const proj = draft.registros.find((p) => p.ID_PROJETO === projectId);
            if (!proj) { throw new Error('Projeto nao encontrado no draft.'); }

            if (proj.REST_CUSTOM.some((e) => String(e.TX_PATH || '').toLowerCase() === normalizedPath.toLowerCase())) {
              throw new Error(`Ja existe endpoint com TX_PATH "${normalizedPath}".`);
            }

            const inferredMethod = inferMethodId(proj, method, lovs);
            const draftEndpoint = buildEndpointFromExampleStructure(proj, {
              NO_REST_CUSTOM: name.trim(),
              TX_PATH: normalizedPath,
              ...(code !== undefined ? { TX_CODIGO: code } : {}),
              ID_METODO: inferredMethod,
              ...(description !== undefined ? { DS_REST_CUSTOM_CURTA: description } : {})
            });

            if (toNumber(draftEndpoint.ID_BANCO_EXTERNO) <= 0 && lovs?.BANCO_EXTERNO?.length) {
              draftEndpoint.ID_BANCO_EXTERNO = lovs.BANCO_EXTERNO[0].ID_BANCO_EXTERNO;
            }
            if (toNumber(draftEndpoint.ID_TIPO_CODIGO) <= 0 && lovs?.TIPO_CODIGO?.length) {
              draftEndpoint.ID_TIPO_CODIGO = lovs.TIPO_CODIGO[0].ID_TIPO_CODIGO;
            }
            if (toNumber(draftEndpoint.ID_TIPO_HEADER) <= 0 && lovs?.TIPO_HEADER?.length) {
              draftEndpoint.ID_TIPO_HEADER = lovs.TIPO_HEADER[0].ID_TIPO_HEADER;
            }

            const newEndpoint = applyLovDisplayValues(draftEndpoint, lovs);

            const missingRequired = requiredFields.filter((fieldName) =>
              isMissingRequiredField(fieldName, newEndpoint[fieldName])
            );
            if (missingRequired.length) {
              throw new Error(
                `Campos obrigatorios nao preenchidos para criar endpoint: ${missingRequired.join(', ')}.`
              );
            }

            const validationErrors = validateEndpointPayload(newEndpoint, endpointValidations);
            if (validationErrors.length) {
              throw new Error(validationErrors.join(' | '));
            }

            proj.REST_CUSTOM.push(newEndpoint as AriaEndpoint);
          });

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Endpoint "${name}" criado com sucesso no projeto "${project.NO_PROJETO}". ` +
              `Campos de lista foram sincronizados (ID/NO) e defaults de conexao/metodo foram inferidos quando necessario. ` +
              `A arvore foi atualizada. Use #aria_list_endpoints para ver todos os endpoints do projeto.`
            )
          ]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Erro ao criar endpoint: ${toErrorMessage(error)}`)
          ]);
        }
      }
    })
  );

  // ── Copilot: Chat Participant @aria ──────────────────────────────────────
  const participant = vscode.chat.createChatParticipant('aria.assistant', async (request, ctx, response, token) => {
    if (!dataset) {
      response.markdown('Nenhum projeto ARIA carregado. Use **ARIA: Conectar na API** primeiro.');
      return;
    }

    const activeFile = vscode.window.activeTextEditor?.document.uri.fsPath;
    const marker = activeFile ? editMap.get(activeFile) : undefined;
    const projects = dataset.registros;

    // Build context based on active file or first matching project
    let contextProject: AriaProject | undefined;
    if (marker) {
      contextProject = projects.find((p) => p.ID_PROJETO === marker.projectId);
    }

    // Build system context message
    const contextLines: string[] = [];
    if (contextProject) {
      const currentEndpointId = marker?.type !== 'projectJson' ? marker?.id : undefined;
      contextLines.push(buildEndpointsSummary(contextProject, currentEndpointId));
    } else {
      contextLines.push(`Projetos carregados (${projects.length} total):`);
      for (const proj of projects.slice(0, 10)) {
        contextLines.push(`- [ID ${proj.ID_PROJETO}] ${proj.NO_PROJETO} (${proj.TX_PATH}) — ${proj.REST_CUSTOM.length} endpoint(s)`);
      }
      if (projects.length > 10) {
        contextLines.push(`... e mais ${projects.length - 10} projeto(s).`);
      }
    }

    const systemContext = contextLines.join('\n');
    const projectsJsonContext = buildProjectsContextJson(projects);

    // Select model (prefer copilot-gpt-4o family, fallback to any)
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!models.length) {
      response.markdown('Nenhum modelo de linguagem Copilot disponivel. Verifique se o Copilot esta ativo.');
      return;
    }

    const model = models[0];

    const messages: vscode.LanguageModelChatMessage[] = [
      vscode.LanguageModelChatMessage.User(
        `Voce e um assistente especializado na plataforma ARIA de APIs. Responda sempre em portugues.\n\nContexto atual:\n\n${systemContext}\n\nArvore de projetos em JSON (fonte da verdade para inferir projeto/id e endpoints):\n\n${projectsJsonContext}`
      )
    ];

    // Include conversation history
    for (const turn of ctx.history) {
      if (turn instanceof vscode.ChatRequestTurn) {
        messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
      } else if (turn instanceof vscode.ChatResponseTurn) {
        const text = turn.response
          .map((r) => (r instanceof vscode.ChatResponseMarkdownPart ? r.value.value : ''))
          .join('');
        if (text.trim()) {
          messages.push(vscode.LanguageModelChatMessage.Assistant(text));
        }
      }
    }

    messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

    const chatResponse = await model.sendRequest(messages, {}, token);
    for await (const fragment of chatResponse.text) {
      response.markdown(fragment);
    }
  });

  participant.iconPath = new vscode.ThemeIcon('server-environment');
  participant.followupProvider = {
    provideFollowups(_result, _ctx, _token) {
      return [
        { prompt: 'Liste todos os endpoints deste projeto', label: 'Listar endpoints', command: 'listar' },
        { prompt: 'Quais endpoints deste projeto sao do tipo GET?', label: 'Endpoints GET' },
        { prompt: 'Crie um novo endpoint GET /exemplo com SELECT 1 FROM dual', label: 'Criar endpoint de exemplo' }
      ];
    }
  };

  context.subscriptions.push(participant);

  context.subscriptions.push({
    dispose: () => {
      void client?.close();
    }
  });
}

export function deactivate(): void {
  // encerramento gerenciado no dispose registrado em activate
}

function buildEndpointFromExampleStructure(project: AriaProject, overrides: Record<string, unknown>): Record<string, unknown> {
  const projectRecord = project as Record<string, unknown>;
  const methodFromOverrides = Number(overrides.ID_METODO ?? 1);
  const methodMap: Record<number, string> = {
    1: 'GET',
    2: 'POST',
    3: 'PUT',
    4: 'DELETE'
  };

  // Fill common infra defaults from the project when available, then fallback to safe defaults.
  const firstEndpoint = project.REST_CUSTOM[0] as Record<string, unknown> | undefined;
  const coSistema = Number(projectRecord.CO_SISTEMA ?? firstEndpoint?.CO_BANCO_EXTERNO ?? -1);
  const idBancoExterno = Number(projectRecord.ID_BANCO_EXTERNO ?? firstEndpoint?.ID_BANCO_EXTERNO ?? 0);
  const coBancoExterno = String(projectRecord.CO_BANCO_EXTERNO ?? firstEndpoint?.CO_BANCO_EXTERNO ?? '');

  const baseStructure: Record<string, unknown> = {
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
    ID_BANCO_EXTERNO: idBancoExterno,
    CO_BANCO_EXTERNO: coBancoExterno,
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
    VARIABLE: [],
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
    NO_METODO: methodMap[Number(overrides.ID_METODO ?? methodFromOverrides)] ?? 'GET'
  };
}

function buildEndpointsSummary(project: AriaProject, currentEndpointId?: number): string {
  const lines: string[] = [
    `## Projeto: ${project.NO_PROJETO}`,
    `- **ID:** ${project.ID_PROJETO}`,
    `- **Caminho base:** ${project.TX_PATH}`,
    `- **Total de endpoints:** ${project.REST_CUSTOM.length}`,
    '',
    '### Endpoints do projeto:',
    ''
  ];

  const methodNames: Record<number, string> = { 1: 'GET', 2: 'POST', 3: 'PUT', 4: 'DELETE' };

  for (const ep of project.REST_CUSTOM) {
    const isCurrent = ep.ID_REST_CUSTOM === currentEndpointId;
    const marker = isCurrent ? ' ← **(endpoint sendo editado)**' : '';
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

function buildProjectsContextJson(projects: AriaProject[], maxProjects = 60, maxEndpointsPerProject = 80): string {
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
        methodId: toNumber((endpoint as Record<string, unknown>).ID_METODO),
        methodName: toStringSafe((endpoint as Record<string, unknown>).NO_METODO)
      }))
    }))
  };

  return JSON.stringify(payload, null, 2);
}

function getSettings(): ApiSettings {
  const config = vscode.workspace.getConfiguration('ariaApi');
  return {
    baseUrl: config.get<string>('baseUrl', 'https://ms-aria.appsdev.ocp.tesouro.gov.br/'),
    fetchProjectPath: config.get<string>('fetchProjectPath', ''),
    ignoreSslErrors: config.get<boolean>('ignoreSslErrors', true)
  };
}

function getEntraSettings(): EntraSettings {
  const config = vscode.workspace.getConfiguration('ariaApi');
  return {
    requireLogin: config.get<boolean>('requireEntraLogin', true),
    allowedEmailDomains: (config.get<string[]>('allowedEmailDomains', []) || [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  };
}

function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length < 2) {
    return undefined;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function ensureEditFilePath(fileName: string): Promise<string> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const editDir = workspaceFolder
    ? path.join(workspaceFolder.uri.fsPath, '.aria-edit')
    : path.join(os.tmpdir(), 'aria-edit');

  await fs.promises.mkdir(editDir, { recursive: true });
  return path.join(editDir, fileName);
}

function mergePreservingTypes(original: Record<string, unknown>, updates: Record<string, unknown>): Record<string, unknown> {
  const result = { ...original };
  for (const [key, value] of Object.entries(updates)) {
    if (!(key in original)) { continue; }
    result[key] = typeof original[key] === 'number' ? Number(value) : value;
  }
  return result;
}

function applyLovDisplayValues(payload: Record<string, unknown>, lovs?: AriaLovs): Record<string, unknown> {
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

  return normalized;
}

function inferMethodId(project: AriaProject, requestedMethod?: number, lovs?: AriaLovs): number {
  if (typeof requestedMethod === 'number' && requestedMethod > 0) {
    return requestedMethod;
  }

  const projectMethod = project.REST_CUSTOM
    .map((endpoint) => toNumber((endpoint as Record<string, unknown>).ID_METODO))
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

function buildRequiredEndpointFieldKeys(items?: EndpointFormItem[]): string[] {
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

function isMissingRequiredField(fieldName: string, value: unknown): boolean {
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

function validateEndpointPayload(payload: Record<string, unknown>, validations?: EndpointValidationItem[]): string[] {
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

  const errors: string[] = [];
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

function shouldApplyValidationCondition(validation: EndpointValidationItem, payload: Record<string, unknown>): boolean {
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

function evaluateSimplePlsqlExpression(expression: string, payload: Record<string, unknown>): boolean | undefined {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }

  const tokens = tokenizeSimplePlsqlExpression(trimmed);
  if (!tokens) {
    return undefined;
  }

  let idx = 0;

  const parseValue = (): unknown => {
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

  const parseComparison = (): boolean | undefined => {
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

  const parsePrimary = (): boolean | undefined => {
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

  const parseAnd = (): boolean | undefined => {
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

  const parseOr = (): boolean | undefined => {
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
    if (/\s/.test(current)) {
      index += 1;
      continue;
    }

    if (current === '(' || current === ')' || current === '=') {
      tokens.push({ type: 'symbol', value: current as '(' | ')' | '=' });
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

function normalizeTextForLookup(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeEndpointPath(value: unknown): string {
  const raw = toStringSafe(value).trim();
  return raw.replace(/^\/+/, '');
}

function resolveProjectFromInput(
  projects: AriaProject[],
  input: { projectId?: number; projectName?: string },
  markerProjectId?: number
): { project?: AriaProject; error?: string } {
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

function resolveEndpointCodeExtension(endpoint: AriaEndpoint): 'sql' | 'py' {
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

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function prettifyLabel(key: string): string {
  const explicitLabels: Record<string, string> = {
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

function getFieldSection(key: string): 'basic' | 'behavior' | 'security' | 'cache' | 'advanced' | 'metadata' {
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

function getFieldOptions(key: string): Array<{ value: string; label: string }> | undefined {
  const options: Record<string, Array<{ value: string; label: string }>> = {
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

function buildLovOptions(key: string, lovs: AriaLovs | undefined): Array<{ value: string; label: string }> | undefined {
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

function getSectionMeta(section: 'basic' | 'behavior' | 'security' | 'cache' | 'advanced' | 'metadata'): { title: string; description: string } {
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
  } as const;

  return sections[section];
}

interface FormRenderOptions {
  endpointItems?: EndpointFormItem[];
  lovs?: AriaLovs;
}

interface EndpointFieldMeta {
  key: string;
  label?: string;
  required: boolean;
  displayAs: string;
  region: string;
  itemSequence: number;
  regionSequence: number;
  hidden: boolean;
  displayOnly: boolean;
}

function normalizeEndpointFieldKey(itemName: string): string {
  return itemName.replace(/^P\d+_/, '').trim().toUpperCase();
}

function buildEndpointFieldMeta(items: EndpointFormItem[]): Map<string, EndpointFieldMeta> {
  const sorted = items
    .filter((item) => item.ITEM_NAME && item.ITEM_NAME.trim().length > 0)
    .slice()
    .sort((a, b) => {
      const regionDiff = (a.REGION_SEQUENCE ?? 0) - (b.REGION_SEQUENCE ?? 0);
      if (regionDiff !== 0) { return regionDiff; }
      const itemDiff = (a.ITEM_SEQUENCE ?? 0) - (b.ITEM_SEQUENCE ?? 0);
      if (itemDiff !== 0) { return itemDiff; }
      return a.ITEM_NAME.localeCompare(b.ITEM_NAME);
    });

  const map = new Map<string, EndpointFieldMeta>();
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

function resolveFieldInputType(displayAs: string): 'text' | 'number' | 'date' {
  const normalized = displayAs.toLowerCase();
  if (normalized.includes('number')) {
    return 'number';
  }
  if (normalized.includes('date')) {
    return 'date';
  }
  return 'text';
}

function shouldRenderTextarea(displayAs: string): boolean {
  const normalized = displayAs.toLowerCase();
  return normalized.includes('tinymce') || normalized.includes('textarea');
}

function buildFormHtml(title: string, data: Record<string, unknown>, excludeKeys: string[], options?: FormRenderOptions): string {
  const endpointMeta = options?.endpointItems?.length ? buildEndpointFieldMeta(options.endpointItems) : undefined;

  const scalarEntries = new Map<string, unknown>(
    Object.entries(data).filter(([_, value]) => typeof value !== 'object' || value === null)
  );

  const visibleEntries: Array<[string, unknown]> = endpointMeta
    ? Array.from(endpointMeta.values())
      .filter((meta) => !meta.hidden && !excludeKeys.includes(meta.key))
      .sort((a, b) => {
        const regionDiff = a.regionSequence - b.regionSequence;
        if (regionDiff !== 0) { return regionDiff; }
        const itemDiff = a.itemSequence - b.itemSequence;
        if (itemDiff !== 0) { return itemDiff; }
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

  const sectionOrder: string[] = endpointMeta
    ? (() => {
        const regionSeqMap = new Map<string, number>();
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

  const sectionFields = new Map<string, string[]>();
  for (const section of sectionOrder) {
    sectionFields.set(section, []);
  }

  for (const [key, value] of visibleEntries) {
    const meta = endpointMeta?.get(key.toUpperCase());
    const strVal = value === null || value === undefined ? '' : String(value);
    const label = meta?.label || prettifyLabel(key);
    const fieldOptions = buildLovOptions(key, options?.lovs) ?? getFieldOptions(key);
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
    } else if (fieldOptions) {
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
    } else if (isBancoEsquema) {
      const currentBancoId = String(data['ID_BANCO_EXTERNO'] ?? '');
      const bancosData: AriaBancoExterno[] = options?.lovs?.BANCO_EXTERNO ?? [];
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
    } else if (isCode) {
      control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <textarea id="${escHtml(key)}" name="${escHtml(key)}" class="code-area" rows="18"${requiredAttr}>${escHtml(strVal)}</textarea>`;
    } else if (isLong) {
      control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <textarea id="${escHtml(key)}" name="${escHtml(key)}" rows="5"${isReadonly ? ' readonly' : ''}${requiredAttr}>${escHtml(strVal)}</textarea>`;
    } else {
      control = `
        <label for="${escHtml(key)}">${escHtml(renderedLabel)}</label>
        <input id="${escHtml(key)}" name="${escHtml(key)}" type="${inputType}" value="${escHtml(strVal)}"${isReadonly ? ' readonly' : ''}${requiredAttr} />`;
    }

    const widthClass = isCode || key === 'TX_URL' || key === 'TX_COMENTARIOS' ? 'field span-2' : 'field';
    sectionFields.get(section)!.push(`<div class="${widthClass}">${control}</div>`);
  }

  const renderedSections = sectionOrder
    .map((section) => {
      const content = sectionFields.get(section)!;
      if (content.length === 0) {
        return '';
      }

      const meta = endpointMeta
        ? {
          title: section,
          description: 'Agrupamento conforme metadata da tela APEX do endpoint.'
        }
        : getSectionMeta(section as 'basic' | 'behavior' | 'security' | 'cache' | 'advanced' | 'metadata');
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

function openFormWebview(
  context: vscode.ExtensionContext,
  title: string,
  data: Record<string, unknown>,
  excludeKeys: string[],
  renderOptions: FormRenderOptions | undefined,
  onSave: (updated: Record<string, unknown>) => Promise<void>
): void {
  const panel = vscode.window.createWebviewPanel(
    'ariaForm',
    title,
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  panel.webview.html = buildFormHtml(title, data, excludeKeys, renderOptions);

  panel.webview.onDidReceiveMessage(
    async (message: { command: string; data: Record<string, unknown> }) => {
      if (message.command === 'save') {
        try {
          void panel.webview.postMessage({ type: 'saving' });
          const savingIndicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: salvando via API...');
          try {
            await vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: 'ARIA: Salvando alteracoes via API...'
              },
              async () => {
                await onSave(message.data);
              }
            );
          } finally {
            savingIndicator.dispose();
          }

          void panel.webview.postMessage({ type: 'saved' });
          vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
        } catch (error) {
          void panel.webview.postMessage({ type: 'error', message: toErrorMessage(error) });
          vscode.window.showErrorMessage(`Falha ao salvar: ${toErrorMessage(error)}`);
        }
      }
    },
    undefined,
    context.subscriptions
  );
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
