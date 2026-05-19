import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { AriaTreeProvider, ProjectNode, EndpointNode } from '../vscode/tree/tree-provider';
import type { AriaDataset, AriaProject, AriaEndpoint } from '../core/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEndpoint(id: number, name: string, path: string): AriaEndpoint {
  return { ID_REST_CUSTOM: id, NO_REST_CUSTOM: name, TX_PATH: path };
}

function makeProject(id: number, name: string, path: string, endpoints: AriaEndpoint[] = []): AriaProject {
  return { ID_PROJETO: id, NO_PROJETO: name, TX_PATH: path, REST_CUSTOM: endpoints };
}

function makeDataset(projects: AriaProject[]): AriaDataset {
  return { registros: projects };
}

// ─── ProjectNode ──────────────────────────────────────────────────────────────

describe('ProjectNode', () => {
  it('label includes project name and path', () => {
    const p = makeProject(1, 'My Project', 'my/path');
    const node = new ProjectNode(p);
    assert.ok((node.label ?? '').toString().includes('My Project'));
    assert.ok((node.label ?? '').toString().includes('my/path'));
  });

  it('description shows project ID', () => {
    const p = makeProject(42, 'Test', 'test');
    const node = new ProjectNode(p);
    assert.ok(String(node.description).includes('42'));
  });

  it('contextValue is ariaProject', () => {
    const node = new ProjectNode(makeProject(1, 'P', 'p'));
    assert.equal(node.contextValue, 'ariaProject');
  });
});

// ─── EndpointNode ─────────────────────────────────────────────────────────────

describe('EndpointNode', () => {
  it('label includes endpoint name and path', () => {
    const p = makeProject(1, 'P', 'p');
    const ep = makeEndpoint(5, 'My Endpoint', 'p/ep');
    const node = new EndpointNode(p, ep);
    assert.ok((node.label ?? '').toString().includes('My Endpoint'));
    assert.ok((node.label ?? '').toString().includes('p/ep'));
  });

  it('description shows endpoint ID', () => {
    const p = makeProject(1, 'P', 'p');
    const ep = makeEndpoint(77, 'EP', 'p/ep');
    const node = new EndpointNode(p, ep);
    assert.ok(String(node.description).includes('77'));
  });

  it('contextValue is ariaEndpoint', () => {
    const p = makeProject(1, 'P', 'p');
    const node = new EndpointNode(p, makeEndpoint(1, 'E', 'e'));
    assert.equal(node.contextValue, 'ariaEndpoint');
  });

  it('has an editEndpointCode command', () => {
    const p = makeProject(1, 'P', 'p');
    const node = new EndpointNode(p, makeEndpoint(1, 'E', 'e'));
    assert.equal((node.command as unknown as Record<string, unknown>)?.command, 'aria.editEndpointCode');
  });
});

// ─── AriaTreeProvider ─────────────────────────────────────────────────────────

describe('AriaTreeProvider.getChildren – no dataset', () => {
  it('returns empty when dataset provider returns undefined', async () => {
    const provider = new AriaTreeProvider(() => undefined);
    const children = await provider.getChildren();
    assert.deepEqual(children, []);
  });
});

describe('AriaTreeProvider.getChildren – root level', () => {
  let provider: AriaTreeProvider;
  let dataset: AriaDataset;

  beforeEach(() => {
    dataset = makeDataset([
      makeProject(1, 'Beta Project', 'beta'),
      makeProject(2, 'Alpha Project', 'alpha'),
    ]);
    provider = new AriaTreeProvider(() => dataset);
  });

  it('returns ProjectNodes sorted alphabetically', async () => {
    const children = await provider.getChildren();
    assert.equal(children.length, 2);
    assert.ok(children[0] instanceof ProjectNode);
    assert.ok((children[0] as ProjectNode).project.NO_PROJETO.startsWith('Alpha'));
    assert.ok((children[1] as ProjectNode).project.NO_PROJETO.startsWith('Beta'));
  });

  it('returns all projects when no search query', async () => {
    const children = await provider.getChildren();
    assert.equal(children.length, 2);
  });
});

