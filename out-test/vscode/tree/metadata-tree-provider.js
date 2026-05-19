"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AriaMetadataDragAndDropController = exports.AriaMetadataTreeProvider = exports.MetadataColumnNode = exports.MetadataTableNode = exports.MetadataSchemaNode = exports.MetadataSourceNode = exports.ARIA_METADATA_CONTEXT_MIME = exports.ARIA_METADATA_TABLE_MIME = void 0;
const vscode = require("vscode");
const utils_1 = require("../../core/utils");
exports.ARIA_METADATA_TABLE_MIME = 'application/vnd.aria.metadata.table';
exports.ARIA_METADATA_CONTEXT_MIME = 'application/vnd.aria.metadata.context';
class MetadataSourceNode extends vscode.TreeItem {
    selection;
    catalog;
    constructor(selection, catalog) {
        super(selection.sourceLabel || buildSourceLabel(selection), vscode.TreeItemCollapsibleState.Expanded);
        this.selection = selection;
        this.catalog = catalog;
        this.description = selection.projectName;
        this.tooltip = `${buildSourceLabel(selection)}\nProjeto: ${selection.projectName}\nChave: ${catalog.key}`;
        this.contextValue = 'ariaMetadataSource';
        this.iconPath = new vscode.ThemeIcon('database');
    }
}
exports.MetadataSourceNode = MetadataSourceNode;
class MetadataSchemaNode extends vscode.TreeItem {
    schema;
    selection;
    constructor(schema, selection) {
        super(schema.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.schema = schema;
        this.selection = selection;
        this.description = `${schema.tables.length} tabela(s)`;
        this.contextValue = 'ariaMetadataSchema';
        this.iconPath = new vscode.ThemeIcon('symbol-namespace');
    }
}
exports.MetadataSchemaNode = MetadataSchemaNode;
class MetadataTableNode extends vscode.TreeItem {
    table;
    selection;
    constructor(table, selection) {
        super(table.name, vscode.TreeItemCollapsibleState.Collapsed);
        this.table = table;
        this.selection = selection;
        this.description = `${table.columns.length} coluna(s)`;
        this.tooltip = table.comment ? `${table.fullName}\n${table.comment}` : table.fullName;
        this.contextValue = 'ariaMetadataTable';
        this.iconPath = new vscode.ThemeIcon('table');
    }
}
exports.MetadataTableNode = MetadataTableNode;
class MetadataColumnNode extends vscode.TreeItem {
    column;
    constructor(column) {
        super(column.name, vscode.TreeItemCollapsibleState.None);
        this.column = column;
        this.description = column.type;
        this.tooltip = column.comment ? `${column.name} ${column.type}\n${column.comment}` : `${column.name} ${column.type}`;
        this.contextValue = 'ariaMetadataColumn';
        this.iconPath = new vscode.ThemeIcon('symbol-field');
    }
}
exports.MetadataColumnNode = MetadataColumnNode;
class AriaMetadataTreeProvider {
    onDidChangeTreeDataEmitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    currentSelection;
    currentCatalog;
    searchQuery = '';
    refresh() { this.onDidChangeTreeDataEmitter.fire(undefined); }
    clear() {
        this.currentSelection = undefined;
        this.currentCatalog = undefined;
        this.refresh();
    }
    setCatalog(selection, catalog) {
        this.currentSelection = selection;
        this.currentCatalog = catalog;
        this.refresh();
    }
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
    getSelection() { return this.currentSelection; }
    getTreeItem(element) { return element; }
    getChildren(element) {
        if (!this.currentSelection || !this.currentCatalog) {
            return Promise.resolve([]);
        }
        const query = this.searchQuery;
        if (!element) {
            return Promise.resolve([new MetadataSourceNode(this.currentSelection, this.currentCatalog)]);
        }
        if (element instanceof MetadataSourceNode) {
            const schemas = element.catalog.schemas.filter((schema) => this.schemaMatchesQuery(schema, query));
            return Promise.resolve(schemas
                .slice()
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((schema) => new MetadataSchemaNode(schema, element.selection)));
        }
        if (element instanceof MetadataSchemaNode) {
            const schemaMatches = this.schemaTextMatches(element.schema, query);
            const tables = element.schema.tables.filter((table) => this.tableMatchesQuery(table, query, schemaMatches));
            return Promise.resolve(tables
                .slice()
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((table) => new MetadataTableNode(table, this.currentSelection)));
        }
        if (element instanceof MetadataTableNode) {
            const tableMatches = this.tableTextMatches(element.table, query);
            const columns = element.table.columns.filter((column) => this.columnMatchesQuery(column, query, tableMatches));
            return Promise.resolve(columns
                .slice()
                .sort((left, right) => left.name.localeCompare(right.name))
                .map((column) => new MetadataColumnNode(column)));
        }
        return Promise.resolve([]);
    }
    schemaMatchesQuery(schema, query) {
        if (!query) {
            return true;
        }
        if (this.schemaTextMatches(schema, query)) {
            return true;
        }
        return schema.tables.some((table) => this.tableTextMatches(table, query) || table.columns.some((column) => this.columnTextMatches(column, query)));
    }
    tableMatchesQuery(table, query, schemaMatches) {
        if (!query) {
            return true;
        }
        if (schemaMatches) {
            return true;
        }
        if (this.tableTextMatches(table, query)) {
            return true;
        }
        return table.columns.some((column) => this.columnTextMatches(column, query));
    }
    columnMatchesQuery(column, query, tableMatches) {
        if (!query) {
            return true;
        }
        if (tableMatches) {
            return true;
        }
        return this.columnTextMatches(column, query);
    }
    schemaTextMatches(schema, query) {
        if (!query) {
            return true;
        }
        return (0, utils_1.normalizeTextForLookup)(schema.name).includes(query);
    }
    tableTextMatches(table, query) {
        const haystack = (0, utils_1.normalizeTextForLookup)(`${table.schema} ${table.name} ${table.fullName} ${table.comment || ''}`);
        return haystack.includes(query);
    }
    columnTextMatches(column, query) {
        const haystack = (0, utils_1.normalizeTextForLookup)(`${column.name} ${column.type} ${column.comment || ''}`);
        return haystack.includes(query);
    }
}
exports.AriaMetadataTreeProvider = AriaMetadataTreeProvider;
class AriaMetadataDragAndDropController {
    dragMimeTypes = [exports.ARIA_METADATA_TABLE_MIME, exports.ARIA_METADATA_CONTEXT_MIME, 'text/plain'];
    dropMimeTypes = [];
    async handleDrag(source, dataTransfer) {
        const schemaNode = source.find((node) => node instanceof MetadataSchemaNode);
        const tableNode = source.find((node) => node instanceof MetadataTableNode);
        if (!tableNode && !schemaNode) {
            return;
        }
        if (tableNode) {
            const payload = {
                schema: tableNode.table.schema,
                table: tableNode.table.name,
                fullName: tableNode.table.fullName,
                columns: tableNode.table.columns.map((column) => column.name),
                idBancoExterno: tableNode.selection.idBancoExterno,
                idBancoEsquema: tableNode.selection.idBancoEsquema,
                txDataSource: tableNode.selection.txDataSource,
            };
            const context = buildTableContext(tableNode.table);
            dataTransfer.set(exports.ARIA_METADATA_TABLE_MIME, new vscode.DataTransferItem(JSON.stringify(payload)));
            dataTransfer.set(exports.ARIA_METADATA_CONTEXT_MIME, new vscode.DataTransferItem(context));
            dataTransfer.set('text/plain', new vscode.DataTransferItem(context));
            return;
        }
        if (schemaNode) {
            const context = buildSchemaContext(schemaNode.schema);
            dataTransfer.set(exports.ARIA_METADATA_CONTEXT_MIME, new vscode.DataTransferItem(context));
            dataTransfer.set('text/plain', new vscode.DataTransferItem(context));
        }
    }
    async handleDrop() { }
}
exports.AriaMetadataDragAndDropController = AriaMetadataDragAndDropController;
function buildSourceLabel(selection) {
    return selection.schemaLabel ? `${selection.bancoLabel} / ${selection.schemaLabel}` : selection.bancoLabel;
}
function buildSchemaContext(schema) {
    const lines = [`Schema: ${schema.name}`];
    for (const table of schema.tables) {
        lines.push(`- ${table.fullName}`);
        for (const column of table.columns) {
            lines.push(`  - ${column.name} ${column.type}`);
        }
    }
    return lines.join('\n');
}
function buildTableContext(table) {
    const lines = [`Tabela: ${table.fullName}`, 'Colunas:'];
    for (const column of table.columns) {
        lines.push(`- ${column.name} ${column.type}`);
    }
    return lines.join('\n');
}
