import * as vscode from 'vscode';
import type { AriaLovs, AriaBancoExterno, EndpointFormItem, ValidateCodeResponse, FormRenderOptions, EndpointFieldMeta, PreviaPayload, PreviaResponse } from '../../core/types';
import { toStringSafe, toNumber, toErrorMessage, normalizeTextForLookup, parseListTokens, normalizeEndpointFieldKey } from '../../core/utils';

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function prettifyLabel(key: string): string {
  const explicitLabels: Record<string, string> = {
    ID_PROJETO: 'ID do Projeto', ID_REST_CUSTOM: 'ID do Endpoint', NO_PROJETO: 'Nome do Projeto',
    NO_REST_CUSTOM: 'Nome do Endpoint', TX_PATH: 'Caminho', DS_REST_CUSTOM_CURTA: 'Descricao curta',
    ID_BANCO_EXTERNO: 'Banco de Dados', ID_BANCO_ESQUEMA: 'Esquema', ID_TIPO_CODIGO: 'Linguagem',
    ID_METODO: 'Metodo', NR_VERSAO: 'Versao', IN_TIPO_TRANSFORMACAO: 'Transformacao dos nomes dos campos',
    IN_FORMATO_SAIDA: 'Formato de Saida', TX_SEPARADOR_CSV: 'Separador CSV', ID_TIPO_HEADER: 'Tipo do Header',
    TX_MIME_TYPE: 'Mime-Type Header', SN_PAGINADO: 'Possui paginacao?', NR_PAGE_SIZE: 'Tamanho da pagina',
    SN_INCLUI_COUNT: 'Incluir count na resposta', SN_NULOS_EXPLICITOS: 'Comportamento dos valores nulos',
    IN_MODO_SEGURANCA: 'Seguranca do Endpoint', TX_PERFIS: 'Perfis', SN_EXIGE_OTP: 'Exige OTP',
    ID_TIPO_OTP: 'Tipos de OTP aceitos', TX_URL: 'URL', SN_APENAS_INTERNO: 'Apenas interno',
    TX_CODIGO_EMBED: 'Codigo Embed', TX_IPS: 'Restringir aos IPs',
    SN_MODO_COMPATIBILIDADE: 'Modo de compatibilidade com Aria 1.0',
    SN_IGNORA_CONFIGS_DEPLOY: 'Ignora configuracoes de deploy', SN_PUBLICADO: 'Publicado na documentacao',
    SN_HABILITA_META_API: 'Habilitado na Meta-API', TX_SECRET_META_API: 'Secret da Meta-API',
    TX_CODIGO: 'Codigo do Endpoint', TX_COMENTARIOS: 'Comentarios',
    SN_SCRIPT_CUSTOM: 'Incluir JS custom no embed', TX_SCRIPT_CUSTOM: 'Script custom',
    SN_IDEMPOTENTE: 'Permite Idempotencia', SN_CACHE: 'Utiliza Cache',
    NR_TEMPO_CACHE: 'Tempo de cache', IN_TEMPO_CACHE: 'Unidade do cache',
    IN_JANELA_TEMPO_CACHE: 'Janela de expiracao', DT_EXP_CACHE: 'Momento de expiracao',
  };
  if (explicitLabels[key]) { return explicitLabels[key]; }
  return key.replace(/^(ID|NO|TX|DS|IN|NR|SN)_/, '').split('_').filter(Boolean).map((p) => p.charAt(0) + p.slice(1).toLowerCase()).join(' ');
}

function isValidateCodeSuccess(status: unknown): boolean {
  const normalized = toStringSafe(status).toLowerCase().trim();
  return normalized === 'sucesso' || normalized === 'ok' || normalized === 'success';
}

function getFieldSection(key: string): string {
  if (['NO_PROJETO','NO_REST_CUSTOM','TX_PATH','DS_REST_CUSTOM_CURTA','ID_BANCO_EXTERNO','ID_BANCO_ESQUEMA','ID_TIPO_CODIGO','ID_METODO','NR_VERSAO'].includes(key)) { return 'basic'; }
  if (['IN_TIPO_TRANSFORMACAO','IN_FORMATO_SAIDA','TX_SEPARADOR_CSV','ID_TIPO_HEADER','TX_MIME_TYPE','SN_PAGINADO','NR_PAGE_SIZE','SN_INCLUI_COUNT','SN_NULOS_EXPLICITOS','TX_CODIGO'].includes(key)) { return 'behavior'; }
  if (['IN_MODO_SEGURANCA','TX_PERFIS','SN_EXIGE_OTP','ID_TIPO_OTP','TX_URL','SN_APENAS_INTERNO','TX_CODIGO_EMBED','TX_IPS','SN_PUBLICADO','SN_HABILITA_META_API','TX_SECRET_META_API','SN_MODO_COMPATIBILIDADE','SN_IGNORA_CONFIGS_DEPLOY'].includes(key)) { return 'security'; }
  if (['SN_IDEMPOTENTE','SN_CACHE','NR_TEMPO_CACHE','IN_TEMPO_CACHE','IN_JANELA_TEMPO_CACHE','DT_EXP_CACHE'].includes(key)) { return 'cache'; }
  if (/^ID_/.test(key)) { return 'metadata'; }
  return 'advanced';
}

