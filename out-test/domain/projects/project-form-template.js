"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProjectCreationTemplate = buildProjectCreationTemplate;
function cloneProjectRecord(project) {
    return JSON.parse(JSON.stringify(project));
}
function buildProjectCreationTemplate(project) {
    if (!project) {
        return {
            ID_PROJETO: 0,
            NO_PROJETO: '',
            TX_PATH: '',
            REST_CUSTOM: [],
        };
    }
    const template = cloneProjectRecord(project);
    for (const [key, value] of Object.entries(template)) {
        if (Array.isArray(value)) {
            template[key] = [];
        }
    }
    template.ID_PROJETO = 0;
    template.NO_PROJETO = '';
    template.TX_PATH = '';
    template.REST_CUSTOM = [];
    return template;
}
