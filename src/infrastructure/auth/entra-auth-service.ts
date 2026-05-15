import * as vscode from 'vscode';
import { REQUIRED_ENTRA_TENANT_ID } from '../../core/constants';
import { decodeJwtClaims, toErrorMessage } from '../../core/utils';
import type { AccessTokenProvider } from '../../core/types';

export interface EntraSettings {
  requireLogin: boolean;
  allowedEmailDomains: string[];
}

export function getEntraSettings(): EntraSettings {
  const config = vscode.workspace.getConfiguration('ariaApi');
  return {
    requireLogin: config.get<boolean>('requireEntraLogin', true),
    allowedEmailDomains: (config.get<string[]>('allowedEmailDomains', []) || [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  };
}

export function validateSession(
  session: vscode.AuthenticationSession,
  entraSettings: EntraSettings
): string | undefined {
  const accountLabel = session.account.label || '';
  const tokenClaims = decodeJwtClaims(session.accessToken);

  const tokenTenant = typeof tokenClaims?.tid === 'string' ? tokenClaims.tid : '';
  if (!tokenTenant || tokenTenant.toLowerCase() !== REQUIRED_ENTRA_TENANT_ID.toLowerCase()) {
    return `Conta Microsoft nao autorizada para este tenant. Tenant esperado: ${REQUIRED_ENTRA_TENANT_ID}.`;
  }

  if (entraSettings.allowedEmailDomains.length > 0) {
    const email =
      (typeof tokenClaims?.preferred_username === 'string' && tokenClaims.preferred_username) ||
      (typeof tokenClaims?.upn === 'string' && tokenClaims.upn) ||
      accountLabel;
    const domain = email.includes('@') ? email.split('@').pop()?.toLowerCase() ?? '' : '';
    const allowed = entraSettings.allowedEmailDomains.map((item) => item.toLowerCase());
    if (!domain || !allowed.includes(domain)) {
      return `Conta Microsoft nao autorizada. Dominios permitidos: ${entraSettings.allowedEmailDomains.join(', ')}.`;
    }
  }

  return undefined;
}

export class EntraAuthService {
  private session: vscode.AuthenticationSession | undefined;
  private requireLogin = true;
  private isLoggedIn = false;
  private readonly onLoginStateChangedEmitter = new vscode.EventEmitter<boolean>();
  readonly onLoginStateChanged = this.onLoginStateChangedEmitter.event;

  getSession(): vscode.AuthenticationSession | undefined { return this.session; }
  getIsLoggedIn(): boolean { return this.isLoggedIn; }
  getRequireLogin(): boolean { return this.requireLogin; }

  async updateLoginState(loggedIn: boolean): Promise<void> {
    this.isLoggedIn = loggedIn;
    await vscode.commands.executeCommand('setContext', 'ariaApi.isLoggedIn', loggedIn);
    this.onLoginStateChangedEmitter.fire(loggedIn);
  }

  async ensureEntraLogin(): Promise<boolean> {
    const entraSettings = getEntraSettings();
    this.requireLogin = entraSettings.requireLogin;
    if (!entraSettings.requireLogin) {
      await this.updateLoginState(true);
      return true;
    }

    try {
      this.session = await vscode.authentication.getSession('microsoft', ['User.Read'], {
        createIfNone: true,
        forceNewSession: false,
      });
    } catch (error) {
      await this.updateLoginState(false);
      vscode.window.showErrorMessage(`Falha ao autenticar com Microsoft Entra ID: ${toErrorMessage(error)}`);
      return false;
    }

    if (!this.session) {
      await this.updateLoginState(false);
      vscode.window.showWarningMessage('Login Microsoft Entra ID e obrigatorio para usar a extensao.');
      return false;
    }

    const validationError = validateSession(this.session, entraSettings);
    if (validationError) {
      await this.updateLoginState(false);
      vscode.window.showErrorMessage(validationError);
      return false;
    }

    await this.updateLoginState(true);
    return true;
  }

  createAccessTokenProvider(): AccessTokenProvider {
    return async (forceRefresh = false): Promise<string | undefined> => {
      const entraSettings = getEntraSettings();
      this.requireLogin = entraSettings.requireLogin;

      if (!entraSettings.requireLogin) {
        await this.updateLoginState(true);
        return undefined;
      }

      try {
        const session = await vscode.authentication.getSession('microsoft', ['User.Read'], {
          createIfNone: forceRefresh,
          forceNewSession: forceRefresh,
        });

        if (!session) {
          await this.updateLoginState(false);
          return undefined;
        }

        const validationError = validateSession(session, entraSettings);
        if (validationError) {
          await this.updateLoginState(false);
          throw new Error(validationError);
        }

        this.session = session;
        await this.updateLoginState(true);
        return session.accessToken;
      } catch {
        await this.updateLoginState(false);
        return undefined;
      }
    };
  }
}
