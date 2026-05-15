"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftStore = void 0;
let nextDraftId = 1;
function generateDraftId() {
    return `draft-${Date.now()}-${nextDraftId++}`;
}
class DraftStore {
    drafts = new Map();
    create(projectId, endpoint) {
        const draftId = generateDraftId();
        const now = Date.now();
        const draft = {
            draftId,
            projectId,
            endpoint: { ...endpoint },
            status: 'created',
            validationIssues: [],
            warnings: [],
            createdAt: now,
            updatedAt: now,
        };
        this.drafts.set(draftId, draft);
        return draft;
    }
    get(draftId) {
        return this.drafts.get(draftId);
    }
    markValidated(draftId, issues, warnings) {
        const draft = this.requireDraft(draftId);
        draft.validationIssues = issues;
        draft.warnings = warnings;
        draft.status = issues.length > 0 ? 'invalid' : 'validated';
        draft.updatedAt = Date.now();
        return draft;
    }
    markImported(draftId) {
        const draft = this.requireDraft(draftId);
        draft.status = 'imported';
        draft.updatedAt = Date.now();
        return draft;
    }
    updateEndpoint(draftId, endpoint) {
        const draft = this.requireDraft(draftId);
        draft.endpoint = { ...endpoint };
        draft.status = 'created';
        draft.validationIssues = [];
        draft.warnings = [];
        draft.updatedAt = Date.now();
        return draft;
    }
    discard(draftId) {
        return this.drafts.delete(draftId);
    }
    list() {
        return Array.from(this.drafts.values());
    }
    listActive() {
        return this.list().filter((d) => d.status !== 'imported');
    }
    getLatestForProject(projectId) {
        let latest;
        for (const draft of this.drafts.values()) {
            if (draft.projectId === projectId && draft.status !== 'imported') {
                if (!latest || draft.updatedAt > latest.updatedAt) {
                    latest = draft;
                }
            }
        }
        return latest;
    }
    clear() {
        this.drafts.clear();
    }
    requireDraft(draftId) {
        const draft = this.drafts.get(draftId);
        if (!draft) {
            throw new Error(`Draft nao encontrado: ${draftId}`);
        }
        return draft;
    }
}
exports.DraftStore = DraftStore;
