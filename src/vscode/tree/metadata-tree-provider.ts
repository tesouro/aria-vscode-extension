import * as vscode from 'vscode';
import type { ParsedMetadataCatalog, ParsedMetadataColumn, ParsedMetadataSchema, ParsedMetadataTable } from '../../core/types';

export const ARIA_METADATA_TABLE_MIME = 'application/vnd.aria.metadata.table';

export interface MetadataTableDragPayload {
  schema: string;
  table: string;
  fullName: string;
  columns: string[];
  idBancoExterno: number;
  idBancoEsquema?: number;
  txDataSource?: string;
}

export interface MetadataExplorerSelection {
  projectId: number;
  projectName: string;
  idBancoExterno: number;
  bancoLabel: string;
  idBancoEsquema?: number;
  schemaLabel?: string;
  sourceLabel?: string;
  txDataSource?: string;
}

export type MetadataNode = MetadataSourceNode | MetadataSchemaNode | MetadataTableNode | MetadataColumnNode;

export class MetadataSourceNode extends vscode.TreeItem {
  constructor(
    public readonly selection: MetadataExplorerSelection,
    public readonly catalog: ParsedMetadataCatalog
  ) {
    super(selection.sourceLabel || buildSourceLabel(selection), vscode.TreeItemCollapsibleState.Expanded);
    this.description = selection.projectName;
    this.tooltip = `${buildSourceLabel(selection)}\nProjeto: ${selection.projectName}\nChave: ${catalog.key}`;
    this.contextValue = 'ariaMetadataSource';
    this.iconPath = new vscode.ThemeIcon('database');
  }
}

export class MetadataSchemaNode extends vscode.TreeItem {
  constructor(public readonly schema: ParsedMetadataSchema) {
    super(schema.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${schema.tables.length} tabela(s)`;
    this.contextValue = 'ariaMetadataSchema';
    this.iconPath = new vscode.ThemeIcon('symbol-namespace');
  }
}

export class MetadataTableNode extends vscode.TreeItem {
  constructor(public readonly table: ParsedMetadataTable, public readonly selection: MetadataExplorerSelection) {
    super(table.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${table.columns.length} coluna(s)`;
    this.tooltip = table.comment ? `${table.fullName}\n${table.comment}` : table.fullName;
    this.contextValue = 'ariaMetadataTable';
    this.iconPath = new vscode.ThemeIcon('table');
  }
}

export class MetadataColumnNode extends vscode.TreeItem {
  constructor(public readonly column: ParsedMetadataColumn) {
    super(column.name, vscode.TreeItemCollapsibleState.None);
    this.description = column.type;
    this.tooltip = column.comment ? `${column.name} ${column.type}\n${column.comment}` : `${column.name} ${column.type}`;
    this.contextValue = 'ariaMetadataColumn';
    this.iconPath = new vscode.ThemeIcon('symbol-field');
  }
}

export class AriaMetadataTreeProvider implements vscode.TreeDataProvider<MetadataNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<MetadataNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  private currentSelection: MetadataExplorerSelection | undefined;
  private currentCatalog: ParsedMetadataCatalog | undefined;

  refresh(): void { this.onDidChangeTreeDataEmitter.fire(undefined); }

  clear(): void {
    this.currentSelection = undefined;
    this.currentCatalog = undefined;
    this.refresh();
  }

  setCatalog(selection: MetadataExplorerSelection, catalog: ParsedMetadataCatalog): void {
    this.currentSelection = selection;
    this.currentCatalog = catalog;
    this.refresh();
  }

  getSelection(): MetadataExplorerSelection | undefined { return this.currentSelection; }

  getTreeItem(element: MetadataNode): vscode.TreeItem { return element; }

  getChildren(element?: MetadataNode): Thenable<MetadataNode[]> {
    if (!this.currentSelection || !this.currentCatalog) { return Promise.resolve([]); }

    if (!element) {
      return Promise.resolve([new MetadataSourceNode(this.currentSelection, this.currentCatalog)]);
    }

    if (element instanceof MetadataSourceNode) {
      return Promise.resolve(
        element.catalog.schemas
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((schema) => new MetadataSchemaNode(schema))
      );
    }

    if (element instanceof MetadataSchemaNode) {
      return Promise.resolve(
        element.schema.tables
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((table) => new MetadataTableNode(table, this.currentSelection!))
      );
    }

    if (element instanceof MetadataTableNode) {
      return Promise.resolve(
        element.table.columns
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((column) => new MetadataColumnNode(column))
      );
    }

    return Promise.resolve([]);
  }
}

export class AriaMetadataDragAndDropController implements vscode.TreeDragAndDropController<MetadataNode> {
  readonly dragMimeTypes = [ARIA_METADATA_TABLE_MIME];
  readonly dropMimeTypes: string[] = [];

  async handleDrag(source: readonly MetadataNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const tableNode = source.find((node): node is MetadataTableNode => node instanceof MetadataTableNode);
    if (!tableNode) { return; }

    const payload: MetadataTableDragPayload = {
      schema: tableNode.table.schema,
      table: tableNode.table.name,
      fullName: tableNode.table.fullName,
      columns: tableNode.table.columns.map((column) => column.name),
      idBancoExterno: tableNode.selection.idBancoExterno,
      idBancoEsquema: tableNode.selection.idBancoEsquema,
      txDataSource: tableNode.selection.txDataSource,
    };

    dataTransfer.set(ARIA_METADATA_TABLE_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
  }

  async handleDrop(): Promise<void> {}
}

function buildSourceLabel(selection: MetadataExplorerSelection): string {
  return selection.schemaLabel ? `${selection.bancoLabel} / ${selection.schemaLabel}` : selection.bancoLabel;
}