function getFieldOptions(key: string): Array<{ value: string; label: string }> | undefined {
  const options: Record<string, Array<{ value: string; label: string }>> = {
    ID_METODO: [{ value: '1', label: 'GET' },{ value: '2', label: 'POST' },{ value: '3', label: 'PUT' },{ value: '4', label: 'DELETE' }],
    ID_TIPO_CODIGO: [{ value: '1', label: 'SQL' },{ value: '2', label: 'PL/SQL' },{ value: '3', label: 'Python' }],
    IN_TIPO_TRANSFORMACAO: [{ value: '', label: 'Sem transformacao' },{ value: '1', label: 'LETRAS MAIUSCULAS' },{ value: '2', label: 'letras minusculas' },{ value: '3', label: 'camelCase' }],
    IN_FORMATO_SAIDA: [{ value: '', label: 'Selecione' },{ value: 'json', label: 'JSON' },{ value: 'csv', label: 'CSV' }],
    ID_TIPO_HEADER: [{ value: '1', label: 'Automatico' },{ value: '2', label: 'Manual' }],
    SN_NULOS_EXPLICITOS: [{ value: 'S', label: 'Aparecem explicitamente no JSON' },{ value: 'N', label: 'Nao aparecem no JSON' }],
    IN_MODO_SEGURANCA: [{ value: '', label: 'Selecione' },{ value: '1', label: 'Publico' },{ value: '2', label: 'Privado (Usuario, Senha e Token)' },{ value: '3', label: 'Privado (Token)' }],
    IN_TEMPO_CACHE: [{ value: '', label: 'Selecione' },{ value: 'S', label: 'Segundos' },{ value: 'M', label: 'Minutos' },{ value: 'H', label: 'Horas' }],
    IN_JANELA_TEMPO_CACHE: [{ value: '', label: 'Selecione' },{ value: 'FS', label: 'Ate o fim do segundo' },{ value: 'FM', label: 'Ate o fim do minuto' },{ value: 'FH', label: 'Ate o fim da hora' },{ value: 'FD', label: 'Ate o fim do dia' }],
  };
  return options[key];
}

function buildLovOptions(key: string, lovs: AriaLovs | undefined): Array<{ value: string; label: string }> | undefined {
  if (!lovs) { return undefined; }
  if (key === 'ID_METODO' && lovs.METODO?.length) { return lovs.METODO.map((e) => ({ value: String(e.ID_METODO), label: e.NO_METODO })); }
  if (key === 'ID_TIPO_CODIGO' && lovs.TIPO_CODIGO?.length) { return lovs.TIPO_CODIGO.map((e) => ({ value: String(e.ID_TIPO_CODIGO), label: e.NO_TIPO_CODIGO })); }
  if (key === 'ID_TIPO_HEADER' && lovs.TIPO_HEADER?.length) { return lovs.TIPO_HEADER.map((e) => ({ value: String(e.ID_TIPO_HEADER), label: e.NO_TIPO_HEADER })); }
  if (key === 'ID_BANCO_EXTERNO' && lovs.BANCO_EXTERNO?.length) { return lovs.BANCO_EXTERNO.map((e) => ({ value: String(e.ID_BANCO_EXTERNO), label: e.CO_BANCO_EXTERNO })); }
  if (key === 'ID_INSTANCIA' && lovs.INSTANCIA?.length) { return lovs.INSTANCIA.map((e) => ({ value: String(e.ID_INSTANCIA), label: e.CO_INSTANCIA })); }
  return undefined;
}

function getSectionMeta(section: string): { title: string; description: string } {
  const sections: Record<string, { title: string; description: string }> = {
    basic: { title: 'Infos basicas', description: 'Campos principais do endpoint ou projeto.' },
    behavior: { title: 'Comportamento e saida', description: 'Formato, paginacao, tratamento de nulos e codigo.' },
    security: { title: 'Seguranca e publicacao', description: 'Acesso, publicacao, compatibilidade.' },
    cache: { title: 'Cache e idempotencia', description: 'Controles operacionais para cache.' },
    advanced: { title: 'Configuracoes avancadas', description: 'Campos menos frequentes.' },
    metadata: { title: 'Metadados tecnicos', description: 'Identificadores do registro.' },
  };
  return sections[section] ?? { title: section, description: '' };
}

