# Changelog

Todas as alterações relevantes deste projeto serão documentadas neste arquivo.

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
