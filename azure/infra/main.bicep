// =============================================================================
// Controle de Licenças Regulatórias — infraestrutura no Azure
//
//  Navegador ──login Entra ID──▶ Static Web App (site)
//                                   │  back-end vinculado (só o SWA chama)
//                                   ▼
//                               Function App (API, identidade gerenciada)
//                                   │  RBAC: Storage Table Data Contributor
//                                   ▼            (somente na tabela "licencas")
//                               Storage Account (Table Storage, sem chaves)
//
// Princípios: sem chaves de acesso (allowSharedKeyAccess = false), identidades
// gerenciadas, menor privilégio por escopo, segredo do Entra no Key Vault.
// =============================================================================

targetScope = 'resourceGroup'

@description('Prefixo curto usado nos nomes dos recursos (3 a 11 letras minúsculas/números).')
@minLength(3)
@maxLength(11)
param prefixo string = 'licencas'

@description('Região dos dados e da API.')
param location string = resourceGroup().location

@description('Região do Static Web App (o serviço só existe em algumas regiões).')
@allowed([ 'eastus2', 'centralus', 'westus2', 'westeurope', 'eastasia' ])
param swaLocation string = 'eastus2'

@description('Tags aplicadas a todos os recursos.')
param tags object = {
  sistema: 'controle-licencas'
  area: 'governanca-ambiental'
  gerenciadoPor: 'bicep'
}

var sufixo = uniqueString(resourceGroup().id)
var storageName = take('st${prefixo}${sufixo}', 24)
var tableName = 'licencas'
var deployContainer = 'pacote-api'

// IDs de funções internas do Azure (RBAC)
var roleStorageBlobDataOwner = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var roleStorageTableDataContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
var roleMonitoringMetricsPublisher = '3913510d-42f4-4e42-8a64-420c390055eb'
var roleKeyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'

// ---------------------------------------------------------------- Observabilidade
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${prefixo}-${sufixo}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 90
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${prefixo}-${sufixo}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: true // telemetria só com identidade do Entra
  }
}

// ---------------------------------------------------------------- Armazenamento
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_ZRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false // nenhuma chave de conta: só identidades do Entra
    defaultToOAuthAuthentication: true
    publicNetworkAccess: 'Enabled'
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 14 }
  }
}

resource deployBlob 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deployContainer
  properties: { publicAccess: 'None' }
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource table 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableService
  name: tableName
}

// ---------------------------------------------------------------- API (Functions)
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'asp-${prefixo}-${sufixo}'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func-${prefixo}-${sufixo}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deployContainer}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: { name: 'node', version: '20' }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'TABLES_ENDPOINT', value: storage.properties.primaryEndpoints.table }
        { name: 'TABLE_NAME', value: tableName }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'APPLICATIONINSIGHTS_AUTHENTICATION_STRING', value: 'Authorization=AAD' }
      ]
    }
  }
}

// Desliga publicação por usuário/senha (FTP e SCM); o deploy usa o Entra (OIDC).
resource apiFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: api
  name: 'ftp'
  properties: { allow: false }
}
resource apiScm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: api
  name: 'scm'
  properties: { allow: false }
}

// ---------------------------------------------------------------- Permissões (menor privilégio)
// Host do Functions e pacote de deploy: blobs da conta.
resource apiBlobOwner 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, api.id, roleStorageBlobDataOwner)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageBlobDataOwner)
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Dados das licenças: somente a tabela "licencas".
resource apiTableContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(table.id, api.id, roleStorageTableDataContributor)
  scope: table
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleStorageTableDataContributor)
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource apiTelemetry 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(appInsights.id, api.id, roleMonitoringMetricsPublisher)
  scope: appInsights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleMonitoringMetricsPublisher)
    principalId: api.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------- Segredo do login (Key Vault)
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take('kv-${prefixo}-${sufixo}', 24)
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: 'Enabled'
  }
}

// ---------------------------------------------------------------- Site (Static Web Apps)
resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: 'swa-${prefixo}-${sufixo}'
  location: swaLocation
  tags: tags
  sku: { name: 'Standard', tier: 'Standard' } // necessário para login Entra próprio e back-end vinculado
  identity: { type: 'SystemAssigned' }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Disabled'
  }
}

resource siteVaultReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, site.id, roleKeyVaultSecretsUser)
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleKeyVaultSecretsUser)
    principalId: site.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// O ID do aplicativo e o segredo do Entra ficam no Key Vault; o site só guarda referências.
resource siteSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    AZURE_CLIENT_ID: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/entra-client-id)'
    AZURE_CLIENT_SECRET: '@Microsoft.KeyVault(SecretUri=${vault.properties.vaultUri}secrets/entra-client-secret)'
  }
  dependsOn: [ siteVaultReader ]
}

// Back-end vinculado: o Azure configura a Function App para aceitar só chamadas do site.
resource backend 'Microsoft.Web/staticSites/linkedBackends@2023-12-01' = {
  parent: site
  name: 'api'
  properties: {
    backendResourceId: api.id
    region: location
  }
}

// ---------------------------------------------------------------- Saídas
output siteUrl string = 'https://${site.properties.defaultHostname}'
output loginCallbackUrl string = 'https://${site.properties.defaultHostname}/.auth/login/aad/callback'
output staticWebAppName string = site.name
output functionAppName string = api.name
output storageAccountName string = storage.name
output tablesEndpoint string = storage.properties.primaryEndpoints.table
output keyVaultName string = vault.name
