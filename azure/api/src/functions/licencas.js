'use strict';

const { app } = require('@azure/functions');
const { handleList, handleSave, handleDelete } = require('../lib/handlers');

// GET /api/licencas
app.http('listarLicencas', {
  methods: ['GET'],
  authLevel: 'anonymous', // a autenticação é feita pelo Static Web Apps + Entra ID
  route: 'licencas',
  handler: handleList
});

// PUT /api/licencas/{id}   (If-Match: <etag> para atualizar; sem If-Match para criar)
app.http('salvarLicenca', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'licencas/{id}',
  handler: handleSave
});

// DELETE /api/licencas/{id}   (If-Match: <etag>)
app.http('excluirLicenca', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'licencas/{id}',
  handler: handleDelete
});
