import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  AriaMetadataTreeProvider,
  MetadataSourceNode,
  MetadataSchemaNode,
  MetadataTableNode,
  MetadataColumnNode,
} from '../vscode/tree/metadata-tree-provider';
import type { ParsedMetadataCatalog } from '../core/types';
import type { MetadataExplorerSelection } from '../vscode/tree/metadata-tree-provider';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSelection(projectId = 1): MetadataExplorerSelection {
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

function makeCatalog(): ParsedMetadataCatalog {
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

describe('MetadataSourceNode', () => {
  it('label is the sourceLabel or built from selection', () => {
    const sel = makeSelection();
    const catalog = makeCatalog();
    const node = new MetadataSourceNode(sel, catalog);
    assert.ok((node.label ?? '').toString().length > 0);
    assert.equal(node.contextValue, 'ariaMetadataSource');
    assert.ok(String(node.description).includes('Test Project'));
  });
});

describe('MetadataSchemaNode', () => {
  it('label is schema name', () => {
    const schema = makeCatalog().schemas[0];
    const node = new MetadataSchemaNode(schema, makeSelection());
    assert.equal(node.label, 'SCHEMA_A');
    assert.ok(String(node.description).includes('2'));
    assert.equal(node.contextValue, 'ariaMetadataSchema');
  });
});

describe('MetadataTableNode', () => {
  it('label is table name with column count description', () => {
    const table = makeCatalog().schemas[0].tables[0];
    const node = new MetadataTableNode(table, makeSelection());
    assert.equal(node.label, 'USERS');
    assert.ok(String(node.description).includes('2'));
    assert.equal(node.contextValue, 'ariaMetadataTable');
  });

  it('tooltip includes comment when present', () => {
    const table = makeCatalog().schemas[0].tables[0];
    const node = new MetadataTableNode(table, makeSelection());
    assert.ok(String(node.tooltip).includes('User table'));
  });
});

describe('MetadataColumnNode', () => {
  it('label is column name and description is type', () => {
    const col = makeCatalog().schemas[0].tables[0].columns[0];
    const node = new MetadataColumnNode(col);
    assert.equal(node.label, 'ID');
    assert.equal(node.description, 'NUMBER');
    assert.equal(node.contextValue, 'ariaMetadataColumn');
  });

  it('tooltip includes comment when present', () => {
    const col = makeCatalog().schemas[0].tables[0].columns[0];
    const node = new MetadataColumnNode(col);
    assert.ok(String(node.tooltip).includes('Primary key'));
  });
});

// ─── AriaMetadataTreeProvider ─────────────────────────────────────────────────

describe('AriaMetadataTreeProvider.getChildren – empty state', () => {
  it('returns empty when no catalog is set', async () => {
    const provider = new AriaMetadataTreeProvider();
    const children = await provider.getChildren();
    assert.deepEqual(children, []);
  });

  it('returns empty after clear()', async () => {
    const provider = new AriaMetadataTreeProvider();
    provider.setCatalog(makeSelection(), makeCatalog());
    provider.clear();
    const children = await provider.getChildren();
    assert.deepEqual(children, []);
  });
});

describe('AriaMetadataTreeProvider.getChildren – root level', () => {
  it('returns a single MetadataSourceNode', async () => {
    const provider = new AriaMetadataTreeProvider();
    provider.setCatalog(makeSelection(), makeCatalog());
    const children = await provider.getChildren();
    assert.equal(children.length, 1);
    assert.ok(children[0] instanceof MetadataSourceNode);
  });
});

describe('AriaMetadataTreeProvider.getChildren – schema level', () => {
  let provider: AriaMetadataTreeProvider;

  beforeEach(() => {
    provider = new AriaMetadataTreeProvider();
    provider.setCatalog(makeSelection(), makeCatalog());
  });

  it('returns MetadataSchemaNodes sorted alphabetically', async () => {
    const root = await provider.getChildren();
    const sourceNode = root[0] as MetadataSourceNode;
    const schemas = await provider.getChildren(sourceNode);
    assert.equal(schemas.length, 2);
    assert.ok(schemas[0] instanceof MetadataSchemaNode);
    assert.equal((schemas[0] as MetadataSchemaNode).schema.name, 'SCHEMA_A');
    assert.equal((schemas[1] as MetadataSchemaNode).schema.name, 'SCHEMA_B');
  });
});

describe('AriaMetadataTreeProvider.getChildren – table level', () => {
  let provider: AriaMetadataTreeProvider;

  beforeEach(() => {
    provider = new AriaMetadataTreeProvider();
    provider.setCatalog(makeSelection(), makeCatalog());
  });

  it('returns MetadataTableNodes sorted alphabetically', async () => {
    const root = await provider.getChildren();
    const schemas = await provider.getChildren(root[0]);
    const schemaA = schemas.find(s => (s as MetadataSchemaNode).schema.name === 'SCHEMA_A') as MetadataSchemaNode;
    const tables = await provider.getChildren(schemaA);
    assert.equal(tables.length, 2);
    assert.ok(tables[0] instanceof MetadataTableNode);
    // ORDERS < USERS
    assert.equal((tables[0] as MetadataTableNode).table.name, 'ORDERS');
    assert.equal((tables[1] as MetadataTableNode).table.name, 'USERS');
  });
});

describe('AriaMetadataTreeProvider.getChildren – column level', () => {
  let provider: AriaMetadataTreeProvider;

  beforeEach(() => {
    provider = new AriaMetadataTreeProvider();
    provider.setCatalog(makeSelection(), makeCatalog());
  });

  it('returns MetadataColumnNodes under a table', async () => {
    const root = await provider.getChildren();
    const schemas = await provider.getChildren(root[0]);
    const schemaA = schemas[0] as MetadataSchemaNode;
    const tables = await provider.getChildren(schemaA);
    const usersNode = tables.find(t => (t as MetadataTableNode).table.name === 'USERS') as MetadataTableNode;
    const columns = await provider.getChildren(usersNode);
    assert.equal(columns.length, 2);
    assert.ok(columns[0] instanceof MetadataColumnNode);
    // EMAIL < ID
    assert.equal((columns[0] as MetadataColumnNode).column.name, 'EMAIL');
    assert.equal((columns[1] as MetadataColumnNode).column.name, 'ID');
  });

  it('returns empty for MetadataColumnNode (leaf node)', async () => {
    const root = await provider.getChildren();
    const schemas = await provider.getChildren(root[0]);
    const tables = await provider.getChildren(schemas[0]);
    const usersNode = tables.find(t => (t as MetadataTableNode).table.name === 'USERS') as MetadataTableNode;
    const columns = await provider.getChildren(usersNode);
    const colChildren = await provider.getChildren(columns[0]);
    assert.deepEqual(colChildren, []);
  });
});

// ─── Search filtering ─────────────────────────────────────────────────────────

describe('AriaMetadataTreeProvider – search filtering', () => {
  let provider: AriaMetadataTreeProvider;

  beforeEach(() => {
    provider = new AriaMetadataTreeProvider();
    provider.setCatalog(makeSelection(), makeCatalog());
  });

  it('filters schemas by name', async () => {
    provider.setSearchQuery('SCHEMA_B');
    const root = await provider.getChildren();
    const schemas = await provider.getChildren(root[0]);
    assert.equal(schemas.length, 1);
    assert.equal((schemas[0] as MetadataSchemaNode).schema.name, 'SCHEMA_B');
  });

  it('includes schema when a table name matches', async () => {
    provider.setSearchQuery('users');
    const root = await provider.getChildren();
    const schemas = await provider.getChildren(root[0]);
    // SCHEMA_A has USERS table
    assert.ok(schemas.some(s => (s as MetadataSchemaNode).schema.name === 'SCHEMA_A'));
  });

  it('clears search query', async () => {
    provider.setSearchQuery('SCHEMA_B');
    provider.clearSearchQuery();
    const root = await provider.getChildren();
    const schemas = await provider.getChildren(root[0]);
    assert.equal(schemas.length, 2);
  });
});

// ─── refresh & getSelection ───────────────────────────────────────────────────

describe('AriaMetadataTreeProvider – getSelection', () => {
  it('returns undefined before setCatalog', () => {
    const provider = new AriaMetadataTreeProvider();
    assert.equal(provider.getSelection(), undefined);
  });

  it('returns the current selection after setCatalog', () => {
    const provider = new AriaMetadataTreeProvider();
    const sel = makeSelection(99);
    provider.setCatalog(sel, makeCatalog());
    assert.equal(provider.getSelection()?.projectId, 99);
  });

  it('fires onDidChangeTreeData on refresh', () => {
    let fired = false;
    const provider = new AriaMetadataTreeProvider();
    provider.onDidChangeTreeData(() => { fired = true; return { dispose: () => {} }; });
    provider.refresh();
    assert.equal(fired, true);
  });
});
