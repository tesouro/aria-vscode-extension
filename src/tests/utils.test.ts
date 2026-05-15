import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  asRecord, asArray, toNumber, toStringSafe, toErrorMessage,
  normalizeTextForLookup, parseListTokens, extractKeywordTokens,
  decodeJwtClaims, normalizeEndpointPath, normalizeEndpointFieldKey,
  buildMetadataKey,
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
});

describe('buildMetadataKey', () => {
  it('builds with schema', () => assert.equal(buildMetadataKey(5, 10), '5:10'));
  it('builds without schema', () => assert.equal(buildMetadataKey(5), '5:sem-esquema'));
  it('treats 0 as no schema', () => assert.equal(buildMetadataKey(5, 0), '5:sem-esquema'));
});
