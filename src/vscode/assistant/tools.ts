import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { AriaEndpoint, AriaLovs, AriaProject } from '../../core/types';
import { asRecord, asArray, toStringSafe, toNumber, toErrorMessage, buildMetadataKey, normalizeEndpointFieldKey } from '../../core/utils';
import { listMetadataSchemas, extractMetadataTableNames, parseMetadataMarkdown } from '../../domain/metadata/metadata-parser';
import { normalizeLovsResponse } from '../../domain/lovs/lovs-normalizer';
import { normalizeModelEndpointOutput, buildEndpointFromExampleStructure, extractVariablesFromCode, normalizeVariables, applyLovDisplayValues } from '../../domain/endpoints/endpoint-normalizer';
import { isSqlEndpointCodeType } from '../../domain/endpoints/code-type-resolver';
import { hasSelectStar, extractSqlReferencedTables, analyzeSqlAliasIssues } from '../../domain/sql/sql-policy-validator';
import { validateEndpointPayload } from '../../domain/validation/endpoint-validator';
import type { StateStore } from '../../infrastructure/stores/state-store';
import type { DraftStore } from '../../domain/assistant/draft-store';

function notConnectedResult(): vscode.LanguageModelToolResult {
  return new vscode.LanguageModelToolResult([
    new vscode.LanguageModelTextPart('ARIA: Nao conectado. Peca ao usuario para executar o comando "ARIA: Conectar na API" primeiro.')
  ]);
}

