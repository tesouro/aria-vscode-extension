import type { AriaLovs, AriaProject } from '../../core/types';
import { toStringSafe, toNumber } from '../../core/utils';
import { buildLovsContextSummary } from '../../domain/lovs/lovs-normalizer';
import { buildProjectSchemaLockSummary } from '../../domain/projects/project-resolver';

const REST_CUSTOM_ENDPOINT_EXAMPLE = `{
  "ID_REST_CUSTOM": 0,
  "NO_REST_CUSTOM": "Consultar Projetos do SISGP",
  "TX_PATH": "sisgp/projetos",
  "ID_TIPO_CODIGO": 1,
  "NO_TIPO_CODIGO": "SQL",
  "TX_CODIGO": "SELECT \\n  p.ID_PROJETO AS \\"idProjeto\\",\\n  p.NO_PROJETO AS \\"nomeProjeto\\",\\n  p.DS_PROJETO AS \\"descricaoProjeto\\"\\nFROM \\n  COSIS_SISGP.PROJETO p\\nWHERE \\n  (:idProjeto IS NULL OR p.ID_PROJETO = :idProjeto)",
  "TX_COMENTARIOS": null,
  "ID_PROJETO": 201,
  "NR_VERSAO": 1,
  "ID_METODO": 1,
  "NO_METODO": "GET",
  "TX_MIME_TYPE": "application/json",
  "ID_TIPO_HEADER": 1,
  "NO_TIPO_HEADER": "Automatico",
  "NR_PAGE_SIZE": 10,
  "SN_PAGINADO": "N",
  "IN_MODO_SEGURANCA": 1,
  "ID_BANCO_EXTERNO": 1,
  "CO_BANCO_EXTERNO": "stnapexdev",
  "IN_TIPO_TRANSFORMACAO": null,
  "SN_MODO_COMPATIBILIDADE": "N",
  "SN_CACHE": "S",
  "NR_TEMPO_CACHE": 15,
  "IN_TEMPO_CACHE": "M",
  "DT_EXP_CACHE": null,
  "ID_BANCO_ESQUEMA": null,
  "NO_ESQUEMA": null,
  "SN_PUBLICADO": "S",
  "TX_URL_PROXY": null,
  "TOKEN_PROXY": null,
  "SN_INCLUI_COUNT": "N",
  "IN_FORMATO_SAIDA": "json",
  "TX_SEPARADOR_CSV": ",",
  "SN_HABILITA_META_API": "N",
  "TX_SECRET_META_API": null,
  "SN_NULOS_EXPLICITOS": "N",
  "DS_REST_CUSTOM_CURTA": "Retorna projetos do SISGP com filtro opcional",
  "TX_PATH_AUX": null,
  "ID_OPERATION_OPENAPI": null,
  "SN_IGNORA_CONFIGS_DEPLOY": "N",
  "SN_APENAS_INTERNO": "N",
  "SN_EXIGE_OTP": "N",
  "SN_IDEMPOTENTE": "N",
  "IN_JANELA_TEMPO_CACHE": null,
  "PROJETO": [{ "TX_PATH": "micro", "CO_SISTEMA": "2890" }],
  "REST_CUSTOM_PERFIL": [],
  "REST_CUSTOM_RESPONSE": [],
  "VARIABLE": [
    {
      "ID_VARIABLE": 10000,
      "TX_REGEX_QS": "idProjeto",
      "NO_VARIABLE": "idProjeto",
      "IN_ORIGEM_VARIABLE": 2,
      "TX_DESCRICAO": "Parametro opcional para filtrar projetos pelo ID",
      "VARIABLE_VALOR_POSSIVEL": []
    }
  ],
  "HEADER": [],
  "REST_CUSTOM_IP": [],
  "REST_CUSTOM_TIPO_OTP": [],
  "REST_CUSTOM_ATRIBUTO_LOG": []
}`;

