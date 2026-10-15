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
- `js/data-service.js`: sincronizacao com o Supabase e leitura dos dados remotos anteriores.
- `supabase/schema.sql`: tabelas e politicas iniciais de seguranca por usuario.
- `supabase/migrate-shared-organization.sql`: migração para compartilhar os dados entre colaboradores.
- `supabase/migrate-central-license-state.sql`: base central com gravacao atomica e controle de versao.
- `supabase/migrate-default-organization.sql`: acesso automatico das contas cadastradas a uma unica organizacao.

## Como atualizar os dados

1. Abra `data/licencas.js`.
2. Inclua ou altere os registros dentro de `window.DEFAULT_DATA`.
3. Preserve os campos existentes em cada licenca.
4. Mantenha `activities: []` quando a licenca nao tiver atividades.
5. Abra `Controle_Licencas_Solinftec.html` no navegador.

O painel organiza os dados em unidades, tipos de processo, processos e etapas. A lista exibida e uma projecao compativel desse modelo estruturado.

Os perfis de unidade exibem informacoes gerais, caracteristicas operacionais e dados de seguranca/AVCB. O fluxo transversal da planilha e aplicado como conjunto de etapas padrao para cada unidade.

Use o seletor **Por licença** para acompanhar cada processo individualmente ou **Por unidade** para consultar o perfil do local, suas obrigações e todos os processos relacionados.

### Cadastro de unidades

O painel abre em **Por unidade**. O cadastro e independente das licencas: unidades sem processos tambem aparecem, com a opcao de criar a primeira licenca.

O catalogo inicial de `data/fluxo.js` contem oito unidades: Fabrica, NY Tower, Concordia e NetZero Farm (Aracatuba/SP), Balsas (Balsas/MA), LEM (Luis Eduardo Magalhaes/BA), Sinop (Sinop/MT) e Querencia (Querencia/MT). Os registros existentes sao preservados; unidades iniciais ausentes sao acrescentadas uma unica vez, e o catalogo e persistido junto ao modelo na proxima gravacao. Nao e necessaria nova migracao SQL.

Use **+ Nova unidade** para cadastrar nome, cidade e UF e **Editar unidade** no card para corrigir esses campos. Nomes repetidos nao sao aceitos. As licencas vinculadas passam a exibir o novo nome/localidade sem perder o vinculo com o ID da unidade.

Em **Editar unidade**, tambem e possivel alterar o perfil completo: razao social, CNPJ, endereco, atividade ambiental, atividades conduzidas, ocupacao, area, extintores, hidrantes, SPDA e alarme. O perfil completo pode ser consultado no proprio card da visao por unidade. Valores apagados permanecem vazios, sem restaurar os dados da planilha. A edicao preserva campos adicionais e atualiza razao social, CNPJ e endereco nas licencas vinculadas.

### Comprovantes do OneDrive

Na unidade e no card de cada licenca, use **+ Vincular comprovante**. Informe um nome e cole o link de um arquivo ou pasta existente no OneDrive. Cada registro pode ter varios vinculos independentes, que podem ser editados, abertos em nova aba e removidos. Remover um vinculo NAO exclui o arquivo.

Sao aceitos links HTTPS de `1drv.ms`, `onedrive.live.com` e subdominios corporativos de `sharepoint.com` (OneDrive empresarial). Outros enderecos sao recusados com mensagem de erro. O painel nao faz upload, nao copia arquivos e nao altera permissoes: configure o compartilhamento no OneDrive para as pessoas que precisam consultar os comprovantes. Todos os colaboradores com acesso a base veem os links, mas apenas quem tiver permissao no OneDrive consegue abrir os arquivos. Nao use links com acesso publico se o comprovante for restrito.

Os vinculos e perfis sao salvos no modelo central existente, sem nova migracao SQL ou integracao com Microsoft Graph. Aguarde **sincronizado** antes de fechar a pagina.

Ao criar uma licenca, selecione uma unidade cadastrada. Cidade e UF sao preenchidas automaticamente e devem ser alteradas no cadastro da unidade, nao individualmente na licenca. O botao **+ Nova licenca** de cada unidade ja seleciona esse cadastro. Excluir a ultima licenca nao exclui a unidade.

