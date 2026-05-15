import type { EndpointDraft } from '../../core/types';

let nextDraftId = 1;

function generateDraftId(): string {
  return `draft-${Date.now()}-${nextDraftId++}`;
}

export class DraftStore {
  private readonly drafts = new Map<string, EndpointDraft>();

  create(projectId: number, endpoint: Record<string, unknown>): EndpointDraft {
    const draftId = generateDraftId();
    const now = Date.now();
    const draft: EndpointDraft = {
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

  get(draftId: string): EndpointDraft | undefined {
    return this.drafts.get(draftId);
  }

  markValidated(draftId: string, issues: string[], warnings: string[]): EndpointDraft {
    const draft = this.requireDraft(draftId);
    draft.validationIssues = issues;
    draft.warnings = warnings;
    draft.status = issues.length > 0 ? 'invalid' : 'validated';
    draft.updatedAt = Date.now();
    return draft;
  }

  markImported(draftId: string): EndpointDraft {
    const draft = this.requireDraft(draftId);
    draft.status = 'imported';
    draft.updatedAt = Date.now();
    return draft;
  }

  updateEndpoint(draftId: string, endpoint: Record<string, unknown>): EndpointDraft {
    const draft = this.requireDraft(draftId);
    draft.endpoint = { ...endpoint };
    draft.status = 'created';
    draft.validationIssues = [];
    draft.warnings = [];
    draft.updatedAt = Date.now();
    return draft;
  }

  discard(draftId: string): boolean {
    return this.drafts.delete(draftId);
  }

  list(): EndpointDraft[] {
    return Array.from(this.drafts.values());
  }

  listActive(): EndpointDraft[] {
    return this.list().filter((d) => d.status !== 'imported');
  }

  getLatestForProject(projectId: number): EndpointDraft | undefined {
    let latest: EndpointDraft | undefined;
    for (const draft of this.drafts.values()) {
      if (draft.projectId === projectId && draft.status !== 'imported') {
        if (!latest || draft.updatedAt > latest.updatedAt) {
          latest = draft;
        }
      }
    }
    return latest;
  }

  clear(): void {
    this.drafts.clear();
  }

  private requireDraft(draftId: string): EndpointDraft {
    const draft = this.drafts.get(draftId);
    if (!draft) {
      throw new Error(`Draft nao encontrado: ${draftId}`);
    }
    return draft;
  }
}