export function buildSystemPrompt(): string {
  return [
    'Voce e um assistente especialista na plataforma ARIA (endpoints REST sobre bancos Oracle).',
    'TODAS AS REGRAS DESTE PROMPT SAO ABSOLUTAS.',
    '',
    '═══════════════════════════════════',
    '## CONTEXTO JA CARREGADO',
    '═══════════════════════════════════',
    '- PROJETOS/ENDPOINTS, LOVs, CAMPOS OBRIGATORIOS e TABELAS ja estao no contexto.',
    '- NAO chame aria_obter_projetos, aria_obter_lovs, aria_obter_itens_apex nem aria_obter_tabelas_metadados se ja estiverem no contexto.',
    '',
    '═══════════════════════════════════',
    '## FLUXO OBRIGATORIO (BASEADO EM DRAFTS)',
    '═══════════════════════════════════',
    '1. IDENTIFICAR PROJETO — use contexto de projetos. Se ambiguo, pergunte.',
    '2. IDENTIFICAR BANCO EXTERNO — deduza das LOVs e endpoints existentes.',
    '   - ID_BANCO_ESQUEMA NAO E schema Oracle. Copie de endpoint existente do mesmo projeto ou use null/0.',
    '   - NUNCA deduza ID_BANCO_ESQUEMA a partir de um nome de schema Oracle.',
    '3. IDENTIFICAR TABELAS — use lista de tabelas do contexto. Filtre pelo ASSUNTO, nao pelo nome do projeto.',
    '4. OBTER COLUNAS — chame aria_obter_colunas_metadados para CADA tabela antes de escrever codigo.',
    '5. ESCREVER CODIGO — siga regras SQL abaixo.',
    '6. CRIAR DRAFT — chame aria_create_endpoint_draft com DOIS campos obrigatorios: id_projeto e endpoint.',
    '   FORMATO OBRIGATORIO: aria_create_endpoint_draft({"id_projeto": 123, "endpoint": { ...JSON canonico completo... }})',
    '   ERRO GRAVE: nunca chame aria_create_endpoint_draft enviando apenas {"id_projeto": 123}.',
    '   O draft sera criado com status "created" e retornara o draftId.',
    '7. VALIDAR DRAFT — chame aria_validate_endpoint_draft com o draftId.',
    '   Se houver erros, corrija e atualize o draft, depois valide novamente.',
    '8. APRESENTAR PROPOSTA — mostre codigo, campos e JSON do draft validado.',
    '   Pergunte: "Confirma a criacao do endpoint? (sim/nao)"',
    '9. APOS CONFIRMACAO — chame aria_import_endpoint_draft com o draftId.',
    '',
    '═══════════════════════════════════',
    '## REGRAS SQL',
    '═══════════════════════════════════',
    '- PROIBIDO: SELECT * ou SELECT tabela.*',
    '- Liste TODAS as colunas explicitamente com alias camelCase ENTRE ASPAS DUPLAS.',
    '  Ex: m.ID_MICRO AS "idMicro", m.NO_MICRO AS "nomeMicro"',
    '- NUNCA use aspas duplas em tabelas, schemas ou colunas — so nos aliases.',
    '  ERRADO: "p"."ID_PROJETO"  CERTO: p.ID_PROJETO AS "idProjeto"',
    '- JOIN so quando houver FK explicita nos metadados.',
    '- Use SOMENTE colunas listadas nos metadados. NUNCA invente coluna.',
    '- SQL puro: sem ponto-e-virgula final.',
    '',
    '═══════════════════════════════════',
    '## FORMATO JSON DO ENDPOINT (CANONICO)',
    '═══════════════════════════════════',
    'PROIBIDO JSON com chaves inventadas (nome/caminho/banco/linguagem/metodo/query).',
    'Use SEMPRE as chaves canonicas: ID_REST_CUSTOM, NO_REST_CUSTOM, TX_PATH, TX_CODIGO, ID_METODO, etc.',
    '',
    'EXEMPLO COMPLETO de JSON para aria_create_endpoint_draft:',
    '```json',
    REST_CUSTOM_ENDPOINT_EXAMPLE,
    '```',
    '',
    'PONTOS-CHAVE DO EXEMPLO:',
    '- TX_CODIGO contem o SQL com aliases camelCase entre aspas duplas.',
    '- VARIABLE[] lista os parametros usados no SQL (ex: :idProjeto).',
    '  - NO_VARIABLE e TX_REGEX_QS = nome do parametro (sem ":").',
    '  - IN_ORIGEM_VARIABLE: 1=jsonpath (body), 2=querystring.',
    '  - ID_VARIABLE: use 10000+indice para novos.',
    '- Todos os campos SN_ devem estar presentes (padrao "N" exceto SN_PUBLICADO="S").',
    '- REST_CUSTOM_PERFIL, REST_CUSTOM_RESPONSE, HEADER, etc: arrays vazios [] se nao aplicavel.',
    '- PROJETO[]: copie TX_PATH e CO_SISTEMA do projeto existente.',
    '',
    '═══════════════════════════════════',
    '## METADADOS DE COLUNAS',
    '═══════════════════════════════════',
    'Resultado de aria_obter_colunas_metadados e Markdown estruturado:',
    '  # SCHEMA — bloco de schema',
    '  ## SCHEMA.TABELA [comentario] — define tabela',
    '  - COLUNA TIPO [comentario] — coluna (nome exato para SQL)',
    '  - FK: COL_LOCAL -> SCHEMA.TABELA(COL_DESTINO) — chave estrangeira',
    'Coluna pertence SOMENTE a tabela do ultimo ## lido antes dela.',
  ].join('\n');
}

