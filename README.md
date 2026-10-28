# Controle de Licencas Solinftec

Painel web para acompanhamento de licencas regulatorias.

## Estrutura

- `Controle_Licencas_Solinftec.html`: tela principal e estrutura da pagina.
- `css/styles.css`: estilos, responsividade e regras de impressao.
- `data/licencas.js`: registros padrao usados na inicializacao e na migracao do modelo estruturado.
- `data/fluxo.js`: perfis, fluxo transversal e controle de etapas de cada unidade extraidos de `Controle de etapas - Fluxo.xlsx` (responsaveis indicados por area).
- `data/fluxos-processo.js`: fluxogramas de Licencas e de Outorgas (Sustentabilidade, v1.0), com etapas, areas responsaveis e decisoes.
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

Os perfis de unidade exibem informacoes gerais, caracteristicas operacionais e dados de seguranca/AVCB.

**Fluxo da unidade:** a pagina da unidade mostra o diagrama do fluxograma de cada licenca da unidade que segue um fluxo. O diagrama e dividido em raias (Sustentabilidade, Areas internas, Fiscal) e indica, em cada etapa, quantas atividades ja foram concluidas. O controle de etapas da aba de cada unidade na planilha vira atividades da licenca (veja "Fluxo do processo").

### Navegacao

- **Abas de visao:** logo abaixo do cabecalho ficam as abas **Unidades · Licencas · Calendario · Gantt** (setas do teclado trocam de aba). A aba aparece no endereco (`#view=unidades`, `#view=licencas`, `#view=calendario`, `#view=gantt`), funciona com Voltar/Avancar e pode ser compartilhada. Os enderecos antigos `#units`, `#licenses` e `#calendar` continuam aceitos. Sem aba no endereco, o painel abre na ultima aba usada neste navegador (apenas preferencia de interface).
- **Requer acao:** na aba Licencas, com a ordem padrao **Urgencia**, a lista e dividida em "Requer acao" (vencidas, dentro da janela de renovacao ou risco alto em aberto) e "Demais licencas". As vencidas aparecem primeiro, da mais atrasada para a menos. O seletor **Ordenar** tambem oferece Vencimento, ID e Unidade, sem agrupamento.
- **Unidades:** os cards sao ordenados pela unidade com mais licencas que requerem acao e mostram o selo "X requerem acao".
- **Indicadores clicaveis:** clicar em um indicador (Obtidas, Pendentes, Vencidas, Risco alto) filtra a lista de licencas; clicar de novo, em "Licencas no escopo" ou em **Limpar filtros** remove o filtro. Ele se combina com os filtros de unidade, status, risco e busca. Na pagina da unidade, os indicadores filtram "Licencas da unidade".
- **Prazos:** os selos mostram o prazo em linguagem humana ("Vence em 45 dias", "Vence em ~8 meses", "Vencida ha ~4 meses"); a data exata aparece ao passar o mouse.
- **Cabecalho:** ficam visiveis **+ Nova licenca**, **+ Nova unidade**, **Exportar relatorio** e o indicador de sincronizacao. **Sincronizar**, **Carregar servidor**, **Importar dados locais**, **Restaurar dados** e **Sair** ficam no menu **⋯ Mais**.
- **Faixa de sincronizacao:** com alteracoes pendentes, uma faixa abaixo do cabecalho avisa que elas ainda nao estao disponiveis para a equipe e oferece **Sincronizar agora**. Em caso de erro, a faixa fica vermelha com **Tentar novamente** (ou **Carregar servidor**, em conflito). No modo local, a faixa informa que os dados ficam so neste navegador.
- **Celular (ate 640px):** cabecalho compacto com as acoes no menu **⋯ Mais**, indicadores em faixa com rolagem lateral, filtros recolhidos em **Filtros (n)** e **+ Nova licenca** como botao flutuante.

### Edicao das licencas

Ao expandir uma licenca, os dados aparecem em modo leitura. Clique em **Editar licenca** para alterar; as mudancas so valem ao clicar em **Salvar** (ou `Ctrl+Enter`). **Cancelar** (ou `Esc`) descarta. Apenas uma licenca fica em edicao por vez, e o painel pede confirmacao antes de descartar alteracoes nao salvas. A tabela de atividades continua editavel diretamente.

### Atividades, prazos e subatividades

