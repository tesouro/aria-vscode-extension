import * as vscode from 'vscode';
import type { AriaDataset, AriaProject, AriaEndpoint } from '../../core/types';

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

  constructor(private readonly datasetProvider: () => AriaDataset | undefined) {}

  refresh(): void { this.onDidChangeTreeDataEmitter.fire(undefined); }

  getTreeItem(element: AriaNode): vscode.TreeItem { return element; }

  getChildren(element?: AriaNode): Thenable<AriaNode[]> {
    const dataset = this.datasetProvider();
    if (!dataset) { return Promise.resolve([]); }
    if (!element) {
      return Promise.resolve(
        dataset.registros.slice().sort((a, b) => a.NO_PROJETO.localeCompare(b.NO_PROJETO)).map((p) => new ProjectNode(p))
      );
    }
    if (element instanceof ProjectNode) {
      return Promise.resolve(
        (element.project.REST_CUSTOM || []).slice().sort((a, b) => a.NO_REST_CUSTOM.localeCompare(b.NO_REST_CUSTOM)).map((ep) => new EndpointNode(element.project, ep))
      );
    }
    return Promise.resolve([]);
  }
}
