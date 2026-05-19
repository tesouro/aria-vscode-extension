import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  resolveProjectFromInput,
  inferBestProjectForContext,
  buildProjectSchemaLockSummary,
} from '../domain/projects/project-resolver';
import type { AriaProject } from '../core/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeProject(id: number, name: string, path: string, schemas?: string[]): AriaProject {
  return {
    ID_PROJETO: id,
    NO_PROJETO: name,
    TX_PATH: path,
    REST_CUSTOM: schemas
      ? schemas.map((s, i) => ({
          ID_REST_CUSTOM: i + 1,
          NO_REST_CUSTOM: `ep-${i + 1}`,
          TX_PATH: `${path}/ep${i + 1}`,
          NO_ESQUEMA: s,
        }))
      : [],
  };
}

const P1 = makeProject(1, 'Projeto Alpha', 'alpha/v1', ['SCHEMA_A', 'SCHEMA_A']);
const P2 = makeProject(2, 'Projeto Beta', 'beta/v2', ['SCHEMA_B']);
const P3 = makeProject(3, 'Projeto Gamma', 'gamma/v1', []);

// ─── resolveProjectFromInput ─────────────────────────────────────────────────

describe('resolveProjectFromInput', () => {
  it('finds project by exact ID', () => {
    const { project } = resolveProjectFromInput([P1, P2, P3], { projectId: 2 });
    assert.equal(project?.ID_PROJETO, 2);
  });

  it('returns error when ID not found', () => {
    const { error } = resolveProjectFromInput([P1, P2], { projectId: 99 });
    assert.ok(error?.includes('99'));
    assert.ok(error?.includes('1 (Projeto Alpha)'));
  });

  it('finds project by exact name (case-insensitive + accent-insensitive)', () => {
    const { project } = resolveProjectFromInput([P1, P2], { projectName: 'projeto alpha' });
    assert.equal(project?.ID_PROJETO, 1);
  });

  it('returns error on ambiguous exact name', () => {
    const dup = makeProject(4, 'Projeto Alpha', 'alpha/v2');
    const { error } = resolveProjectFromInput([P1, dup], { projectName: 'Projeto Alpha' });
    assert.ok(error?.includes('ambiguo'));
  });

  it('finds project by contains match', () => {
    const { project } = resolveProjectFromInput([P1, P2, P3], { projectName: 'alpha' });
    assert.equal(project?.ID_PROJETO, 1);
  });

  it('returns error on ambiguous contains match', () => {
    const { error } = resolveProjectFromInput([P1, P2, P3], { projectName: 'Projeto' });
    assert.ok(error?.includes('ambiguo'));
  });

  it('returns error when name not found', () => {
    const { error } = resolveProjectFromInput([P1, P2], { projectName: 'Delta' });
    assert.ok(error?.includes('Delta'));
  });

  it('falls back to markerProjectId when no input given', () => {
    const { project } = resolveProjectFromInput([P1, P2, P3], {}, 3);
    assert.equal(project?.ID_PROJETO, 3);
  });

  it('falls back to single project when no other hint', () => {
    const { project } = resolveProjectFromInput([P1], {});
    assert.equal(project?.ID_PROJETO, 1);
  });

  it('returns error when no hint and multiple projects', () => {
    const { error } = resolveProjectFromInput([P1, P2], {});
    assert.ok(error?.includes('projectId'));
  });

  it('returns error when markerProjectId not found', () => {
    // marker not in list, and multiple projects -> falls through to ambiguous
    const { error } = resolveProjectFromInput([P1, P2], {}, 99);
    assert.ok(typeof error === 'string');
  });
});

// ─── inferBestProjectForContext ───────────────────────────────────────────────

describe('inferBestProjectForContext', () => {
  it('returns undefined for empty projects list', () => {
    assert.equal(inferBestProjectForContext([], 'alpha'), undefined);
  });

  it('returns first project for text with no match', () => {
    const result = inferBestProjectForContext([P1, P2], 'xyz xyz xyz');
    assert.equal(result?.ID_PROJETO, 1);
  });

  it('matches by project name in text', () => {
    const result = inferBestProjectForContext([P1, P2], 'preciso do Projeto Alpha');
    assert.equal(result?.ID_PROJETO, 1);
  });

  it('matches by TX_PATH in text', () => {
    const result = inferBestProjectForContext([P1, P2], 'endpoint beta/v2 está falhando');
    assert.equal(result?.ID_PROJETO, 2);
  });

  it('uses token-level scoring', () => {
    const result = inferBestProjectForContext([P1, P2], 'Alpha endpoint issues');
    // Alpha token should score P1 higher
    assert.equal(result?.ID_PROJETO, 1);
  });
});

// ─── buildProjectSchemaLockSummary ────────────────────────────────────────────

describe('buildProjectSchemaLockSummary', () => {
  it('returns empty string for empty projects list', () => {
    assert.equal(buildProjectSchemaLockSummary([], 'any prompt'), '');
  });

  it('returns empty when no project scores above zero', () => {
    const result = buildProjectSchemaLockSummary([P1, P2], 'xyzzy not related text');
    assert.equal(result, '');
  });

  it('returns schema summary when project matches prompt', () => {
    const result = buildProjectSchemaLockSummary([P1, P2], 'Projeto Alpha precisa de schema');
    assert.ok(result.includes('SCHEMA_A'));
    assert.ok(result.includes('Alpha'));
  });

  it('reports no schema when project has no endpoints with schema', () => {
    const result = buildProjectSchemaLockSummary([P3], 'Projeto Gamma');
    assert.ok(result.includes('Gamma'));
    assert.ok(result.includes('nao teve schema'));
  });

  it('collects distinct schemas alphabetically', () => {
    const p = makeProject(5, 'Multi', 'multi', ['SCHEMA_Z', 'SCHEMA_A', 'SCHEMA_A']);
    const result = buildProjectSchemaLockSummary([p], 'Multi schema');
    assert.ok(result.includes('SCHEMA_A'));
    assert.ok(result.includes('SCHEMA_Z'));
    // A appears before Z in the output
    assert.ok(result.indexOf('SCHEMA_A') < result.indexOf('SCHEMA_Z'));
  });
});
