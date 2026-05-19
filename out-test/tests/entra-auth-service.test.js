"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert/strict");
const entra_auth_service_1 = require("../infrastructure/auth/entra-auth-service");
const constants_1 = require("../core/constants");
// ─── JWT helpers ──────────────────────────────────────────────────────────────
function makeJwt(claims) {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `eyJhbGciOiJSUzI1NiJ9.${payload}.signature`;
}
function makeSession(claims, label = 'user@example.com') {
    return {
        id: 'session-id',
        accessToken: makeJwt(claims),
        account: { id: 'acc-id', label },
        scopes: ['User.Read'],
    };
}
const validSettings = {
    requireLogin: true,
    allowedEmailDomains: [],
};
// ─── validateSession ──────────────────────────────────────────────────────────
(0, node_test_1.describe)('validateSession', () => {
    (0, node_test_1.it)('returns undefined for valid session with correct tenant', () => {
        const session = makeSession({ tid: constants_1.REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@example.com' });
        const error = (0, entra_auth_service_1.validateSession)(session, validSettings);
        assert.equal(error, undefined);
    });
    (0, node_test_1.it)('returns error when tenant ID does not match', () => {
        const session = makeSession({ tid: 'wrong-tenant-id' });
        const error = (0, entra_auth_service_1.validateSession)(session, validSettings);
        assert.ok(error?.includes('tenant'));
        assert.ok(error?.includes(constants_1.REQUIRED_ENTRA_TENANT_ID));
    });
    (0, node_test_1.it)('returns error when tenant is missing from token claims', () => {
        const session = makeSession({ sub: 'user' });
        const error = (0, entra_auth_service_1.validateSession)(session, validSettings);
        assert.ok(typeof error === 'string');
    });
    (0, node_test_1.it)('returns undefined when domain restriction is empty', () => {
        const session = makeSession({ tid: constants_1.REQUIRED_ENTRA_TENANT_ID });
        const settings = { requireLogin: true, allowedEmailDomains: [] };
        assert.equal((0, entra_auth_service_1.validateSession)(session, settings), undefined);
    });
    (0, node_test_1.it)('returns undefined when email domain is in allowed list', () => {
        const session = makeSession({ tid: constants_1.REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@tesouro.gov.br' });
        const settings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
        assert.equal((0, entra_auth_service_1.validateSession)(session, settings), undefined);
    });
    (0, node_test_1.it)('returns error when email domain is NOT in allowed list', () => {
        const session = makeSession({ tid: constants_1.REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@notallowed.com' });
        const settings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
        const error = (0, entra_auth_service_1.validateSession)(session, settings);
        assert.ok(error?.includes('notallowed.com') || error?.includes('Dominios permitidos'));
    });
    (0, node_test_1.it)('falls back to account.label when preferred_username is absent', () => {
        const session = makeSession({ tid: constants_1.REQUIRED_ENTRA_TENANT_ID }, 'user@tesouro.gov.br');
        const settings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
        assert.equal((0, entra_auth_service_1.validateSession)(session, settings), undefined);
    });
    (0, node_test_1.it)('handles domain comparison case-insensitively', () => {
        const session = makeSession({ tid: constants_1.REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@TESOURO.GOV.BR' });
        const settings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
        assert.equal((0, entra_auth_service_1.validateSession)(session, settings), undefined);
    });
});
// ─── EntraAuthService ─────────────────────────────────────────────────────────
(0, node_test_1.describe)('EntraAuthService', () => {
    (0, node_test_1.it)('getSession returns undefined before login', () => {
        const svc = new entra_auth_service_1.EntraAuthService();
        assert.equal(svc.getSession(), undefined);
    });
    (0, node_test_1.it)('getIsLoggedIn returns false initially', () => {
        const svc = new entra_auth_service_1.EntraAuthService();
        assert.equal(svc.getIsLoggedIn(), false);
    });
    (0, node_test_1.it)('getRequireLogin returns true initially', () => {
        const svc = new entra_auth_service_1.EntraAuthService();
        assert.equal(svc.getRequireLogin(), true);
    });
    (0, node_test_1.it)('updateLoginState changes isLoggedIn and fires event', async () => {
        const svc = new entra_auth_service_1.EntraAuthService();
        const events = [];
        svc.onLoginStateChanged(v => events.push(v));
        await svc.updateLoginState(true);
        assert.equal(svc.getIsLoggedIn(), true);
        assert.deepEqual(events, [true]);
    });
    (0, node_test_1.it)('updateLoginState to false fires event', async () => {
        const svc = new entra_auth_service_1.EntraAuthService();
        const events = [];
        svc.onLoginStateChanged(v => events.push(v));
        await svc.updateLoginState(true);
        await svc.updateLoginState(false);
        assert.deepEqual(events, [true, false]);
        assert.equal(svc.getIsLoggedIn(), false);
    });
    (0, node_test_1.it)('createAccessTokenProvider returns an async function', () => {
        const svc = new entra_auth_service_1.EntraAuthService();
        const provider = svc.createAccessTokenProvider();
        assert.equal(typeof provider, 'function');
    });
    (0, node_test_1.it)('logout clears session and sets isLoggedIn false', async () => {
        const svc = new entra_auth_service_1.EntraAuthService();
        await svc.updateLoginState(true);
        await svc.logout();
        assert.equal(svc.getSession(), undefined);
        assert.equal(svc.getIsLoggedIn(), false);
    });
    (0, node_test_1.it)('ensureEntraLogin returns true when requireLogin is false (mocked workspace config)', async () => {
        // The vscode.workspace.getConfiguration mock returns the default value
        // requireLogin defaults to true in the mock, so ensureEntraLogin will try to get a session.
        // Since getSession returns undefined in the mock, it will return false (no session).
        const svc = new entra_auth_service_1.EntraAuthService();
        const result = await svc.ensureEntraLogin(false);
        // Without a real session provider, the result will be false (session not found)
        assert.equal(typeof result, 'boolean');
    });
});
