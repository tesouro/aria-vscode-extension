"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const utils_1 = require("../core/utils");
(0, node_test_1.describe)('asRecord', () => {
    (0, node_test_1.it)('returns object for plain object', () => assert.deepEqual((0, utils_1.asRecord)({ a: 1 }), { a: 1 }));
    (0, node_test_1.it)('returns undefined for array', () => assert.equal((0, utils_1.asRecord)([1]), undefined));
    (0, node_test_1.it)('returns undefined for null', () => assert.equal((0, utils_1.asRecord)(null), undefined));
});
(0, node_test_1.describe)('asArray', () => {
    (0, node_test_1.it)('returns array for array', () => assert.deepEqual((0, utils_1.asArray)([1, 2]), [1, 2]));
    (0, node_test_1.it)('returns undefined for non-array', () => assert.equal((0, utils_1.asArray)('x'), undefined));
});
(0, node_test_1.describe)('toNumber', () => {
    (0, node_test_1.it)('parses numbers', () => assert.equal((0, utils_1.toNumber)('42'), 42));
    (0, node_test_1.it)('returns 0 for NaN', () => assert.equal((0, utils_1.toNumber)('abc'), 0));
    (0, node_test_1.it)('returns 0 for null', () => assert.equal((0, utils_1.toNumber)(null), 0));
});
(0, node_test_1.describe)('toStringSafe', () => {
    (0, node_test_1.it)('converts values', () => assert.equal((0, utils_1.toStringSafe)(42), '42'));
    (0, node_test_1.it)('empty for null', () => assert.equal((0, utils_1.toStringSafe)(null), ''));
    (0, node_test_1.it)('empty for undefined', () => assert.equal((0, utils_1.toStringSafe)(undefined), ''));
});
(0, node_test_1.describe)('toErrorMessage', () => {
    (0, node_test_1.it)('extracts Error message', () => assert.equal((0, utils_1.toErrorMessage)(new Error('fail')), 'fail'));
    (0, node_test_1.it)('converts non-Error', () => assert.equal((0, utils_1.toErrorMessage)('oops'), 'oops'));
});
(0, node_test_1.describe)('normalizeTextForLookup', () => {
    (0, node_test_1.it)('lowercases and strips accents', () => assert.equal((0, utils_1.normalizeTextForLookup)('Café'), 'cafe'));
});
(0, node_test_1.describe)('parseListTokens', () => {
    (0, node_test_1.it)('splits on comma/newline/semicolon', () => assert.deepEqual((0, utils_1.parseListTokens)('a,b;c\nd'), ['a', 'b', 'c', 'd']));
    (0, node_test_1.it)('trims and filters empty', () => assert.deepEqual((0, utils_1.parseListTokens)(' a , , b '), ['a', 'b']));
});
(0, node_test_1.describe)('extractKeywordTokens', () => {
    (0, node_test_1.it)('extracts 4+ char tokens, excluding stopwords', () => {
        const tokens = (0, utils_1.extractKeywordTokens)('microservico api dados test');
        assert.ok(tokens.includes('MICROSERVICO'));
        assert.ok(tokens.includes('TEST'));
        assert.ok(!tokens.includes('API'));
        assert.ok(!tokens.includes('DADOS'));
    });
});
(0, node_test_1.describe)('decodeJwtClaims', () => {
    (0, node_test_1.it)('decodes a valid JWT payload', () => {
        const payload = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
        const token = `header.${payload}.sig`;
        const claims = (0, utils_1.decodeJwtClaims)(token);
        assert.equal(claims?.sub, '123');
    });
    (0, node_test_1.it)('returns undefined for invalid', () => {
        assert.equal((0, utils_1.decodeJwtClaims)('not-a-jwt'), undefined);
    });
});
(0, node_test_1.describe)('normalizeEndpointPath', () => {
    (0, node_test_1.it)('strips leading slashes', () => assert.equal((0, utils_1.normalizeEndpointPath)('/api/test'), 'api/test'));
    (0, node_test_1.it)('trims whitespace', () => assert.equal((0, utils_1.normalizeEndpointPath)('  path  '), 'path'));
});
(0, node_test_1.describe)('normalizeEndpointFieldKey', () => {
    (0, node_test_1.it)('strips P<n>_ prefix and uppercases', () => assert.equal((0, utils_1.normalizeEndpointFieldKey)('P1_no_rest_custom'), 'NO_REST_CUSTOM'));
});
(0, node_test_1.describe)('buildMetadataKey', () => {
    (0, node_test_1.it)('builds with schema', () => assert.equal((0, utils_1.buildMetadataKey)(5, 10), '5:10'));
    (0, node_test_1.it)('builds without schema', () => assert.equal((0, utils_1.buildMetadataKey)(5), '5:sem-esquema'));
    (0, node_test_1.it)('treats 0 as no schema', () => assert.equal((0, utils_1.buildMetadataKey)(5, 0), '5:sem-esquema'));
});
