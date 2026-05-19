"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntraAuthService = void 0;
exports.getEntraSettings = getEntraSettings;
exports.validateSession = validateSession;
const vscode = require("vscode");
const constants_1 = require("../../core/constants");
const utils_1 = require("../../core/utils");
function getEntraSettings() {
    const config = vscode.workspace.getConfiguration('ariaApi');
    return {
        requireLogin: config.get('requireEntraLogin', true),
        allowedEmailDomains: (config.get('allowedEmailDomains', []) || [])
            .map((item) => item.trim())
            .filter((item) => item.length > 0),
    };
}
function validateSession(session, entraSettings) {
    const accountLabel = session.account.label || '';
    const tokenClaims = (0, utils_1.decodeJwtClaims)(session.accessToken);
    const tokenTenant = typeof tokenClaims?.tid === 'string' ? tokenClaims.tid : '';
    if (!tokenTenant || tokenTenant.toLowerCase() !== constants_1.REQUIRED_ENTRA_TENANT_ID.toLowerCase()) {
        return `Conta Microsoft nao autorizada para este tenant. Tenant esperado: ${constants_1.REQUIRED_ENTRA_TENANT_ID}.`;
    }
    if (entraSettings.allowedEmailDomains.length > 0) {
        const email = (typeof tokenClaims?.preferred_username === 'string' && tokenClaims.preferred_username) ||
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
class EntraAuthService {
    session;
    requireLogin = true;
    isLoggedIn = false;
    onLoginStateChangedEmitter = new vscode.EventEmitter();
    onLoginStateChanged = this.onLoginStateChangedEmitter.event;
    getSession() { return this.session; }
    getIsLoggedIn() { return this.isLoggedIn; }
    getRequireLogin() { return this.requireLogin; }
    async updateLoginState(loggedIn) {
        this.isLoggedIn = loggedIn;
        await vscode.commands.executeCommand('setContext', 'ariaApi.isLoggedIn', loggedIn);
        this.onLoginStateChangedEmitter.fire(loggedIn);
    }
    async ensureEntraLogin(createIfNone = true) {
        const entraSettings = getEntraSettings();
        this.requireLogin = entraSettings.requireLogin;
        if (!entraSettings.requireLogin) {
            await this.updateLoginState(true);
            return true;
        }
        try {
            this.session = await vscode.authentication.getSession('microsoft', ['User.Read'], {
                createIfNone: createIfNone,
                forceNewSession: false,
            });
        }
        catch (error) {
            await this.updateLoginState(false);
            vscode.window.showErrorMessage(`Falha ao autenticar com Microsoft Entra ID: ${(0, utils_1.toErrorMessage)(error)}`);
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
    async logout() {
        // Note: VS Code API may not expose a provider-specific logout in older versions.
        // Here we clear the extension session state and update the login context.
        this.session = undefined;
        await this.updateLoginState(false);
        vscode.window.showInformationMessage('Sessao ARIA encerrada localmente. Para remover a conta do VS Code, use a opcao de Contas na barra de status.');
    }
    createAccessTokenProvider() {
        return async (forceRefresh = false) => {
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
            }
            catch {
                await this.updateLoginState(false);
                return undefined;
            }
        };
    }
}
exports.EntraAuthService = EntraAuthService;