describe('AriaTreeProvider.getChildren – under ProjectNode', () => {
  let provider: AriaTreeProvider;

  beforeEach(() => {
    const dataset = makeDataset([
      makeProject(1, 'Alpha', 'a', [
        makeEndpoint(10, 'Get Users', 'a/users'),
        makeEndpoint(11, 'Create User', 'a/users/create'),
      ]),
    ]);
    provider = new AriaTreeProvider(() => dataset);
  });

  it('returns EndpointNodes sorted alphabetically under ProjectNode', async () => {
    const root = await provider.getChildren();
    const projectNode = root[0] as ProjectNode;
    const children = await provider.getChildren(projectNode);
    assert.equal(children.length, 2);
    assert.ok(children[0] instanceof EndpointNode);
    // 'Create User' < 'Get Users'
    assert.ok((children[0] as EndpointNode).endpoint.NO_REST_CUSTOM.startsWith('Create'));
  });

  it('returns empty for EndpointNode (leaf)', async () => {
    const root = await provider.getChildren();
    const projectNode = root[0] as ProjectNode;
    const eps = await provider.getChildren(projectNode);
    const epChildren = await provider.getChildren(eps[0]);
    assert.deepEqual(epChildren, []);
  });
});

describe('AriaTreeProvider – search filtering', () => {
  let provider: AriaTreeProvider;
  let dataset: AriaDataset;

  beforeEach(() => {
    dataset = makeDataset([
      makeProject(1, 'Finance API', 'finance', [
        makeEndpoint(1, 'Get Budget', 'finance/budget'),
        makeEndpoint(2, 'Get Tax', 'finance/tax'),
      ]),
      makeProject(2, 'HR System', 'hr', [
        makeEndpoint(3, 'Get Employees', 'hr/employees'),
      ]),
    ]);
    provider = new AriaTreeProvider(() => dataset);
  });

  it('filters projects by name query', async () => {
    provider.setSearchQuery('Finance');
    const children = await provider.getChildren();
    assert.equal(children.length, 1);
    assert.ok((children[0] as ProjectNode).project.NO_PROJETO.includes('Finance'));
  });

  it('includes project when query matches an endpoint', async () => {
    provider.setSearchQuery('employees');
    const children = await provider.getChildren();
    assert.equal(children.length, 1);
    assert.ok((children[0] as ProjectNode).project.NO_PROJETO.includes('HR'));
  });

  it('filters endpoints under project by query', async () => {
    provider.setSearchQuery('budget');
    const root = await provider.getChildren();
    const financeNode = root[0] as ProjectNode;
    const eps = await provider.getChildren(financeNode);
    assert.equal(eps.length, 1);
    assert.ok((eps[0] as EndpointNode).endpoint.NO_REST_CUSTOM.includes('Budget'));
  });

  it('clearSearchQuery restores all results', async () => {
    provider.setSearchQuery('finance');
    provider.clearSearchQuery();
    const children = await provider.getChildren();
    assert.equal(children.length, 2);
  });

  it('clearSearchQuery does nothing when query already empty', () => {
    // Should not throw
    provider.clearSearchQuery();
  });
});

describe('AriaTreeProvider – refresh', () => {
  it('fires onDidChangeTreeData event on refresh', () => {
    let fired = false;
    const provider = new AriaTreeProvider(() => undefined);
    provider.onDidChangeTreeData(() => { fired = true; return { dispose: () => {} }; });
    provider.refresh();
    assert.equal(fired, true);
  });

  it('getTreeItem returns the element itself', () => {
    const p = makeProject(1, 'P', 'p');
    const provider = new AriaTreeProvider(() => undefined);
    const node = new ProjectNode(p);
    assert.equal(provider.getTreeItem(node), node);
  });
});
