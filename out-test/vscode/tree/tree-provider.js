"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AriaTreeProvider = exports.EndpointNode = exports.ProjectNode = void 0;
const vscode = require("vscode");
const utils_1 = require("../../core/utils");
class ProjectNode extends vscode.TreeItem {
    project;
    constructor(project) {
        super(`${project.NO_PROJETO} (${project.TX_PATH})`, vscode.TreeItemCollapsibleState.Collapsed);
        this.project = project;
        this.description = `ID ${project.ID_PROJETO}`;
        this.contextValue = 'ariaProject';
    }
}
exports.ProjectNode = ProjectNode;
class EndpointNode extends vscode.TreeItem {
    project;
    endpoint;
    constructor(project, endpoint) {
        super(`${endpoint.NO_REST_CUSTOM} (${endpoint.TX_PATH})`, vscode.TreeItemCollapsibleState.None);
        this.project = project;
        this.endpoint = endpoint;
        this.description = `ID ${endpoint.ID_REST_CUSTOM}`;
        this.contextValue = 'ariaEndpoint';
        this.command = { command: 'aria.editEndpointCode', title: 'Editar Código', arguments: [this] };
    }
}
exports.EndpointNode = EndpointNode;
class AriaTreeProvider {
    datasetProvider;
    onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    searchQuery = '';
    constructor(datasetProvider) {
        this.datasetProvider = datasetProvider;
    }
    refresh() { this.onDidChangeTreeDataEmitter.fire(undefined); }
    setSearchQuery(query) {
        this.searchQuery = (0, utils_1.normalizeTextForLookup)(query);
        this.refresh();
    }
    clearSearchQuery() {
        if (!this.searchQuery) {
            return;
        }
        this.searchQuery = '';
        this.refresh();
    }
    getTreeItem(element) { return element; }
    getChildren(element) {
        const dataset = this.datasetProvider();
        if (!dataset) {
            return Promise.resolve([]);
        }
        const query = this.searchQuery;
        if (!element) {
            const projects = dataset.registros
                .slice()
                .sort((a, b) => a.NO_PROJETO.localeCompare(b.NO_PROJETO))
                .filter((project) => this.projectMatchesQuery(project, query));
            return Promise.resolve(projects.map((project) => new ProjectNode(project)));
        }
        if (element instanceof ProjectNode) {
            const projectMatches = this.projectTextMatches(element.project, query);
            const endpoints = (element.project.REST_CUSTOM || [])
                .slice()
                .sort((a, b) => a.NO_REST_CUSTOM.localeCompare(b.NO_REST_CUSTOM))
                .filter((endpoint) => this.endpointMatchesQuery(endpoint, query, projectMatches));
            return Promise.resolve(endpoints.map((endpoint) => new EndpointNode(element.project, endpoint)));
        }
        return Promise.resolve([]);
    }
    projectMatchesQuery(project, query) {
        if (!query) {
            return true;
        }
        if (this.projectTextMatches(project, query)) {
            return true;
        }
        return (project.REST_CUSTOM || []).some((endpoint) => this.endpointTextMatches(endpoint, query));
    }
    projectTextMatches(project, query) {
        if (!query) {
            return true;
        }
        const text = (0, utils_1.normalizeTextForLookup)(`${project.NO_PROJETO} ${project.TX_PATH} ${project.ID_PROJETO}`);
        return text.includes(query);
    }
    endpointMatchesQuery(endpoint, query, projectMatches) {
        if (!query) {
            return true;
        }
        if (projectMatches) {
            return true;
        }
        return this.endpointTextMatches(endpoint, query);
    }
    endpointTextMatches(endpoint, query) {
        const text = (0, utils_1.normalizeTextForLookup)(`${endpoint.NO_REST_CUSTOM} ${endpoint.TX_PATH} ${endpoint.ID_REST_CUSTOM}`);
        return text.includes(query);
    }
}
exports.AriaTreeProvider = AriaTreeProvider;
