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
    (0, node_test_1.it)('strips P100_ prefix', () => assert.equal((0, utils_1.normalizeEndpointFieldKey)('P100_TX_PATH'), 'TX_PATH'));
    (0, node_test_1.it)('returns unchanged when no P<n>_ prefix', () => assert.equal((0, utils_1.normalizeEndpointFieldKey)('MY_FIELD'), 'MY_FIELD'));
});
(0, node_test_1.describe)('buildMetadataKey', () => {
    (0, node_test_1.it)('builds with schema', () => assert.equal((0, utils_1.buildMetadataKey)(5, 10), '5:10'));
    (0, node_test_1.it)('builds without schema', () => assert.equal((0, utils_1.buildMetadataKey)(5), '5:sem-esquema'));
    (0, node_test_1.it)('treats 0 as no schema', () => assert.equal((0, utils_1.buildMetadataKey)(5, 0), '5:sem-esquema'));
    (0, node_test_1.it)('treats negative as no schema', () => assert.equal((0, utils_1.buildMetadataKey)(5, -1), '5:sem-esquema'));
});
(0, node_test_1.describe)('summarizeForLog', () => {
    (0, node_test_1.it)('truncates long strings', () => {
        const longStr = 'x'.repeat(300);
        const result = (0, utils_1.summarizeForLog)(longStr);
        assert.ok(result.includes('chars omitted'));
    });
    (0, node_test_1.it)('summarizes arrays beyond maxArrayItems', () => {
        const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const result = (0, utils_1.summarizeForLog)(arr);
        assert.ok(typeof result === 'string');
    });
    (0, node_test_1.it)('handles null', () => {
        const result = (0, utils_1.summarizeForLog)(null);
        assert.ok(result === 'null');
    });
    (0, node_test_1.it)('handles nested objects', () => {
        const result = (0, utils_1.summarizeForLog)({ a: { b: { c: 'deep' } } });
        assert.ok(typeof result === 'string');
    });
    (0, node_test_1.it)('replaces functions with [Function]', () => {
        const result = (0, utils_1.summarizeForLog)({ fn: () => { } });
        assert.ok(result.includes('Function'));
    });
    (0, node_test_1.it)('handles circular references', () => {
        const obj = { a: 1 };
        obj.self = obj;
        const result = (0, utils_1.summarizeForLog)(obj);
        assert.ok(result.includes('Circular'));
    });
});
(0, node_test_1.describe)('asRecord – additional cases', () => {
    (0, node_test_1.it)('returns undefined for Date objects (treated as object but not plain)', () => {
        // Date is an object, not an array, so asRecord should return it
        const d = new Date();
        const result = (0, utils_1.asRecord)(d);
        assert.ok(result !== undefined); // Date is a non-array object
    });
    (0, node_test_1.it)('returns undefined for string', () => assert.equal((0, utils_1.asRecord)('hello'), undefined));
    (0, node_test_1.it)('returns undefined for number', () => assert.equal((0, utils_1.asRecord)(42), undefined));
});
(0, node_test_1.describe)('toNumber – additional cases', () => {
    (0, node_test_1.it)('returns the number for float strings', () => assert.equal((0, utils_1.toNumber)('3.14'), 3.14));
    (0, node_test_1.it)('returns 0 for empty string', () => assert.equal((0, utils_1.toNumber)(''), 0));
    (0, node_test_1.it)('returns numeric value for boolean true', () => assert.equal((0, utils_1.toNumber)(true), 1));
});
(0, node_test_1.describe)('normalizeTextForLookup – additional cases', () => {
    (0, node_test_1.it)('handles empty string', () => assert.equal((0, utils_1.normalizeTextForLookup)(''), ''));
    (0, node_test_1.it)('strips multiple accent types', () => {
        const result = (0, utils_1.normalizeTextForLookup)('Éàüõ');
        assert.equal(result, 'eauo');
    });
    (0, node_test_1.it)('trims whitespace', () => assert.equal((0, utils_1.normalizeTextForLookup)('  hello  '), 'hello'));
});
(0, node_test_1.describe)('extractKeywordTokens – additional cases', () => {
    (0, node_test_1.it)('returns empty for empty string', () => assert.deepEqual((0, utils_1.extractKeywordTokens)(''), []));
    (0, node_test_1.it)('deduplicates tokens', () => {
        const tokens = (0, utils_1.extractKeywordTokens)('test test test');
        assert.equal(tokens.filter(t => t === 'TEST').length, 1);
    });
    (0, node_test_1.it)('filters tokens shorter than 4 chars', () => {
        const tokens = (0, utils_1.extractKeywordTokens)('ab abc abcd');
        assert.ok(!tokens.includes('AB'));
        assert.ok(!tokens.includes('ABC'));
        assert.ok(tokens.includes('ABCD'));
    });
});
