# Controle de Licenças no Azure

Versão compartilhada do painel de licenças regulatórias. Os funcionários entram com a **conta Microsoft da Solinftec** (Entra ID), e as edições ficam salvas para todos. Ninguém precisa de licença do Claude.

## Como funciona

```
Navegador ──login Entra ID──▶ Static Web App (site do painel)
                                 │ back-end vinculado (só o site chama a API)
                                 ▼
                             Function App (API /api/licencas)
                                 │ identidade gerenciada, sem chaves
                                 ▼
                             Table Storage (tabela "licencas")
```

| Pasta | Conteúdo |
|---|---|
| `web/` | O painel (HTML, CSS e JS) e `staticwebapp.config.json` (login e cabeçalhos de segurança). |
| `api/` | API Node.js 20 (Azure Functions v4): listar, salvar e excluir licenças, mais os testes. |
| `infra/` | Infraestrutura como código (Bicep). |
| `scripts/` | Carga inicial das 13 licenças atuais (`dados-iniciais.js`). |
| `pipeline/azure-deploy.yml` | Testes e publicação automática via GitHub Actions. Mova para `.github/workflows/` na raiz do repositório. |

## Segurança

- **Acesso só pelo IAM corporativo:** só entra quem estiver atribuído ao aplicativo no Entra ID (de preferência por um grupo). A API recusa chamadas sem usuário autenticado.
- **Sem chaves nem senhas no código:**
  - a conta de armazenamento tem as chaves de acesso **desligadas** (`allowSharedKeyAccess: false`);
  - a API acessa os dados com **identidade gerenciada**;
  - o segredo do login fica no **Key Vault**, e o site guarda só uma referência a ele;
  - a publicação usa **OIDC**, sem segredos guardados no GitHub.
- **Menor privilégio:**
  - a API só pode gravar na tabela `licencas` (Storage Table Data Contributor no escopo da tabela);
  - o site só pode **ler** segredos do Key Vault;
  - a publicação por FTP e por usuário/senha está desligada.
- **Validação no servidor (OWASP):**
  - só os campos conhecidos são aceitos;
  - há limites de tamanho e de valores possíveis, datas validadas e erros que não expõem detalhes internos.
  - O site envia CSP, HSTS, X-Frame-Options e nosniff.
- **Edições simultâneas:** cada gravação leva a versão (ETag) da licença. Se outra pessoa salvou antes, a API recusa a gravação (HTTP 412) e o painel recarrega a versão atual. Ninguém sobrescreve o trabalho do outro sem saber.
- **Auditoria:** cada licença guarda quem fez a última alteração e quando. Os logs da API vão para o Application Insights.

## Implantação (para a TI)

Pré-requisitos: Azure CLI 2.60 ou mais recente, Node.js 20 e acesso de **Owner** (ou Contributor + Role Based Access Control Administrator) no grupo de recursos.

### 1. Criar a infraestrutura

```bash
az login
az group create --name rg-controle-licencas --location brazilsouth

# Confirme que a região escolhida oferece Functions Flex Consumption:
az functionapp list-flexconsumption-locations --query "[].name" -o tsv

az deployment group create \
  --resource-group rg-controle-licencas \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam
```

Anote as saídas: `siteUrl`, `loginCallbackUrl`, `keyVaultName`, `tablesEndpoint`, `functionAppName` e `staticWebAppName`.

> O Static Web Apps só existe em algumas regiões (`swaLocation`, padrão `eastus2`). Ele serve apenas os arquivos do site. Os **dados e a API ficam na região do grupo de recursos** (por exemplo, `brazilsouth`).

### 2. Registrar o login no Entra ID

```bash
APP_ID=$(az ad app create \
  --display-name "Controle de Licenças Regulatórias" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "<loginCallbackUrl>" \
  --enable-id-token-issuance true \
  --query appId -o tsv)

az ad sp create --id "$APP_ID"
# Só entra quem for atribuído ao aplicativo:
az ad sp update --id "$APP_ID" --set appRoleAssignmentRequired=true

# Guardar ID e segredo no Key Vault, sem exibir o segredo no terminal
# (quem roda precisa da função Key Vault Secrets Officer no cofre):
az keyvault secret set --vault-name <keyVaultName> --name entra-client-id --value "$APP_ID" -o none
az ad app credential reset --id "$APP_ID" --display-name static-web-app --years 1 --query password -o tsv \
  | az keyvault secret set --vault-name <keyVaultName> --name entra-client-secret --file /dev/stdin -o none
```

