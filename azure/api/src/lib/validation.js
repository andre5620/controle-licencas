'use strict';

/*
 * Validação de entrada (OWASP: nunca confiar no cliente).
 * Só os campos conhecidos são aceitos; o resto é descartado.
 */

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._\-]{0,39}$/;

const STRING_FIELDS = {
  unidade: 120, cidade: 120, uf: 2, razaoSocial: 200, endereco: 300, cnpj: 18,
  categoria: 120, orgaoEmissor: 120, tipoLicenca: 200, nProcesso: 80,
  owner: 120, notes: 4000, lastUpdated: 120
};
const ENUMS = {
  risco: ['NA', 'Baixo', 'Médio', 'Alto'],
  status: ['Pendente', 'Condicionada', 'Obtida', 'Dispensada']
};
const ACTIVITY_STATUS = ['Não iniciado', 'Working on it', 'Stuck', 'Done'];
const ACTIVITY_FIELDS = { name: 200, owner: 120, observacao: 1000 };
const MAX_ACTIVITIES = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}

function str(value, max, field) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError(`Campo "${field}" deve ser texto.`);
  if (value.length > max) throw new ValidationError(`Campo "${field}" excede ${max} caracteres.`);
  return value.trim();
}

function date(value, field) {
  const v = str(value, 10, field);
  if (v && (!DATE_PATTERN.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) {
    throw new ValidationError(`Campo "${field}" deve estar no formato AAAA-MM-DD.`);
  }
  return v;
}

function enumValue(value, allowed, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new ValidationError(`Valor inválido para "${field}".`);
  return value;
}

function validateId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new ValidationError('ID inválido. Use até 40 caracteres: letras, números, espaço, ponto, hífen ou sublinhado.');
  }
  return id;
}

/* RowKey do Table Storage não aceita / \ # ? nem caracteres de controle. */
function rowKeyFor(id) {
  return encodeURIComponent(id).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%/g, '~');
}

function validateLicense(body, idFromRoute) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Corpo da requisição deve ser um objeto JSON.');
  }
  const id = validateId(idFromRoute);
  if (body.id !== undefined && body.id !== id) throw new ValidationError('O ID do corpo não corresponde ao da URL.');

  const out = { id };
  for (const [field, max] of Object.entries(STRING_FIELDS)) out[field] = str(body[field], max, field);
  out.uf = out.uf.toUpperCase();
  out.risco = enumValue(body.risco, ENUMS.risco, 'risco', 'NA');
  out.status = enumValue(body.status, ENUMS.status, 'status', 'Pendente');
  out.dataEmissao = date(body.dataEmissao, 'dataEmissao');
  out.vencimento = date(body.vencimento, 'vencimento');

  const acts = body.activities === undefined ? [] : body.activities;
  if (!Array.isArray(acts)) throw new ValidationError('"activities" deve ser uma lista.');
  if (acts.length > MAX_ACTIVITIES) throw new ValidationError(`Máximo de ${MAX_ACTIVITIES} atividades por licença.`);
  out.activities = acts.map((a, i) => {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new ValidationError(`Atividade ${i + 1} inválida.`);
    const act = {};
    for (const [field, max] of Object.entries(ACTIVITY_FIELDS)) act[field] = str(a[field], max, `atividade ${i + 1}: ${field}`);
    act.status = enumValue(a.status, ACTIVITY_STATUS, `atividade ${i + 1}: status`, 'Não iniciado');
    act.date = date(a.date, `atividade ${i + 1}: data`);
    return act;
  });
  return out;
}

module.exports = { validateLicense, validateId, rowKeyFor, ValidationError };
