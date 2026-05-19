// ─── Domain Types ───────────────────────────────────────────────────────────

export interface AriaDataset {
  registros: AriaProject[];
  listasValores?: unknown;
}

export interface AriaProject {
  ID_PROJETO: number;
  NO_PROJETO: string;
  TX_PATH: string;
  REST_CUSTOM: AriaEndpoint[];
  [key: string]: unknown;
}

export interface AriaEndpoint {
  ID_REST_CUSTOM: number;
  NO_REST_CUSTOM: string;
  TX_PATH: string;
  TX_CODIGO?: string;
  [key: string]: unknown;
}

export interface ValidateCodeResponse {
  status?: string;
  mensagem?: string;
  codigo?: unknown;
  [key: string]: unknown;
}

export interface PreviaPayload {
  idBancoExterno: unknown;
  idBancoEsquema: unknown;
  query: string;
  pagina: number;
  tamanhoPagina: number;
  parametros: string[];
  valoresParametros: string[];
}

export interface PreviaResponse {
  pageCount?: number;
  columns?: string[];
  count?: number;
  registros?: Record<string, unknown>[];
  status?: string;
}

export interface EndpointFormItem {
  ITEM_SEQUENCE: number;
  REGION_SEQUENCE: number;
  IS_REQUIRED: string;
  DISPLAY_AS: string;
  ITEM_SOURCE?: string;
  LABEL?: string;
  ITEM_SOURCE_TYPE?: string;
  ITEM_NAME: string;
  REGION?: string;
}

export interface EndpointValidationItem {
  REGION_SEQUENCE: number;
  REGION_NAME?: string;
  VALIDATION_SEQUENCE: number;
  VALIDATION_NAME: string;
  VALIDATION_TYPE: string;
  VALIDATION_FAILURE_TEXT?: string;
  VALIDATION_EXPRESSION1?: string;
  CONDITION_TYPE?: string;
  CONDITION_EXPRESSION1?: string;
  CONDITION_EXPRESSION2?: string;
  ASSOCIATED_ITEM?: string;
}

export interface AriaBancoEsquema {
  ID_BANCO_ESQUEMA: number;
  NO_ESQUEMA: string;
}

export interface AriaBancoExterno {
  ID_BANCO_EXTERNO: number;
  CO_BANCO_EXTERNO: string;
  TX_DATASOURCE?: string;
  BANCO_ESQUEMA: AriaBancoEsquema[];
}

export type AriaLovs = {
  METODO?: Array<{ ID_METODO: number; NO_METODO: string }>;
  TIPO_CODIGO?: Array<{ ID_TIPO_CODIGO: number; NO_TIPO_CODIGO: string }>;
  TIPO_HEADER?: Array<{ ID_TIPO_HEADER: number; NO_TIPO_HEADER: string }>;
  BANCO_EXTERNO?: AriaBancoExterno[];
  PERFIL?: Array<{ ID_PERFIL: number; NO_PERFIL: string }>;
  INSTANCIA?: Array<{ ID_INSTANCIA: number; CO_INSTANCIA: string }>;
  TIPO_OTP?: Array<{ ID_TIPO_OTP: number; NO_TIPO_OTP: string }>;
  SISTEMA?: Array<{ ID_SISTEMA: number; CO_SISTEMA: number }>;
};

// ─── Metadata Types ─────────────────────────────────────────────────────────

export interface ParsedMetadataForeignKey {
  column: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  raw: string;
}

export interface ParsedMetadataColumn {
  name: string;
  type: string;
  comment?: string;
  raw: string;
}

export interface ParsedMetadataTable {
  schema: string;
  name: string;
  fullName: string;
  comment?: string;
  columns: ParsedMetadataColumn[];
  foreignKeys: ParsedMetadataForeignKey[];
}

export interface ParsedMetadataSchema {
  name: string;
  tables: ParsedMetadataTable[];
}

export interface ParsedMetadataCatalog {
  key: string;
  filePath?: string;
  markdown: string;
  schemas: ParsedMetadataSchema[];
}

// ─── Config Types ───────────────────────────────────────────────────────────

export interface ApiSettings {
  baseUrl: string;
  fetchProjectPath: string;
  ignoreSslErrors: boolean;
}

export interface EntraSettings {
  requireLogin: boolean;
  allowedEmailDomains: string[];
}

// ─── Code Types ─────────────────────────────────────────────────────────────

export type CodeTypeLabel = 'SQL' | 'PLSQL' | 'PYTHON';

// ─── Editor Types ───────────────────────────────────────────────────────────

export type EditMarker =
  | { type: 'projectJson'; id: number; projectId: number }
  | { type: 'endpointJson'; id: number; projectId: number }
  | { type: 'endpointCode'; id: number; projectId: number };

// ─── Draft Types ────────────────────────────────────────────────────────────

export type DraftStatus = 'created' | 'invalid' | 'validated' | 'imported';

export interface EndpointDraft {
  draftId: string;
  projectId: number;
  endpoint: Record<string, unknown>;
  status: DraftStatus;
  validationIssues: string[];
  warnings: string[];
  createdAt: number;
  updatedAt: number;
}

// ─── Endpoint Field Meta ────────────────────────────────────────────────────

export interface EndpointFieldMeta {
  key: string;
  label?: string;
  required: boolean;
  displayAs: string;
  region: string;
  itemSequence: number;
  regionSequence: number;
  hidden: boolean;
  displayOnly: boolean;
}

// ─── Form Render Options ────────────────────────────────────────────────────

export interface FormRenderOptions {
  endpointItems?: EndpointFormItem[];
  lovs?: AriaLovs;
}

// ─── Function Types ─────────────────────────────────────────────────────────

export type AccessTokenProvider = (forceRefresh?: boolean) => Promise<string | undefined>;
export type LogWriter = (message: string) => void;
