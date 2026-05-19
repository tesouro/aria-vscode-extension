"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openPreviewParamsWebview = openPreviewParamsWebview;
const vscode = require("vscode");
function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function serializeForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}
function buildParamsHtml(title, initialPayload) {
    const serializedPayload = serializeForScript(initialPayload);
    const paramsMarkup = initialPayload.parametros.length
        ? initialPayload.parametros.map((name) => `<div class="field"><label for="param-${escHtml(name)}">${escHtml(name)}</label><input id="param-${escHtml(name)}" type="text" placeholder=":${escHtml(name)}" /></div>`).join('')
        : '<div class="empty">A query atual nao possui parametros nomeados.</div>';
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${escHtml(title)}</title>
<style>
:root{--panel-border:color-mix(in srgb,var(--vscode-panel-border,#444) 70%, transparent);--muted:var(--vscode-descriptionForeground,var(--vscode-input-placeholderForeground));--button-hover:var(--vscode-button-hoverBackground);--button-bg:var(--vscode-button-background);--button-fg:var(--vscode-button-foreground)}*{box-sizing:border-box}html,body{margin:0;height:100%}body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background)}.shell{display:grid;gap:14px;padding:14px}.header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-bottom:10px;border-bottom:1px solid var(--panel-border)}.header strong{font-size:.95em}.header span{color:var(--muted);font-size:.9em}.toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.field{min-width:140px;flex:1}.field label{display:block;margin-bottom:6px;font-size:.78em;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}input[type="text"],input[type="number"]{width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:8px;padding:8px 10px;font:inherit}.params-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}.status{min-height:1.2em;font-size:.88em;color:var(--muted)}.apply-row{display:flex;align-items:center;justify-content:flex-end;gap:8px}.apply-btn{height:32px;padding:0 14px;background:var(--button-bg);color:var(--button-fg);border:1px solid transparent;border-radius:8px;cursor:pointer;font:inherit;font-weight:600}.apply-btn:hover{background:var(--button-hover)}.empty{padding:10px 0;color:var(--muted)}@media(max-width:820px){.header,.toolbar,.apply-row{align-items:stretch;flex-direction:column}.apply-btn{width:100%}}
</style>
</head>
<body>
<div class="shell">
  <div class="header">
    <strong>${escHtml(title)}</strong>
    <span>A consulta executa automaticamente ao abrir.</span>
  </div>
  <div class="toolbar">
    <div class="field">
      <label for="pageSize">Linhas por pagina</label>
      <input id="pageSize" type="number" min="1" value="${escHtml(String(initialPayload.tamanhoPagina || 20))}" />
    </div>
  </div>
  <div id="paramsHost" class="params-grid">${paramsMarkup}</div>
  <div class="apply-row">
    <span class="status" id="status"></span>
    <button type="button" class="apply-btn" id="runBtn">Aplicar</button>
  </div>
</div>
<script>
const vscode=acquireVsCodeApi();
const initialPayload=${serializedPayload};
const paramNames=Array.isArray(initialPayload.parametros)?initialPayload.parametros:[];
const pageSizeInput=document.getElementById('pageSize');
const statusEl=document.getElementById('status');

function renderValue(name){
  const input=document.getElementById('param-'+name);
  return input&&typeof input.value==='string'?input.value:'';
}

function collectPayload(){
  return {
    idBancoExterno: initialPayload.idBancoExterno,
    idBancoEsquema: initialPayload.idBancoEsquema,
    query: initialPayload.query,
    pagina: 1,
    tamanhoPagina: Number(pageSizeInput.value)||20,
    parametros: paramNames,
    valoresParametros: paramNames.map(renderValue)
  };
}

document.getElementById('runBtn').addEventListener('click',function(){
  statusEl.textContent='Executando...';
  statusEl.className='status';
  vscode.postMessage({command:'execute',payload:collectPayload()});
});

const firstInput=paramNames.length?document.getElementById('param-'+paramNames[0]):pageSizeInput;
if(firstInput&&typeof firstInput.focus==='function'){firstInput.focus();}
</script>
</body>
</html>`;
}
function openPreviewParamsWebview(title, initialPayload, onExecute) {
    const panel = vscode.window.createWebviewPanel('ariaPreviewParams', title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = buildParamsHtml(title, initialPayload);
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command !== 'execute' || !message.payload) {
            return;
        }
        await onExecute(message.payload);
    });
}
