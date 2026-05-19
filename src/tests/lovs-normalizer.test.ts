import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizeLovsResponse, buildLovsContextSummary } from '../domain/lovs/lovs-normalizer';
import type { AriaLovs } from '../core/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FULL_LOVS: AriaLovs = {
  METODO: [
    { ID_METODO: 1, NO_METODO: 'GET' },
    { ID_METODO: 2, NO_METODO: 'POST' },
  ],
  TIPO_CODIGO: [
    { ID_TIPO_CODIGO: 1, NO_TIPO_CODIGO: 'SQL' },
    { ID_TIPO_CODIGO: 3, NO_TIPO_CODIGO: 'Python' },
  ],
  TIPO_HEADER: [{ ID_TIPO_HEADER: 1, NO_TIPO_HEADER: 'Automatico' }],
  BANCO_EXTERNO: [
    {
      ID_BANCO_EXTERNO: 10,
      CO_BANCO_EXTERNO: 'DB_PROD',
      BANCO_ESQUEMA: [
        { ID_BANCO_ESQUEMA: 100, NO_ESQUEMA: 'PUBLIC' },
        { ID_BANCO_ESQUEMA: 101, NO_ESQUEMA: 'PRIVATE' },
      ],
    },
  ],
};

// ─── normalizeLovsResponse ────────────────────────────────────────────────────

describe('normalizeLovsResponse', () => {
  it('returns direct LOVs record that has METODO key', () => {
    const result = normalizeLovsResponse(FULL_LOVS);
    assert.ok(Array.isArray(result.METODO));
    assert.equal(result.METODO![0].NO_METODO, 'GET');
  });

  it('unwraps registros envelope — first LOVs-like record wins', () => {
    const wrapped = { registros: [FULL_LOVS, { OTHER: [] }] };
    const result = normalizeLovsResponse(wrapped);
    assert.ok(Array.isArray(result.METODO));
  });

  it('handles registros with non-LOVs first item', () => {
    const wrapped = { registros: [{ unrelated: true }, FULL_LOVS] };
    const result = normalizeLovsResponse(wrapped);
    assert.ok(Array.isArray(result.METODO));
  });

  it('handles array of LOVs objects', () => {
    const result = normalizeLovsResponse([FULL_LOVS]);
    assert.ok(Array.isArray(result.METODO));
  });

  it('returns first item from array when no LOVs-like record found', () => {
    const result = normalizeLovsResponse([{ X: 1 }]);
    assert.equal((result as Record<string, unknown>).X, 1);
  });

  it('returns empty object for null', () => {
    assert.deepEqual(normalizeLovsResponse(null), {});
  });

  it('returns empty object for undefined', () => {
    assert.deepEqual(normalizeLovsResponse(undefined), {});
  });

  it('returns empty object for empty array', () => {
    assert.deepEqual(normalizeLovsResponse([]), {});
  });

  it('returns empty object for empty registros', () => {
    assert.deepEqual(normalizeLovsResponse({ registros: [] }), {});
  });

  it('wraps the root record when it directly has BANCO_EXTERNO', () => {
    const raw = { BANCO_EXTERNO: [{ ID_BANCO_EXTERNO: 1, CO_BANCO_EXTERNO: 'X', BANCO_ESQUEMA: [] }] };
    const result = normalizeLovsResponse(raw);
    assert.ok(Array.isArray(result.BANCO_EXTERNO));
  });
});

// ─── buildLovsContextSummary ──────────────────────────────────────────────────

describe('buildLovsContextSummary', () => {
  it('returns unavailable message for undefined', () => {
    const result = buildLovsContextSummary(undefined);
    assert.ok(result.includes('indispon'));
  });

  it('includes METODO list', () => {
    const result = buildLovsContextSummary(FULL_LOVS);
    assert.ok(result.includes('GET(1)'));
    assert.ok(result.includes('POST(2)'));
  });

  it('includes TIPO_CODIGO list', () => {
    const result = buildLovsContextSummary(FULL_LOVS);
    assert.ok(result.includes('SQL(1)'));
    assert.ok(result.includes('Python(3)'));
  });

  it('includes TIPO_HEADER list', () => {
    const result = buildLovsContextSummary(FULL_LOVS);
    assert.ok(result.includes('Automatico(1)'));
  });

  it('includes BANCO_EXTERNO with schemas', () => {
    const result = buildLovsContextSummary(FULL_LOVS);
    assert.ok(result.includes('DB_PROD'));
    assert.ok(result.includes('PUBLIC(100)'));
    assert.ok(result.includes('PRIVATE(101)'));
  });

  it('shows "vazio" for empty METODO', () => {
    const lovs: AriaLovs = { METODO: [] };
    const result = buildLovsContextSummary(lovs);
    assert.ok(result.includes('METODO: vazio'));
  });

  it('shows "sem bancos" for empty BANCO_EXTERNO', () => {
    const lovs: AriaLovs = { BANCO_EXTERNO: [] };
    const result = buildLovsContextSummary(lovs);
    assert.ok(result.includes('sem bancos'));
  });

  it('shows "Sem esquemas" for banco without schemas', () => {
    const lovs: AriaLovs = {
      BANCO_EXTERNO: [{ ID_BANCO_EXTERNO: 1, CO_BANCO_EXTERNO: 'EMPTY_DB', BANCO_ESQUEMA: [] }],
    };
    const result = buildLovsContextSummary(lovs);
    assert.ok(result.includes('Sem esquemas'));
  });
});