- A tabela **Atividades / etapas** tem as colunas **Data** (a data de referencia usada no Gantt, no calendario e na planilha), **Inicio** e **Fim**. A data fim nao pode ser anterior a de inicio.
- **Alerta de prazo:** uma atividade (ou subatividade) com **Fim** no passado e status diferente de `Done`/`N/A` fica destacada em vermelho com o selo **⚠ Atrasada ha X dias**. O cabecalho do card mostra **⚠ N atividades fora do prazo**, mesmo com o card fechado (passe o mouse para ver quais). O relatorio inclui essas atividades em "Atividades travadas ou em atraso".
- **Subatividades:** clique em **▸ Subatividades** abaixo do nome da atividade para abrir a lista. Cada subatividade tem nome, responsavel, status, inicio e fim. Quando a atividade tem subatividades, o status dela passa a ser calculado: `Done` quando todas estao concluidas (ou `N/A`), `Stuck` se alguma estiver travada, `Working on it` se alguma ja comecou. O botao mostra o progresso (ex.: "Subatividades 2/5").
- **Concluir etapa** no fluxo tambem conclui as subatividades pendentes; **Iniciar novo ciclo** as reabre.

Dentro da licenca, o perfil da unidade aparece resumido, com o link **Ver/editar perfil da unidade →**. O perfil so e editado na pagina da unidade.

No formulario **+ Nova licenca**, o ID e gerado automaticamente (proximo `L-NNN` livre) e pode ser alterado em **alterar**. Unidade, tipo de licenca, orgao emissor e status sao obrigatorios; os erros aparecem no proprio formulario.

**Desfazer e confirmacoes:** remover um vinculo de comprovante e concluir as atividades de uma etapa valem na hora e mostram um aviso com **Desfazer** por 8 segundos; a gravacao acontece quando o aviso expira (ou antes, se outra alteracao for gravada, ao sincronizar, sair ou fechar a pagina). Exclusoes e acoes que afetam toda a base (novo ciclo, restaurar, importar, descartar pendencias) continuam pedindo confirmacao, em uma janela do proprio painel.

### Cadastro de unidades

O painel abre na aba **Unidades**. O cadastro e independente das licencas: unidades sem processos tambem aparecem, com a opcao de criar a primeira licenca.

Os cards exibem um resumo. Use **Abrir unidade** para acessar uma pagina completa com perfil (em modo leitura), indicadores, comprovantes do OneDrive, obrigacoes ambientais (tabela com obrigacao, orgao, numero, status e prazo), fluxo da unidade (diagrama) e todas as licencas da unidade. Status e prazo de uma obrigacao vem da licenca da unidade com o mesmo orgao e tipo; dispensas sem licenca correspondente aparecem como *Dispensada*. Quando nenhuma licenca segue o fluxograma, a pagina oferece botoes **Aplicar fluxo de Licencas/Outorgas na L-0XX**; unidades sem licencas mostram **+ Criar primeira licenca**. Edicao de perfil, criacao de licenca e edicao de atividades continuam disponiveis nessa pagina.

Na pagina completa, **Excluir unidade** remove o cadastro apos confirmacao, somente se nao houver licencas vinculadas (independentemente dos filtros). Remova ou transfira as licencas antes de excluir. A exclusao afeta todos os colaboradores e remove perfil, obrigacoes e vinculos de comprovantes da unidade, mas nunca apaga arquivos do OneDrive. Unidades do catalogo inicial excluidas nao sao recriadas ao recarregar; **Restaurar dados** pode restaura-las. Em caso de falha de rede, a exclusao fica pendente neste navegador e pode ser reenviada por **Sincronizar**; conflitos continuam protegidos pelo controle de versao.

Cada unidade tem um link direto no formato `Controle_Licencas_Solinftec.html#unit=ID`. E possivel compartilhar esse endereco, recarregar a pagina e usar Voltar/Avancar do navegador sem perder a unidade selecionada. O acesso continua exigindo login e permissao na organizacao; um ID inexistente mostra uma mensagem, sem abrir outra unidade. **Voltar as unidades** retorna aos cards, preservando os filtros da lista.

Na pagina completa, os filtros e indicadores globais ficam ocultos: os indicadores sao calculados somente para a unidade e suas licencas nao ficam limitadas pelos filtros da lista anterior. Os cards de licenca podem ser expandidos nessa mesma tela. Nao ha mudanca no armazenamento ou necessidade de migracao SQL.

