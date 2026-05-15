"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLovsResponse = normalizeLovsResponse;
exports.buildLovsContextSummary = buildLovsContextSummary;
const utils_1 = require("../../core/utils");
function normalizeLovsResponse(response) {
    const isLovsRecord = (value) => {
        return Boolean(value.BANCO_EXTERNO || value.METODO || value.TIPO_CODIGO || value.TIPO_HEADER || value.PERFIL || value.INSTANCIA || value.TIPO_OTP);
    };
    const root = (0, utils_1.asRecord)(response);
    if (root) {
        const registros = (0, utils_1.asArray)(root.registros);
        if (registros && registros.length > 0) {
            for (const item of registros) {
                const record = (0, utils_1.asRecord)(item);
                if (record && isLovsRecord(record)) {
                    return record;
                }
            }
            const firstRecord = (0, utils_1.asRecord)(registros[0]);
            if (firstRecord) {
                return firstRecord;
            }
        }
        if (isLovsRecord(root)) {
            return root;
        }
    }
    if (Array.isArray(response)) {
        for (const item of response) {
            const record = (0, utils_1.asRecord)(item);
            if (record && isLovsRecord(record)) {
                return record;
            }
        }
        const firstRecord = (0, utils_1.asRecord)(response[0]);
        if (firstRecord) {
            return firstRecord;
        }
    }
    return {};
}
function buildLovsContextSummary(lovs) {
    if (!lovs) {
        return 'LOVs: indisponíveis.';
    }
    const metodo = (lovs.METODO ?? []).map((item) => `${(0, utils_1.toStringSafe)(item.NO_METODO)}(${(0, utils_1.toNumber)(item.ID_METODO)})`).join(', ');
    const tipoCodigo = (lovs.TIPO_CODIGO ?? []).map((item) => `${(0, utils_1.toStringSafe)(item.NO_TIPO_CODIGO)}(${(0, utils_1.toNumber)(item.ID_TIPO_CODIGO)})`).join(', ');
    const tipoHeader = (lovs.TIPO_HEADER ?? []).map((item) => `${(0, utils_1.toStringSafe)(item.NO_TIPO_HEADER)}(${(0, utils_1.toNumber)(item.ID_TIPO_HEADER)})`).join(', ');
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
