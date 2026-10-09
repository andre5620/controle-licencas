# Controle de Licencas Solinftec

Painel web para acompanhamento de licencas regulatorias.

## Estrutura

- `Controle_Licencas_Solinftec.html`: tela principal e estrutura da pagina.
- `css/styles.css`: estilos, responsividade e regras de impressao.
- `data/licencas.js`: registros padrao usados na inicializacao e na migracao do modelo estruturado.
- `data/fluxo.js`: fluxo transversal e perfis das unidades extraidos de `Controle de etapas - Fluxo.xlsx`.
- `data/licencas_planilha.js`: obrigacoes ambientais da tabela 3 por unidade.
- `data/supabase-config.js`: URL e chave publica opcionais do Supabase.
- `js/app.js`: filtros, edicao, persistencia, atividades e relatorio.
- `js/data-service.js`: sincronizacao opcional com o Supabase, mantendo o fallback local.
- `supabase/schema.sql`: tabelas e politicas iniciais de seguranca por usuario.
- `supabase/migrate-shared-organization.sql`: migração para compartilhar os dados entre colaboradores.

## Como atualizar os dados

1. Abra `data/licencas.js`.
2. Inclua ou altere os registros dentro de `window.DEFAULT_DATA`.
3. Preserve os campos existentes em cada licenca.
4. Mantenha `activities: []` quando a licenca nao tiver atividades.
5. Abra `Controle_Licencas_Solinftec.html` no navegador.

O painel organiza os dados em unidades, tipos de processo, processos e etapas. A lista exibida e uma projecao compativel desse modelo estruturado.

Os perfis de unidade exibem informacoes gerais, caracteristicas operacionais e dados de seguranca/AVCB. O fluxo transversal da planilha e aplicado como conjunto de etapas padrao para cada unidade.

Use o seletor **Por licença** para acompanhar cada processo individualmente ou **Por unidade** para consultar o perfil do local, suas obrigações e todos os processos relacionados.

As edicoes feitas pelo painel sao sempre salvas no armazenamento do navegador. Quando `data/supabase-config.js` estiver preenchido e o usuario estiver autenticado, elas tambem serao sincronizadas com o Supabase. O botao **Restaurar dados** retorna aos registros definidos em `data/licencas.js`.

## Como configurar o Supabase

1. Crie um projeto gratuito no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Execute `supabase/migrate-shared-organization.sql` no SQL Editor.
4. Copie a URL do projeto e a chave anon/public para `data/supabase-config.js`.
5. Em **Authentication > Users**, crie os usuarios que acessarao o painel.
6. Publique o projeto pelo GitHub Pages seguindo a seção abaixo.

O login por e-mail ja esta integrado ao painel. O primeiro usuario cria automaticamente a organizacao inicial. Para incluir os demais colaboradores, use o comando comentado no final de `supabase/migrate-shared-organization.sql`.

## Como usar

Abra o arquivo `Controle_Licencas_Solinftec.html` diretamente no navegador para usar o modo local. Para sincronizacao remota, e necessaria uma conexao com o CDN do Supabase e a configuracao descrita acima.

## Publicar no GitHub Pages

1. Crie um repositorio no GitHub e envie todo este projeto.
2. Mantenha `index.html` na raiz do repositorio.
3. Acesse **Settings > Pages** e selecione **GitHub Actions** como fonte.
4. Envie a branch `main` ou execute manualmente o workflow `Deploy to GitHub Pages`.
5. Compartilhe a URL exibida em **Settings > Pages**.

O workflow publica somente os arquivos necessários da aplicação. Planilhas, PDF, SQL e a pasta Azure/SharePoint não são enviados para o site público.