export function registerTools(
  context: vscode.ExtensionContext,
  state: StateStore,
  output: vscode.OutputChannel
): void {

  context.subscriptions.push(

    // ── Get projects ──────────────────────────────────────────────────────
    vscode.lm.registerTool<Record<string, never>>('aria_obter_projetos', {
      async invoke(_options, _token) {
        if (!state.client) { return notConnectedResult(); }
        try {
          const data = await state.client.getProjectEndpointTree();
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(data.registros, null, 2))]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)]);
        }
      }
    }),

    // ── Get LOVs ──────────────────────────────────────────────────────────
    vscode.lm.registerTool<{ id_projeto: number }>('aria_obter_lovs', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        try {
          const lovs = await state.client.getLovs(Number(options.input.id_projeto));
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(lovs, null, 2))]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)]);
        }
      }
    }),

    // ── Get project JSON ──────────────────────────────────────────────────
    vscode.lm.registerTool<{ id_projeto: number }>('aria_obter_json_projeto', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        try {
          const ds = await state.client.getDatasetByProjectId(Number(options.input.id_projeto));
          const stripped = ds.registros.map((proj) => ({
            ...proj,
            REST_CUSTOM: proj.REST_CUSTOM.map((ep) => {
              const { REST_CUSTOM_JSON_SCHEMA: _s, TX_CODIGO: _c, VARIABLE: _v, ...rest } = ep as Record<string, unknown>;
              return rest;
            })
          }));
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(JSON.stringify(stripped, null, 2) +
              '\n\n// NOTA: TX_CODIGO e VARIABLE omitidos para economizar contexto.')
          ]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)]);
        }
      }
    }),

    // ── Get form items ────────────────────────────────────────────────────
    vscode.lm.registerTool<Record<string, never>>('aria_obter_itens_apex', {
      async invoke(_options, _token) {
        if (!state.client) { return notConnectedResult(); }
        try {
          const items = await state.client.getEndpointFormItems();
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify(items, null, 2))]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)]);
        }
      }
    }),

    // ── Get metadata ──────────────────────────────────────────────────────
    vscode.lm.registerTool<{ p_id_banco_externo: number; p_id_banco_esquema?: number }>('aria_obter_metadados', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        const idBancoExterno = Number(options.input.p_id_banco_externo);
        const idBancoEsquema = Number(options.input.p_id_banco_esquema);
        if (!(idBancoExterno > 0)) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Parametro invalido: p_id_banco_externo deve ser > 0.')]);
        }
        const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
        const pseudoEndpoint: AriaEndpoint = { ID_REST_CUSTOM: 0, NO_REST_CUSTOM: '', TX_PATH: '', ID_BANCO_EXTERNO: idBancoExterno };
        if (idBancoEsquema > 0) { pseudoEndpoint.ID_BANCO_ESQUEMA = idBancoEsquema; }
        try {
          const metadata = await state.client!.getEndpointMetadata(pseudoEndpoint);
          if (!metadata) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Nenhum metadado disponivel.')]);
          }
          const metadataDir = path.join(__dirname, '..', '..', 'resources');
          const fileName = idBancoEsquema > 0 ? `metadata-${idBancoExterno}-${idBancoEsquema}.aria.txt` : `metadata-${idBancoExterno}.aria.txt`;
          const filePath = path.join(metadataDir, fileName);
          await fs.promises.mkdir(metadataDir, { recursive: true });
          await fs.promises.writeFile(filePath, metadata, 'utf8');
          state.metadataUriByEndpoint.set(metadataKey, vscode.Uri.file(filePath));
          state.metadataCatalogByEndpoint.set(metadataKey, parseMetadataMarkdown(metadata, filePath, metadataKey));
          const schemas = listMetadataSchemas(metadata);
          const tables = extractMetadataTableNames(metadata);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Metadados salvos em: ${filePath}\n\nSchemas:\n${schemas.map((s) => `- ${s}`).join('\n') || '(nenhum)'}\n\nTabelas:\n${tables.sort().join('\n') || '(nenhuma)'}\n\nProximo passo: chame aria_obter_colunas_metadados para cada tabela.`
            )
          ]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)]);
        }
      }
    }),

    // ── Get metadata schemas ──────────────────────────────────────────────
    vscode.lm.registerTool<{ p_id_banco_externo: number; p_id_banco_esquema?: number }>('aria_obter_esquemas_metadados', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        const idBancoExterno = Number(options.input.p_id_banco_externo);
        const idBancoEsquema = Number(options.input.p_id_banco_esquema);
        if (!(idBancoExterno > 0)) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Parametro invalido.')]); }
        const catalog = await state.getMetadataCatalog(idBancoExterno, idBancoEsquema);
        if (!catalog) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Execute aria_obter_metadados primeiro.')]); }
        const schemas = catalog.schemas.map((s) => ({ schema: s.name, tableCount: s.tables.length, tables: s.tables.map((t) => t.fullName) }));
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify({ metadataKey: catalog.key, schemas }, null, 2))]);
      }
    }),

    // ── Get metadata tables ───────────────────────────────────────────────
    vscode.lm.registerTool<{ p_id_banco_externo: number; p_id_banco_esquema?: number; schema?: string }>('aria_obter_tabelas_metadados', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        const idBancoExterno = Number(options.input.p_id_banco_externo);
        const idBancoEsquema = Number(options.input.p_id_banco_esquema);
        const schemaFilter = toStringSafe(options.input.schema).trim().toUpperCase();
        if (!(idBancoExterno > 0)) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Parametro invalido.')]); }
        const catalog = await state.getMetadataCatalog(idBancoExterno, idBancoEsquema);
        if (!catalog) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Execute aria_obter_metadados primeiro.')]); }
        const tables = catalog.schemas.flatMap((s) => {
          if (schemaFilter && s.name.toUpperCase() !== schemaFilter) { return []; }
          return s.tables.map((t) => ({ schema: s.name, table: t.fullName, comment: t.comment ?? '', columnCount: t.columns.length, foreignKeyCount: t.foreignKeys.length }));
        });
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify({ metadataKey: catalog.key, schema: schemaFilter || null, tables }, null, 2))]);
      }
    }),

    // ── Get metadata columns ──────────────────────────────────────────────
    vscode.lm.registerTool<{ p_id_banco_externo: number; p_id_banco_esquema?: number; schema?: string; tabela: string }>('aria_obter_colunas_metadados', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        const idBancoExterno = Number(options.input.p_id_banco_externo);
        const idBancoEsquema = Number(options.input.p_id_banco_esquema);
        const schemaFilter = toStringSafe(options.input.schema).trim().toUpperCase();
        const tableFilter = toStringSafe(options.input.tabela).trim().toUpperCase();
        if (!(idBancoExterno > 0) || !tableFilter) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Parametro invalido.')]); }
        const catalog = await state.getMetadataCatalog(idBancoExterno, idBancoEsquema);
        if (!catalog) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Execute aria_obter_metadados primeiro.')]); }
        const candidates = catalog.schemas.flatMap((s) => {
          if (schemaFilter && s.name.toUpperCase() !== schemaFilter) { return []; }
          return s.tables.filter((t) => t.fullName.toUpperCase() === tableFilter || t.name.toUpperCase() === tableFilter)
            .map((t) => ({ schema: s.name, table: t.fullName, comment: t.comment ?? '', columns: t.columns, foreignKeys: t.foreignKeys }));
        });
        if (!candidates.length) { return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Tabela nao encontrada: ${tableFilter}`)]); }
        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(JSON.stringify({ metadataKey: catalog.key, tables: candidates }, null, 2))]);
      }
    }),

    // ── Create endpoint draft ─────────────────────────────────────────────
    vscode.lm.registerTool<{ id_projeto: number; endpoint: unknown }>('aria_create_endpoint_draft', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        const rawInput = options.input as Record<string, unknown>;
        let idProjeto = toNumber(rawInput.id_projeto);
        if (!(idProjeto > 0)) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Parametro invalido: id_projeto deve ser > 0.')]);
        }

        let endpoint = asRecord(rawInput.endpoint);
        // If endpoint not provided, allow passing an endpoint id to edit existing endpoint
        if (!endpoint) {
          const endpointId = toNumber(rawInput.id_endpoint ?? rawInput.ID_REST_CUSTOM ?? rawInput.id);
          if (endpointId > 0) {
            try {
              // Try to load project details and find the endpoint
              const project = await state.getProjectDetails(idProjeto);
              const found = (project.REST_CUSTOM || []).find((e) => toNumber((e as any).ID_REST_CUSTOM) === endpointId);
              if (found) { endpoint = found as Record<string, unknown>; }
            } catch {
              // ignore and fallthrough to error below
            }
          }
        }
        if (!endpoint && rawInput.NO_REST_CUSTOM) {
          const { id_projeto: _id, ...rest } = rawInput;
          endpoint = rest;
        }
        if (!endpoint) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              'Parametro invalido: endpoint nao encontrado no input. Forneca o objeto endpoint ou informe id_projeto e id_endpoint.'
            )
          ]);
        }

        // Unwrap REST_CUSTOM envelope
        const rc = asArray(endpoint.REST_CUSTOM);
        if (rc?.length && !endpoint.NO_REST_CUSTOM && !endpoint.TX_PATH) {
          const first = asRecord(rc[0]);
          if (first) { endpoint = first; }
        }

        // Normalize
        let normalized: Record<string, unknown>;
        try {
          normalized = normalizeModelEndpointOutput(endpoint);
        } catch (err) {
          output.appendLine(`[${new Date().toISOString()}] aria_create_endpoint_draft normalize error: ${toErrorMessage(err)}`);
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro ao normalizar endpoint: ${toErrorMessage(err)}`)]);
        }
        normalized.ID_PROJETO = idProjeto;

        // Enrich with LOVs
        try {
          const lovs = await state.getProjectLovs(idProjeto);
          if (lovs) {
            const enriched = applyLovDisplayValues(normalized, lovs);
            for (const [k, v] of Object.entries(enriched)) { normalized[k] = v; }
          }
        } catch { /* ignore */ }

        // Extract variables if missing
        const vars = asArray(normalized.VARIABLE) ?? [];
        if (!vars.length && typeof normalized.TX_CODIGO === 'string') {
          const extracted = extractVariablesFromCode(normalized.TX_CODIGO);
          if (extracted.length) { normalized.VARIABLE = extracted; }
        } else if (vars.length) {
          const nv = normalizeVariables(vars, (m) => output.appendLine(`[normalizeVariables] ${m}`));
          normalized.VARIABLE = nv.normalized;
          if (nv.errors?.length) { output.appendLine(`[normalizeVariables] errors: ${nv.errors.join('; ')}`); }
        }

        // Strip trailing semicolons for SQL
        if (isSqlEndpointCodeType(normalized) && typeof normalized.TX_CODIGO === 'string') {
          normalized.TX_CODIGO = normalized.TX_CODIGO.trimEnd().replace(/;+$/, '');
        }

        const draft = state.draftStore.create(idProjeto, normalized);

        output.appendLine(`[${new Date().toISOString()}] Draft criado: ${draft.draftId}, projeto=${idProjeto}`);
        output.appendLine(`--- Draft JSON ---`);
        output.appendLine(JSON.stringify(normalized, null, 2));
        output.appendLine(`--- fim ---`);

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Draft criado com sucesso.\n- draftId: ${draft.draftId}\n- projeto: ${idProjeto}\n- endpoint: ${toStringSafe(normalized.NO_REST_CUSTOM)}\n- status: ${draft.status}\n\nProximo passo: chame aria_validate_endpoint_draft({"draftId": "${draft.draftId}"}) para validar.`
          )
        ]);
      }
    }),

    // ── Validate endpoint draft ───────────────────────────────────────────
    vscode.lm.registerTool<{ draftId: string }>('aria_validate_endpoint_draft', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        const draftId = toStringSafe(options.input.draftId);
        const draft = state.draftStore.get(draftId);
        if (!draft) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Draft nao encontrado: ${draftId}`)]);
        }

        const endpoint = draft.endpoint;
        const issues: string[] = [];
        const warnings: string[] = [];

        // Required fields
        const requiredFields = ['NO_REST_CUSTOM', 'TX_PATH', 'TX_CODIGO', 'ID_METODO', 'ID_TIPO_CODIGO', 'ID_BANCO_EXTERNO'];
        for (const field of requiredFields) {
          const value = endpoint[field];
          if (typeof value === 'number' ? !(value > 0) : !toStringSafe(value).trim()) {
            issues.push(`Campo obrigatorio ausente: ${field}`);
          }
        }

        // SQL guardrails
        if (isSqlEndpointCodeType(endpoint)) {
          const txCodigo = toStringSafe(endpoint.TX_CODIGO);
          if (hasSelectStar(txCodigo)) {
            issues.push('SELECT * detectado. Liste colunas explicitamente com aliases camelCase.');
          }
          const aliasIssues = analyzeSqlAliasIssues(txCodigo);
          if (aliasIssues.missingAlias.length) {
            warnings.push(`Colunas sem alias: ${aliasIssues.missingAlias.join(', ')}`);
          }
          if (aliasIssues.nonMnemonicAlias.length) {
            warnings.push(`Alias nao camelCase: ${aliasIssues.nonMnemonicAlias.join(', ')}`);
          }

          // Metadata validation
          const idBancoExterno = toNumber(endpoint.ID_BANCO_EXTERNO);
          const idBancoEsquema = toNumber(endpoint.ID_BANCO_ESQUEMA);
          if (idBancoExterno > 0) {
            const metadataKey = buildMetadataKey(idBancoExterno, idBancoEsquema);
            const metadataUri = state.metadataUriByEndpoint.get(metadataKey);
            if (!metadataUri) {
              issues.push(`Metadados nao carregados. Execute aria_obter_metadados primeiro.`);
            } else {
              try {
                const metadataText = await fs.promises.readFile(metadataUri.fsPath, 'utf8');
                const catalogTables = new Set(extractMetadataTableNames(metadataText).map((t) => t.toUpperCase()));
                const sqlTables = extractSqlReferencedTables(txCodigo);
                for (const sqlTable of sqlTables) {
                  const exact = catalogTables.has(sqlTable);
                  const bySuffix = !sqlTable.includes('.') && Array.from(catalogTables).some((ct) => ct.endsWith(`.${sqlTable}`));
                  if (!exact && !bySuffix) {
                    issues.push(`Tabela nao encontrada nos metadados: ${sqlTable}`);
                  }
                }
              } catch (e) {
                issues.push(`Falha ao ler metadados: ${toErrorMessage(e)}`);
              }
            }
          }
        }

        // VARIABLE validation
        const vars = asArray(endpoint.VARIABLE) ?? [];
        const varsMissingOrigin = vars.filter((v) => {
          const r = asRecord(v);
          return !r || r.IN_ORIGEM_VARIABLE === undefined || r.IN_ORIGEM_VARIABLE === null;
        });
        if (varsMissingOrigin.length) {
          issues.push('VARIABLE sem IN_ORIGEM_VARIABLE definido.');
        }

        // Server-side validations
        // Server-side validations are not provided to the assistant context.
        // Skip fetching endpoint validations here to avoid leaking them into LM tools.
        const validationErrors = validateEndpointPayload(endpoint);
        issues.push(...validationErrors);

        state.draftStore.markValidated(draftId, issues, warnings);

        const resultLines = [`Validacao do draft ${draftId}:`];
        if (issues.length) {
          resultLines.push(`\nERROS (${issues.length}):\n- ${issues.join('\n- ')}`);
        }
        if (warnings.length) {
          resultLines.push(`\nAVISOS (${warnings.length}):\n- ${warnings.join('\n- ')}`);
        }
        if (!issues.length) {
          resultLines.push('\nDraft VALIDADO com sucesso. Apresente a proposta ao usuario e aguarde confirmacao.');
          resultLines.push('Apos confirmacao, chame aria_import_endpoint_draft({"draftId": "' + draftId + '"}).');
        } else {
          resultLines.push('\nCorrija os erros, atualize o draft com aria_create_endpoint_draft e valide novamente.');
        }

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(resultLines.join('\n'))]);
      }
    }),

    // ── Import endpoint draft ─────────────────────────────────────────────
    vscode.lm.registerTool<{ draftId: string }>('aria_import_endpoint_draft', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        const draftId = toStringSafe(options.input.draftId);
        const draft = state.draftStore.get(draftId);
        if (!draft) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Draft nao encontrado: ${draftId}`)]);
        }
        if (draft.status === 'imported') {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Draft ja foi importado: ${draftId}`)]);
        }
        if (draft.validationIssues.length > 0) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Draft possui erros de validacao. Corrija antes de importar.\nErros:\n- ${draft.validationIssues.join('\n- ')}`)]);
        }

        try {
          const endpoint = draft.endpoint as unknown as AriaEndpoint;
          const importResult = await state.client.importarJsonEndpoint(draft.projectId, endpoint);
          if (importResult?.status !== 'ok') {
            throw new Error(importResult?.mensagem || 'API retornou status diferente de ok.');
          }

          state.draftStore.markImported(draftId);
          state.dataset = await state.client.getProjectEndpointTree();

          const endpointName = toStringSafe((endpoint as Record<string, unknown>).NO_REST_CUSTOM) || '(sem nome)';
          const endpointPath = toStringSafe((endpoint as Record<string, unknown>).TX_PATH) || '(sem path)';
          const incomingId = toNumber((endpoint as Record<string, unknown>).ID_REST_CUSTOM);
          const action = incomingId > 0 ? 'editado' : 'criado';

          output.appendLine(`[${new Date().toISOString()}] Draft importado: ${draftId}, endpoint ${action}: ${endpointName}`);

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(
              `Endpoint ${action} com sucesso.\n- Projeto: ${draft.projectId}\n- Endpoint: ${endpointName} (TX_PATH=${endpointPath})\nArvore de projetos atualizada.`
            )
          ]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro ao importar: ${toErrorMessage(error)}`)]);
        }
      }
    }),

    // ── Legacy import JSON (full dataset) ─────────────────────────────────
    vscode.lm.registerTool<{ json_projeto: unknown }>('aria_importar_json', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        try {
          const rawInput = options.input as Record<string, unknown>;
          const inputPayloadRaw = (asRecord(rawInput?.json_projeto) ?? rawInput) as Record<string, unknown>;
          const inputProjects = Array.isArray(inputPayloadRaw.registros) ? inputPayloadRaw.registros as AriaProject[] : [];
          if (!inputProjects.length) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Importacao bloqueada: registros vazio.')]);
          }

          // Simplified: delegate to importar-json endpoint directly
          const client = state.getClient();
          await client.saveDataset(inputPayloadRaw as any);
          state.dataset = await client.getProjectEndpointTree();
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('JSON importado com sucesso. Arvore atualizada.')]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)]);
        }
      }
    }),

    // ── Legacy import single endpoint ─────────────────────────────────────
    vscode.lm.registerTool<{ id_projeto: number; endpoint: unknown }>('aria_importar_json_endpoint', {
      async invoke(options, _token) {
        if (!state.client) { return notConnectedResult(); }
        try {
          const rawInput = options.input as Record<string, unknown>;
          const idProjeto = Number(rawInput.id_projeto);
          if (!(idProjeto > 0)) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Parametro invalido: id_projeto deve ser > 0.')]);
          }

          let endpoint = asRecord(rawInput.endpoint);
          if (!endpoint && rawInput.NO_REST_CUSTOM) {
            const { id_projeto: _id, ...rest } = rawInput;
            endpoint = rest;
          }
          if (!endpoint) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('Parametro invalido: endpoint nao encontrado.')]);
          }

          // Unwrap
          const rc = asArray(endpoint.REST_CUSTOM);
          if (rc?.length && !endpoint.NO_REST_CUSTOM && !endpoint.TX_PATH) {
            const first = asRecord(rc[0]);
            if (first) { endpoint = first; }
          }

          const { REST_CUSTOM: _r, PROJETO: _p, REST_CUSTOM_JSON_SCHEMA: _s, ...clean } = endpoint;
          const incomingEndpoint = clean as unknown as AriaEndpoint;

          // Enrich with LOVs
          try {
            const lovs = await state.getProjectLovs(idProjeto);
            if (lovs) {
              const enriched = applyLovDisplayValues(asRecord(incomingEndpoint) ?? {}, lovs);
              for (const [k, v] of Object.entries(enriched)) { (incomingEndpoint as Record<string, unknown>)[k] = v; }
            }
          } catch { /* ignore */ }

          // Normalize variables
          const vars = asArray((incomingEndpoint as any).VARIABLE) ?? [];
          if (vars.length) {
            const nv = normalizeVariables(vars, (m) => output.appendLine(`[normalizeVariables] ${m}`));
            (incomingEndpoint as any).VARIABLE = nv.normalized;
            if (nv.errors?.length) { output.appendLine(`[normalizeVariables] errors: ${nv.errors.join('; ')}`); }
          } else if (typeof incomingEndpoint.TX_CODIGO === 'string') {
            const extracted = extractVariablesFromCode(incomingEndpoint.TX_CODIGO);
            if (extracted.length) { (incomingEndpoint as any).VARIABLE = extracted; }
          }

          // Strip trailing semicolons
          if (isSqlEndpointCodeType(incomingEndpoint) && typeof incomingEndpoint.TX_CODIGO === 'string') {
            incomingEndpoint.TX_CODIGO = incomingEndpoint.TX_CODIGO.trimEnd().replace(/;+$/, '');
          }

          // Required field check
          const requiredFields: (keyof AriaEndpoint)[] = ['NO_REST_CUSTOM', 'TX_PATH', 'TX_CODIGO', 'ID_METODO', 'ID_TIPO_CODIGO', 'ID_BANCO_EXTERNO'];
          const missing = requiredFields.filter((f) => {
            const v = (incomingEndpoint as any)[String(f)];
            return typeof v === 'number' ? !(v > 0) : !toStringSafe(v).trim();
          });
          if (missing.length) {
            return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Campos obrigatorios ausentes: ${missing.join(', ')}`)]);
          }

          // SQL guardrails
          if (isSqlEndpointCodeType(incomingEndpoint)) {
            if (hasSelectStar(toStringSafe(incomingEndpoint.TX_CODIGO))) {
              return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('SELECT * detectado. Liste colunas explicitamente.')]);
            }
          }

          output.appendLine(`[${new Date().toISOString()}] aria_importar_json_endpoint: projeto=${idProjeto}`);
          output.appendLine(JSON.stringify(incomingEndpoint, null, 2));

          const importResult = await state.client.importarJsonEndpoint(idProjeto, incomingEndpoint);
          if (importResult?.status !== 'ok') {
            throw new Error(importResult?.mensagem || 'API retornou status diferente de ok.');
          }

          state.dataset = await state.client.getProjectEndpointTree();
          const action = toNumber((incomingEndpoint as Record<string, unknown>).ID_REST_CUSTOM) > 0 ? 'editado' : 'criado';
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Endpoint ${action} com sucesso.\n- Projeto: ${idProjeto}\nArvore atualizada.`)
          ]);
        } catch (error) {
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(`Erro: ${toErrorMessage(error)}`)]);
        }
      }
    })
  );
}
