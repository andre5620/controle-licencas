# Changelog

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

## [1.7.0] - 2026-10-15

### Cadastro de unidades

- Visão por unidade como tela inicial, incluindo unidades sem licenças.
- Catálogo inicial de oito unidades com cidade e UF; cadastro e edição compartilhados no painel.
- Seleção de unidade na nova licença, com cidade e UF automáticas.
- Preservação dos cadastros ao excluir licenças e atualização dos processos vinculados ao editar a unidade.

## [1.6.0] - 2026-10-15

### Base central de licenças

- Gravação atômica do modelo por organização no Supabase, com controle de versão contra sobrescritas concorrentes.
- Atualização dos demais painéis a cada 15 segundos quando o usuário não está editando.
- Indicador de sincronização real, repetição manual, recuperação de rascunhos por usuário/organização e importação explícita dos dados locais antigos.
- Bloqueio do fallback silencioso para uma base local quando o modo central é obrigatório.
- Migração SQL e instruções para ativação e compartilhamento entre colaboradores.
- Organização oficial única para contas cadastradas, com vínculo automático no login e preservação das bases e vínculos anteriores.

## [1.5.0] - 2026-10-09

### Autenticação

- Login por e-mail e senha usando Supabase Auth.
- Exibição do usuário autenticado e ação de logout.
- Bloqueio do painel até existir uma sessão quando o Supabase estiver configurado.
- Organização compartilhada e políticas RLS para colaboradores.

## [1.4.0] - 2026-10-09

### Integração Supabase

- Camada opcional de persistência remota com Supabase Free.
- Schema inicial com unidades, tipos de processo, processos, etapas, obrigações ambientais e documentos.
- Políticas iniciais de Row Level Security por usuário autenticado.
- Fallback automático para `localStorage` quando o Supabase não estiver configurado ou disponível.

## [1.3.0] - 2026-10-08

### Visualização

- Painel agrupado por unidade com perfil, obrigações ambientais e processos relacionados.
- Navegação entre os painéis por unidade e por licença.
- Acesso direto de um processo no painel de unidade para a licença correspondente.

## [1.2.0] - 2026-10-08

### Adicionado

- Modelo estruturado inicial com unidades, tipos de processo, processos e etapas.
- Perfis de unidade extraidos da planilha, com informacoes gerais, caracteristicas operacionais e dados de seguranca/AVCB.
- Obrigacoes ambientais da tabela 3 vinculadas a cada unidade.
- Fluxo transversal de 21 etapas aplicado como padrao por unidade.
- Tipos de processo reutilizaveis com etapas padrao e copia das etapas para cada processo.
- Migracao transparente dos dados legados e persistencia do modelo estruturado.

## [1.1.0] - 2026-08-17

### Alterações

- Número de versão da aplicação (`APP_VERSION`), exibido no rodapé da tela.
- Este arquivo de changelog para registrar futuras alterações.

## [1.0.0]

- Versão inicial: painel de controle de licenças regulatórias com filtros, edição, persistência local, atividades e exportação de relatório.