function buildEndpointFieldMeta(items: EndpointFormItem[]): Map<string, EndpointFieldMeta> {
  const sorted = items.filter((item) => item.ITEM_NAME?.trim()).slice().sort((a, b) => {
    const rd = (a.REGION_SEQUENCE ?? 0) - (b.REGION_SEQUENCE ?? 0);
    if (rd !== 0) { return rd; }
    const id = (a.ITEM_SEQUENCE ?? 0) - (b.ITEM_SEQUENCE ?? 0);
    if (id !== 0) { return id; }
    return a.ITEM_NAME.localeCompare(b.ITEM_NAME);
  });
  const map = new Map<string, EndpointFieldMeta>();
  for (const item of sorted) {
    const key = normalizeEndpointFieldKey(item.ITEM_NAME);
    if (!key || map.has(key)) { continue; }
    const displayAs = String(item.DISPLAY_AS || '').trim();
    map.set(key, {
      key, label: item.LABEL?.trim() || undefined,
      required: String(item.IS_REQUIRED || '').trim().toLowerCase() === 'yes',
      displayAs, region: item.REGION?.trim() || 'Outros',
      itemSequence: item.ITEM_SEQUENCE ?? 0, regionSequence: item.REGION_SEQUENCE ?? 0,
      hidden: displayAs.toLowerCase() === 'hidden',
      displayOnly: displayAs.toLowerCase() === 'display only',
    });
  }
  return map;
}

