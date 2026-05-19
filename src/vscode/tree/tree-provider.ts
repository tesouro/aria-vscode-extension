import * as vscode from 'vscode';
import type { AriaDataset, AriaProject, AriaEndpoint } from '../../core/types';
import { normalizeTextForLookup } from '../../core/utils';

export type AriaNode = ProjectNode | EndpointNode;

export class ProjectNode extends vscode.TreeItem {
  constructor(public readonly project: AriaProject) {
    super(`${project.NO_PROJETO} (${project.TX_PATH})`, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `ID ${project.ID_PROJETO}`;
    this.contextValue = 'ariaProject';
  }
}

export class EndpointNode extends vscode.TreeItem {
  constructor(public readonly project: AriaProject, public readonly endpoint: AriaEndpoint) {
    super(`${endpoint.NO_REST_CUSTOM} (${endpoint.TX_PATH})`, vscode.TreeItemCollapsibleState.None);
    this.description = `ID ${endpoint.ID_REST_CUSTOM}`;
    this.contextValue = 'ariaEndpoint';
    this.command = { command: 'aria.editEndpointCode', title: 'Editar Código', arguments: [this] };
  }
}

export class AriaTreeProvider implements vscode.TreeDataProvider<AriaNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<AriaNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
  private searchQuery = '';

  constructor(private readonly datasetProvider: () => AriaDataset | undefined) {}

  refresh(): void { this.onDidChangeTreeDataEmitter.fire(undefined); }

  setSearchQuery(query: string): void {
    this.searchQuery = normalizeTextForLookup(query);
    this.refresh();
  }

  clearSearchQuery(): void {
    if (!this.searchQuery) { return; }
    this.searchQuery = '';
    this.refresh();
  }

  getTreeItem(element: AriaNode): vscode.TreeItem { return element; }

  getChildren(element?: AriaNode): Thenable<AriaNode[]> {
    const dataset = this.datasetProvider();
    if (!dataset) { return Promise.resolve([]); }
    const query = this.searchQuery;
    if (!element) {
      const projects = dataset.registros
        .slice()
        .sort((a, b) => a.NO_PROJETO.localeCompare(b.NO_PROJETO))
        .filter((project) => this.projectMatchesQuery(project, query));
      return Promise.resolve(
        projects.map((project) => new ProjectNode(project))
      );
    }
    if (element instanceof ProjectNode) {
      const projectMatches = this.projectTextMatches(element.project, query);
      const endpoints = (element.project.REST_CUSTOM || [])
        .slice()
        .sort((a, b) => a.NO_REST_CUSTOM.localeCompare(b.NO_REST_CUSTOM))
        .filter((endpoint) => this.endpointMatchesQuery(endpoint, query, projectMatches));
      return Promise.resolve(
        endpoints.map((endpoint) => new EndpointNode(element.project, endpoint))
      );
    }
    return Promise.resolve([]);
  }

  private projectMatchesQuery(project: AriaProject, query: string): boolean {
    if (!query) { return true; }
    if (this.projectTextMatches(project, query)) { return true; }
    return (project.REST_CUSTOM || []).some((endpoint) => this.endpointTextMatches(endpoint, query));
  }

  private projectTextMatches(project: AriaProject, query: string): boolean {
    if (!query) { return true; }
    const text = normalizeTextForLookup(`${project.NO_PROJETO} ${project.TX_PATH} ${project.ID_PROJETO}`);
    return text.includes(query);
  }

  private endpointMatchesQuery(endpoint: AriaEndpoint, query: string, projectMatches: boolean): boolean {
    if (!query) { return true; }
    if (projectMatches) { return true; }
    return this.endpointTextMatches(endpoint, query);
  }

  private endpointTextMatches(endpoint: AriaEndpoint, query: string): boolean {
    const text = normalizeTextForLookup(`${endpoint.NO_REST_CUSTOM} ${endpoint.TX_PATH} ${endpoint.ID_REST_CUSTOM}`);
    return text.includes(query);
  }
}
