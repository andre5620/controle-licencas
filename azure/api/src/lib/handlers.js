'use strict';

const store = require('./store');
const { getUser } = require('./auth');
const { validateLicense, validateId, rowKeyFor, ValidationError } = require('./validation');

const MAX_BODY_BYTES = 64 * 1024;
const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
};

const json = (status, body) => ({ status, headers: SECURITY_HEADERS, jsonBody: body });
const error = (status, message) => json(status, { erro: message });

function unauthorized() { return error(401, 'Faça login com sua conta da Solinftec.'); }

/* Erros do Table Storage -> respostas HTTP sem expor detalhes internos. */
function storeError(err, context) {
  const code = err && err.statusCode;
  if (code === 409) return error(409, 'Já existe uma licença com esse ID.');
  if (code === 412) return error(412, 'Outra pessoa alterou esta licença. Recarregue para ver a versão atual.');
  if (code === 404) return error(404, 'Licença não encontrada.');
  context.error('Falha no armazenamento', { status: code, message: err && err.message });
  return error(500, 'Não foi possível concluir a operação. Tente novamente.');
}

async function handleList(request, context) {
  const user = getUser(request);
  if (!user) return unauthorized();
  try {
    return json(200, { licencas: await store.listLicenses() });
  } catch (err) {
    return storeError(err, context);
  }
}

async function handleSave(request, context) {
  const user = getUser(request);
  if (!user) return unauthorized();

  let license;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return error(413, 'Licença grande demais para salvar.');
    let body;
    try { body = JSON.parse(raw); } catch { return error(400, 'JSON inválido.'); }
    license = validateLicense(body, request.params.id);
  } catch (err) {
    if (err instanceof ValidationError) return error(400, err.message);
    throw err;
  }

  const etag = request.headers.get('if-match') || undefined;
  try {
    const saved = await store.saveLicense(rowKeyFor(license.id), license, user.name, etag);
    context.log('Licença salva', { id: license.id, por: user.id });
    return json(etag ? 200 : 201, saved);
  } catch (err) {
    return storeError(err, context);
  }
}

async function handleDelete(request, context) {
  const user = getUser(request);
  if (!user) return unauthorized();
  let id;
  try { id = validateId(request.params.id); } catch (err) { return error(400, err.message); }
  const etag = request.headers.get('if-match');
  if (!etag) return error(428, 'Informe a versão da licença (If-Match) para excluir.');
  try {
    await store.deleteLicense(rowKeyFor(id), etag);
    context.log('Licença excluída', { id, por: user.id });
    return { status: 204, headers: SECURITY_HEADERS };
  } catch (err) {
    return storeError(err, context);
  }
}

module.exports = { handleList, handleSave, handleDelete };