export function buildFormHtml(title: string, data: Record<string, unknown>, excludeKeys: string[], options?: FormRenderOptions): string {
  const endpointMeta = options?.endpointItems?.length ? buildEndpointFieldMeta(options.endpointItems) : undefined;
  const scalarEntries = new Map<string, unknown>(
    Object.entries(data).filter(([_, value]) => typeof value !== 'object' || value === null)
  );

  const visibleEntries: Array<[string, unknown]> = endpointMeta
    ? Array.from(endpointMeta.values())
        .filter((m) => !m.hidden && !excludeKeys.includes(m.key))
        .sort((a, b) => { const r = a.regionSequence - b.regionSequence; return r !== 0 ? r : a.itemSequence - b.itemSequence; })
        .map((m) => [m.key, scalarEntries.get(m.key)])
    : Object.entries(data).filter(([key, value]) => !excludeKeys.includes(key) && (typeof value !== 'object' || value === null));

  const summaryItems = visibleEntries
    .filter(([key]) => ['NO_PROJETO','NO_REST_CUSTOM','TX_PATH','ID_PROJETO','ID_REST_CUSTOM'].includes(key))
    .map(([key, value]) => `<div class="summary-chip"><span class="summary-chip-label">${escHtml(prettifyLabel(key))}</span><strong>${escHtml(value == null ? '-' : String(value))}</strong></div>`)
    .join('');

  const sectionOrder: string[] = endpointMeta
    ? (() => { const m = new Map<string, number>(); for (const item of endpointMeta.values()) { if (!item.hidden && !m.has(item.region)) { m.set(item.region, item.regionSequence); } } return Array.from(m.entries()).sort((a, b) => a[1] - b[1]).map(([r]) => r); })()
    : ['basic','behavior','security','cache','advanced','metadata'];

  const sectionFields = new Map<string, string[]>();
  for (const s of sectionOrder) { sectionFields.set(s, []); }

  for (const [key, value] of visibleEntries) {
    const meta = endpointMeta?.get(key.toUpperCase());
    const strVal = value == null ? '' : String(value);
    const label = meta?.label || prettifyLabel(key);
    const fieldOptions = buildLovOptions(key, options?.lovs) ?? getFieldOptions(key);
    const profileOptions = key === 'TX_PERFIS' && options?.lovs?.PERFIL?.length ? options.lovs.PERFIL.map((p) => ({ value: String(p.ID_PERFIL), label: p.NO_PERFIL })) : undefined;
    const selectedProfileIds = (() => {
      if (!profileOptions?.length) { return new Set<string>(); }
      const rawTokens = Array.isArray(value) ? value.map((i) => String(i ?? '').trim()).filter(Boolean) : parseListTokens(strVal);
      if (!rawTokens.length) { return new Set<string>(); }
      const selected = new Set<string>();
      for (const profile of options?.lovs?.PERFIL ?? []) {
        const pId = String(profile.ID_PERFIL); const pName = normalizeTextForLookup(profile.NO_PERFIL);
        if (rawTokens.some((t) => t === pId || normalizeTextForLookup(t) === pName)) { selected.add(pId); }
      }
      return selected;
    })();
    const isBancoEsquema = key === 'ID_BANCO_ESQUEMA' && Boolean(options?.lovs?.BANCO_EXTERNO?.length);
    const hasLovOptions = Boolean(fieldOptions) || isBancoEsquema;
    const isBoolean = meta ? meta.displayAs.toLowerCase().includes('checkbox') || ((strVal === 'S' || strVal === 'N') && /^SN_/.test(key)) : /^SN_/.test(key) && (strVal === 'S' || strVal === 'N');
    const isReadonly = Boolean(meta?.displayOnly) || ((/^ID_/.test(key) || key === 'TX_URL') && !hasLovOptions);
    const isCode = key === 'TX_CODIGO' || key === 'TX_SCRIPT_CUSTOM';
    const isLong = isCode || (meta?.displayAs || '').toLowerCase().includes('textarea') || strVal.length > 120 || /^DS_|^TX_COMENTARIOS|^TX_PERFIS|^TX_IPS|^TX_SECRET_META_API/.test(key);
    const section = meta?.region || getFieldSection(key);
    const requiredAttr = meta?.required && !isReadonly && !isBoolean ? ' required' : '';
    const renderedLabel = meta?.required ? `${label} *` : label;
    const inputType = (meta?.displayAs || '').toLowerCase().includes('number') ? 'number' : 'text';

    let control = '';
    if (isBoolean) {
      const checked = strVal === 'S' ? ' checked' : '';
      control = `<input type="hidden" name="${escHtml(key)}" value="N" /><label class="toggle" for="${escHtml(key)}"><input id="${escHtml(key)}" name="${escHtml(key)}" type="checkbox" value="S"${checked} /><span class="toggle-track" aria-hidden="true"></span><span class="toggle-text">${escHtml(renderedLabel)}</span></label>`;
    } else if (profileOptions) {
      const renderedOpts = profileOptions.map((o) => `<option value="${escHtml(o.value)}"${selectedProfileIds.has(o.value) ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('');
      control = `<label for="${escHtml(key)}">${escHtml(renderedLabel)}</label><input type="hidden" name="${escHtml(key)}" value="" /><select id="${escHtml(key)}" name="${escHtml(key)}" multiple size="6">${renderedOpts}</select>`;
    } else if (key === 'ID_TIPO_OTP' && options?.lovs?.TIPO_OTP?.length) {
      const otpOpts = options.lovs.TIPO_OTP.map((o) => ({ value: String(o.ID_TIPO_OTP), label: o.NO_TIPO_OTP }));
      const rawTokens = Array.isArray(value) ? value.map((i) => String(i ?? '').trim()).filter(Boolean) : parseListTokens(strVal);
      const selectedOtps = new Set<string>();
      for (const otp of options.lovs.TIPO_OTP) {
        if (rawTokens.some((t) => t === String(otp.ID_TIPO_OTP) || normalizeTextForLookup(t) === normalizeTextForLookup(otp.NO_TIPO_OTP))) { selectedOtps.add(String(otp.ID_TIPO_OTP)); }
      }
      const renderedOpts = otpOpts.map((o) => `<option value="${escHtml(o.value)}"${selectedOtps.has(o.value) ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('');
      control = `<label for="${escHtml(key)}">${escHtml(renderedLabel)}</label><input type="hidden" name="${escHtml(key)}" value="" /><select id="${escHtml(key)}" name="${escHtml(key)}" multiple size="6">${renderedOpts}</select>`;
    } else if (fieldOptions) {
      const renderedOpts = fieldOptions.map((o) => `<option value="${escHtml(o.value)}"${o.value === strVal ? ' selected' : ''}>${escHtml(o.label)}</option>`).join('');
      const cascade = key === 'ID_BANCO_EXTERNO' ? ' onchange="ariaUpdateBancoEsquema(this.value)"' : '';
      control = `<label for="${escHtml(key)}">${escHtml(renderedLabel)}</label><select id="${escHtml(key)}" name="${escHtml(key)}"${requiredAttr}${cascade}>${renderedOpts}</select>`;
    } else if (isBancoEsquema) {
      const currentBancoId = String(data['ID_BANCO_EXTERNO'] ?? '');
      const banco = (options?.lovs?.BANCO_EXTERNO ?? []).find((b) => String(b.ID_BANCO_EXTERNO) === currentBancoId);
      const schemas = banco?.BANCO_ESQUEMA ?? [];
      const renderedOpts = ['<option value="">Selecione</option>', ...schemas.map((s) => `<option value="${escHtml(String(s.ID_BANCO_ESQUEMA))}"${String(s.ID_BANCO_ESQUEMA) === strVal ? ' selected' : ''}>${escHtml(s.NO_ESQUEMA)}</option>`)].join('');
      control = `<label for="${escHtml(key)}">${escHtml(renderedLabel)}</label><select id="${escHtml(key)}" name="${escHtml(key)}" data-cascades-from="ID_BANCO_EXTERNO"${requiredAttr}>${renderedOpts}</select>`;
    } else if (isCode) {
      control = `<label for="${escHtml(key)}">${escHtml(renderedLabel)}</label><textarea id="${escHtml(key)}" name="${escHtml(key)}" class="code-area" rows="18"${requiredAttr}>${escHtml(strVal)}</textarea>`;
    } else if (isLong) {
      control = `<label for="${escHtml(key)}">${escHtml(renderedLabel)}</label><textarea id="${escHtml(key)}" name="${escHtml(key)}" rows="5"${isReadonly ? ' readonly' : ''}${requiredAttr}>${escHtml(strVal)}</textarea>`;
    } else {
      control = `<label for="${escHtml(key)}">${escHtml(renderedLabel)}</label><input id="${escHtml(key)}" name="${escHtml(key)}" type="${inputType}" value="${escHtml(strVal)}"${isReadonly ? ' readonly' : ''}${requiredAttr} />`;
    }

    const widthClass = isCode || key === 'TX_URL' || key === 'TX_COMENTARIOS' ? 'field span-2' : 'field';
    sectionFields.get(section)?.push(`<div class="${widthClass}">${control}</div>`);
  }

  const renderedSections = sectionOrder.map((section) => {
    const content = sectionFields.get(section);
    if (!content?.length) { return ''; }
    const sm = endpointMeta ? { title: section, description: 'Agrupamento conforme metadata da tela APEX.' } : getSectionMeta(section);
    return `<section class="panel-card"><div class="panel-head"><div><p class="eyebrow">Formulario JSON</p><h3>${escHtml(sm.title)}</h3></div><p>${escHtml(sm.description)}</p></div><div class="fields-grid">${content.join('\n')}</div></section>`;
  }).join('\n');

  const isSqlEndpoint = data['ID_TIPO_CODIGO'] === 1 || data['ID_TIPO_CODIGO'] === '1';
  const bancoExternoJson = options?.lovs?.BANCO_EXTERNO?.length ? JSON.stringify(options.lovs.BANCO_EXTERNO) : undefined;

  // Cabeçalho e descrição amigáveis
  let friendlyHeader = '';
  let friendlyDesc = '';
  if (/^Novo Projeto/i.test(title)) {
    friendlyHeader = 'Novo Projeto';
    friendlyDesc = 'Preencha as informações do novo projeto abaixo.';
  } else if (/^Novo Endpoint/i.test(title)) {
    friendlyHeader = 'Novo Endpoint';
    friendlyDesc = 'Preencha as informações do novo endpoint abaixo.';
  } else {
    friendlyHeader = escHtml(title);
    friendlyDesc = '';
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>${escHtml(title)}</title>
<style>
:root{--panel-bg:var(--vscode-editorWidget-background,var(--vscode-editor-background));--panel-border:var(--vscode-panel-border,#444);--muted:var(--vscode-descriptionForeground,var(--vscode-input-placeholderForeground));--accent:var(--vscode-button-background);--accent-strong:var(--vscode-button-hoverBackground)}*{box-sizing:border-box}body{margin:0;font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:linear-gradient(180deg,var(--vscode-sideBar-background,var(--vscode-editor-background)) 0%,var(--vscode-editor-background) 100%)}.shell{max-width:1200px;margin:0 auto;padding:24px}.hero{display:grid;gap:16px;padding:22px;border:1px solid var(--panel-border);border-radius:18px;background:linear-gradient(135deg,var(--panel-bg) 0%,var(--vscode-editor-background) 100%);box-shadow:0 18px 36px rgba(0,0,0,.12);margin-bottom:20px}.hero-top{display:flex;justify-content:space-between;gap:16px;align-items:start}.hero h1{margin:6px 0 0;font-size:1.5em;line-height:1.2}.hero p{margin:0;color:var(--muted);max-width:72ch}.eyebrow{margin:0;text-transform:uppercase;letter-spacing:.12em;font-size:.78em;color:var(--muted)}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}.summary-chip{padding:12px 14px;border:1px solid var(--panel-border);border-radius:14px;background:var(--vscode-input-background)}.summary-chip-label{display:block;margin-bottom:4px;color:var(--muted);font-size:.8em;text-transform:uppercase;letter-spacing:.06em}form{display:grid;gap:18px}.panel-card{border:1px solid var(--panel-border);border-radius:18px;background:var(--panel-bg);overflow:hidden}.panel-head{display:flex;justify-content:space-between;gap:18px;padding:18px 20px 14px;border-bottom:1px solid var(--panel-border)}.panel-head h3{margin:6px 0 0;font-size:1.08em}.panel-head p:last-child{margin:0;max-width:48ch;color:var(--muted);font-size:.95em}.fields-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding:20px}.field{min-width:0}.span-2{grid-column:span 2}label{display:block;font-size:.8em;font-weight:700;margin-bottom:6px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}input[type="text"],textarea,select{width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);border-radius:12px;padding:10px 12px;font-family:inherit;font-size:inherit;outline:none}select[multiple]{min-height:140px}input[type="text"]:focus,textarea:focus,select:focus{border-color:var(--vscode-focusBorder)}textarea{resize:vertical;min-height:120px}.code-area{min-height:320px;font-family:var(--vscode-editor-font-family,monospace);font-size:var(--vscode-editor-font-size,13px);line-height:1.5}input[readonly],textarea[readonly]{opacity:.72;cursor:default}.toggle{display:flex;align-items:center;gap:12px;min-height:48px;margin:0;padding:10px 12px;border:1px solid var(--vscode-input-border,transparent);border-radius:12px;background:var(--vscode-input-background);cursor:pointer}.toggle input[type="checkbox"]{position:absolute;opacity:0;pointer-events:none}.toggle-track{position:relative;width:42px;height:24px;border-radius:999px;background:var(--vscode-input-placeholderForeground);opacity:.45;transition:background .16s ease,opacity .16s ease;flex:0 0 auto}.toggle-track::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:white;transition:transform .16s ease}.toggle input:checked+.toggle-track{background:var(--accent);opacity:1}.toggle input:checked+.toggle-track::after{transform:translateX(18px)}.toggle-text{font-size:.98em;font-weight:600;color:var(--vscode-foreground);text-transform:none;letter-spacing:normal}.actions{position:sticky;bottom:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--panel-border);border-radius:16px;background:var(--panel-bg)}.actions-copy{color:var(--muted);font-size:.92em}.actions-main{display:flex;gap:12px;align-items:center}button{padding:10px 18px;background:var(--accent);color:var(--vscode-button-foreground);border:none;border-radius:999px;cursor:pointer;font-size:inherit;font-family:inherit;font-weight:700}button:hover{background:var(--accent-strong)}.status{font-size:.92em;min-height:1.3em}.status.ok{color:var(--vscode-testing-iconPassed,#73c991)}.status.err{color:var(--vscode-errorForeground,#f48771)}.btn-secondary{background:transparent;border:1px solid var(--panel-border);color:var(--vscode-foreground)}.btn-secondary:hover{background:var(--vscode-input-background)}.preview-params{padding:16px 20px 0}.preview-actions{padding:12px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}.preview-table-wrap{overflow-x:auto;padding:0 20px 20px}.preview-table{border-collapse:collapse;width:100%;font-size:.88em;min-width:400px}.preview-table th,.preview-table td{border:1px solid var(--panel-border);padding:6px 10px;text-align:left;white-space:nowrap}.preview-table th{background:var(--vscode-input-background);font-weight:700;font-size:.8em;text-transform:uppercase;letter-spacing:.04em}.preview-table tr:nth-child(even) td{background:rgba(128,128,128,.04)}@media(max-width:900px){.hero-top,.panel-head,.actions{flex-direction:column;align-items:stretch}.fields-grid{grid-template-columns:1fr}.span-2{grid-column:auto}}
</style>
</head>
<body>
<div class="shell">
  <form id="form">
    <section class="hero">
      <div class="hero-top">
        <div><h1>${escHtml(friendlyHeader)}</h1></div>
        <p>${escHtml(friendlyDesc)}</p>
      </div>
      <div class="summary-grid">${summaryItems}</div>
    </section>
    ${renderedSections}
    ${isSqlEndpoint ? `<section class="panel-card" id="preview-section" style="display:none"><div class="panel-head"><div><p class="eyebrow">Previa de Dados</p><h3>Resultado da Query SQL</h3></div><p>Executa a query atual contra o banco configurado e exibe os primeiros registros.</p></div><div class="preview-params" id="preview-params-area" style="display:none"><p style="margin:0 0 8px;font-size:.8em;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Parametros detectados</p><div class="fields-grid" id="preview-params-grid"></div></div><div class="preview-actions"><button type="button" id="previewRunBtn">Executar</button><span id="preview-status" style="font-size:.9em;color:var(--muted)"></span><span style="flex:1"></span><span id="preview-page-info" style="font-size:.88em;color:var(--muted)"></span><button type="button" class="btn-secondary" id="previewPrevBtn" style="display:none">&#9664; Anterior</button><button type="button" class="btn-secondary" id="previewNextBtn" style="display:none">Proxima &#9654;</button></div><div class="preview-table-wrap" id="preview-table-wrap"></div></section>` : ''}
    <div class="actions">
      <div class="actions-copy">Revise as informações abaixo e salve quando terminar.</div>
      <div class="actions-main">
        <span class="status" id="status"></span>
        <button type="button" id="validateBtn">Validar Codigo</button>
        ${isSqlEndpoint ? `<button type="button" class="btn-secondary" id="previewToggleBtn">Previa de Dados</button>` : ''}
        <button type="submit">Salvar via API</button>
      </div>
    </div>
  </form>
</div>
<script>
var vscode=acquireVsCodeApi();var form=document.getElementById('form');var status=document.getElementById('status');
${bancoExternoJson ? `var ariaBancoExternoData=${bancoExternoJson};function ariaUpdateBancoEsquema(bancoId){var sel=document.getElementById('ID_BANCO_ESQUEMA');if(!sel)return;var cur=sel.value;sel.innerHTML='<option value="">Selecione</option>';var b=ariaBancoExternoData.find(function(b){return String(b.ID_BANCO_EXTERNO)===String(bancoId)});if(b&&b.BANCO_ESQUEMA){b.BANCO_ESQUEMA.forEach(function(s){var o=document.createElement('option');o.value=String(s.ID_BANCO_ESQUEMA);o.textContent=s.NO_ESQUEMA;if(String(s.ID_BANCO_ESQUEMA)===cur)o.selected=true;sel.appendChild(o)})}}` : 'function ariaUpdateBancoEsquema(){}'}
function collectFormData(){var d={};new FormData(form).forEach(function(v,k){if(d[k]===undefined){d[k]=v;return}if(Array.isArray(d[k])){d[k].push(v);return}d[k]=[d[k],v]});return d}
form.addEventListener('submit',function(e){e.preventDefault();var d=collectFormData();vscode.postMessage({command:'save',data:d});status.textContent='Salvando...';status.className='status'});
document.getElementById('validateBtn').addEventListener('click',function(){var d=collectFormData();vscode.postMessage({command:'validate',data:d});status.textContent='Validando...';status.className='status'});
var previewPage=1;var previewPageSize=20;var previewParams=[];
${isSqlEndpoint ? `document.getElementById('previewToggleBtn').addEventListener('click',function(){var s=document.getElementById('preview-section');s.style.display=s.style.display==='none'?'':'none';if(s.style.display!=='none'){updatePreviewParams();}});function updatePreviewParams(){var el=document.getElementById('TX_CODIGO');var q=el?el.value:'';var found={};var unique=[];(q.match(/:[a-zA-Z_][a-zA-Z0-9_]*/g)||[]).forEach(function(m){var n=m.slice(1).toUpperCase();if(!found[n]){found[n]=true;unique.push(n);}});previewParams=unique;var grid=document.getElementById('preview-params-grid');var area=document.getElementById('preview-params-area');if(unique.length){area.style.display='';grid.innerHTML=unique.map(function(p){return'<div class="field"><label>'+p+'</label><input type="text" id="preview-param-'+p+'" placeholder=":'+p+'" /></div>';}).join('');}else{area.style.display='none';}}function runPreview(){var el=document.getElementById('TX_CODIGO');var q=el?el.value:'';var fd=collectFormData();var vals=previewParams.map(function(p){var i=document.getElementById('preview-param-'+p);return i?i.value:'';});var ps=document.getElementById('preview-status');if(ps)ps.textContent='Executando...';document.getElementById('preview-table-wrap').innerHTML='';document.getElementById('previewPrevBtn').style.display='none';document.getElementById('previewNextBtn').style.display='none';var pi=document.getElementById('preview-page-info');if(pi)pi.textContent='';vscode.postMessage({command:'preview',data:{idBancoExterno:fd['ID_BANCO_EXTERNO'],idBancoEsquema:fd['ID_BANCO_ESQUEMA'],query:q,pagina:previewPage,tamanhoPagina:previewPageSize,parametros:previewParams,valoresParametros:vals}});}document.getElementById('previewRunBtn').addEventListener('click',function(){previewPage=1;runPreview();});document.getElementById('previewPrevBtn').addEventListener('click',function(){if(previewPage>1){previewPage--;runPreview();}});document.getElementById('previewNextBtn').addEventListener('click',function(){previewPage++;runPreview();});` : ''}
window.addEventListener('message',function(event){var m=event.data;if(m.type==='saving'){status.textContent='Salvando via API...';status.className='status'}else if(m.type==='saved'){status.textContent='Salvo com sucesso!';status.className='status ok'}else if(m.type==='error'){status.textContent='Erro: '+m.message;status.className='status err'}else if(m.type==='validate-result'){if(m.status==='sucesso'){status.textContent='Codigo valido: '+(m.mensagem||'');status.className='status ok'}else{status.textContent='Erro de validacao: '+(m.mensagem||'');status.className='status err'}}else if(m.type==='preview-result'){var ps=document.getElementById('preview-status');var tw=document.getElementById('preview-table-wrap');if(!ps||!tw)return;if(m.status!=='ok'){ps.textContent='Erro: '+(m.error||'Falha na previa');return;}var cols=m.columns||[];var rows=m.registros||[];ps.textContent=rows.length+' registro(s) — Total: '+(m.count||0);var pi=document.getElementById('preview-page-info');if(pi)pi.textContent='Pagina '+previewPage+' de '+(m.pageCount||1);var pb=document.getElementById('previewPrevBtn');var nb=document.getElementById('previewNextBtn');if(pb)pb.style.display=previewPage>1?'':'none';if(nb)nb.style.display=previewPage<(m.pageCount||1)?'':'none';function escH(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}var thead='<thead><tr>'+cols.map(function(c){return'<th>'+escH(c)+'</th>';}).join('')+'</tr></thead>';var tbody='<tbody>'+rows.map(function(row){return'<tr>'+cols.map(function(c){var v=row[c];return'<td>'+(v==null?'':escH(String(v)))+'</td>';}).join('')+'</tr>';}).join('')+'</tbody>';tw.innerHTML='<table class="preview-table">'+thead+tbody+'</table>';}});
</script>
</body>
</html>`;
}

export function openFormWebview(
  context: vscode.ExtensionContext,
  title: string,
  data: Record<string, unknown>,
  excludeKeys: string[],
  renderOptions: FormRenderOptions | undefined,
  onSave: (updated: Record<string, unknown>) => Promise<void>,
  onValidate?: (data: Record<string, unknown>) => Promise<ValidateCodeResponse>,
  onPreview?: (payload: PreviaPayload) => Promise<PreviaResponse>
): void {
  const panel = vscode.window.createWebviewPanel('ariaForm', title, vscode.ViewColumn.One, { enableScripts: true, retainContextWhenHidden: true });
  panel.webview.html = buildFormHtml(title, data, excludeKeys, renderOptions);

  panel.webview.onDidReceiveMessage(
    async (message: { command: string; data: Record<string, unknown> }) => {
      if (message.command === 'save') {
        try {
          message.data.SN_MODO_COMPATIBILIDADE = 'N';
          if (message.data.IN_TIPO_TRANSFORMACAO === '') { message.data.IN_TIPO_TRANSFORMACAO = null; }
          void panel.webview.postMessage({ type: 'saving' });
          const savingIndicator = vscode.window.setStatusBarMessage('$(sync~spin) ARIA: salvando via API...');
          try {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'ARIA: Salvando alteracoes via API...' }, async () => { await onSave(message.data); });
          } finally { savingIndicator.dispose(); }
          void panel.webview.postMessage({ type: 'saved' });
          vscode.window.showInformationMessage('Alteracoes salvas via API (importar-json).');
        } catch (error) {
          void panel.webview.postMessage({ type: 'error', message: toErrorMessage(error) });
          vscode.window.showErrorMessage(`Falha ao salvar: ${toErrorMessage(error)}`);
        }
      } else if (message.command === 'validate' && onValidate) {
        try {
          const result = await onValidate(message.data);
          void panel.webview.postMessage({ type: 'validate-result', status: result.status, mensagem: result.mensagem });
        } catch (error) {
          void panel.webview.postMessage({ type: 'validate-result', status: 'erro', mensagem: toErrorMessage(error) });
        }
      } else if (message.command === 'preview' && onPreview) {
        try {
          if (onValidate) {
            const validation = await onValidate(message.data);
            void panel.webview.postMessage({ type: 'validate-result', status: validation.status, mensagem: validation.mensagem });
            if (!isValidateCodeSuccess(validation.status)) { return; }
          }
          const d = message.data as Record<string, unknown>;
          const result = await onPreview({
            idBancoExterno: d.idBancoExterno,
            idBancoEsquema: d.idBancoEsquema,
            query: String(d.query ?? ''),
            pagina: Number(d.pagina) || 1,
            tamanhoPagina: Number(d.tamanhoPagina) || 20,
            parametros: Array.isArray(d.parametros) ? (d.parametros as string[]) : [],
            valoresParametros: Array.isArray(d.valoresParametros) ? (d.valoresParametros as string[]) : [],
          });
          void panel.webview.postMessage({ type: 'preview-result', ...result });
        } catch (error) {
          void panel.webview.postMessage({ type: 'preview-result', status: 'erro', error: toErrorMessage(error) });
        }
      }
    }, undefined, context.subscriptions
  );
}
