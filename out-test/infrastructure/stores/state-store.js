"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateStore = void 0;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const utils_1 = require("../../core/utils");
const metadata_parser_1 = require("../../domain/metadata/metadata-parser");
class StateStore {
    client;
    dataset;
    endpointFormItemsCache;
    endpointValidationsCache;
    lovsCache = new Map();
    lastPayloadPath;
    entraSession;
    requireEntraLogin = true;
    isLoggedIn = false;
    editMap = new Map();
    metadataUriByEndpoint = new Map();
    metadataCatalogByEndpoint = new Map();
    draftStore;
    constructor(draftStore) {
        this.draftStore = draftStore;
    }
    getClient() {
        if (!this.client) {
            throw new Error('Sem conexao ativa com a API.');
        }
        return this.client;
    }
    resetCaches() {
        this.endpointFormItemsCache = undefined;
        this.endpointValidationsCache = undefined;
        this.lovsCache.clear();
        this.metadataUriByEndpoint.clear();
        this.metadataCatalogByEndpoint.clear();
    }
    async getProjectDetails(projectId) {
        const client = this.getClient();
        const details = await client.getDatasetByProjectId(projectId);
        const project = details.registros.find((item) => item.ID_PROJETO === projectId);
        if (!project) {
            throw new Error(`Projeto ${projectId} nao encontrado no retorno de gerar-json.`);
        }
        return project;
    }
    async getEndpointFormItems() {
        if (!this.client) {
            return undefined;
        }
        if (this.endpointFormItemsCache) {
            return this.endpointFormItemsCache;
        }
        try {
            this.endpointFormItemsCache = await this.client.getEndpointFormItems();
            return this.endpointFormItemsCache;
        }
        catch (error) {
            vscode.window.showWarningMessage(`Nao foi possivel carregar metadados do formulario de endpoint. Motivo: ${(0, utils_1.toErrorMessage)(error)}`);
            return undefined;
        }
    }
    async getProjectLovs(projectId) {
        if (!this.client) {
            return undefined;
        }
        const cacheKey = projectId ?? 0;
        if (this.lovsCache.has(cacheKey)) {
            return this.lovsCache.get(cacheKey);
        }
        try {
            const lovs = await this.client.getLovs(projectId);
            this.lovsCache.set(cacheKey, lovs);
            return lovs;
        }
        catch (error) {
            const scope = projectId != null ? `do projeto ${projectId}` : 'globais';
            vscode.window.showWarningMessage(`Nao foi possivel carregar LOVs ${scope}. Motivo: ${(0, utils_1.toErrorMessage)(error)}`);
            return undefined;
        }
    }
    async getEndpointValidations() {
        if (!this.client) {
            return undefined;
        }
        if (this.endpointValidationsCache) {
            return this.endpointValidationsCache;
        }
        try {
            this.endpointValidationsCache = await this.client.getEndpointValidations();
            return this.endpointValidationsCache;
        }
        catch (error) {
            vscode.window.showWarningMessage(`Nao foi possivel carregar validacoes do formulario. Motivo: ${(0, utils_1.toErrorMessage)(error)}`);
            return undefined;
        }
    }
    async getMetadataCatalog(idBancoExterno, idBancoEsquema) {
        const metadataKey = (0, utils_1.buildMetadataKey)(idBancoExterno, idBancoEsquema);
        const cached = this.metadataCatalogByEndpoint.get(metadataKey);
        if (cached) {
            return cached;
        }
        const uri = this.metadataUriByEndpoint.get(metadataKey);
        if (!uri) {
            return undefined;
        }
        try {
            const markdown = await fs.promises.readFile(uri.fsPath, 'utf8');
            const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(markdown, uri.fsPath, metadataKey);
            this.metadataCatalogByEndpoint.set(metadataKey, catalog);
            return catalog;
        }
        catch {
            return undefined;
        }
    }
    async ensureMetadataCatalog(idBancoExterno, idBancoEsquema, options) {
        const metadataKey = (0, utils_1.buildMetadataKey)(idBancoExterno, idBancoEsquema);
        if (!options?.forceRefresh) {
            const cached = await this.getMetadataCatalog(idBancoExterno, idBancoEsquema);
            if (cached) {
                return cached;
            }
        }
        if (!this.client) {
            return undefined;
        }
        const endpoint = {
            ID_REST_CUSTOM: 0,
            NO_REST_CUSTOM: 'Metadata Explorer',
            TX_PATH: '/metadata',
            ID_BANCO_EXTERNO: idBancoExterno,
            ...(idBancoEsquema && idBancoEsquema > 0 ? { ID_BANCO_ESQUEMA: idBancoEsquema } : {}),
        };
        const markdown = await this.client.getEndpointMetadata(endpoint);
        if (!markdown) {
            return undefined;
        }
        const filePath = this.getMetadataFilePath(idBancoExterno, idBancoEsquema);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, markdown, 'utf8');
        const catalog = (0, metadata_parser_1.parseMetadataMarkdown)(markdown, filePath, metadataKey);
        this.metadataUriByEndpoint.set(metadataKey, vscode.Uri.file(filePath));
        this.metadataCatalogByEndpoint.set(metadataKey, catalog);
        return catalog;
    }
    getMetadataFilePath(idBancoExterno, idBancoEsquema) {
        const metadataDir = path.join(__dirname, '..', '..', 'resources');
        const fileName = idBancoEsquema && idBancoEsquema > 0
            ? `metadata-${idBancoExterno}-${idBancoEsquema}.aria.txt`
            : `metadata-${idBancoExterno}.aria.txt`;
        return path.join(metadataDir, fileName);
    }
}
exports.StateStore = StateStore;