O catalogo inicial de `data/fluxo.js` contem oito unidades: Fabrica, NY Tower, Concordia e NetZero Farm (Aracatuba/SP), Balsas (Balsas/MA), LEM (Luis Eduardo Magalhaes/BA), Sinop (Sinop/MT) e Querencia (Querencia/MT). Os registros existentes sao preservados; unidades iniciais ausentes sao acrescentadas uma unica vez, e o catalogo e persistido junto ao modelo na proxima gravacao. Nao e necessaria nova migracao SQL.

Use **+ Nova unidade** para cadastrar nome, cidade e UF e **Editar unidade** no card para corrigir esses campos. Nomes repetidos nao sao aceitos. As licencas vinculadas passam a exibir o novo nome/localidade sem perder o vinculo com o ID da unidade.

Em **Editar unidade**, tambem e possivel alterar o perfil completo: razao social, CNPJ, endereco, atividade ambiental, atividades conduzidas, ocupacao, area, extintores, hidrantes, SPDA e alarme. O perfil completo pode ser consultado na pagina da unidade. Valores apagados permanecem vazios, sem restaurar os dados da planilha. A edicao preserva campos adicionais e atualiza razao social, CNPJ e endereco nas licencas vinculadas.

### Comprovantes do OneDrive

Na unidade e no card de cada licenca, use **+ Vincular comprovante**. Informe um nome e cole o link de um arquivo ou pasta existente no OneDrive. Cada registro pode ter varios vinculos independentes, que podem ser editados, abertos em nova aba e removidos (com **Desfazer** por 8 segundos). Remover um vinculo NAO exclui o arquivo.

Sao aceitos links HTTPS de `1drv.ms`, `onedrive.live.com` e subdominios corporativos de `sharepoint.com` (OneDrive empresarial). Outros enderecos sao recusados com mensagem de erro. O painel nao faz upload, nao copia arquivos e nao altera permissoes: configure o compartilhamento no OneDrive para as pessoas que precisam consultar os comprovantes. Todos os colaboradores com acesso a base veem os links, mas apenas quem tiver permissao no OneDrive consegue abrir os arquivos. Nao use links com acesso publico se o comprovante for restrito.

Os vinculos e perfis sao salvos no modelo central existente, sem nova migracao SQL ou integracao com Microsoft Graph. Aguarde **sincronizado** antes de fechar a pagina.

### Fluxo do processo (Licencas e Outorgas)

Cada licenca pode seguir um dos fluxogramas da Sustentabilidade: **Regulatorio Licencas** ou **Regulatorio Outorgas**. Ao aplicar o fluxo, as etapas sao criadas na tabela de atividades com a area responsavel de cada raia (Sustentabilidade, Areas internas, Fabrica/Facilities, Fiscal/Financeiro).

- Novas licencas recebem o fluxo escolhido no formulario. O fluxo de Outorgas e sugerido quando a categoria ou o tipo menciona "outorga".
- Licencas ja cadastradas mostram o botao **Aplicar fluxo**. Ele acrescenta as etapas no inicio da tabela e mantem as atividades existentes.
- **Atividades da planilha:** na licenca de *Licenciamento Ambiental* de Fabrica, Balsas, LEM, Sinop e Querencia, aplicar o fluxo de Licencas importa o controle de etapas da aba da unidade.
  - Cada item vira uma atividade com responsavel (por area, sem nomes de pessoas), status, prazo e observacao.
  - Cada atividade fica ligada a uma etapa do fluxograma. Por exemplo, Estatuto, Contrato e IPTU ficam em "Reunir e enviar documentos".
  - Etapas sem item na planilha recebem uma atividade propria. As que ficaram para tras de uma etapa ja concluida sao marcadas como concluidas.
  - As decisoes iniciais (Brasil; licenca ou certidao de dispensa a requerer) sao preenchidas.
  - Licencas que ja seguiam o fluxo mostram **Importar atividades da planilha**.
  - Outorgas e as demais licencas usam as etapas genericas.
