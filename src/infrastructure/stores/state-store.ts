import * as vscode from 'vscode';
import type { AriaDataset, AriaProject, AriaEndpoint, AriaLovs, EndpointFormItem,
  EndpointValidationItem, ParsedMetadataCatalog, EditMarker } from '../../core/types';
import { toErrorMessage, buildMetadataKey } from '../../core/utils';
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

  async getProjectLovs(projectId: number): Promise<AriaLovs | undefined> {
    if (!this.client) { return undefined; }
    if (this.lovsCache.has(projectId)) { return this.lovsCache.get(projectId); }
    try {
      const lovs = await this.client.getLovs(projectId);
      this.lovsCache.set(projectId, lovs);
      return lovs;
    } catch (error) {
      vscode.window.showWarningMessage(`Nao foi possivel carregar LOVs do projeto ${projectId}. Motivo: ${toErrorMessage(error)}`);
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
      const fs = await import('fs');
      const markdown = await fs.promises.readFile(uri.fsPath, 'utf8');
      const { parseMetadataMarkdown } = await import('../../domain/metadata/metadata-parser');
      const catalog = parseMetadataMarkdown(markdown, uri.fsPath, metadataKey);
      this.metadataCatalogByEndpoint.set(metadataKey, catalog);
      return catalog;
    } catch { return undefined; }
  }
}