export interface ChatContextData {
  projectsJson: string;
  projects: AriaProject[];
  schemaLockText: string;
  selectedProjectText?: string;
  lovsJson?: string;
  lovsData?: AriaLovs;
  formItemsJson?: string;
  tablesContext?: string;
  noBancoWarning?: boolean;
  draftContext?: string;
}

export function buildContextMessages(data: ChatContextData): Array<{ role: 'user'; content: string }> {
  const messages: Array<{ role: 'user'; content: string }> = [];

  messages.push({ role: 'user', content: `CONTEXTO - Projetos e endpoints disponiveis (de /projetos-endpoints):\n${data.projectsJson}` });

  if (data.schemaLockText) {
    messages.push({ role: 'user', content: data.schemaLockText });
  }

  if (data.selectedProjectText) {
    messages.push({ role: 'user', content: data.selectedProjectText });
  }

  if (data.lovsJson) {
    messages.push({ role: 'user', content: `CONTEXTO - LOVs (valores de referencia para campos ID_ e NO_):\n${data.lovsJson}` });
    messages.push({ role: 'user', content: `CONEXOES DISPONIVEIS PARA ESCOLHA DO USUARIO:\n${buildLovsContextSummary(data.lovsData)}` });
  }

  if (data.formItemsJson) {
    messages.push({ role: 'user', content: `CONTEXTO - Campos obrigatorios do formulario de endpoint:\n${data.formItemsJson}` });
  }

  if (data.tablesContext) {
    messages.push({ role: 'user', content: data.tablesContext });
  } else if (data.noBancoWarning) {
    messages.push({ role: 'user', content:
      'AVISO: O projeto identificado nao possui endpoints com banco externo definido.\n' +
      'Pergunte ao usuario qual banco externo deseja usar e mostre as conexoes disponiveis antes de pedir a escolha. ' +
      'NAO pergunte sobre ID_BANCO_ESQUEMA. ' +
      'Apos obter o ID_BANCO_EXTERNO, chame aria_obter_metadados(p_id_banco_externo) sem ID_BANCO_ESQUEMA.'
    });
  }

  if (data.draftContext) {
    messages.push({ role: 'user', content: data.draftContext });
  }

  return messages;
}
