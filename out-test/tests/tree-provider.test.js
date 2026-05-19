"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const tree_provider_1 = require("../vscode/tree/tree-provider");
// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeEndpoint(id, name, path) {
    return { ID_REST_CUSTOM: id, NO_REST_CUSTOM: name, TX_PATH: path };
}
function makeProject(id, name, path, endpoints = []) {
    return { ID_PROJETO: id, NO_PROJETO: name, TX_PATH: path, REST_CUSTOM: endpoints };
}
function makeDataset(projects) {
    return { registros: projects };
}
// ─── ProjectNode ──────────────────────────────────────────────────────────────
(0, node_test_1.describe)('ProjectNode', () => {
    (0, node_test_1.it)('label includes project name and path', () => {
        const p = makeProject(1, 'My Project', 'my/path');
        const node = new tree_provider_1.ProjectNode(p);
        assert.ok((node.label ?? '').toString().includes('My Project'));
        assert.ok((node.label ?? '').toString().includes('my/path'));
    });
    (0, node_test_1.it)('description shows project ID', () => {
        const p = makeProject(42, 'Test', 'test');
        const node = new tree_provider_1.ProjectNode(p);
        assert.ok(String(node.description).includes('42'));
    });
    (0, node_test_1.it)('contextValue is ariaProject', () => {
        const node = new tree_provider_1.ProjectNode(makeProject(1, 'P', 'p'));
        assert.equal(node.contextValue, 'ariaProject');
    });
});
// ─── EndpointNode ─────────────────────────────────────────────────────────────
(0, node_test_1.describe)('EndpointNode', () => {
    (0, node_test_1.it)('label includes endpoint name and path', () => {
        const p = makeProject(1, 'P', 'p');
        const ep = makeEndpoint(5, 'My Endpoint', 'p/ep');
        const node = new tree_provider_1.EndpointNode(p, ep);
        assert.ok((node.label ?? '').toString().includes('My Endpoint'));
        assert.ok((node.label ?? '').toString().includes('p/ep'));
    });
    (0, node_test_1.it)('description shows endpoint ID', () => {
        const p = makeProject(1, 'P', 'p');
        const ep = makeEndpoint(77, 'EP', 'p/ep');
        const node = new tree_provider_1.EndpointNode(p, ep);
        assert.ok(String(node.description).includes('77'));
    });
    (0, node_test_1.it)('contextValue is ariaEndpoint', () => {
        const p = makeProject(1, 'P', 'p');
        const node = new tree_provider_1.EndpointNode(p, makeEndpoint(1, 'E', 'e'));
        assert.equal(node.contextValue, 'ariaEndpoint');
    });
    (0, node_test_1.it)('has an editEndpointCode command', () => {
        const p = makeProject(1, 'P', 'p');
        const node = new tree_provider_1.EndpointNode(p, makeEndpoint(1, 'E', 'e'));
        assert.equal(node.command?.command, 'aria.editEndpointCode');
    });
});
// ─── AriaTreeProvider ─────────────────────────────────────────────────────────
(0, node_test_1.describe)('AriaTreeProvider.getChildren – no dataset', () => {
    (0, node_test_1.it)('returns empty when dataset provider returns undefined', async () => {
        const provider = new tree_provider_1.AriaTreeProvider(() => undefined);
        const children = await provider.getChildren();
        assert.deepEqual(children, []);
    });
});
(0, node_test_1.describe)('AriaTreeProvider.getChildren – root level', () => {
    let provider;
    let dataset;
    (0, node_test_1.beforeEach)(() => {
        dataset = makeDataset([
            makeProject(1, 'Beta Project', 'beta'),
            makeProject(2, 'Alpha Project', 'alpha'),
        ]);
        provider = new tree_provider_1.AriaTreeProvider(() => dataset);
    });
    (0, node_test_1.it)('returns ProjectNodes sorted alphabetically', async () => {
        const children = await provider.getChildren();
        assert.equal(children.length, 2);
        assert.ok(children[0] instanceof tree_provider_1.ProjectNode);
        assert.ok(children[0].project.NO_PROJETO.startsWith('Alpha'));
        assert.ok(children[1].project.NO_PROJETO.startsWith('Beta'));
    });
    (0, node_test_1.it)('returns all projects when no search query', async () => {
        const children = await provider.getChildren();
        assert.equal(children.length, 2);
    });
});
(0, node_test_1.describe)('AriaTreeProvider.getChildren – under ProjectNode', () => {
    let provider;
    (0, node_test_1.beforeEach)(() => {
        const dataset = makeDataset([
            makeProject(1, 'Alpha', 'a', [
                makeEndpoint(10, 'Get Users', 'a/users'),
                makeEndpoint(11, 'Create User', 'a/users/create'),
            ]),
        ]);
        provider = new tree_provider_1.AriaTreeProvider(() => dataset);
    });
    (0, node_test_1.it)('returns EndpointNodes sorted alphabetically under ProjectNode', async () => {
        const root = await provider.getChildren();
        const projectNode = root[0];
        const children = await provider.getChildren(projectNode);
        assert.equal(children.length, 2);
        assert.ok(children[0] instanceof tree_provider_1.EndpointNode);
        // 'Create User' < 'Get Users'
        assert.ok(children[0].endpoint.NO_REST_CUSTOM.startsWith('Create'));
    });
    (0, node_test_1.it)('returns empty for EndpointNode (leaf)', async () => {
        const root = await provider.getChildren();
        const projectNode = root[0];
        const eps = await provider.getChildren(projectNode);
        const epChildren = await provider.getChildren(eps[0]);
        assert.deepEqual(epChildren, []);
    });
});
(0, node_test_1.describe)('AriaTreeProvider – search filtering', () => {
    let provider;
    let dataset;
    (0, node_test_1.beforeEach)(() => {
        dataset = makeDataset([
            makeProject(1, 'Finance API', 'finance', [
                makeEndpoint(1, 'Get Budget', 'finance/budget'),
                makeEndpoint(2, 'Get Tax', 'finance/tax'),
            ]),
            makeProject(2, 'HR System', 'hr', [
                makeEndpoint(3, 'Get Employees', 'hr/employees'),
            ]),
        ]);
        provider = new tree_provider_1.AriaTreeProvider(() => dataset);
    });
    (0, node_test_1.it)('filters projects by name query', async () => {
        provider.setSearchQuery('Finance');
        const children = await provider.getChildren();
        assert.equal(children.length, 1);
        assert.ok(children[0].project.NO_PROJETO.includes('Finance'));
    });
    (0, node_test_1.it)('includes project when query matches an endpoint', async () => {
        provider.setSearchQuery('employees');
        const children = await provider.getChildren();
        assert.equal(children.length, 1);
        assert.ok(children[0].project.NO_PROJETO.includes('HR'));
    });
    (0, node_test_1.it)('filters endpoints under project by query', async () => {
        provider.setSearchQuery('budget');
        const root = await provider.getChildren();
        const financeNode = root[0];
        const eps = await provider.getChildren(financeNode);
        assert.equal(eps.length, 1);
        assert.ok(eps[0].endpoint.NO_REST_CUSTOM.includes('Budget'));
    });
    (0, node_test_1.it)('clearSearchQuery restores all results', async () => {
        provider.setSearchQuery('finance');
        provider.clearSearchQuery();
        const children = await provider.getChildren();
        assert.equal(children.length, 2);
    });
    (0, node_test_1.it)('clearSearchQuery does nothing when query already empty', () => {
        // Should not throw
        provider.clearSearchQuery();
    });
});
(0, node_test_1.describe)('AriaTreeProvider – refresh', () => {
    (0, node_test_1.it)('fires onDidChangeTreeData event on refresh', () => {
        let fired = false;
        const provider = new tree_provider_1.AriaTreeProvider(() => undefined);
        provider.onDidChangeTreeData(() => { fired = true; return { dispose: () => { } }; });
        provider.refresh();
        assert.equal(fired, true);
    });
    (0, node_test_1.it)('getTreeItem returns the element itself', () => {
        const p = makeProject(1, 'P', 'p');
        const provider = new tree_provider_1.AriaTreeProvider(() => undefined);
        const node = new tree_provider_1.ProjectNode(p);
        assert.equal(provider.getTreeItem(node), node);
    });
});