Filtros por status/risco mostram apenas unidades com licencas correspondentes. Sem esses filtros, as unidades vazias continuam visiveis; podem ser buscadas por nome, cidade ou UF. O cadastro usa a mesma sincronizacao e protecao contra conflitos das licencas. **Restaurar dados** tambem restaura o catalogo padrao, removendo cadastros personalizados da base compartilhada apos confirmacao.

No modo central, o Supabase e a fonte oficial dos dados. **Sincronizado** significa que o servidor confirmou a gravacao. As outras maquinas consultam atualizacoes a cada 15 segundos (com a pagina visivel e sem um campo em edicao), ao voltar para a janela ou ao clicar em **Sincronizar**.

Cada gravacao envia o modelo completo em uma unica transacao, com controle de versao. Se duas pessoas alterarem a mesma versao, a segunda gravacao sera recusada em vez de sobrescrever o trabalho da primeira. Nesse caso, exporte o relatorio para preservar suas alteracoes, clique em **Carregar servidor** e reaplique as alteracoes necessarias.

Alteracoes nao enviadas ficam como rascunho local, separado por usuario e organizacao, e sao recuperadas no proximo acesso nesse navegador. Clique em **Sincronizar** para tentar novamente. Rascunhos nao sao enviados automaticamente apos uma falha. Nao limpe o armazenamento do navegador antes de sincronizar ou exportar suas pendencias.

O botao **Restaurar dados** substitui a base de TODOS os colaboradores da organizacao pelos registros padrao. Ha uma confirmacao antes da operacao.

## Como configurar o Supabase

1. Crie um projeto gratuito no Supabase.
2. Execute `supabase/schema.sql` no SQL Editor.
3. Execute `supabase/migrate-shared-organization.sql` no SQL Editor.
4. Execute `supabase/migrate-central-license-state.sql` no SQL Editor.
5. Confira a URL do projeto e a chave publicavel/anon em `data/supabase-config.js`. Nunca use uma chave `service_role` no navegador. Mantenha `required: true` para impedir o fallback silencioso para o modo local quando o CDN ou a conexao falharem.
6. Em **Authentication > Users**, crie os usuarios que acessarao o painel.
7. Em **Authentication > Sign In / Providers**, desative **Allow new users to sign up** (cadastro publico) e login anonimo. O nome/local desta opcao pode variar no painel. Confirme que o cadastro publico esta desativado antes de continuar.
8. Execute `supabase/migrate-default-organization.sql` conforme a secao abaixo.
9. Publique o projeto pelo GitHub Pages seguindo a seção abaixo.

### Uma organizacao para todas as contas cadastradas

Apos aplicar `supabase/migrate-default-organization.sql`, basta criar ou convidar a pessoa em **Authentication > Users**. No primeiro login, o servidor vincula a conta como `member` a organizacao oficial. Ela podera consultar, adicionar, editar e excluir licencas, independentemente do dominio do e-mail. O login continua obrigatorio; contas anonimas nao sao aceitas. Novos membros nao ganham administracao dos vinculos.

**Esta regra abrange todas as contas nao anonimas do projeto Supabase**, inclusive contas existentes e as criadas por outros provedores de login. Use um projeto dedicado a este painel e mantenha o cadastro publico desativado. A migracao SQL nao altera as configuracoes do Supabase Auth nem distingue uma conta criada pelo administrador de uma conta criada por cadastro publico. Desative tambem provedores de login que possam criar contas sem sua aprovacao. Para revogar acesso, desative/exclua a conta em Authentication; remover apenas seu vinculo nao basta, pois o login o recriara.

Antes de executar a migracao, consulte as bases existentes:

```sql
select o.id, o.name, u.email as criada_por,
       s.revision as revisao_central,
       jsonb_array_length(s.model->'processes') as licencas_centrais
from public.organizations o
left join auth.users u on u.id = o.created_by
left join public.organization_license_state s on s.organization_id = o.id
order by o.created_at, o.id;
```

