"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const metadata_tree_provider_1 = require("../vscode/tree/metadata-tree-provider");
// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeSelection(projectId = 1) {
    return {
        projectId,
        projectName: 'Test Project',
        idBancoExterno: 10,
        bancoLabel: 'DB_PROD',
        idBancoEsquema: 100,
        schemaLabel: 'PUBLIC',
        txDataSource: 'jdbc:oracle:thin:@host',
    };
}
function makeCatalog() {
    return {
        key: '10:100',
        filePath: '/metadata.txt',
        markdown: '',
        schemas: [
            {
                name: 'SCHEMA_A',
                tables: [
                    {
                        schema: 'SCHEMA_A',
                        name: 'USERS',
                        fullName: 'SCHEMA_A.USERS',
                        comment: 'User table',
                        columns: [
                            { name: 'ID', type: 'NUMBER', comment: 'Primary key', raw: '- ID NUMBER Primary key' },
                            { name: 'EMAIL', type: 'VARCHAR2', raw: '- EMAIL VARCHAR2' },
                        ],
                        foreignKeys: [],
                    },
                    {
                        schema: 'SCHEMA_A',
                        name: 'ORDERS',
                        fullName: 'SCHEMA_A.ORDERS',
                        columns: [],
                        foreignKeys: [],
                    },
                ],
            },
            {
                name: 'SCHEMA_B',
                tables: [
                    {
                        schema: 'SCHEMA_B',
                        name: 'PRODUCTS',
                        fullName: 'SCHEMA_B.PRODUCTS',
                        columns: [
                            { name: 'SKU', type: 'VARCHAR2', raw: '- SKU VARCHAR2' },
                        ],
                        foreignKeys: [],
                    },
                ],
            },
        ],
    };
}
// ─── node construction ────────────────────────────────────────────────────────
(0, node_test_1.describe)('MetadataSourceNode', () => {
    (0, node_test_1.it)('label is the sourceLabel or built from selection', () => {
        const sel = makeSelection();
        const catalog = makeCatalog();
        const node = new metadata_tree_provider_1.MetadataSourceNode(sel, catalog);
        assert.ok((node.label ?? '').toString().length > 0);
        assert.equal(node.contextValue, 'ariaMetadataSource');
        assert.ok(String(node.description).includes('Test Project'));
    });
});
(0, node_test_1.describe)('MetadataSchemaNode', () => {
    (0, node_test_1.it)('label is schema name', () => {
        const schema = makeCatalog().schemas[0];
        const node = new metadata_tree_provider_1.MetadataSchemaNode(schema, makeSelection());
        assert.equal(node.label, 'SCHEMA_A');
        assert.ok(String(node.description).includes('2'));
        assert.equal(node.contextValue, 'ariaMetadataSchema');
    });
});
(0, node_test_1.describe)('MetadataTableNode', () => {
    (0, node_test_1.it)('label is table name with column count description', () => {
        const table = makeCatalog().schemas[0].tables[0];
        const node = new metadata_tree_provider_1.MetadataTableNode(table, makeSelection());
        assert.equal(node.label, 'USERS');
        assert.ok(String(node.description).includes('2'));
        assert.equal(node.contextValue, 'ariaMetadataTable');
    });
    (0, node_test_1.it)('tooltip includes comment when present', () => {
        const table = makeCatalog().schemas[0].tables[0];
        const node = new metadata_tree_provider_1.MetadataTableNode(table, makeSelection());
        assert.ok(String(node.tooltip).includes('User table'));
    });
});
(0, node_test_1.describe)('MetadataColumnNode', () => {
    (0, node_test_1.it)('label is column name and description is type', () => {
        const col = makeCatalog().schemas[0].tables[0].columns[0];
        const node = new metadata_tree_provider_1.MetadataColumnNode(col);
        assert.equal(node.label, 'ID');
        assert.equal(node.description, 'NUMBER');
        assert.equal(node.contextValue, 'ariaMetadataColumn');
    });
    (0, node_test_1.it)('tooltip includes comment when present', () => {
        const col = makeCatalog().schemas[0].tables[0].columns[0];
        const node = new metadata_tree_provider_1.MetadataColumnNode(col);
        assert.ok(String(node.tooltip).includes('Primary key'));
    });
});
// ─── AriaMetadataTreeProvider ─────────────────────────────────────────────────
(0, node_test_1.describe)('AriaMetadataTreeProvider.getChildren – empty state', () => {
    (0, node_test_1.it)('returns empty when no catalog is set', async () => {
        const provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        const children = await provider.getChildren();
        assert.deepEqual(children, []);
    });
    (0, node_test_1.it)('returns empty after clear()', async () => {
        const provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        provider.setCatalog(makeSelection(), makeCatalog());
        provider.clear();
        const children = await provider.getChildren();
        assert.deepEqual(children, []);
    });
});
(0, node_test_1.describe)('AriaMetadataTreeProvider.getChildren – root level', () => {
    (0, node_test_1.it)('returns a single MetadataSourceNode', async () => {
        const provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        provider.setCatalog(makeSelection(), makeCatalog());
        const children = await provider.getChildren();
        assert.equal(children.length, 1);
        assert.ok(children[0] instanceof metadata_tree_provider_1.MetadataSourceNode);
    });
});
(0, node_test_1.describe)('AriaMetadataTreeProvider.getChildren – schema level', () => {
    let provider;
    (0, node_test_1.beforeEach)(() => {
        provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        provider.setCatalog(makeSelection(), makeCatalog());
    });
    (0, node_test_1.it)('returns MetadataSchemaNodes sorted alphabetically', async () => {
        const root = await provider.getChildren();
        const sourceNode = root[0];
        const schemas = await provider.getChildren(sourceNode);
        assert.equal(schemas.length, 2);
        assert.ok(schemas[0] instanceof metadata_tree_provider_1.MetadataSchemaNode);
        assert.equal(schemas[0].schema.name, 'SCHEMA_A');
        assert.equal(schemas[1].schema.name, 'SCHEMA_B');
    });
});
(0, node_test_1.describe)('AriaMetadataTreeProvider.getChildren – table level', () => {
    let provider;
    (0, node_test_1.beforeEach)(() => {
        provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        provider.setCatalog(makeSelection(), makeCatalog());
    });
    (0, node_test_1.it)('returns MetadataTableNodes sorted alphabetically', async () => {
        const root = await provider.getChildren();
        const schemas = await provider.getChildren(root[0]);
        const schemaA = schemas.find(s => s.schema.name === 'SCHEMA_A');
        const tables = await provider.getChildren(schemaA);
        assert.equal(tables.length, 2);
        assert.ok(tables[0] instanceof metadata_tree_provider_1.MetadataTableNode);
        // ORDERS < USERS
        assert.equal(tables[0].table.name, 'ORDERS');
        assert.equal(tables[1].table.name, 'USERS');
    });
});
(0, node_test_1.describe)('AriaMetadataTreeProvider.getChildren – column level', () => {
    let provider;
    (0, node_test_1.beforeEach)(() => {
        provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        provider.setCatalog(makeSelection(), makeCatalog());
    });
    (0, node_test_1.it)('returns MetadataColumnNodes under a table', async () => {
        const root = await provider.getChildren();
        const schemas = await provider.getChildren(root[0]);
        const schemaA = schemas[0];
        const tables = await provider.getChildren(schemaA);
        const usersNode = tables.find(t => t.table.name === 'USERS');
        const columns = await provider.getChildren(usersNode);
        assert.equal(columns.length, 2);
        assert.ok(columns[0] instanceof metadata_tree_provider_1.MetadataColumnNode);
        // EMAIL < ID
        assert.equal(columns[0].column.name, 'EMAIL');
        assert.equal(columns[1].column.name, 'ID');
    });
    (0, node_test_1.it)('returns empty for MetadataColumnNode (leaf node)', async () => {
        const root = await provider.getChildren();
        const schemas = await provider.getChildren(root[0]);
        const tables = await provider.getChildren(schemas[0]);
        const usersNode = tables.find(t => t.table.name === 'USERS');
        const columns = await provider.getChildren(usersNode);
        const colChildren = await provider.getChildren(columns[0]);
        assert.deepEqual(colChildren, []);
    });
});
// ─── Search filtering ─────────────────────────────────────────────────────────
(0, node_test_1.describe)('AriaMetadataTreeProvider – search filtering', () => {
    let provider;
    (0, node_test_1.beforeEach)(() => {
        provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        provider.setCatalog(makeSelection(), makeCatalog());
    });
    (0, node_test_1.it)('filters schemas by name', async () => {
        provider.setSearchQuery('SCHEMA_B');
        const root = await provider.getChildren();
        const schemas = await provider.getChildren(root[0]);
        assert.equal(schemas.length, 1);
        assert.equal(schemas[0].schema.name, 'SCHEMA_B');
    });
    (0, node_test_1.it)('includes schema when a table name matches', async () => {
        provider.setSearchQuery('users');
        const root = await provider.getChildren();
        const schemas = await provider.getChildren(root[0]);
        // SCHEMA_A has USERS table
        assert.ok(schemas.some(s => s.schema.name === 'SCHEMA_A'));
    });
    (0, node_test_1.it)('clears search query', async () => {
        provider.setSearchQuery('SCHEMA_B');
        provider.clearSearchQuery();
        const root = await provider.getChildren();
        const schemas = await provider.getChildren(root[0]);
        assert.equal(schemas.length, 2);
    });
});
// ─── refresh & getSelection ───────────────────────────────────────────────────
(0, node_test_1.describe)('AriaMetadataTreeProvider – getSelection', () => {
    (0, node_test_1.it)('returns undefined before setCatalog', () => {
        const provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        assert.equal(provider.getSelection(), undefined);
    });
    (0, node_test_1.it)('returns the current selection after setCatalog', () => {
        const provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        const sel = makeSelection(99);
        provider.setCatalog(sel, makeCatalog());
        assert.equal(provider.getSelection()?.projectId, 99);
    });
    (0, node_test_1.it)('fires onDidChangeTreeData on refresh', () => {
        let fired = false;
        const provider = new metadata_tree_provider_1.AriaMetadataTreeProvider();
        provider.onDidChangeTreeData(() => { fired = true; return { dispose: () => { } }; });
        provider.refresh();
        assert.equal(fired, true);
    });
});
