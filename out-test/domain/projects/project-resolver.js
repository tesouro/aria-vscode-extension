"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProjectFromInput = resolveProjectFromInput;
exports.inferBestProjectForContext = inferBestProjectForContext;
exports.buildProjectSchemaLockSummary = buildProjectSchemaLockSummary;
const utils_1 = require("../../core/utils");
function resolveProjectFromInput(projects, input, markerProjectId) {
    if (typeof input.projectId === 'number') {
        const byId = projects.find((p) => p.ID_PROJETO === input.projectId);
        if (!byId) {
            const ids = projects.map((p) => `${p.ID_PROJETO} (${p.NO_PROJETO})`).join(', ');
            return { error: `Projeto ID ${input.projectId} nao encontrado. Projetos carregados: ${ids}` };
        }
        return { project: byId };
    }
    const rawName = input.projectName?.trim();
    if (rawName) {
        const normalizedName = (0, utils_1.normalizeTextForLookup)(rawName);
        const exactMatches = projects.filter((p) => (0, utils_1.normalizeTextForLookup)(p.NO_PROJETO) === normalizedName);
        if (exactMatches.length === 1) {
            return { project: exactMatches[0] };
        }
        if (exactMatches.length > 1) {
            const names = exactMatches.map((p) => `${p.ID_PROJETO} (${p.NO_PROJETO})`).join(', ');
            return { error: `Nome de projeto ambiguo "${rawName}". Matches: ${names}` };
        }
        const containsMatches = projects.filter((p) => (0, utils_1.normalizeTextForLookup)(p.NO_PROJETO).includes(normalizedName));
        if (containsMatches.length === 1) {
            return { project: containsMatches[0] };
        }
        if (containsMatches.length > 1) {
            const names = containsMatches.map((p) => `${p.ID_PROJETO} (${p.NO_PROJETO})`).join(', ');
            return { error: `Nome de projeto ambiguo "${rawName}". Matches: ${names}` };
        }
        return { error: `Projeto "${rawName}" nao encontrado na arvore de projetos.` };
    }
    if (typeof markerProjectId === 'number') {
        const byMarker = projects.find((p) => p.ID_PROJETO === markerProjectId);
        if (byMarker) {
            return { project: byMarker };
        }
    }
    if (projects.length === 1) {
        return { project: projects[0] };
    }
    return { error: 'Informe projectId ou projectName para identificar o projeto alvo.' };
}
function inferBestProjectForContext(projects, text) {
    if (!projects.length) {
        return undefined;
    }
    const normalizedText = (0, utils_1.toStringSafe)(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const tokens = (0, utils_1.extractKeywordTokens)(text).map((item) => item.toLowerCase());
    let bestProject;
    let bestScore = -1;
    for (const project of projects) {
        const projectName = (0, utils_1.toStringSafe)(project.NO_PROJETO).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const projectPath = (0, utils_1.toStringSafe)(project.TX_PATH).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        let score = 0;
        if (projectName && normalizedText.includes(projectName)) {
            score += 100;
        }
        if (projectPath && normalizedText.includes(projectPath)) {
            score += 60;
        }
        const nameTokens = (0, utils_1.extractKeywordTokens)(project.NO_PROJETO).map((item) => item.toLowerCase());
        for (const token of tokens) {
            if (nameTokens.includes(token)) {
                score += 15;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestProject = project;
        }
    }
    return bestProject ?? projects[0];
}
function buildProjectSchemaLockSummary(projects, prompt) {
    if (!Array.isArray(projects) || projects.length === 0) {
        return '';
    }
    const normalizedPrompt = (0, utils_1.toStringSafe)(prompt).toUpperCase();
    const promptTokens = new Set((0, utils_1.extractKeywordTokens)(prompt));
    const scoredProjects = projects.map((project) => {
        const projectName = (0, utils_1.toStringSafe)(project.NO_PROJETO).trim().toUpperCase();
        const projectPath = (0, utils_1.toStringSafe)(project.TX_PATH).trim().toUpperCase();
        const nameTokens = (0, utils_1.extractKeywordTokens)(project.NO_PROJETO);
        const tokenHits = nameTokens.filter((token) => promptTokens.has(token)).length;
        let score = 0;
        if (projectName && normalizedPrompt.includes(projectName)) {
            score += 100;
        }
        if (projectPath && normalizedPrompt.includes(projectPath)) {
            score += 80;
        }
        score += tokenHits * 10;
        return { project, score };
    }).sort((a, b) => b.score !== a.score ? b.score - a.score : (0, utils_1.toStringSafe)(a.project.NO_PROJETO).localeCompare((0, utils_1.toStringSafe)(b.project.NO_PROJETO)));
    const selected = scoredProjects[0];
    if (!selected || selected.score <= 0) {
        return '';
    }
    const schemaSet = new Set();
    for (const endpoint of selected.project.REST_CUSTOM ?? []) {
        const schema = (0, utils_1.toStringSafe)(endpoint.NO_ESQUEMA ?? endpoint.no_esquema ?? endpoint.CO_ESQUEMA ?? endpoint.co_esquema).trim().toUpperCase();
        if (schema) {
            schemaSet.add(schema);
        }
    }
    const schemas = Array.from(schemaSet).sort();
    const projectLabel = (0, utils_1.toStringSafe)(selected.project.NO_PROJETO).trim() || '(sem nome)';
    const projectPath = (0, utils_1.toStringSafe)(selected.project.TX_PATH).trim();
    const projectRef = projectPath ? `${projectLabel} [${projectPath}]` : projectLabel;
    if (schemas.length === 0) {
        return `SCHEMA SUGERIDO: projeto ${projectRef} nao teve schema identificado nos endpoints existentes.`;
    }
    return `SCHEMA SUGERIDO: projeto ${projectRef} usa predominantemente: ${schemas.join(', ')}.`;
}
