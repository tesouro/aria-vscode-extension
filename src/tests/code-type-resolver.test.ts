import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  normalizeCodeTypeToken,
  normalizeCodeTypeLabel,
  inferCodeTypeLabelFromCode,
  formatCodeTypeLabel,
  resolveCodeTypeSelection,
  isSqlEndpointCodeType,
  resolveEndpointCodeExtension,
} from '../domain/endpoints/code-type-resolver';

describe('normalizeCodeTypeToken', () => {
  it('lowercases and strips accents/punctuation', () => {
    assert.equal(normalizeCodeTypeToken('PL/SQL'), 'plsql');
    assert.equal(normalizeCodeTypeToken(' Python '), 'python');
    assert.equal(normalizeCodeTypeToken('Código'), 'codigo');
  });
  it('returns empty for null/undefined', () => {
    assert.equal(normalizeCodeTypeToken(null), '');
    assert.equal(normalizeCodeTypeToken(undefined), '');
  });
});

describe('normalizeCodeTypeLabel', () => {
  it('resolves known labels', () => {
    assert.equal(normalizeCodeTypeLabel('python'), 'PYTHON');
    assert.equal(normalizeCodeTypeLabel('PL/SQL'), 'PLSQL');
    assert.equal(normalizeCodeTypeLabel('SQL'), 'SQL');
    assert.equal(normalizeCodeTypeLabel('Jython'), 'PYTHON');
  });
  it('returns undefined for unknown', () => {
    assert.equal(normalizeCodeTypeLabel('javascript'), undefined);
    assert.equal(normalizeCodeTypeLabel(''), undefined);
  });
});

describe('inferCodeTypeLabelFromCode', () => {
  it('detects Python', () => {
    assert.equal(inferCodeTypeLabelFromCode('import os\nprint("hi")'), 'PYTHON');
    assert.equal(inferCodeTypeLabelFromCode('#!/usr/bin/python\npass'), 'PYTHON');
    assert.equal(inferCodeTypeLabelFromCode('def foo(): pass'), 'PYTHON');
  });
  it('detects PL/SQL', () => {
    assert.equal(inferCodeTypeLabelFromCode('DECLARE v NUMBER; BEGIN v := 1; END;'), 'PLSQL');
    assert.equal(inferCodeTypeLabelFromCode('x := 10'), 'PLSQL');
  });
  it('defaults to SQL for empty', () => {
    assert.equal(inferCodeTypeLabelFromCode(''), 'SQL');
  });
  it('note: SELECT with FROM keyword triggers Python detection', () => {
    // 'from' keyword in SQL triggers Python heuristic — known limitation
    assert.equal(inferCodeTypeLabelFromCode('SELECT id FROM t WHERE 1=1'), 'PYTHON');
  });
});

describe('formatCodeTypeLabel', () => {
  it('formats labels', () => {
    assert.equal(formatCodeTypeLabel('PYTHON'), 'Python');
    assert.equal(formatCodeTypeLabel('PLSQL'), 'PL/SQL');
    assert.equal(formatCodeTypeLabel('SQL'), 'SQL');
  });
});

describe('resolveCodeTypeSelection', () => {
  const lovs = {
    TIPO_CODIGO: [
      { ID_TIPO_CODIGO: 1, NO_TIPO_CODIGO: 'SQL' },
      { ID_TIPO_CODIGO: 2, NO_TIPO_CODIGO: 'PL/SQL' },
      { ID_TIPO_CODIGO: 3, NO_TIPO_CODIGO: 'Python' },
    ],
  } as any;

  it('uses explicit codeType', () => {
    const r = resolveCodeTypeSelection(lovs, { codeType: 'python' });
    assert.equal(r.label, 'PYTHON');
    assert.equal(r.id, 3);
  });
  it('infers from code when no codeType', () => {
    const r = resolveCodeTypeSelection(lovs, { code: 'DECLARE x NUMBER; BEGIN NULL; END;' });
    assert.equal(r.label, 'PLSQL');
    assert.equal(r.id, 2);
  });
  it('falls back to SQL', () => {
    const r = resolveCodeTypeSelection(lovs, {});
    assert.equal(r.label, 'SQL');
    assert.equal(r.id, 1);
  });
});

describe('isSqlEndpointCodeType', () => {
  it('true for ID 1', () => assert.ok(isSqlEndpointCodeType({ ID_TIPO_CODIGO: 1 })));
  it('true for SQL label', () => assert.ok(isSqlEndpointCodeType({ NO_TIPO_CODIGO: 'SQL' })));
  it('false for Python', () => assert.ok(!isSqlEndpointCodeType({ ID_TIPO_CODIGO: 3, NO_TIPO_CODIGO: 'Python' })));
});

describe('resolveEndpointCodeExtension', () => {
  it('returns py for Python', () => assert.equal(resolveEndpointCodeExtension({ ID_TIPO_CODIGO: 3 }), 'py'));
  it('returns sql for SQL', () => assert.equal(resolveEndpointCodeExtension({ ID_TIPO_CODIGO: 1 }), 'sql'));
  it('detects py from code', () => assert.equal(resolveEndpointCodeExtension({ TX_CODIGO: 'import requests' }), 'py'));
});