Em `web/staticwebapp.config.json`, troque `[PLACEHOLDER-TENANT-ID]` pelo ID do tenant da Solinftec (`az account show --query tenantId -o tsv`).

> O segredo vence em 1 ano. Coloque a renovação no calendário da TI e repita o último comando para gerar um novo segredo.

### 3. Liberar o acesso das pessoas

1. Crie um grupo no Entra ID, por exemplo `GRP-Controle-Licencas`, e adicione os colegas.
2. No portal do Azure, abra **Entra ID > Aplicativos empresariais > Controle de Licenças Regulatórias > Usuários e grupos > Adicionar atribuição** e escolha o grupo.

Para incluir ou tirar alguém daqui em diante, basta alterar o grupo. A mudança vale no próximo login da pessoa.

### 4. Publicar o site e a API

**Pelo GitHub Actions (recomendado):**

1. Crie um aplicativo de deploy no Entra com **credencial federada** para o repositório (branch `main`, ambiente `producao`).
2. Dê a ele as funções **Contributor** e **Role Based Access Control Administrator** no grupo de recursos.
3. Copie `pipeline/azure-deploy.yml` para `.github/workflows/` na raiz do repositório e preencha as variáveis listadas no topo do arquivo.
4. Cada push na `main` roda os testes e publica a infraestrutura, a API e o site.

**Manual (primeira vez ou teste):**

```bash
cd api && npm install --omit=dev
func azure functionapp publish <functionAppName>        # Azure Functions Core Tools v4
cd ..
TOKEN=$(az staticwebapp secrets list -n <staticWebAppName> -g rg-controle-licencas --query properties.apiKey -o tsv)
npx @azure/static-web-apps-cli@2.0.2 deploy web --env production --deployment-token "$TOKEN"
```

### 5. Carregar as licenças atuais (uma vez)

A pessoa que roda a carga precisa de acesso **temporário** à tabela:

```bash
ME=$(az ad signed-in-user show --query id -o tsv)
SCOPE=$(az storage account show -n <storageAccountName> -g rg-controle-licencas --query id -o tsv)/tableServices/default/tables/licencas
az role assignment create --assignee "$ME" --role "Storage Table Data Contributor" --scope "$SCOPE"

cd api && npm install && node ../scripts/carregar-dados.js <tablesEndpoint>

# Remova o acesso depois da carga:
az role assignment delete --assignee "$ME" --role "Storage Table Data Contributor" --scope "$SCOPE"
```

O script não sobrescreve licenças que já existam na tabela.

## Desenvolvimento local

```bash
cd api
npm install
npx -p azurite azurite-table --silent --location ./.azurite &   # emulador do Table Storage
npm test
```

Os testes cobrem quatro situações:

- chamadas sem login são recusadas;
- dados inválidos são rejeitados;
- o fluxo completo de criar, listar, atualizar e excluir funciona;
- a proteção contra edições simultâneas funciona.

Também confirmam que as 13 licenças atuais passam na validação.

## Custos

| Recurso | Como é cobrado |
|---|---|
| Static Web Apps **Standard** | Valor fixo por mês. É o plano exigido para login próprio do Entra e back-end vinculado. |
| Functions **Flex Consumption** | Por uso. Para poucas dezenas de usuários, o consumo tende a ficar dentro da franquia gratuita. |
| Table Storage, Key Vault e Application Insights | Por uso, com custo baixo neste volume. |

Use a [calculadora de preços do Azure](https://azure.microsoft.com/pricing/calculator/) para o valor atual na região escolhida.

## Diferenças em relação à versão local

- **Onde ficam os dados:** as edições vão para o Azure, não para o navegador de cada pessoa.
- **Restaurar dados:** o botão foi removido, porque apagaria o trabalho de todos.
- **Excluir licença:** a exclusão some para todos e não pode ser desfeita.
- **Atualização automática:** o painel busca as alterações dos colegas a cada 30 segundos e quando a aba volta a ficar visível.
- **IDs das licenças:** aceitam até 40 caracteres, só com letras, números, espaço, ponto, hífen ou sublinhado.
- **Obrigações ambientais de Concórdia:** passaram a aparecer. O nome da unidade com acento impedia a ligação com a planilha.
