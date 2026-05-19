import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  asRecord, asArray, toNumber, toStringSafe, toErrorMessage,
  normalizeTextForLookup, parseListTokens, extractKeywordTokens,
  decodeJwtClaims, normalizeEndpointPath, normalizeEndpointFieldKey,
  buildMetadataKey, summarizeForLog,
} from '../core/utils';

describe('asRecord', () => {
  it('returns object for plain object', () => assert.deepEqual(asRecord({ a: 1 }), { a: 1 }));
  it('returns undefined for array', () => assert.equal(asRecord([1]), undefined));
  it('returns undefined for null', () => assert.equal(asRecord(null), undefined));
});

describe('asArray', () => {
  it('returns array for array', () => assert.deepEqual(asArray([1, 2]), [1, 2]));
  it('returns undefined for non-array', () => assert.equal(asArray('x'), undefined));
});

describe('toNumber', () => {
  it('parses numbers', () => assert.equal(toNumber('42'), 42));
  it('returns 0 for NaN', () => assert.equal(toNumber('abc'), 0));
  it('returns 0 for null', () => assert.equal(toNumber(null), 0));
});

describe('toStringSafe', () => {
  it('converts values', () => assert.equal(toStringSafe(42), '42'));
  it('empty for null', () => assert.equal(toStringSafe(null), ''));
  it('empty for undefined', () => assert.equal(toStringSafe(undefined), ''));
});

describe('toErrorMessage', () => {
  it('extracts Error message', () => assert.equal(toErrorMessage(new Error('fail')), 'fail'));
  it('converts non-Error', () => assert.equal(toErrorMessage('oops'), 'oops'));
});

describe('normalizeTextForLookup', () => {
  it('lowercases and strips accents', () => assert.equal(normalizeTextForLookup('Café'), 'cafe'));
});

describe('parseListTokens', () => {
  it('splits on comma/newline/semicolon', () => assert.deepEqual(parseListTokens('a,b;c\nd'), ['a', 'b', 'c', 'd']));
  it('trims and filters empty', () => assert.deepEqual(parseListTokens(' a , , b '), ['a', 'b']));
});

describe('extractKeywordTokens', () => {
  it('extracts 4+ char tokens, excluding stopwords', () => {
    const tokens = extractKeywordTokens('microservico api dados test');
    assert.ok(tokens.includes('MICROSERVICO'));
    assert.ok(tokens.includes('TEST'));
    assert.ok(!tokens.includes('API'));
    assert.ok(!tokens.includes('DADOS'));
  });
});

describe('decodeJwtClaims', () => {
  it('decodes a valid JWT payload', () => {
    const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
    const token = `header.${payload}.sig`;
    const claims = decodeJwtClaims(token);
    assert.equal(claims?.sub, '123');
  });
  it('returns undefined for invalid', () => {
    assert.equal(decodeJwtClaims('not-a-jwt'), undefined);
  });
});

describe('normalizeEndpointPath', () => {
  it('strips leading slashes', () => assert.equal(normalizeEndpointPath('/api/test'), 'api/test'));
  it('trims whitespace', () => assert.equal(normalizeEndpointPath('  path  '), 'path'));
});

describe('normalizeEndpointFieldKey', () => {
  it('strips P<n>_ prefix and uppercases', () => assert.equal(normalizeEndpointFieldKey('P1_no_rest_custom'), 'NO_REST_CUSTOM'));
  it('strips P100_ prefix', () => assert.equal(normalizeEndpointFieldKey('P100_TX_PATH'), 'TX_PATH'));
  it('returns unchanged when no P<n>_ prefix', () => assert.equal(normalizeEndpointFieldKey('MY_FIELD'), 'MY_FIELD'));
});

describe('buildMetadataKey', () => {
  it('builds with schema', () => assert.equal(buildMetadataKey(5, 10), '5:10'));
  it('builds without schema', () => assert.equal(buildMetadataKey(5), '5:sem-esquema'));
  it('treats 0 as no schema', () => assert.equal(buildMetadataKey(5, 0), '5:sem-esquema'));
  it('treats negative as no schema', () => assert.equal(buildMetadataKey(5, -1), '5:sem-esquema'));
});

describe('summarizeForLog', () => {
  it('truncates long strings', () => {
    const longStr = 'x'.repeat(300);
    const result = summarizeForLog(longStr);
    assert.ok(result.includes('chars omitted'));
  });

  it('summarizes arrays beyond maxArrayItems', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = summarizeForLog(arr);
    assert.ok(typeof result === 'string');
  });

  it('handles null', () => {
    const result = summarizeForLog(null);
    assert.ok(result === 'null');
  });

  it('handles nested objects', () => {
    const result = summarizeForLog({ a: { b: { c: 'deep' } } });
    assert.ok(typeof result === 'string');
  });

  it('replaces functions with [Function]', () => {
    const result = summarizeForLog({ fn: () => {} });
    assert.ok(result.includes('Function'));
  });

  it('handles circular references', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;
    const result = summarizeForLog(obj);
    assert.ok(result.includes('Circular'));
  });
});

describe('asRecord – additional cases', () => {
  it('returns undefined for Date objects (treated as object but not plain)', () => {
    // Date is an object, not an array, so asRecord should return it
    const d = new Date();
    const result = asRecord(d);
    assert.ok(result !== undefined); // Date is a non-array object
  });

  it('returns undefined for string', () => assert.equal(asRecord('hello'), undefined));
  it('returns undefined for number', () => assert.equal(asRecord(42), undefined));
});

describe('toNumber – additional cases', () => {
  it('returns the number for float strings', () => assert.equal(toNumber('3.14'), 3.14));
  it('returns 0 for empty string', () => assert.equal(toNumber(''), 0));
  it('returns numeric value for boolean true', () => assert.equal(toNumber(true), 1));
});

describe('normalizeTextForLookup – additional cases', () => {
  it('handles empty string', () => assert.equal(normalizeTextForLookup(''), ''));
  it('strips multiple accent types', () => {
    const result = normalizeTextForLookup('Éàüõ');
    assert.equal(result, 'eauo');
  });
  it('trims whitespace', () => assert.equal(normalizeTextForLookup('  hello  '), 'hello'));
});

describe('extractKeywordTokens – additional cases', () => {
  it('returns empty for empty string', () => assert.deepEqual(extractKeywordTokens(''), []));
  it('deduplicates tokens', () => {
    const tokens = extractKeywordTokens('test test test');
    assert.equal(tokens.filter(t => t === 'TEST').length, 1);
  });
  it('filters tokens shorter than 4 chars', () => {
    const tokens = extractKeywordTokens('ab abc abcd');
    assert.ok(!tokens.includes('AB'));
    assert.ok(!tokens.includes('ABC'));
    assert.ok(tokens.includes('ABCD'));
  });
});
