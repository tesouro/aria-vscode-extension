import * as http from 'http';
import * as https from 'https';
import type { ApiSettings, AccessTokenProvider, LogWriter, AriaDataset, AriaProject, AriaEndpoint,
  AriaLovs, ValidateCodeResponse, EndpointFormItem, EndpointValidationItem, PreviaPayload, PreviaResponse } from '../../core/types';
import { asRecord, asArray, toNumber, toStringSafe, summarizeForLog } from '../../core/utils';
import { API_TIMEOUT_MS, GET_RETRY_DELAYS_MS } from '../../core/constants';
import { normalizeLovsResponse } from '../../domain/lovs/lovs-normalizer';
import { buildMetadataQuery, formatMetadataForEditor } from '../../domain/metadata/metadata-parser';

export class AriaApiClient {
  constructor(
    private readonly settings: ApiSettings,
    private readonly accessTokenProvider?: AccessTokenProvider,
    private readonly logger?: LogWriter
  ) {}

  async connect(): Promise<void> {
    await this.getProjectEndpointTree();
  }

  async close(): Promise<void> {}

  async getDataset(fetchProjectPath = this.settings.fetchProjectPath): Promise<AriaDataset> {
    const dataset = await this.requestDataset();
    const filter = fetchProjectPath.trim().toLowerCase();
    if (!filter) { return dataset; }
    return { ...dataset, registros: dataset.registros.filter((p) => String(p.TX_PATH || '').toLowerCase().includes(filter)) };
  }

  async getDatasetByProjectId(projectId: number): Promise<AriaDataset> {
    const dataset = await this.requestDataset(projectId);
    return { ...dataset, registros: dataset.registros.filter((p) => p.ID_PROJETO === projectId) };
  }

  async getProjectEndpointTree(): Promise<AriaDataset> {
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/projetos-endpoints');
    const root = asRecord(response);
    if (Array.isArray(root?.projetos)) {
      return { registros: root.projetos.map((item) => this.mapProject(item)) };
    }
    return this.normalizeDataset(response);
  }

  async saveDataset(dataset: AriaDataset): Promise<void> {
    await this.request('POST', '/v1/aria-vscode/custom/importar-json', undefined, dataset);
  }

  async saveProject(project: Record<string, unknown>): Promise<void> {
    await this.request('POST', '/v1/aria-vscode/custom/importar-json', undefined, { registros: [project] });
  }

  async importarJsonEndpoint(projectId: number, endpointJson: unknown): Promise<{ status?: string; mensagem?: string }> {
    const query = { p_id_projeto: String(projectId) };
    const response = await this.request<unknown>('POST', '/v1/aria-vscode/custom/importar-json-endpoint', query, endpointJson);
    const root = asRecord(response) || {};
    return {
      status: typeof root.status === 'string' ? root.status : undefined,
      mensagem: typeof root.mensagem === 'string' ? root.mensagem : undefined,
    };
  }

  async getEndpointMetadata(endpoint: AriaEndpoint): Promise<string | undefined> {
    const query = buildMetadataQuery(endpoint as Record<string, unknown>);
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/obtem-metadados', query);
    return formatMetadataForEditor(response);
  }

  async getEndpointFormItems(): Promise<EndpointFormItem[]> {
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/items-apex-endpoint');
    const root = asRecord(response);
    const rows = asArray(root?.registros) || [];
    return rows.map((item) => this.mapEndpointFormItem(item)).filter(item => item.ITEM_NAME !== '');
  }

  async getEndpointValidations(): Promise<EndpointValidationItem[]> {
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/validacoes-apex');
    const root = asRecord(response);
    const rows = asArray(root?.registros) || [];
    return rows.map((item) => this.mapEndpointValidation(item));
  }

  async getLovs(projectId: number): Promise<AriaLovs> {
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/lovs', { id_projeto: String(projectId) });
    return normalizeLovsResponse(response);
  }

