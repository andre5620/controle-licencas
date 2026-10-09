'use strict';

/*
 * Acesso ao Azure Table Storage com a identidade gerenciada da Function App
 * (DefaultAzureCredential). Nenhuma chave ou connection string é usada.
 */

const PARTITION = 'licenca';
let client = null;

function getClient() {
  if (client) return client;
  const { TableClient } = require('@azure/data-tables');
  const { DefaultAzureCredential } = require('@azure/identity');
  const endpoint = process.env.TABLES_ENDPOINT;   // ex.: https://<conta>.table.core.windows.net
  const table = process.env.TABLE_NAME || 'licencas';
  if (!endpoint) throw new Error('Configuração TABLES_ENDPOINT ausente.');
  client = new TableClient(endpoint, table, new DefaultAzureCredential());
  return client;
}

/* Permite injetar um cliente falso nos testes. */
function setClient(c) { client = c; }

function toDto(entity) {
  const data = JSON.parse(entity.data);
  return {
    ...data,
    updatedBy: entity.updatedBy || '',
    updatedAt: entity.updatedAt || '',
    etag: entity.etag
  };
}

async function listLicenses() {
  const items = [];
  const iter = getClient().listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } });
  for await (const entity of iter) items.push(toDto(entity));
  items.sort((a, b) => String(a.id).localeCompare(String(b.id), 'pt-BR', { numeric: true }));
  return items;
}

/*
 * Concorrência otimista:
 *  - sem etag  -> só cria (falha com 409 se já existir);
 *  - com etag  -> só atualiza se ninguém alterou depois (falha com 412).
 */
async function saveLicense(rowKey, license, user, etag) {
  const entity = {
    partitionKey: PARTITION,
    rowKey,
    data: JSON.stringify(license),
    updatedBy: user,
    updatedAt: new Date().toISOString()
  };
  const c = getClient();
  const res = etag
    ? await c.updateEntity(entity, 'Replace', { etag })
    : await c.createEntity(entity);
  return { ...license, updatedBy: entity.updatedBy, updatedAt: entity.updatedAt, etag: res.etag };
}

async function deleteLicense(rowKey, etag) {
  await getClient().deleteEntity(PARTITION, rowKey, { etag: etag || '*' });
}

module.exports = { listLicenses, saveLicense, deleteLicense, setClient };