- Uma etapa do fluxograma fica concluida quando todas as suas atividades estao `Done` ou `N/A`. A coluna **Etapa do fluxo** da tabela de atividades permite religar uma atividade a outra etapa.
- O card mostra a etapa atual, as atividades pendentes dela e o diagrama em raias. Use **Concluir etapa**, que conclui as atividades pendentes da etapa na hora (com **Desfazer** por 8 segundos), ou altere o status de cada atividade na tabela.
- Nas decisoes do fluxograma, escolha a resposta pelos botoes. Cada resposta fica registrada no historico do fluxo:
  - **Jurisdicao (Brasil)**: "Nao" encerra o fluxo com status *Nao aplicavel*.
  - **Licenca exigida ou dispensa**: "Exigida" vale para licenca ou certidao de dispensa a requerer ao orgao (caminho completo); "Dispensa sem requerimento" cria a etapa de registro da dispensa e marca a licenca como *Dispensada*.
  - **Ha taxa aplicavel?** (Outorgas): "Nao" marca o pagamento como `N/A`.
  - **Resultado do orgao**:
    - *Emitida* muda o status para *Obtida*.
    - *Pendencia* cria a etapa "Atender a pendencia" e volta ao envio. As etapas de boleto e pagamento ja concluidas nao sao repetidas.
    - *Indeferida* cria a etapa de consultoria/juridico (Licencas) ou de alternativas de abastecimento (Outorgas) e reinicia o processo a partir do acesso ao sistema do orgao.
- Ao chegar na espera pela emissao, a licenca passa automaticamente para *Em analise*.
- Depois de concluido, **Iniciar novo ciclo** volta as etapas para "Nao iniciado" na proxima renovacao, preservando o historico.

Os status *Em analise*, *Indeferida* e *Nao aplicavel* foram acrescentados. Os dados do fluxo ficam no modelo central existente, sem nova migracao SQL.

### Calendario (ciclo mensal)

A aba **Calendario** reproduz o inicio dos fluxogramas: consultar o calendario de vencimentos e verificar se a janela esta aberta. A janela de renovacao abre 120 dias antes do vencimento. O prazo pode ser alterado no campo **Janela de renovacao (dias)** de cada licenca.

Para o mes selecionado, o painel separa:

- licencas com a janela aberta (acao neste ciclo);
- licencas vencidas;
- licencas que aguardam o proximo ciclo;
- licencas sem data de vencimento.

Cada item mostra a etapa atual do fluxo e abre a licenca. Os filtros de unidade, status, risco e busca tambem se aplicam ao calendario.

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

**Atencao:** `azure/web/` e uma copia antiga do painel (anterior as versoes com Supabase, fluxograma e as melhorias de interface da 1.13.0) e nao recebe as atualizacoes da raiz. O site publicado pelo GitHub Pages usa os arquivos da raiz. O pipeline `azure/pipeline/azure-deploy.yml` publica `azure/web` como esta; atualize essa copia antes de usa-lo.

## Testes

Com Node.js instalado, execute `node --test test\sync.test.cjs`. Os testes usam um servidor simulado e cobrem o cliente, a persistencia e as regras de interface (ordenacao por urgencia, filtros rapidos, modo leitura, Desfazer, rotas das abas, validacao da nova licenca); a migracao SQL deve ser aplicada e validada no projeto Supabase antes do uso em producao.

Depois de aplicar a migracao de organizacao unica, execute `supabase/test/default-organization.sql` no SQL Editor. Ele verifica o vinculo de duas contas novas a mesma base, preservacao de vinculos/owners e bloqueio anonimo. O teste usa uma transacao com `rollback`, sem manter contas ou organizacoes de teste. Se ocorrer erro, execute `rollback;` antes de continuar. Valide tambem dois logins reais no painel e que o cadastro publico esta desativado.

## Publicar no GitHub Pages

1. Crie um repositorio no GitHub e envie todo este projeto.
2. Mantenha `index.html` na raiz do repositorio.
3. Acesse **Settings > Pages** e selecione **GitHub Actions** como fonte.
4. Envie a branch `main` ou execute manualmente o workflow `Deploy to GitHub Pages`.
5. Compartilhe a URL exibida em **Settings > Pages**.

A cada nova versão, atualize `APP_VERSION` em `js/app.js` e o sufixo `?v=` dos arquivos CSS/JS em `Controle_Licencas_Solinftec.html`. Assim o navegador baixa todos os arquivos novos juntos, sem misturar versões em cache.

O workflow publica somente os arquivos necessários da aplicação. Planilhas, PDF, SQL e a pasta Azure/SharePoint não são enviados para o site público.
