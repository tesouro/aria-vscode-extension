"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeModelEndpointOutput = normalizeModelEndpointOutput;
exports.buildEndpointFromExampleStructure = buildEndpointFromExampleStructure;
exports.extractVariablesFromCode = extractVariablesFromCode;
exports.normalizeVariables = normalizeVariables;
exports.resolveRequiredBankFields = resolveRequiredBankFields;
exports.applyLovDisplayValues = applyLovDisplayValues;
exports.compactEndpoint = compactEndpoint;
exports.compactProject = compactProject;
const utils_1 = require("../../core/utils");
const constants_1 = require("../../core/constants");
// ─── Friendly-to-canonical key mapping ──────────────────────────────────────
const FRIENDLY_KEY_MAP = {
    'nome': 'NO_REST_CUSTOM',
    'name': 'NO_REST_CUSTOM',
    'nome_endpoint': 'NO_REST_CUSTOM',
    'caminho': 'TX_PATH',
    'path': 'TX_PATH',
    'banco': 'ID_BANCO_EXTERNO',
    'banco_externo': 'ID_BANCO_EXTERNO',
    'linguagem': 'ID_TIPO_CODIGO',
    'tipo_codigo': 'ID_TIPO_CODIGO',
    'metodo': 'ID_METODO',
    'method': 'ID_METODO',
    'query': 'TX_CODIGO',
    'codigo': 'TX_CODIGO',
    'code': 'TX_CODIGO',
    'sql': 'TX_CODIGO',
    'descricao': 'DS_REST_CUSTOM_CURTA',
    'descricao_curta': 'DS_REST_CUSTOM_CURTA',
    'comentarios': 'TX_COMENTARIOS',
    'comments': 'TX_COMENTARIOS',
    'esquema': 'ID_BANCO_ESQUEMA',
    'schema': 'ID_BANCO_ESQUEMA',
};
function normalizeModelEndpointOutput(raw) {
    // Unwrap envelope
    const restCustomArray = (0, utils_1.asArray)(raw.REST_CUSTOM);
    if (restCustomArray && restCustomArray.length > 0 && !raw.NO_REST_CUSTOM && !raw.TX_PATH) {
        const firstEp = (0, utils_1.asRecord)(restCustomArray[0]);
        if (firstEp) {
            raw = firstEp;
        }
    }
    const normalized = {};
    for (const [key, value] of Object.entries(raw)) {
        const lowerKey = key.toLowerCase().trim();
        const canonicalKey = FRIENDLY_KEY_MAP[lowerKey] ?? key;
        if (canonicalKey !== key && normalized[canonicalKey] !== undefined) {
            continue;
        }
        normalized[canonicalKey] = value;
    }
    // Defaults for new endpoints
    if (normalized.ID_REST_CUSTOM === undefined || normalized.ID_REST_CUSTOM === null) {
        normalized.ID_REST_CUSTOM = 0;
    }
    for (const [field, defaultValue] of Object.entries(constants_1.SN_DEFAULTS)) {
        if (normalized[field] === undefined || normalized[field] === null) {
            normalized[field] = defaultValue;
        }
    }
    normalized.SN_MODO_COMPATIBILIDADE = 'N';
    if (!normalized.IN_FORMATO_SAIDA) {
        normalized.IN_FORMATO_SAIDA = 'json';
    }
    if (!normalized.TX_MIME_TYPE) {
        normalized.TX_MIME_TYPE = 'application/json';
    }
    if (!normalized.IN_MODO_SEGURANCA) {
        normalized.IN_MODO_SEGURANCA = 1;
    }
    if (normalized.NR_VERSAO === undefined || normalized.NR_VERSAO === null) {
        normalized.NR_VERSAO = 1;
    }
    delete normalized.REST_CUSTOM;
    delete normalized.PROJETO;
    delete normalized.REST_CUSTOM_JSON_SCHEMA;
    for (const field of constants_1.CHILD_ARRAY_FIELDS) {
        if (!Array.isArray(normalized[field])) {
            normalized[field] = [];
        }
    }
    return normalized;
}
// ─── Build canonical endpoint from overrides ────────────────────────────────
function buildEndpointFromExampleStructure(project, overrides, lovs, options) {
    const projectRecord = project;
    const methodFromOverrides = Number(overrides.ID_METODO ?? 1);
    const firstEndpoint = project.REST_CUSTOM[0];
    const coSistema = Number(projectRecord.CO_SISTEMA ?? firstEndpoint?.CO_BANCO_EXTERNO ?? -1);
    const bankDefaults = resolveRequiredBankFields(projectRecord, { ...firstEndpoint, ...overrides }, lovs, { ignoreExplicitBankFields: options?.ignoreExplicitBankFields ?? false });
    const code = String(overrides.TX_CODIGO ?? '');
    const variables = extractVariablesFromCode(code);
    const variableArr = variables.map((v, idx) => ({
        ID_VARIABLE: 10000 + idx,
        TX_REGEX_QS: v.name,
        NO_VARIABLE: v.name,
        IN_ORIGEM_VARIABLE: v.origem,
        VARIABLE_VALOR_POSSIVEL: [],
    }));
    const baseStructure = {
        ID_REST_CUSTOM: 0,
        NO_REST_CUSTOM: '',
        TX_PATH: '',
        ID_TIPO_CODIGO: 1,
        NO_TIPO_CODIGO: 'SQL',
        TX_CODIGO: '',
        TX_COMENTARIOS: '',
        ID_PROJETO: project.ID_PROJETO,
        NR_VERSAO: 1,
        ID_METODO: Number.isFinite(methodFromOverrides) ? methodFromOverrides : 1,
        NO_METODO: constants_1.METHOD_MAP[methodFromOverrides] ?? 'GET',
        TX_MIME_TYPE: 'application/json',
        ID_TIPO_HEADER: 1,
        NO_TIPO_HEADER: 'Automatico',
        NR_PAGE_SIZE: 1000,
        SN_PAGINADO: 'S',
        IN_MODO_SEGURANCA: 1,
        ID_BANCO_EXTERNO: bankDefaults.ID_BANCO_EXTERNO,
        CO_BANCO_EXTERNO: bankDefaults.CO_BANCO_EXTERNO,
        ID_BANCO_ESQUEMA: bankDefaults.ID_BANCO_ESQUEMA,
        NO_ESQUEMA: bankDefaults.NO_ESQUEMA,
        SN_MODO_COMPATIBILIDADE: 'N',
        SN_CACHE: 'N',
        SN_PUBLICADO: 'S',
        SN_INCLUI_COUNT: 'N',
        IN_FORMATO_SAIDA: 'json',
        TX_SEPARADOR_CSV: ',',
        SN_HABILITA_META_API: 'N',
        SN_NULOS_EXPLICITOS: 'N',
        DS_REST_CUSTOM_CURTA: '',
        SN_IGNORA_CONFIGS_DEPLOY: 'N',
        SN_APENAS_INTERNO: 'N',
        SN_EXIGE_OTP: 'N',
        SN_IDEMPOTENTE: 'N',
        IN_JANELA_TEMPO_CACHE: 'FH',
        PROJETO: [{ TX_PATH: project.TX_PATH, CO_SISTEMA: coSistema }],
        REST_CUSTOM_PERFIL: [],
        REST_CUSTOM_RESPONSE: [],
        REST_CUSTOM_JSON_SCHEMA: [],
        VARIABLE: variableArr,
        HEADER: [],
        REST_CUSTOM_IP: [],
        REST_CUSTOM_TIPO_OTP: [],
        REST_CUSTOM_ATRIBUTO_LOG: [],
    };
    return {
        ...baseStructure,
        ...overrides,
        ID_REST_CUSTOM: 0,
        ID_PROJETO: project.ID_PROJETO,
        PROJETO: [{ TX_PATH: project.TX_PATH, CO_SISTEMA: coSistema }],
        NO_METODO: constants_1.METHOD_MAP[Number(overrides.ID_METODO ?? methodFromOverrides)] ?? 'GET',
        VARIABLE: variableArr,
    };
}
// ─── Variable extraction ────────────────────────────────────────────────────
function extractVariablesFromCode(code) {
    const variables = [];
    const regexes = [
        { re: /:([a-zA-Z_][a-zA-Z0-9_]*)/g, origem: 2 },
        { re: /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, origem: 1 },
        { re: /\$([a-zA-Z_][a-zA-Z0-9_]*)/g, origem: 1 },
    ];
    for (const { re, origem } of regexes) {
        let m;
        while ((m = re.exec(code))) {
            const name = m[1];
            if (name && !constants_1.RESERVED_VARIABLE_NAMES.has(name.toLowerCase()) && !variables.some(v => v.name === name)) {
                variables.push({ name, origem });
            }
        }
    }
    return variables;
}
function normalizeVariables(vars, logger) {
    const normalizedVars = [];
    const errors = [];
    for (let vi = 0; vi < vars.length; vi++) {
        const rawVar = (0, utils_1.asRecord)(vars[vi]) || {};
        const noVariable = (0, utils_1.toStringSafe)(rawVar.NO_VARIABLE || rawVar.TX_REGEX_QS).trim();
        if (!noVariable || constants_1.RESERVED_VARIABLE_NAMES.has(noVariable.toLowerCase())) {
            continue;
        }
        const txRegex = (0, utils_1.toStringSafe)(rawVar.TX_REGEX_QS).trim() || noVariable;
        normalizedVars.push({
            ID_VARIABLE: (0, utils_1.toNumber)(rawVar.ID_VARIABLE) || 10000 + vi,
            NO_VARIABLE: noVariable,
            TX_REGEX_QS: txRegex,
            IN_ORIGEM_VARIABLE: rawVar.IN_ORIGEM_VARIABLE,
            TX_DESCRICAO: (0, utils_1.toStringSafe)(rawVar.TX_DESCRICAO),
        });
    }
    const missingOrigin = normalizedVars.filter(v => v.IN_ORIGEM_VARIABLE === undefined || v.IN_ORIGEM_VARIABLE === null);
    if (missingOrigin.length > 0) {
        errors.push('Existem entradas em VARIABLE sem IN_ORIGEM_VARIABLE definido. Informe IN_ORIGEM_VARIABLE para cada variável.');
        logger?.('VARIABLE sem IN_ORIGEM_VARIABLE definido no payload');
    }
    return { normalized: normalizedVars, errors };
}
// ─── Bank fields resolution ─────────────────────────────────────────────────
function resolveRequiredBankFields(source, project, lovs, options) {
    const bancos = lovs?.BANCO_EXTERNO ?? [];
    const contextText = [
        source.NO_REST_CUSTOM, source.TX_PATH, source.CO_ESQUEMA, source.CO_TABELA,
        project.NO_PROJETO, project.TX_PATH, project.CO_ESQUEMA, project.CO_TABELA,
    ].map(utils_1.toStringSafe).join(' ');
    const contextTokens = (0, utils_1.extractKeywordTokens)(contextText);
    let selectedBank = bancos[0];
    let selectedSchema;
    let bestScore = -1;
    for (const bank of bancos) {
        const bankText = `${(0, utils_1.toStringSafe)(bank.CO_BANCO_EXTERNO)} ${bank.BANCO_ESQUEMA.map((s) => (0, utils_1.toStringSafe)(s.NO_ESQUEMA)).join(' ')}`;
        const bankNormalized = (0, utils_1.normalizeTextForLookup)(bankText);
        let bankScore = 0;
        for (const token of contextTokens) {
            if (bankNormalized.includes(token)) {
                bankScore += 2;
            }
        }
        for (const schema of bank.BANCO_ESQUEMA) {
            const schemaNormalized = (0, utils_1.normalizeTextForLookup)(schema.NO_ESQUEMA);
            let schemaScore = bankScore;
            for (const token of contextTokens) {
                if (schemaNormalized.includes(token)) {
                    schemaScore += 4;
                }
            }
            if (schemaScore > bestScore) {
                bestScore = schemaScore;
                selectedBank = bank;
                selectedSchema = schema;
            }
        }
        if (!selectedSchema && bank.BANCO_ESQUEMA.length > 0 && bankScore > bestScore) {
            bestScore = bankScore;
            selectedBank = bank;
            selectedSchema = bank.BANCO_ESQUEMA[0];
        }
    }
    if (!selectedBank && bancos.length > 0) {
        selectedBank = bancos[0];
        selectedSchema = selectedBank.BANCO_ESQUEMA[0];
    }
    const ignore = options?.ignoreExplicitBankFields ?? false;
    const resolvedIdBancoExterno = ignore ? (0, utils_1.toNumber)(selectedBank?.ID_BANCO_EXTERNO) : (0, utils_1.toNumber)(source.ID_BANCO_EXTERNO ?? project.ID_BANCO_EXTERNO ?? selectedBank?.ID_BANCO_EXTERNO);
    const resolvedCoBancoExterno = ignore ? (0, utils_1.toStringSafe)(selectedBank?.CO_BANCO_EXTERNO).trim() : (0, utils_1.toStringSafe)(source.CO_BANCO_EXTERNO ?? project.CO_BANCO_EXTERNO ?? selectedBank?.CO_BANCO_EXTERNO).trim();
    const resolvedIdBancoEsquema = ignore ? (0, utils_1.toNumber)(selectedSchema?.ID_BANCO_ESQUEMA) : (0, utils_1.toNumber)(source.ID_BANCO_ESQUEMA ?? project.ID_BANCO_ESQUEMA ?? selectedSchema?.ID_BANCO_ESQUEMA);
    const resolvedNoEsquema = ignore ? (0, utils_1.toStringSafe)(selectedSchema?.NO_ESQUEMA).trim() : (0, utils_1.toStringSafe)(source.NO_ESQUEMA ?? project.NO_ESQUEMA ?? selectedSchema?.NO_ESQUEMA).trim();
    const missing = [];
    if (!(resolvedIdBancoExterno > 0)) {
        missing.push('ID_BANCO_EXTERNO');
    }
    if (!resolvedCoBancoExterno) {
        missing.push('CO_BANCO_EXTERNO');
    }
    if (!(resolvedIdBancoEsquema > 0)) {
        missing.push('ID_BANCO_ESQUEMA');
    }
    if (!resolvedNoEsquema) {
        missing.push('NO_ESQUEMA');
    }
    return {
        ID_BANCO_EXTERNO: resolvedIdBancoExterno > 0 ? resolvedIdBancoExterno : 0,
        CO_BANCO_EXTERNO: resolvedCoBancoExterno,
        ID_BANCO_ESQUEMA: resolvedIdBancoEsquema > 0 ? resolvedIdBancoEsquema : 0,
        NO_ESQUEMA: resolvedNoEsquema,
        missing,
    };
}
// ─── LOVs enrichment ────────────────────────────────────────────────────────
function applyLovDisplayValues(payload, lovs) {
    if (!lovs) {
        return payload;
    }
    const normalized = { ...payload };
    const metodoId = (0, utils_1.toNumber)(normalized.ID_METODO);
    if (metodoId > 0) {
        const metodo = lovs.METODO?.find((item) => item.ID_METODO === metodoId);
        if (metodo) {
            normalized.NO_METODO = metodo.NO_METODO;
        }
    }
    const tipoCodigoId = (0, utils_1.toNumber)(normalized.ID_TIPO_CODIGO);
    if (tipoCodigoId > 0) {
        const tipoCodigo = lovs.TIPO_CODIGO?.find((item) => item.ID_TIPO_CODIGO === tipoCodigoId);
        if (tipoCodigo) {
            normalized.NO_TIPO_CODIGO = tipoCodigo.NO_TIPO_CODIGO;
        }
    }
    const tipoHeaderId = (0, utils_1.toNumber)(normalized.ID_TIPO_HEADER);
    if (tipoHeaderId > 0) {
        const tipoHeader = lovs.TIPO_HEADER?.find((item) => item.ID_TIPO_HEADER === tipoHeaderId);
        if (tipoHeader) {
            normalized.NO_TIPO_HEADER = tipoHeader.NO_TIPO_HEADER;
        }
    }
    const bancoId = (0, utils_1.toNumber)(normalized.ID_BANCO_EXTERNO);
    if (bancoId > 0) {
        const banco = lovs.BANCO_EXTERNO?.find((item) => item.ID_BANCO_EXTERNO === bancoId);
        if (banco) {
            normalized.CO_BANCO_EXTERNO = banco.CO_BANCO_EXTERNO;
            const schemaId = (0, utils_1.toNumber)(normalized.ID_BANCO_ESQUEMA);
            if (schemaId > 0 && !banco.BANCO_ESQUEMA.some((s) => s.ID_BANCO_ESQUEMA === schemaId)) {
                normalized.ID_BANCO_ESQUEMA = '';
            }
        }
    }
    const instanciaId = (0, utils_1.toNumber)(normalized.ID_INSTANCIA);
    if (instanciaId > 0) {
        const instancia = lovs.INSTANCIA?.find((item) => item.ID_INSTANCIA === instanciaId);
        if (instancia) {
            normalized.CO_INSTANCIA = instancia.CO_INSTANCIA;
        }
    }
    if (lovs.PERFIL?.length) {
        const rawProfiles = normalized.TX_PERFIS;
        const profileTokens = Array.isArray(rawProfiles)
            ? rawProfiles.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
            : parseListTokens((0, utils_1.toStringSafe)(rawProfiles));
        const selectedProfiles = lovs.PERFIL.filter((profile) => {
            const profileId = String(profile.ID_PERFIL);
            const normalizedProfileName = (0, utils_1.normalizeTextForLookup)(profile.NO_PERFIL);
            return profileTokens.some((token) => token === profileId || (0, utils_1.normalizeTextForLookup)(token) === normalizedProfileName);
        });
        normalized.TX_PERFIS = selectedProfiles.map((p) => p.NO_PERFIL).join(', ');
        if ('REST_CUSTOM_PERFIL' in normalized) {
            normalized.REST_CUSTOM_PERFIL = selectedProfiles.map((p) => ({ ID_PERFIL: p.ID_PERFIL, NO_PERFIL: p.NO_PERFIL }));
        }
    }
    if (lovs.TIPO_OTP?.length) {
        const rawOtps = normalized.ID_TIPO_OTP;
        const otpTokens = Array.isArray(rawOtps)
            ? rawOtps.map((item) => String(item ?? '').trim()).filter((item) => item.length > 0)
            : parseListTokens((0, utils_1.toStringSafe)(rawOtps));
        const selectedOtps = lovs.TIPO_OTP.filter((otp) => {
            const otpId = String(otp.ID_TIPO_OTP);
            const normalizedOtpName = (0, utils_1.normalizeTextForLookup)(otp.NO_TIPO_OTP);
            return otpTokens.some((token) => token === otpId || (0, utils_1.normalizeTextForLookup)(token) === normalizedOtpName);
        });
        normalized.TX_TIPO_OTP = selectedOtps.map((otp) => otp.NO_TIPO_OTP).join(', ');
        if ('REST_CUSTOM_TIPO_OTP' in normalized) {
            normalized.REST_CUSTOM_TIPO_OTP = selectedOtps.map((otp) => ({ ID_TIPO_OTP: otp.ID_TIPO_OTP, NO_TIPO_OTP: otp.NO_TIPO_OTP }));
        }
    }
    return normalized;
}
function parseListTokens(value) {
    return value.split(/[\n,;]+/).map((t) => t.trim()).filter((t) => t.length > 0);
}
// ─── Compact endpoint (remove JSON_SCHEMA) ──────────────────────────────────
function compactEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== 'object') {
        return endpoint;
    }
    const { REST_CUSTOM_JSON_SCHEMA, ...rest } = endpoint;
    return rest;
}
function compactProject(project) {
    if (!project || typeof project !== 'object') {
        return project;
    }
    const restCustom = Array.isArray(project.REST_CUSTOM)
        ? project.REST_CUSTOM.map(compactEndpoint)
        : [];
    return { ...project, REST_CUSTOM: restCustom };
}
