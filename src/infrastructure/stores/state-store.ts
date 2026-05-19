import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { AriaDataset, AriaProject, AriaEndpoint, AriaLovs, EndpointFormItem,
  EndpointValidationItem, ParsedMetadataCatalog, EditMarker } from '../../core/types';
import { toErrorMessage, buildMetadataKey } from '../../core/utils';
import { parseMetadataMarkdown } from '../../domain/metadata/metadata-parser';
import type { AriaApiClient } from '../api/aria-api-client';
import type { DraftStore } from '../../domain/assistant/draft-store';

export class StateStore {
  client: AriaApiClient | undefined;
  dataset: AriaDataset | undefined;
  endpointFormItemsCache: EndpointFormItem[] | undefined;
  endpointValidationsCache: EndpointValidationItem[] | undefined;
  readonly lovsCache = new Map<number, AriaLovs>();
  lastPayloadPath: string | undefined;
  entraSession: vscode.AuthenticationSession | undefined;
  requireEntraLogin = true;
  isLoggedIn = false;
  readonly editMap = new Map<string, EditMarker>();
  readonly metadataUriByEndpoint = new Map<string, vscode.Uri>();
  readonly metadataCatalogByEndpoint = new Map<string, ParsedMetadataCatalog>();
  readonly draftStore: DraftStore;

  constructor(draftStore: DraftStore) {
    this.draftStore = draftStore;
  }

  getClient(): AriaApiClient {
    if (!this.client) { throw new Error('Sem conexao ativa com a API.'); }
    return this.client;
  }

  resetCaches(): void {
    this.endpointFormItemsCache = undefined;
    this.endpointValidationsCache = undefined;
    this.lovsCache.clear();
    this.metadataUriByEndpoint.clear();
    this.metadataCatalogByEndpoint.clear();
  }

  async getProjectDetails(projectId: number): Promise<AriaProject> {
    const client = this.getClient();
    const details = await client.getDatasetByProjectId(projectId);
    const project = details.registros.find((item) => item.ID_PROJETO === projectId);
    if (!project) { throw new Error(`Projeto ${projectId} nao encontrado no retorno de gerar-json.`); }
    return project;
  }

  async getEndpointFormItems(): Promise<EndpointFormItem[] | undefined> {
    if (!this.client) { return undefined; }
    if (this.endpointFormItemsCache) { return this.endpointFormItemsCache; }
    try {
      this.endpointFormItemsCache = await this.client.getEndpointFormItems();
      return this.endpointFormItemsCache;
    } catch (error) {
      vscode.window.showWarningMessage(`Nao foi possivel carregar metadados do formulario de endpoint. Motivo: ${toErrorMessage(error)}`);
      return undefined;
    }
  }

  async getProjectLovs(projectId?: number): Promise<AriaLovs | undefined> {
    if (!this.client) { return undefined; }
    const cacheKey = projectId ?? 0;
    if (this.lovsCache.has(cacheKey)) { return this.lovsCache.get(cacheKey); }
    try {
      const lovs = await this.client.getLovs(projectId);
      this.lovsCache.set(cacheKey, lovs);
      return lovs;
    } catch (error) {
      const scope = projectId != null ? `do projeto ${projectId}` : 'globais';
      vscode.window.showWarningMessage(`Nao foi possivel carregar LOVs ${scope}. Motivo: ${toErrorMessage(error)}`);
      return undefined;
    }
  }

  async getEndpointValidations(): Promise<EndpointValidationItem[] | undefined> {
    if (!this.client) { return undefined; }
    if (this.endpointValidationsCache) { return this.endpointValidationsCache; }
    try {
      this.endpointValidationsCache = await this.client.getEndpointValidations();
      return this.endpointValidationsCache;
    } catch (error) {
      vscode.window.showWarningMessage(`Nao foi possivel carregar validacoes do formulario. Motivo: ${toErrorMessage(error)}`);
      return undefined;
    }
  }

  async getMetadataCatalog(idBancoExterno: number, idBancoEsquema?: number): Promise<ParsedMetadataCatalog | undefined> {
    const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
    const cached = this.metadataCatalogByEndpoint.get(metadataKey);
    if (cached) { return cached; }

    const uri = this.metadataUriByEndpoint.get(metadataKey);
    if (!uri) { return undefined; }

    try {
      const markdown = await fs.promises.readFile(uri.fsPath, 'utf8');
      const catalog = parseMetadataMarkdown(markdown, uri.fsPath, metadataKey);
      this.metadataCatalogByEndpoint.set(metadataKey, catalog);
      return catalog;
    } catch { return undefined; }
  }

  async ensureMetadataCatalog(
    idBancoExterno: number,
    idBancoEsquema?: number,
    options?: { forceRefresh?: boolean }
  ): Promise<ParsedMetadataCatalog | undefined> {
    const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);

    if (!options?.forceRefresh) {
      const cached = await this.getMetadataCatalog(idBancoExterno, idBancoEsquema);
      if (cached) { return cached; }
    }

    if (!this.client) { return undefined; }

    const endpoint: AriaEndpoint = {
      ID_REST_CUSTOM: 0,
      NO_REST_CUSTOM: 'Metadata Explorer',
      TX_PATH: '/metadata',
      ID_BANCO_EXTERNO: idBancoExterno,
      ...(idBancoEsquema && idBancoEsquema > 0 ? { ID_BANCO_ESQUEMA: idBancoEsquema } : {}),
    };

    const markdown = await this.client.getEndpointMetadata(endpoint);
    if (!markdown) { return undefined; }

    const filePath = this.getMetadataFilePath(idBancoExterno, idBancoEsquema);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, markdown, 'utf8');

    const catalog = parseMetadataMarkdown(markdown, filePath, metadataKey);
    this.metadataUriByEndpoint.set(metadataKey, vscode.Uri.file(filePath));
    this.metadataCatalogByEndpoint.set(metadataKey, catalog);
    return catalog;
  }

  private getMetadataFilePath(idBancoExterno: number, idBancoEsquema?: number): string {
    const metadataDir = path.join(__dirname, '..', '..', 'resources');
    const fileName = idBancoEsquema && idBancoEsquema > 0
      ? `metadata-${idBancoExterno}-${idBancoEsquema}.aria.txt`
      : `metadata-${idBancoExterno}.aria.txt`;
    return path.join(metadataDir, fileName);
  }
}
