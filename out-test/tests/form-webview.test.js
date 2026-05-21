"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const form_webview_1 = require("../vscode/editors/form-webview");
function makeItem(overrides) {
    return {
        ITEM_SEQUENCE: 1,
        REGION_SEQUENCE: 1,
        IS_REQUIRED: 'No',
        DISPLAY_AS: 'Text Field',
        ITEM_NAME: 'NO_REST_CUSTOM',
        REGION: 'Dados Gerais',
        ...overrides,
    };
}
(0, node_test_1.describe)('buildFormHtml', () => {
    (0, node_test_1.it)('removes endpoint metadata helper copy from section headers', () => {
        const html = (0, form_webview_1.buildFormHtml)('Novo Endpoint', { NO_REST_CUSTOM: 'Listar projetos' }, [], {
            endpointItems: [
                makeItem({ ITEM_NAME: 'NO_REST_CUSTOM', LABEL: 'Nome do endpoint' }),
            ],
        });
        assert.ok(html.includes('<h3>Dados Gerais</h3>'));
        assert.ok(!html.includes('Formulario JSON'));
        assert.ok(!html.includes('Agrupamento conforme metadata da tela APEX.'));
    });
    (0, node_test_1.it)('hides empty readonly fields', () => {
        const html = (0, form_webview_1.buildFormHtml)('Novo Endpoint', {
            NO_REST_CUSTOM: 'Listar projetos',
            ID_REST_CUSTOM: '',
            TX_URL: '   ',
        }, [], {
            endpointItems: [
                makeItem({ ITEM_NAME: 'NO_REST_CUSTOM', LABEL: 'Nome do endpoint' }),
                makeItem({ ITEM_NAME: 'ID_REST_CUSTOM', LABEL: 'ID do endpoint', ITEM_SEQUENCE: 2, DISPLAY_AS: 'Display Only' }),
                makeItem({ ITEM_NAME: 'TX_URL', LABEL: 'URL', ITEM_SEQUENCE: 3 }),
            ],
        });
        assert.ok(html.includes('Nome do endpoint'));
        assert.ok(!html.includes('ID do endpoint'));
        assert.ok(!html.includes('<label for="TX_URL">URL</label>'));
    });
});
