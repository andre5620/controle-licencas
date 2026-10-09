'use strict';

/*
 * O Static Web Apps autentica o usuário no Entra ID e repassa a identidade
 * para o back-end vinculado no cabeçalho x-ms-client-principal (base64 JSON).
 * A Function App só aceita chamadas vindas do Static Web Apps (configurado
 * automaticamente ao vincular o back-end), então este cabeçalho é confiável.
 * Mesmo assim, recusamos qualquer chamada sem usuário autenticado.
 */
function getUser(request) {
  const header = request.headers.get('x-ms-client-principal');
  if (!header) return null;
  try {
    const principal = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    const roles = principal.userRoles || [];
    if (!roles.includes('authenticated')) return null;
    return {
      id: String(principal.userId || ''),
      name: String(principal.userDetails || '').slice(0, 120),
      roles
    };
  } catch {
    return null;
  }
}

module.exports = { getUser };
