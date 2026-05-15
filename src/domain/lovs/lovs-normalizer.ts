import type { AriaLovs } from '../../core/types';
import { asRecord, asArray, toNumber, toStringSafe } from '../../core/utils';

export function normalizeLovsResponse(response: unknown): AriaLovs {
  const isLovsRecord = (value: Record<string, unknown>): boolean => {
    return Boolean(value.BANCO_EXTERNO || value.METODO || value.TIPO_CODIGO || value.TIPO_HEADER || value.PERFIL || value.INSTANCIA || value.TIPO_OTP);
  };

  const root = asRecord(response);
  if (root) {
    const registros = asArray(root.registros);
    if (registros && registros.length > 0) {
      for (const item of registros) {
        const record = asRecord(item);
        if (record && isLovsRecord(record)) { return record as AriaLovs; }
      }
      const firstRecord = asRecord(registros[0]);
      if (firstRecord) { return firstRecord as AriaLovs; }
    }
    if (isLovsRecord(root)) { return root as AriaLovs; }
  }

  if (Array.isArray(response)) {
    for (const item of response) {
      const record = asRecord(item);
      if (record && isLovsRecord(record)) { return record as AriaLovs; }
    }
    const firstRecord = asRecord(response[0]);
    if (firstRecord) { return firstRecord as AriaLovs; }
  }

  return {};
}

export function buildLovsContextSummary(lovs: AriaLovs | undefined): string {
  if (!lovs) { return 'LOVs: indisponíveis.'; }

  const metodo = (lovs.METODO ?? []).map((item) => `${toStringSafe(item.NO_METODO)}(${toNumber(item.ID_METODO)})`).join(', ');
  const tipoCodigo = (lovs.TIPO_CODIGO ?? []).map((item) => `${toStringSafe(item.NO_TIPO_CODIGO)}(${toNumber(item.ID_TIPO_CODIGO)})`).join(', ');
  const tipoHeader = (lovs.TIPO_HEADER ?? []).map((item) => `${toStringSafe(item.NO_TIPO_HEADER)}(${toNumber(item.ID_TIPO_HEADER)})`).join(', ');

  const bancos = (lovs.BANCO_EXTERNO ?? []).map((banco) => {
    const schemas = (banco.BANCO_ESQUEMA ?? []).map((s) => `${s.NO_ESQUEMA}(${s.ID_BANCO_ESQUEMA})`).join(', ');
    return `- ${banco.CO_BANCO_EXTERNO} (ID: ${banco.ID_BANCO_EXTERNO})${schemas ? `: ${schemas}` : ': Sem esquemas.'}`;
  });

  return [
    'LOVs relevantes para montar o JSON:',
    metodo ? `- METODO: ${metodo}` : '- METODO: vazio',
    tipoCodigo ? `- TIPO_CODIGO: ${tipoCodigo}` : '- TIPO_CODIGO: vazio',
    tipoHeader ? `- TIPO_HEADER: ${tipoHeader}` : '- TIPO_HEADER: vazio',
    '- BANCO_EXTERNO:', ...(bancos.length ? bancos : ['- sem bancos disponíveis']),
  ].join('\n');
}