- Se houver uma unica organizacao, ela sera utilizada.
- Se houver varias, o script para sem alterar dados. No inicio do bloco `do`, substitua `selected_org uuid := null;` pelo UUID da base oficial e execute novamente. Nao escolha apenas pelo nome: nomes podem se repetir.
- Se nao houver organizacoes, crie primeiro sua conta em Authentication. O script cria a organizacao e usa a conta nao anonima mais antiga como owner inicial.
- As contas existentes recebem vinculo com a base oficial durante a migracao. Os vinculos e dados das outras organizacoes nao sao apagados nem mesclados; revise/exporte pendencias antes da troca.
- A escolha fica em `public.app_organization`, acessivel apenas administrativamente. O painel passa a utilizar essa base, mesmo quando o usuario tinha um vinculo mais antigo com outra organizacao. Sair e entrar novamente/recarregar todas as abas e necessario para abandonar IDs de organizacao em cache.
- O script pode ser reexecutado: preserva a escolha anterior e os papeis existentes. Nao reexecute a migracao antiga de organizacao compartilhada depois dele, pois ela restauraria a selecao anterior por usuario.

### Atualizar uma instalacao existente

1. Preserve os dados locais: no painel antigo, exporte um relatorio antes da atualizacao. Nao limpe o navegador. Interrompa as edicoes e feche as abas antigas de todos os colaboradores durante a migracao.
2. Execute apenas as migracoes ainda nao aplicadas, na ordem acima. Nao reexecute `schema.sql` em uma instalacao compartilhada: ele recria as politicas antigas por usuario.
3. Publique a nova versao e feche/recarregue as abas da versao antiga em todas as maquinas.
4. Entre no painel. No primeiro acesso da organizacao, os dados existentes nas tabelas antigas sao lidos e copiados para `public.organization_license_state`. Essas tabelas nao sao apagadas; depois da migracao, novas edicoes ficam somente na base central.
5. Se suas licencas existiam apenas no navegador, entre usando o MESMO navegador e endereco do site e clique em **Importar dados locais**. A importacao substitui a base central inteira, exige confirmacao e deve ser feita uma unica vez pelo responsavel pela base. Ela nao mescla automaticamente cadastros de maquinas diferentes.
6. Confirme **sincronizado**, abra o painel em outra maquina com um membro da mesma organizacao e confira os dados. Teste uma nova licenca e uma edicao.

Se faltar uma migracao, permissao ou conexao, o painel mostra o erro e nao abre silenciosamente uma base local no lugar da base central. A chave publica permite usar a API, mas NAO permite administrar o banco ou aplicar migracoes; esses passos exigem acesso administrativo ao painel do Supabase.

## Como usar

Use o endereco publicado para a base compartilhada. Para usar explicitamente o modo local, remova a URL/chave e defina `required: false` na configuracao. Nesse modo o indicador informa **salvo so neste navegador**. A variante em `azure/` e independente e nao foi alterada por esta integracao Supabase.

## Testes

Com Node.js instalado, execute `node --test test\sync.test.cjs`. Os testes usam um servidor simulado e cobrem o cliente e a persistencia do painel; a migracao SQL deve ser aplicada e validada no projeto Supabase antes do uso em producao.

Depois de aplicar a migracao de organizacao unica, execute `supabase/test/default-organization.sql` no SQL Editor. Ele verifica o vinculo de duas contas novas a mesma base, preservacao de vinculos/owners e bloqueio anonimo. O teste usa uma transacao com `rollback`, sem manter contas ou organizacoes de teste. Se ocorrer erro, execute `rollback;` antes de continuar. Valide tambem dois logins reais no painel e que o cadastro publico esta desativado.

## Publicar no GitHub Pages

1. Crie um repositorio no GitHub e envie todo este projeto.
2. Mantenha `index.html` na raiz do repositorio.
3. Acesse **Settings > Pages** e selecione **GitHub Actions** como fonte.
4. Envie a branch `main` ou execute manualmente o workflow `Deploy to GitHub Pages`.
5. Compartilhe a URL exibida em **Settings > Pages**.

O workflow publica somente os arquivos necessários da aplicação. Planilhas, PDF, SQL e a pasta Azure/SharePoint não são enviados para o site público.
