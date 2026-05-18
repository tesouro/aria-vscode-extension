"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const project_form_template_1 = require("../domain/projects/project-form-template");
(0, node_test_1.describe)('buildProjectCreationTemplate', () => {
    (0, node_test_1.it)('keeps the project shape but clears identifiers and arrays', () => {
        const source = {
            ID_PROJETO: 42,
            NO_PROJETO: 'Projeto X',
            TX_PATH: 'x/projeto',
            REST_CUSTOM: [{ ID_REST_CUSTOM: 1 }],
            PROJETO: [{ TX_PATH: 'x/projeto', CO_SISTEMA: 2890 }],
            CO_SISTEMA: 2890,
            SN_PUBLICADO: 'S',
        };
        const template = (0, project_form_template_1.buildProjectCreationTemplate)(source);
        assert.equal(template.ID_PROJETO, 0);
        assert.equal(template.NO_PROJETO, '');
        assert.equal(template.TX_PATH, '');
        assert.deepEqual(template.REST_CUSTOM, []);
        assert.deepEqual(template.PROJETO, []);
        assert.equal(template.CO_SISTEMA, 2890);
        assert.equal(template.SN_PUBLICADO, 'S');
        assert.equal(source.NO_PROJETO, 'Projeto X');
        assert.equal(source.REST_CUSTOM.length, 1);
    });
    (0, node_test_1.it)('returns a minimal template without a source project', () => {
        const template = (0, project_form_template_1.buildProjectCreationTemplate)();
        assert.equal(template.ID_PROJETO, 0);
        assert.equal(template.NO_PROJETO, '');
        assert.equal(template.TX_PATH, '');
        assert.deepEqual(template.REST_CUSTOM, []);
    });
});
