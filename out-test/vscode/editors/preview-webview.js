"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openPreviewWebview = openPreviewWebview;
const vscode = require("vscode");
const utils_1 = require("../../core/utils");
function escHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function serializeForScript(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c');
}
function buildPreviewHtml(title, initialPayload) {
    const serializedPayload = serializeForScript(initialPayload);
    const queryPreview = initialPayload.query.trim().split(/\r?\n/).slice(0, 4).join('\n');
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${escHtml(title)}</title>
<style>
:root{--panel-bg:var(--vscode-editorWidget-background,var(--vscode-editor-background));--panel-border:var(--vscode-panel-border,#444);--muted:var(--vscode-descriptionForeground,var(--vscode-input-placeholderForeground));--accent:var(--vscode-button-background);--accent-strong:var(--vscode-button-hoverBackground)}*{box-sizing:border-box}body{margin:0;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background)}.shell{display:grid;grid-template-rows:auto auto 1fr;gap:16px;height:100vh;padding:16px}.panel{border:1px solid var(--panel-border);border-radius:16px;background:var(--panel-bg);overflow:hidden}.panel-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid var(--panel-border)}.panel-head h1,.panel-head h2{margin:4px 0 0;font-size:1.05em}.panel-head p{margin:0;color:var(--muted);max-width:60ch}.eyebrow{margin:0;text-transform:uppercase;letter-spacing:.12em;font-size:.78em;color:var(--muted)}.query-box{padding:14px 18px;white-space:pre-wrap;font-family:var(--vscode-editor-font-family,monospace);font-size:var(--vscode-editor-font-size,12px);line-height:1.45;color:var(--muted)}.controls{display:grid;gap:14px;padding:16px 18px}.controls-bar{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap}.field{min-width:180px}.field label{display:block;margin-bottom:6px;font-size:.8em;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}input[type="text"],input[type="number"]{width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:10px;padding:9px 11px;font-family:inherit;font-size:inherit}.params-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.spacer{flex:1}.status{min-height:1.3em;font-size:.92em;color:var(--muted)}.status.ok{color:var(--vscode-testing-iconPassed,#73c991)}.status.err{color:var(--vscode-errorForeground,#f48771)}button{padding:9px 16px;background:var(--accent);color:var(--vscode-button-foreground);border:none;border-radius:999px;cursor:pointer;font:inherit;font-weight:700}button:hover{background:var(--accent-strong)}button.secondary{background:transparent;border:1px solid var(--panel-border);color:var(--vscode-foreground)}button.secondary:hover{background:var(--vscode-input-background)}button[disabled]{opacity:.55;cursor:default}.results{display:grid;grid-template-rows:auto 1fr;min-height:0}.results-meta{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 18px;border-bottom:1px solid var(--panel-border);color:var(--muted);font-size:.9em}.table-wrap{overflow:auto;min-height:0}.empty{padding:18px;color:var(--muted)}table{border-collapse:collapse;width:100%;min-width:480px;font-size:.9em}th,td{border:1px solid var(--panel-border);padding:7px 10px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:var(--vscode-input-background);font-size:.8em;text-transform:uppercase;letter-spacing:.05em}tr:nth-child(even) td{background:rgba(128,128,128,.04)}@media(max-width:820px){.shell{height:auto;min-height:100vh}.panel-head,.controls-bar,.actions,.results-meta{flex-direction:column;align-items:stretch}.spacer{display:none}}</style>
</head>
<body>
<div class="shell">
  <section class="panel">
    <div class="panel-head">
      <div>
        <p class="eyebrow">Previa SQL</p>
        <h1>${escHtml(title)}</h1>
      </div>
      <p>Preencha os parametros detectados na query atual e execute a consulta paginada.</p>
    </div>
    <div class="query-box">${escHtml(queryPreview || '(query vazia)')}</div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div>
        <p class="eyebrow">Parametros</p>
        <h2>Execucao</h2>
      </div>
      <p>Os valores sao enviados como arrays paralelos em parametros e valoresParametros.</p>
    </div>
    <div class="controls">
      <div class="controls-bar">
        <div class="field">
          <label for="pageSize">Tamanho da pagina</label>
          <input id="pageSize" type="number" min="1" value="${escHtml(String(initialPayload.tamanhoPagina || 20))}" />
        </div>
        <div class="actions">
          <button type="button" id="runBtn">Executar</button>
          <button type="button" class="secondary" id="prevBtn">Anterior</button>
          <button type="button" class="secondary" id="nextBtn">Proxima</button>
        </div>
        <span class="spacer"></span>
        <span class="status" id="status"></span>
      </div>
      <div id="paramsHost" class="params-grid"></div>
    </div>
  </section>

  <section class="panel results">
    <div class="results-meta">
      <span id="summary">Nenhuma execucao ainda.</span>
      <span class="spacer"></span>
      <span id="pageInfo"></span>
    </div>
    <div class="table-wrap" id="tableWrap"><div class="empty">Execute a query para ver a previa dos dados.</div></div>
  </section>
</div>
<script>
const vscode=acquireVsCodeApi();
const initialPayload=${serializedPayload};
const paramNames=Array.isArray(initialPayload.parametros)?initialPayload.parametros:[];
let currentPage=Number(initialPayload.pagina)||1;
let currentPageCount=1;
const pageSizeInput=document.getElementById('pageSize');
const paramsHost=document.getElementById('paramsHost');
const statusEl=document.getElementById('status');
const summaryEl=document.getElementById('summary');
const pageInfoEl=document.getElementById('pageInfo');
const tableWrap=document.getElementById('tableWrap');
const prevBtn=document.getElementById('prevBtn');
const nextBtn=document.getElementById('nextBtn');

function esc(value){return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function renderParams(){
  if(!paramNames.length){
    paramsHost.innerHTML='<div class="empty">A query atual nao possui parametros nomeados.</div>';
    return;
  }
  paramsHost.innerHTML=paramNames.map(function(name){
    return '<div class="field"><label for="param-'+esc(name)+'">'+esc(name)+'</label><input id="param-'+esc(name)+'" type="text" placeholder=":'+esc(name)+'" /></div>';
  }).join('');
}

function updatePaginationButtons(){
  prevBtn.disabled=currentPage<=1;
  nextBtn.disabled=currentPage>=currentPageCount;
}

function collectPayload(){
  return {
    idBancoExterno: initialPayload.idBancoExterno,
    idBancoEsquema: initialPayload.idBancoEsquema,
    query: initialPayload.query,
    pagina: currentPage,
    tamanhoPagina: Number(pageSizeInput.value)||20,
    parametros: paramNames,
    valoresParametros: paramNames.map(function(name){
      const input=document.getElementById('param-'+name);
      return input&&typeof input.value==='string'?input.value:'';
    })
  };
}

function runPreview(){
  statusEl.textContent='Executando...';
  statusEl.className='status';
  summaryEl.textContent='Consultando dados...';
  pageInfoEl.textContent='';
  updatePaginationButtons();
  vscode.postMessage({ command:'run', payload: collectPayload() });
}

document.getElementById('runBtn').addEventListener('click',function(){currentPage=1;runPreview();});
prevBtn.addEventListener('click',function(){if(currentPage>1){currentPage-=1;runPreview();}});
nextBtn.addEventListener('click',function(){if(currentPage<currentPageCount){currentPage+=1;runPreview();}});

window.addEventListener('message',function(event){
  const message=event.data;
  if(message.type!=='preview-result'){return;}
  if(message.status!=='ok'){
    statusEl.textContent='Erro: '+(message.error||'Falha na previa.');
    statusEl.className='status err';
    summaryEl.textContent='Nenhum dado retornado.';
    tableWrap.innerHTML='<div class="empty">Nao foi possivel executar a previa.</div>';
    currentPageCount=1;
    updatePaginationButtons();
    return;
  }

  const columns=Array.isArray(message.columns)?message.columns:[];
  const rows=Array.isArray(message.registros)?message.registros:[];
  currentPageCount=Math.max(Number(message.pageCount)||1,1);
  updatePaginationButtons();
  statusEl.textContent='Consulta executada.';
  statusEl.className='status ok';
  summaryEl.textContent=rows.length+' registro(s) nesta pagina. Total: '+String(message.count??rows.length)+'.';
  pageInfoEl.textContent='Pagina '+currentPage+' de '+currentPageCount;

  if(!columns.length){
    tableWrap.innerHTML='<div class="empty">A API nao retornou colunas para exibir.</div>';
    return;
  }

  const thead='<thead><tr>'+columns.map(function(column){return '<th>'+esc(column)+'</th>';}).join('')+'</tr></thead>';
  const tbodyRows=rows.map(function(row){
    return '<tr>'+columns.map(function(column){
      const raw=row&&Object.prototype.hasOwnProperty.call(row,column)?row[column]:'';
      return '<td>'+esc(raw==null?'':String(raw))+'</td>';
    }).join('')+'</tr>';
  }).join('');
  const tbody=tbodyRows?'<tbody>'+tbodyRows+'</tbody>':'<tbody><tr><td colspan="'+columns.length+'">Nenhum registro retornado.</td></tr></tbody>';
  tableWrap.innerHTML='<table>'+thead+tbody+'</table>';
});

renderParams();
updatePaginationButtons();
if(!paramNames.length){runPreview();}
</script>
</body>
</html>`;
}
let activePreviewPanel;
function openPreviewWebview(context, title, initialPayload, onPreview) {
    activePreviewPanel?.dispose();
    const panel = vscode.window.createWebviewPanel('ariaSqlPreview', title, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true });
    activePreviewPanel = panel;
    panel.webview.html = buildPreviewHtml(title, initialPayload);
    panel.onDidDispose(() => {
        if (activePreviewPanel === panel) {
            activePreviewPanel = undefined;
        }
    }, undefined, context.subscriptions);
    panel.webview.onDidReceiveMessage(async (message) => {
        if (message.command !== 'run' || !message.payload) {
            return;
        }
        try {
            const result = await onPreview(message.payload);
            void panel.webview.postMessage({ type: 'preview-result', status: result.status ?? 'ok', ...result });
        }
        catch (error) {
            void panel.webview.postMessage({ type: 'preview-result', status: 'erro', error: (0, utils_1.toErrorMessage)(error) });
        }
    }, undefined, context.subscriptions);
}
