# Changelog

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

## [1.12.0] - 2026-10-19

### Atividades da planilha ligadas ao fluxograma

- Ao aplicar o fluxo de Licenças na licença de Licenciamento Ambiental, as atividades da aba da unidade (Fábrica, Balsas, LEM, Sinop e Querência) são importadas com responsável, status, prazo e observação, cada uma ligada a uma etapa do fluxograma.
- Uma etapa do fluxograma é concluída quando todas as suas atividades estão concluídas; etapas sem item na planilha recebem uma atividade própria.
- Coluna "Etapa do fluxo" na tabela de atividades para religar uma atividade a outra etapa.
- Diagrama em raias (Sustentabilidade, Áreas internas, Fiscal) com o andamento de cada etapa, na página da unidade e no card da licença.
- Botão "Importar atividades da planilha" para licenças que já seguiam o fluxo.
- Dispensas requeridas ao órgão seguem o caminho completo do fluxograma.
- Endereços de CSS e scripts carregam o número da versão para que o navegador baixe todos os arquivos novos juntos.

## [1.11.1] - 2026-10-19

### Correção

- Cada unidade passa a exibir o controle de etapas da sua própria aba da planilha, em vez do fluxo transversal copiado para todas.
- Tabela com etapa, ação, responsável (por área), status, prazo e observação na página da unidade.
- Unidades sem tabela própria mostram o fluxo transversal apenas como referência; a cópia antiga é substituída uma única vez.

## [1.11.0] - 2026-10-19

### Fluxograma de Licenças e Outorgas

- Fluxos guiados "Regulatório Licenças" e "Regulatório Outorgas", com etapas por área responsável e decisões do fluxograma (jurisdição, dispensa, taxa, resultado do órgão).
- Pendência volta ao envio sem repetir o pagamento; indeferimento reinicia o processo pela etapa de consultoria ou de alternativas de abastecimento.
- Botão "Aplicar fluxo" nas licenças existentes, preservando as atividades atuais; histórico de decisões e novo ciclo de renovação.
- Novos status: Em análise, Indeferida e Não aplicável; status de atividade N/A.
- Aba Calendário com o ciclo mensal de vencimentos e janela de renovação configurável por licença.

## [1.10.0] - 2026-10-15

### Exclusão de unidades

- Exclusão pela página completa, com confirmação e bloqueio enquanto houver licenças vinculadas.
- Preservação dos arquivos no OneDrive e tratamento de pendências e conflitos na sincronização.

## [1.9.0] - 2026-10-15

### Páginas de unidades

- Cards resumidos com acesso à página completa de cada unidade.
- Links diretos por ID, preservados ao recarregar e navegar pelo histórico.
- Perfil, indicadores, comprovantes, obrigações, fluxo padrão e edição de licenças na mesma página.
- Filtros globais não limitam as informações da página completa.

## [1.8.0] - 2026-10-15

### Perfil e comprovantes

- Edição do perfil completo na visão por unidade, preservando campos adicionais e valores apagados.
- Vínculos de arquivos e pastas do OneDrive independentes por unidade e por licença, com inclusão, edição e remoção.
- Validação de links HTTPS da Microsoft e abertura sem alterar permissões ou enviar arquivos.

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
