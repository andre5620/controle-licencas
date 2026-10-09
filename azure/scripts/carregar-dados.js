'use strict';
/*
 * Carga inicial: grava as licenças de dados-iniciais.js na tabela do Azure.
 * Usa o seu login do Azure CLI (az login); nenhuma chave é necessária.
 * Licenças que já existem na tabela NÃO são sobrescritas.
 *
 * Uso (na pasta azure/api, após npm install):
 *   node ../scripts/carregar-dados.js https://<conta>.table.core.windows.net
 */
const path = require('path');
const apiDir = path.join(__dirname, '..', 'api');
const { TableClient } = require(require.resolve('@azure/data-tables', { paths: [apiDir] }));
const { DefaultAzureCredential } = require(require.resolve('@azure/identity', { paths: [apiDir] }));
const { validateLicense, rowKeyFor } = require(path.join(apiDir, 'src', 'lib', 'validation'));

async function main() {
  const endpoint = process.argv[2];
  if (!endpoint || !/^https:\/\/[a-z0-9]+\.table\.core\.windows\.net\/?$/.test(endpoint)) {
    console.error('Informe o endpoint da tabela, ex.: https://stlicencasxxxx.table.core.windows.net');
    process.exit(1);
  }
  global.window = {};
  require('./dados-iniciais.js');
  const records = global.window.DEFAULT_DATA || [];

  const client = new TableClient(endpoint, 'licencas', new DefaultAzureCredential());
  let created = 0, skipped = 0;
  for (const record of records) {
    const license = validateLicense(record, record.id);
    try {
      await client.createEntity({
        partitionKey: 'licenca',
        rowKey: rowKeyFor(license.id),
        data: JSON.stringify(license),
        updatedBy: 'carga inicial',
        updatedAt: new Date().toISOString()
      });
      created++;
    } catch (err) {
      if (err.statusCode === 409) { skipped++; continue; }
      throw err;
    }
  }
  console.log(`Concluído: ${created} licenças criadas, ${skipped} já existiam.`);
}

main().catch(err => { console.error('Falha na carga:', err.message); process.exit(1); });
