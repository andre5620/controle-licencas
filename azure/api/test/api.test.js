'use strict';
/*
 * Testes da API contra o emulador Azurite (Table Storage).
 * Rodar: npx azurite-table --silent &  e depois  npm test
 */
const test = require('node:test');
const assert = require('node:assert');
const { TableClient } = require('@azure/data-tables');
const store = require('../src/lib/store');
const { handleList, handleSave, handleDelete } = require('../src/lib/handlers');

const CONN = process.env.AZURITE_CONN || 'UseDevelopmentStorage=true';
const table = TableClient.fromConnectionString(CONN, 'licencasteste' + Date.now(), { allowInsecureConnection: true });
store.setClient(table);

const ctx = { log() {}, error() {} };
const principal = Buffer.from(JSON.stringify({ identityProvider: 'aad', userId: 'abc', userDetails: 'pessoa.teste@empresa.com', userRoles: ['anonymous', 'authenticated'] })).toString('base64');

function req({ id, body, etag, auth = true }) {
  const headers = new Map();
  if (auth) headers.set('x-ms-client-principal', principal);
  if (etag) headers.set('if-match', etag);
  return {
    params: { id },
    headers: { get: k => headers.get(k.toLowerCase()) ?? null },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

const lic = { id: 'L-900', unidade: 'Fábrica', status: 'Pendente', risco: 'Alto', vencimento: '2027-04-22',
  activities: [{ name: 'Alinhamento', status: 'Done', date: '2026-02-15', observacao: '' }], campoExtra: 'ignorar' };

test.before(async () => { await table.createTable(); });
test.after(async () => { await table.deleteTable(); });

test('recusa sem login', async () => {
  assert.equal((await handleList(req({ auth: false }), ctx)).status, 401);
  assert.equal((await handleSave(req({ id: 'L-900', body: lic, auth: false }), ctx)).status, 401);
});

test('valida entrada', async () => {
  assert.equal((await handleSave(req({ id: 'L/1', body: lic }), ctx)).status, 400);
  assert.equal((await handleSave(req({ id: 'L-900', body: { ...lic, status: 'Hackeado' } }), ctx)).status, 400);
  assert.equal((await handleSave(req({ id: 'L-900', body: { ...lic, vencimento: '22/04/2027' } }), ctx)).status, 400);
  assert.equal((await handleSave(req({ id: 'L-900', body: '{nao json' }), ctx)).status, 400);
});

test('cria, lista, protege edição simultânea e exclui', async () => {
  const created = await handleSave(req({ id: 'L-900', body: lic }), ctx);
  assert.equal(created.status, 201);
  assert.equal(created.jsonBody.updatedBy, 'pessoa.teste@empresa.com');
  assert.equal(created.jsonBody.campoExtra, undefined);
  const etag1 = created.jsonBody.etag;

  assert.equal((await handleSave(req({ id: 'L-900', body: lic }), ctx)).status, 409, 'criar duplicado');

  const list = await handleList(req({}), ctx);
  assert.equal(list.jsonBody.licencas.length, 1);
  assert.equal(list.jsonBody.licencas[0].activities[0].status, 'Done');

  const upd = await handleSave(req({ id: 'L-900', body: { ...lic, status: 'Obtida' }, etag: etag1 }), ctx);
  assert.equal(upd.status, 200);
  const stale = await handleSave(req({ id: 'L-900', body: { ...lic, status: 'Dispensada' }, etag: etag1 }), ctx);
  assert.equal(stale.status, 412, 'edição com versão antiga deve ser recusada');

  assert.equal((await handleDelete(req({ id: 'L-900' }), ctx)).status, 428);
  assert.equal((await handleDelete(req({ id: 'L-900', etag: etag1 }), ctx)).status, 412);
  assert.equal((await handleDelete(req({ id: 'L-900', etag: upd.jsonBody.etag }), ctx)).status, 204);
  assert.equal((await handleList(req({}), ctx)).jsonBody.licencas.length, 0);
});

test('aceita os 13 registros atuais da planilha', async () => {
  global.window = {};
  require('../../scripts/dados-iniciais.js');
  const { validateLicense } = require('../src/lib/validation');
  for (const r of global.window.DEFAULT_DATA) validateLicense(r, r.id);
});
