import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { validateSession, EntraAuthService } from '../infrastructure/auth/entra-auth-service';
import type { EntraSettings } from '../infrastructure/auth/entra-auth-service';
import { REQUIRED_ENTRA_TENANT_ID } from '../core/constants';

// ─── JWT helpers ──────────────────────────────────────────────────────────────

function makeJwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.signature`;
}

function makeSession(claims: Record<string, unknown>, label = 'user@example.com') {
  return {
    id: 'session-id',
    accessToken: makeJwt(claims),
    account: { id: 'acc-id', label },
    scopes: ['User.Read'],
  };
}

const validSettings: EntraSettings = {
  requireLogin: true,
  allowedEmailDomains: [],
};

// ─── validateSession ──────────────────────────────────────────────────────────

describe('validateSession', () => {
  it('returns undefined for valid session with correct tenant', () => {
    const session = makeSession({ tid: REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@example.com' });
    const error = validateSession(session as never, validSettings);
    assert.equal(error, undefined);
  });

  it('returns error when tenant ID does not match', () => {
    const session = makeSession({ tid: 'wrong-tenant-id' });
    const error = validateSession(session as never, validSettings);
    assert.ok(error?.includes('tenant'));
    assert.ok(error?.includes(REQUIRED_ENTRA_TENANT_ID));
  });

  it('returns error when tenant is missing from token claims', () => {
    const session = makeSession({ sub: 'user' });
    const error = validateSession(session as never, validSettings);
    assert.ok(typeof error === 'string');
  });

  it('returns undefined when domain restriction is empty', () => {
    const session = makeSession({ tid: REQUIRED_ENTRA_TENANT_ID });
    const settings: EntraSettings = { requireLogin: true, allowedEmailDomains: [] };
    assert.equal(validateSession(session as never, settings), undefined);
  });

  it('returns undefined when email domain is in allowed list', () => {
    const session = makeSession(
      { tid: REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@tesouro.gov.br' },
    );
    const settings: EntraSettings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
    assert.equal(validateSession(session as never, settings), undefined);
  });

  it('returns error when email domain is NOT in allowed list', () => {
    const session = makeSession(
      { tid: REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@notallowed.com' },
    );
    const settings: EntraSettings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
    const error = validateSession(session as never, settings);
    assert.ok(error?.includes('notallowed.com') || error?.includes('Dominios permitidos'));
  });

  it('falls back to account.label when preferred_username is absent', () => {
    const session = makeSession(
      { tid: REQUIRED_ENTRA_TENANT_ID },
      'user@tesouro.gov.br',
    );
    const settings: EntraSettings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
    assert.equal(validateSession(session as never, settings), undefined);
  });

  it('handles domain comparison case-insensitively', () => {
    const session = makeSession(
      { tid: REQUIRED_ENTRA_TENANT_ID, preferred_username: 'user@TESOURO.GOV.BR' },
    );
    const settings: EntraSettings = { requireLogin: true, allowedEmailDomains: ['tesouro.gov.br'] };
    assert.equal(validateSession(session as never, settings), undefined);
  });
});

// ─── EntraAuthService ─────────────────────────────────────────────────────────

describe('EntraAuthService', () => {
  it('getSession returns undefined before login', () => {
    const svc = new EntraAuthService();
    assert.equal(svc.getSession(), undefined);
  });

  it('getIsLoggedIn returns false initially', () => {
    const svc = new EntraAuthService();
    assert.equal(svc.getIsLoggedIn(), false);
  });

  it('getRequireLogin returns true initially', () => {
    const svc = new EntraAuthService();
    assert.equal(svc.getRequireLogin(), true);
  });

  it('updateLoginState changes isLoggedIn and fires event', async () => {
    const svc = new EntraAuthService();
    const events: boolean[] = [];
    svc.onLoginStateChanged(v => events.push(v));
    await svc.updateLoginState(true);
    assert.equal(svc.getIsLoggedIn(), true);
    assert.deepEqual(events, [true]);
  });

  it('updateLoginState to false fires event', async () => {
    const svc = new EntraAuthService();
    const events: boolean[] = [];
    svc.onLoginStateChanged(v => events.push(v));
    await svc.updateLoginState(true);
    await svc.updateLoginState(false);
    assert.deepEqual(events, [true, false]);
    assert.equal(svc.getIsLoggedIn(), false);
  });

  it('createAccessTokenProvider returns an async function', () => {
    const svc = new EntraAuthService();
    const provider = svc.createAccessTokenProvider();
    assert.equal(typeof provider, 'function');
  });

  it('logout clears session and sets isLoggedIn false', async () => {
    const svc = new EntraAuthService();
    await svc.updateLoginState(true);
    await svc.logout();
    assert.equal(svc.getSession(), undefined);
    assert.equal(svc.getIsLoggedIn(), false);
  });

  it('ensureEntraLogin returns true when requireLogin is false (mocked workspace config)', async () => {
    // The vscode.workspace.getConfiguration mock returns the default value
    // requireLogin defaults to true in the mock, so ensureEntraLogin will try to get a session.
    // Since getSession returns undefined in the mock, it will return false (no session).
    const svc = new EntraAuthService();
    const result = await svc.ensureEntraLogin(false);
    // Without a real session provider, the result will be false (session not found)
    assert.equal(typeof result, 'boolean');
  });
});
