export const REQUIRED_ENTRA_TENANT_ID = 'b5661350-c2e4-43dc-bce8-f003ddf8a3c4';
export const ARIA_EDIT_SCHEME = 'aria-edit';
export const API_TIMEOUT_MS = 45_000;
export const GET_RETRY_DELAYS_MS = [1200, 2500];

export const METHOD_MAP: Record<number, string> = {
  1: 'GET',
  2: 'POST',
  3: 'PUT',
  4: 'DELETE',
};

export const SN_DEFAULTS: Record<string, string> = {
  SN_MODO_COMPATIBILIDADE: 'N',
  SN_PAGINADO: 'N',
  SN_CACHE: 'N',
  SN_PUBLICADO: 'S',
  SN_INCLUI_COUNT: 'N',
  SN_HABILITA_META_API: 'N',
  SN_NULOS_EXPLICITOS: 'N',
  SN_IGNORA_CONFIGS_DEPLOY: 'N',
  SN_APENAS_INTERNO: 'N',
  SN_EXIGE_OTP: 'N',
  SN_IDEMPOTENTE: 'N',
};

export const CHILD_ARRAY_FIELDS = [
  'REST_CUSTOM_PERFIL',
  'REST_CUSTOM_RESPONSE',
  'HEADER',
  'REST_CUSTOM_IP',
  'REST_CUSTOM_TIPO_OTP',
  'REST_CUSTOM_ATRIBUTO_LOG',
];

export const RESERVED_VARIABLE_NAMES = new Set([
  'aria_perfis_usuario',
  'aria_id_usuario',
  'aria_login_usuario',
  'aria_email_usuario',
  'request_body',
]);
