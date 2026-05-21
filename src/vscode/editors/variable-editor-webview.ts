import * as vscode from 'vscode';

function escHtml(str: string): string {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function serializeForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function buildHtml(title: string, variables: Record<string, unknown>[], sourceCode: string): string {
  const serialized = serializeForScript(variables || []);
  const serializedCode = serializeForScript(sourceCode || '');
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>
  *, *::before, *::after { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 16px 20px 32px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.5;
  }

  /* ── Topbar ─────────────────────────────── */
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }
  .topbar-title { font-size: 1.1em; font-weight: 700; }
  .topbar-sub { font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 2px; }
  .topbar-actions { display: flex; gap: 8px; flex-shrink: 0; align-items: center; }

  /* ── Buttons ────────────────────────────── */
  .btn {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 6px 14px;
    font-family: inherit; font-size: inherit; font-weight: 600;
    border: none; border-radius: 999px; cursor: pointer;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    white-space: nowrap;
  }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn-ghost {
    background: transparent;
    border: 1px solid var(--vscode-button-background);
    color: var(--vscode-foreground);
  }
  .btn-ghost:hover { background: var(--vscode-list-hoverBackground); }
  .btn-icon {
    padding: 4px 8px; border-radius: 6px;
    background: transparent;
    border: 1px solid var(--vscode-widget-border, var(--vscode-input-border));
    color: var(--vscode-foreground);
    font-size: 0.95em; cursor: pointer; line-height: 1;
  }
  .btn-icon:hover { background: var(--vscode-list-hoverBackground); }

  /* ── Table wrapper (horizontal scroll) ─── */
  .table-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #444)); }

  table {
    width: 100%; border-collapse: collapse;
    table-layout: fixed;
    min-width: 700px;
  }

  /* column widths */
  col.col-var    { width: 16%; }
  col.col-regex  { width: 20%; }
  col.col-origem { width: 130px; }
  col.col-desc   { width: 18%; }
  col.col-poss   { width: auto; }
  col.col-del    { width: 44px; }

  thead tr {
    background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-tab-activeBackground, var(--vscode-editor-background)));
  }
  th {
    padding: 9px 10px;
    text-align: left;
    font-size: 0.78em; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #444));
    white-space: nowrap;
  }
  th.col-del { text-align: center; }

  tbody tr { border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, #444)); }
  tbody tr:last-child { border-bottom: none; }
  tbody tr:hover { background: var(--vscode-list-hoverBackground); }

  td { padding: 6px 8px; vertical-align: middle; }
  td.col-del { text-align: center; }

  /* ── Inputs ─────────────────────────────── */
  input[type="text"], select {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 6px;
    padding: 6px 8px;
    font-family: inherit; font-size: inherit;
    outline: none;
    min-width: 0;
  }
  input[type="text"]:focus, select:focus {
    border-color: var(--vscode-focusBorder);
    outline: none;
  }
  input::placeholder { color: var(--vscode-input-placeholderForeground); }

  /* ── Empty state ────────────────────────── */
  .empty-state {
    padding: 32px;
    text-align: center;
    color: var(--vscode-descriptionForeground);
    border-radius: 8px;
    border: 1px dashed var(--vscode-widget-border, var(--vscode-panel-border, #444));
    margin-top: 8px;
    font-size: 0.95em;
  }
</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="topbar-title">${escHtml(title)}</div>
      <div class="topbar-sub">Edite as variáveis do endpoint. Salve quando terminar.</div>
    </div>
    <div class="topbar-actions">
      <button id="autoBtn" class="btn btn-ghost">Autoidentificar do código</button>
      <button id="addBtn" class="btn btn-ghost">+ Adicionar</button>
      <button id="saveBtn" class="btn">Salvar via API</button>
    </div>
  </div>

  <div id="tableHost"></div>
  <div id="emptyState" class="empty-state" style="display:none">
    Nenhuma variável cadastrada. Clique em <strong>+ Adicionar</strong> para criar.
  </div>

<script>
const vscode = acquireVsCodeApi();
let vars = ${serialized};
const sourceCode = ${serializedCode};

function safeName(value) {
  return String(value || '').trim();
}

function canonicalName(value) {
  return safeName(value).toUpperCase();
}

function uniqueRows(rows) {
  const seen = new Set();
  const output = [];
  for (const row of rows || []) {
    const name = canonicalName(row.NO_VARIABLE || row.TX_REGEX_QS);
    if (!name || seen.has(name)) { continue; }
    seen.add(name);
    output.push(row);
  }
  return output;
}

function extractVariablesFromCode(code) {
  const result = [];
  const seen = new Set();
  const regexes = [/:([a-zA-Z_][a-zA-Z0-9_]*)/g, /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, /\$([a-zA-Z_][a-zA-Z0-9_]*)/g];
  for (const re of regexes) {
    let match;
    while ((match = re.exec(code || ''))) {
      const name = safeName(match[1]);
      const key = canonicalName(name);
      if (!name || seen.has(key)) { continue; }
      seen.add(key);
      result.push(name);
    }
  }
  return result;
}

function syncPossibleRaw(row) {
  if (row.__possible_raw == null) {
    row.__possible_raw = Array.isArray(row.VARIABLE_VALOR_POSSIVEL)
      ? row.VARIABLE_VALOR_POSSIVEL.map(function(x){ return String((x && x.VA_VARIABLE != null) ? x.VA_VARIABLE : x); }).filter(Boolean).join(', ')
      : '';
  }
}

function pvToString(v) {
  const pv = Array.isArray(v.VARIABLE_VALOR_POSSIVEL)
    ? v.VARIABLE_VALOR_POSSIVEL.map(function(x){ return String((x && x.VA_VARIABLE != null) ? x.VA_VARIABLE : x); }).filter(Boolean)
    : [];
  return pv.join(', ');
}

function render() {
  const host = document.getElementById('tableHost');
  const empty = document.getElementById('emptyState');

  if (!vars || vars.length === 0) {
    host.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  const tbody = document.createElement('tbody');

  vars.forEach(function(v, i) {
    syncPossibleRaw(v);
    const tr = document.createElement('tr');

    function td(content) {
      const cell = document.createElement('td');
      if (typeof content === 'string') { cell.innerHTML = content; }
      else { cell.appendChild(content); }
      return cell;
    }

    function inp(val, placeholder, onInput) {
      const el = document.createElement('input');
      el.type = 'text'; el.value = val || ''; el.placeholder = placeholder;
      el.addEventListener('input', function() { onInput(el.value); });
      return el;
    }

    const nameEl  = inp(v.NO_VARIABLE  || '', ':param',           function(val){ vars[i].NO_VARIABLE  = val; });
    const regexEl = inp(v.TX_REGEX_QS  || '', 'ex: $.campo',      function(val){ vars[i].TX_REGEX_QS  = val; });
    const descEl  = inp(v.TX_DESCRICAO || '', 'Descrição',         function(val){ vars[i].TX_DESCRICAO = val; });
    const possEl  = inp((v.__possible_raw != null ? v.__possible_raw : pvToString(v)), 'val1, val2, ...', function(val){ vars[i].__possible_raw = val; });

    const sel = document.createElement('select');
    sel.innerHTML = '<option value="1">JSONPath</option><option value="2">QueryString</option>';
    sel.value = String(v.IN_ORIGEM_VARIABLE != null ? v.IN_ORIGEM_VARIABLE : 2);
    sel.addEventListener('change', function() { vars[i].IN_ORIGEM_VARIABLE = Number(sel.value); });

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕'; delBtn.className = 'btn-icon';
    delBtn.title = 'Remover';
    delBtn.addEventListener('click', function() { vars.splice(i, 1); render(); });

    const delCell = document.createElement('td');
    delCell.className = 'col-del'; delCell.appendChild(delBtn);

    tr.appendChild(td(nameEl));
    tr.appendChild(td(regexEl));
    tr.appendChild(td(sel));
    tr.appendChild(td(descEl));
    tr.appendChild(td(possEl));
    tr.appendChild(delCell);

    tbody.appendChild(tr);
  });

  const table = document.createElement('table');
  table.innerHTML = \`<colgroup>
    <col class="col-var"><col class="col-regex"><col class="col-origem">
    <col class="col-desc"><col class="col-poss"><col class="col-del">
  </colgroup>
  <thead><tr>
    <th>Variável (no código)</th>
    <th>JSONPath / QueryString</th>
    <th>Origem</th>
    <th>Descrição</th>
    <th>Valores possíveis</th>
    <th class="col-del"></th>
  </tr></thead>\`;
  table.appendChild(tbody);

  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  wrap.appendChild(table);
  host.appendChild(wrap);
}

function autoDetectFromCode() {
  let detected = extractVariablesFromCode(sourceCode);
  // Exclude variables that begin with 'aria_' from automatic detection
  detected = (detected || []).filter(function(name) {
    const n = String(name || '').trim();
    return !/^aria_/i.test(n);
  });
  if (!detected.length) { return; }

  const indexByName = new Map();
  vars.forEach(function(row, idx) {
    const key = canonicalName(row.NO_VARIABLE || row.TX_REGEX_QS);
    if (key && !indexByName.has(key)) { indexByName.set(key, idx); }
  });

  detected.forEach(function(name, detectedIndex) {
    const key = canonicalName(name);
    const existingIndex = indexByName.get(key);
    if (existingIndex != null) {
      vars[existingIndex].NO_VARIABLE = name;
      vars[existingIndex].TX_REGEX_QS = name;
      vars[existingIndex].IN_ORIGEM_VARIABLE = 2;
      syncPossibleRaw(vars[existingIndex]);
      return;
    }
    const row = { ID_VARIABLE: Date.now() + detectedIndex, NO_VARIABLE: name, TX_REGEX_QS: name, IN_ORIGEM_VARIABLE: 2, TX_DESCRICAO: '', VARIABLE_VALOR_POSSIVEL: [], __possible_raw: '' };
    indexByName.set(key, vars.length);
    vars.push(row);
  });

  vars = uniqueRows(vars);
  render();
}

document.getElementById('autoBtn').addEventListener('click', function() {
  autoDetectFromCode();
});
document.getElementById('addBtn').addEventListener('click', function() {
  vars.push({ ID_VARIABLE: Date.now(), NO_VARIABLE: '', TX_REGEX_QS: '', IN_ORIGEM_VARIABLE: 2, TX_DESCRICAO: '', VARIABLE_VALOR_POSSIVEL: [], __possible_raw: '' });
  render();
});

document.getElementById('saveBtn').addEventListener('click', function() {
  const copy = uniqueRows(vars || []).map(function(v) {
    const out = Object.assign({}, v);
    delete out.__possible_raw;
    const raw = (v.__possible_raw != null) ? v.__possible_raw : pvToString(v);
    out.VARIABLE_VALOR_POSSIVEL = raw.split(',').map(function(s){ return s.trim(); }).filter(Boolean)
      .map(function(t){ return { ID_VARIABLE_VALOR_POSSIVEL: 0, VA_VARIABLE: t }; });
    out.NO_VARIABLE = safeName(out.NO_VARIABLE || out.TX_REGEX_QS);
    out.TX_REGEX_QS = safeName(out.TX_REGEX_QS || out.NO_VARIABLE);
    out.IN_ORIGEM_VARIABLE = 2;
    return out;
  });
  vscode.postMessage({ command: 'save', variables: copy });
});

window.addEventListener('message', function(e) {
  const m = e.data;
  if (m && m.command === 'set') { vars = m.variables || []; render(); }
});

render();
</script>
</body>
</html>`;
}

export function openVariableEditorWebview(
  context: vscode.ExtensionContext,
  title: string,
  variables: Record<string, unknown>[] | undefined,
  sourceCode: string,
  onSave: (variables: Record<string, unknown>[]) => Promise<void>
): void {
  const panel = vscode.window.createWebviewPanel('ariaVariableEditor', title, { viewColumn: vscode.ViewColumn.One, preserveFocus: false }, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = buildHtml(title, variables || [], sourceCode);

  panel.webview.onDidReceiveMessage(async (message: { command?: string; variables?: Record<string, unknown>[] }) => {
    if (message.command === 'save' && Array.isArray(message.variables)) {
      try {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Salvando variáveis...' }, async () => { await onSave(message.variables || []); });
        vscode.window.showInformationMessage('Variáveis salvas via API.');
        panel.dispose();
      } catch (e) {
        vscode.window.showErrorMessage(String(e));
      }
    }
  }, undefined, context.subscriptions);
}