  async validateCode(payload: {
    idTipoCodigo: unknown; idBancoExterno: unknown;
    snModoCompatibilidade: unknown; idBancoEsquema: unknown; txCodigo: string;
  }): Promise<ValidateCodeResponse> {
    const body: Record<string, unknown> = {};
    if (payload.idTipoCodigo != null) { body.p_id_tipo_codigo = payload.idTipoCodigo; }
    if (payload.idBancoExterno != null) { body.p_id_banco_externo = payload.idBancoExterno; }
    if (payload.snModoCompatibilidade != null) { body.p_sn_modo_compatibilidade = payload.snModoCompatibilidade; }
    if (payload.idBancoEsquema != null) { body.p_id_banco_esquema = payload.idBancoEsquema; }
    if (payload.txCodigo != null) { body.p_tx_codigo = payload.txCodigo; }
    const response = await this.request<unknown>('POST', '/v1/aria-vscode/custom/valida-codigo', undefined, body);
    return (asRecord(response) as ValidateCodeResponse | undefined) ?? {};
  }

  async getPrevia(payload: PreviaPayload): Promise<PreviaResponse> {
    const body: Record<string, unknown> = {
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
    const response = await this.request<unknown>('POST', '/v1/aria-vscode/custom/get-previa', undefined, body);
    const root = asRecord(response) || {};
    return {
      pageCount: typeof root.pageCount === 'number' ? root.pageCount : undefined,
      columns: Array.isArray(root.columns) ? root.columns as string[] : undefined,
      count: typeof root.count === 'number' ? root.count : undefined,
      registros: Array.isArray(root.registros) ? root.registros as Record<string, unknown>[] : undefined,
      status: typeof root.status === 'string' ? root.status : undefined,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async requestDataset(projectId?: number): Promise<AriaDataset> {
    const query = projectId ? { id_projeto: String(projectId) } : undefined;
    const response = await this.request<unknown>('GET', '/v1/aria-vscode/custom/gerar-json', query);
    return this.normalizeDataset(response);
  }

  private normalizeDataset(payload: unknown): AriaDataset {
    const root = asRecord(payload);
    if (Array.isArray(root?.registros)) {
      return { ...root, registros: root.registros.map((item) => this.mapProject(item)) } as AriaDataset;
    }
    if (Array.isArray(root?.projetos)) {
      return { registros: root.projetos.map((item) => this.mapProject(item)) };
    }
    if (Array.isArray(payload)) {
      return { registros: payload.map((item) => this.mapProject(item)) };
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
      REST_CUSTOM: endpoints.map((ep) => this.mapEndpoint(ep)),
    };
  }

  private mapEndpoint(raw: unknown): AriaEndpoint {
    const source = asRecord(raw) || {};
    const mapped: AriaEndpoint = {
      ...source,
      ID_REST_CUSTOM: toNumber(source.ID_REST_CUSTOM ?? source.id_endpoint),
      NO_REST_CUSTOM: toStringSafe(source.NO_REST_CUSTOM ?? source.nome_endpoint),
      TX_PATH: toStringSafe(source.TX_PATH ?? source.path_endpoint),
      TX_CODIGO: typeof source.TX_CODIGO === 'string' ? source.TX_CODIGO : undefined,
    };
    if (mapped.ID_REST_CUSTOM <= 0) { throw new Error('Endpoint retornado pela API sem ID valido.'); }
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
      REGION: typeof source.REGION === 'string' ? source.REGION : undefined,
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
      ASSOCIATED_ITEM: typeof source.ASSOCIATED_ITEM === 'string' ? source.ASSOCIATED_ITEM : undefined,
    };
  }

  private async request<T>(method: 'GET' | 'POST', endpointPath: string, query?: Record<string, string>, body?: unknown): Promise<T> {
    const url = new URL(endpointPath.replace(/^\//, ''), this.withTrailingSlash(this.settings.baseUrl));
    if (query) { for (const [key, value] of Object.entries(query)) { url.searchParams.set(key, value); } }

    const payload = body === undefined ? undefined : JSON.stringify(body);
    try {
      const bodyPreview = (endpointPath.includes('/importar-json-endpoint'))
        ? (body === undefined ? undefined : JSON.parse(JSON.stringify(body)))
        : this.buildRequestBodyForLog(endpointPath, body);
      this.logger?.(
        `[${new Date().toISOString()}] ms-aria request => ${method} ${url.pathname}${url.search}\n` +
        `  query: ${summarizeForLog(query)}\n` +
        `  body: ${endpointPath.includes('/importar-json-endpoint') ? JSON.stringify(bodyPreview, null, 2) : summarizeForLog(bodyPreview)}`
      );
    } catch (e) {
      this.logger?.(`[${new Date().toISOString()}] ms-aria request => ${method} ${url.pathname}${url.search} (failed to build log: ${String(e)})`);
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload, 'utf8').toString();
    }

    const isHttps = url.protocol === 'https:';
    const requestOptions: https.RequestOptions = { method, headers };
    if (isHttps) { requestOptions.rejectUnauthorized = !this.settings.ignoreSslErrors; }

    const requestOnce = async (token?: string): Promise<{ statusCode: number; responseBody: string }> => {
      const mergedHeaders = { ...headers };
      if (token && token.trim()) { mergedHeaders.Authorization = `Bearer ${token}`; }
      const localOptions: https.RequestOptions = { ...requestOptions, headers: mergedHeaders };
      const client = isHttps ? https : http;

      return await new Promise<{ statusCode: number; responseBody: string }>((resolve, reject) => {
        const req = client.request(url, localOptions as http.RequestOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
          res.on('end', () => { resolve({ statusCode: res.statusCode ?? 0, responseBody: Buffer.concat(chunks).toString('utf8') }); });
          res.on('error', reject);
        });
        req.setTimeout(API_TIMEOUT_MS, () => {
          req.destroy(new Error(`Timeout de ${API_TIMEOUT_MS / 1000}s na chamada para ${endpointPath}.`));
        });
        req.on('error', reject);
        if (payload !== undefined) { req.write(payload); }
        req.end();
      });
    };

    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let currentToken = await this.accessTokenProvider?.(false);

    const executeAttempt = async (): Promise<{ statusCode: number; responseBody: string }> => {
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
      for (let i = 0; i < GET_RETRY_DELAYS_MS.length && statusCode === 500; i++) {
        this.logger?.(`[${new Date().toISOString()}] ms-aria retry => ${method} ${url.pathname}${url.search} status=500 attempt=${i + 2}`);
        await wait(GET_RETRY_DELAYS_MS[i]);
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

    if (!responseBody.trim()) { return undefined as T; }
    if (responseBody.trimStart().startsWith('<')) {
      throw new Error('API retornou resposta HTML inesperada (esperava JSON). Verifique se o servidor está acessível.');
    }

    try { return JSON.parse(responseBody) as T; } catch { return responseBody as unknown as T; }
  }

  private withTrailingSlash(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) { throw new Error('URL base da API nao informada. Configure ariaApi.baseUrl.'); }
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }

  private buildRequestBodyForLog(endpointPath: string, body: unknown): unknown {
    if (endpointPath.includes('/importar-json')) {
      const root = asRecord(body);
      if (!root) { return body; }
      const projects = asArray(root.registros) || asArray(root.projetos);
      if (!projects) { return root; }
      return {
        totalProjects: projects.length,
        projects: projects.slice(0, 3).map((item) => {
          const project = asRecord(item) || {};
          const endpoints = asArray(project.REST_CUSTOM) || [];
          return {
            ID_PROJETO: toNumber(project.ID_PROJETO),
            NO_PROJETO: toStringSafe(project.NO_PROJETO),
            endpointCount: endpoints.length,
          };
        }),
      };
    }
    return body;
  }
}
