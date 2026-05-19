import * as vscode from 'vscode';
import type { ParsedMetadataCatalog, ParsedMetadataColumn, ParsedMetadataSchema, ParsedMetadataTable } from '../../core/types';
import { normalizeTextForLookup } from '../../core/utils';

export const ARIA_METADATA_TABLE_MIME = 'application/vnd.aria.metadata.table';
export const ARIA_METADATA_CONTEXT_MIME = 'application/vnd.aria.metadata.context';

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
  constructor(public readonly schema: ParsedMetadataSchema, public readonly selection: MetadataExplorerSelection) {
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
  private searchQuery = '';

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

  setSearchQuery(query: string): void {
    this.searchQuery = normalizeTextForLookup(query);
    this.refresh();
  }

  clearSearchQuery(): void {
    if (!this.searchQuery) { return; }
    this.searchQuery = '';
    this.refresh();
  }

  getSelection(): MetadataExplorerSelection | undefined { return this.currentSelection; }

  getTreeItem(element: MetadataNode): vscode.TreeItem { return element; }

  getChildren(element?: MetadataNode): Thenable<MetadataNode[]> {
    if (!this.currentSelection || !this.currentCatalog) { return Promise.resolve([]); }
    const query = this.searchQuery;

    if (!element) {
      return Promise.resolve([new MetadataSourceNode(this.currentSelection, this.currentCatalog)]);
    }

    if (element instanceof MetadataSourceNode) {
      const schemas = element.catalog.schemas.filter((schema) => this.schemaMatchesQuery(schema, query));
      return Promise.resolve(
        schemas
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((schema) => new MetadataSchemaNode(schema, element.selection))
      );
    }

    if (element instanceof MetadataSchemaNode) {
      const schemaMatches = this.schemaTextMatches(element.schema, query);
      const tables = element.schema.tables.filter((table) => this.tableMatchesQuery(table, query, schemaMatches));
      return Promise.resolve(
        tables
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((table) => new MetadataTableNode(table, this.currentSelection!))
      );
    }

    if (element instanceof MetadataTableNode) {
      const tableMatches = this.tableTextMatches(element.table, query);
      const columns = element.table.columns.filter((column) => this.columnMatchesQuery(column, query, tableMatches));
      return Promise.resolve(
        columns
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((column) => new MetadataColumnNode(column))
      );
    }

    return Promise.resolve([]);
  }

  private schemaMatchesQuery(schema: ParsedMetadataSchema, query: string): boolean {
    if (!query) { return true; }
    if (this.schemaTextMatches(schema, query)) { return true; }
    return schema.tables.some((table) => this.tableTextMatches(table, query) || table.columns.some((column) => this.columnTextMatches(column, query)));
  }

  private tableMatchesQuery(table: ParsedMetadataTable, query: string, schemaMatches: boolean): boolean {
    if (!query) { return true; }
    if (schemaMatches) { return true; }
    if (this.tableTextMatches(table, query)) { return true; }
    return table.columns.some((column) => this.columnTextMatches(column, query));
  }

  private columnMatchesQuery(column: ParsedMetadataColumn, query: string, tableMatches: boolean): boolean {
    if (!query) { return true; }
    if (tableMatches) { return true; }
    return this.columnTextMatches(column, query);
  }

  private schemaTextMatches(schema: ParsedMetadataSchema, query: string): boolean {
    if (!query) { return true; }
    return normalizeTextForLookup(schema.name).includes(query);
  }

  private tableTextMatches(table: ParsedMetadataTable, query: string): boolean {
    const haystack = normalizeTextForLookup(`${table.schema} ${table.name} ${table.fullName} ${table.comment || ''}`);
    return haystack.includes(query);
  }

  private columnTextMatches(column: ParsedMetadataColumn, query: string): boolean {
    const haystack = normalizeTextForLookup(`${column.name} ${column.type} ${column.comment || ''}`);
    return haystack.includes(query);
  }
}

export class AriaMetadataDragAndDropController implements vscode.TreeDragAndDropController<MetadataNode> {
  readonly dragMimeTypes = [ARIA_METADATA_TABLE_MIME, ARIA_METADATA_CONTEXT_MIME, 'text/plain'];
  readonly dropMimeTypes: string[] = [];

  async handleDrag(source: readonly MetadataNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
    const schemaNode = source.find((node): node is MetadataSchemaNode => node instanceof MetadataSchemaNode);
    const tableNode = source.find((node): node is MetadataTableNode => node instanceof MetadataTableNode);
    if (!tableNode && !schemaNode) { return; }

    if (tableNode) {
      const payload: MetadataTableDragPayload = {
        schema: tableNode.table.schema,
        table: tableNode.table.name,
        fullName: tableNode.table.fullName,
        columns: tableNode.table.columns.map((column) => column.name),
        idBancoExterno: tableNode.selection.idBancoExterno,
        idBancoEsquema: tableNode.selection.idBancoEsquema,
        txDataSource: tableNode.selection.txDataSource,
      };
      const context = buildTableContext(tableNode.table);
      dataTransfer.set(ARIA_METADATA_TABLE_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
      dataTransfer.set(ARIA_METADATA_CONTEXT_MIME, new vscode.DataTransferItem(context));
      dataTransfer.set('text/plain', new vscode.DataTransferItem(context));
      return;
    }

    if (schemaNode) {
      const context = buildSchemaContext(schemaNode.schema);
      dataTransfer.set(ARIA_METADATA_CONTEXT_MIME, new vscode.DataTransferItem(context));
      dataTransfer.set('text/plain', new vscode.DataTransferItem(context));
    }
  }

  async handleDrop(): Promise<void> {}
}

function buildSourceLabel(selection: MetadataExplorerSelection): string {
  return selection.schemaLabel ? `${selection.bancoLabel} / ${selection.schemaLabel}` : selection.bancoLabel;
}

function buildSchemaContext(schema: ParsedMetadataSchema): string {
  const lines: string[] = [`Schema: ${schema.name}`];
  for (const table of schema.tables) {
    lines.push(`- ${table.fullName}`);
    for (const column of table.columns) {
      lines.push(`  - ${column.name} ${column.type}`);
    }
  }
  return lines.join('\n');
}

function buildTableContext(table: ParsedMetadataTable): string {
  const lines: string[] = [`Tabela: ${table.fullName}`, 'Colunas:'];
  for (const column of table.columns) {
    lines.push(`- ${column.name} ${column.type}`);
  }
  return lines.join('\n');
}