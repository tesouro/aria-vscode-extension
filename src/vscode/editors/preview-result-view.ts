import * as vscode from 'vscode';
import type { PreviaPayload, PreviaResponse } from '../../core/types';

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

type PreviewResultState = {
  title: string;
  payload?: PreviaPayload;
  result?: PreviaResponse;
  loading: boolean;
  error?: string;
};

function formatCellValue(value: unknown): string {
  if (value == null) { return ''; }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export class SqlPreviewResultViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private state: PreviewResultState = { title: 'ARIA Query Result', loading: false };

  constructor(private readonly onAction: (action: 'refresh' | 'prev' | 'next') => Promise<void>) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.onDidReceiveMessage(async (message: { command?: string }) => {
      if (message.command === 'refresh' || message.command === 'prev' || message.command === 'next') {
        await this.onAction(message.command);
      }
    });
    this.render();
  }

  show(): void {
    this.view?.show(false);
  }

  setSession(title: string, payload: PreviaPayload): void {
    this.state = { title, payload, loading: false };
    this.render();
  }

  setLoading(): void {
    this.state = { ...this.state, loading: true, error: undefined };
    this.render();
  }

  setResult(result: PreviaResponse): void {
    this.state = { ...this.state, loading: false, result, error: undefined };
    this.render();
  }

  setError(message: string): void {
    this.state = { ...this.state, loading: false, error: message };
    this.render();
  }

  private render(): void {
    if (!this.view) { return; }
    this.view.webview.html = this.buildHtml();
  }

  private buildHtml(): string {
    const payload = this.state.payload;
    const result = this.state.result;
    const rows = result?.registros ?? [];
    const columns = result?.columns?.length ? result.columns : Object.keys(rows[0] ?? {});
    const page = Number(payload?.pagina || 1);
    const pageCount = Math.max(Number(result?.pageCount || 1), 1);
    const totalCount = Number(result?.count ?? rows.length);
    const statusLabel = this.state.loading
      ? 'Carregando...'
      : this.state.error
        ? this.state.error
        : result
          ? `${totalCount} registro(s)`
          : 'Sem dados';
    const canPrev = page > 1;
    const canNext = page < pageCount;

    const tableHtml = !result
      ? '<div class="empty">Carregando resultado...</div>'
      : !columns.length
        ? '<div class="empty">A API nao retornou colunas para exibir.</div>'
        : `<table><thead><tr>${columns.map((column) => `<th>${escHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((row) => `<tr>${columns.map((column) => `<td title="${escHtml(formatCellValue(row?.[column]))}">${escHtml(formatCellValue(row?.[column]))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty-row">Nenhum registro retornado.</td></tr>`}</tbody></table>`;

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${escHtml(this.state.title)}</title>
<style>
:root{--panel-border:color-mix(in srgb,var(--vscode-panel-border,#444) 70%, transparent);--muted:var(--vscode-descriptionForeground,var(--vscode-input-placeholderForeground));--button-bg:transparent;--button-hover:var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground));--header-bg:color-mix(in srgb,var(--vscode-editor-background) 92%, white 8%)}*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background)}.shell{display:grid;grid-template-rows:auto 1fr;height:100%;min-height:0}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;border-bottom:1px solid var(--panel-border);min-height:40px}.meta{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:.88em;min-width:0}.meta strong{color:var(--vscode-foreground);font-weight:600}.pager{display:flex;align-items:center;gap:2px;flex-shrink:0}.pager-label{min-width:78px;text-align:center;color:var(--muted);font-variant-numeric:tabular-nums}.icon-btn{height:28px;min-width:28px;padding:0 8px;background:var(--button-bg);color:var(--vscode-foreground);border:1px solid transparent;border-radius:6px;cursor:pointer;font:inherit}.icon-btn:hover{background:var(--button-hover)}.icon-btn[disabled]{opacity:.4;cursor:default}.table-wrap{min-height:0;overflow:auto}.empty{display:flex;align-items:center;justify-content:center;height:100%;padding:24px;color:var(--muted)}table{border-collapse:separate;border-spacing:0;width:100%;min-width:480px;font-size:.91em}th,td{padding:7px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--panel-border);white-space:nowrap}th{position:sticky;top:0;z-index:1;background:var(--header-bg);font-size:.78em;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}td{max-width:360px;overflow:hidden;text-overflow:ellipsis}tr:hover td{background:var(--vscode-list-hoverBackground)}.empty-row{text-align:center;color:var(--muted)}@media(max-width:820px){.toolbar{padding:6px 8px}.meta{font-size:.82em}.pager-label{min-width:66px}}</style>
</head>
<body>
<div class="shell">
  <div class="toolbar">
    <div class="meta"><strong>${escHtml(statusLabel)}</strong>${result ? `<span>Pagina ${escHtml(String(page))} de ${escHtml(String(pageCount))}</span>` : ''}</div>
    <div class="pager">
      <button type="button" class="icon-btn" id="prevBtn" title="Pagina anterior" ${canPrev ? '' : 'disabled'}>&lsaquo;</button>
      <span class="pager-label">${result ? `${escHtml(String(page))}/${escHtml(String(pageCount))}` : '-'}</span>
      <button type="button" class="icon-btn" id="nextBtn" title="Proxima pagina" ${canNext ? '' : 'disabled'}>&rsaquo;</button>
    </div>
  </div>
  <section class="table-wrap">${tableHtml}</section>
</div>
<script>
const vscode=acquireVsCodeApi();
document.getElementById('prevBtn').addEventListener('click',function(){vscode.postMessage({command:'prev'});});
document.getElementById('nextBtn').addEventListener('click',function(){vscode.postMessage({command:'next'});});
</script>
</body>
</html>`;
  }
}