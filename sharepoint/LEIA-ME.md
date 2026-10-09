# Controle de Licenças no SharePoint (Microsoft Lists)

Versão gratuita e compartilhada do painel. Ela usa só o que a Solinftec já tem no Microsoft 365: listas do SharePoint (Microsoft Lists).

- **Acesso:** os colegas entram com a conta Microsoft da empresa.
- **Edições:** várias pessoas podem editar ao mesmo tempo.
- **Histórico:** cada alteração fica registrada no histórico de versões, com quem fez e quando.
- **Custo e permissões:** não há custo extra e não é preciso pedir nada à TI.

## Arquivos

| Arquivo | Vira a lista | Conteúdo |
|---|---|---|
| `1_Licencas.xlsx` | **Licenças** | As 13 licenças, com status, risco, datas e notas. |
| `2_Atividades.xlsx` | **Atividades** | As 34 atividades/etapas, cada uma ligada à licença pela coluna "Licença". |
| `3_Unidades.xlsx` | **Unidades** | O perfil das 8 unidades e as obrigações ambientais. |
| `4_Fluxo_Padrao.xlsx` | **Fluxo Padrão** | As 21 etapas do fluxo transversal (referência). |
| `formatacao/*.json` | — | Cores das colunas Status, Risco, Vencimento e Status da atividade. |

## Passo a passo (cerca de 20 minutos)

### 1. Escolher onde criar

Prefira um **site do SharePoint da sua equipe**, onde você seja membro. A lista pertence ao site, e não a você. Se não houver um, use **Microsoft Lists > Minhas listas**. Nesse caso, a lista fica no seu OneDrive e você a compartilha com os colegas.

### 2. Criar as listas a partir do Excel

Para cada arquivo, nesta ordem (1, 2, 3, 4):

1. No site, clique em **+ Novo > Lista > Do Excel** e envie o arquivo.
2. Na tela de revisão, ajuste o tipo das colunas:

| Lista | Coluna | Tipo |
|---|---|---|
| Licenças | Risco | **Escolha** (NA, Baixo, Médio, Alto) |
| Licenças | Status | **Escolha** (Pendente, Condicionada, Obtida, Dispensada) |
| Licenças | Data de Emissão, Vencimento | **Data** |
| Licenças | Notas | **Várias linhas de texto** |
| Atividades | Status | **Escolha** (Não iniciado, Em andamento, Travado, Concluído) |
| Atividades | Data | **Data** |
| Atividades | Ordem | **Número** |
| Atividades | Observação | **Várias linhas de texto** |
| Unidades | Obrigações Ambientais, Endereço | **Várias linhas de texto** |

3. Dê nomes às listas: **Licenças**, **Atividades**, **Unidades** e **Fluxo Padrão**.

### 3. Aplicar as cores (opcional, recomendado)

Na lista, clique no cabeçalho da coluna e vá em **Configurações da coluna > Formatar esta coluna > Modo avançado**. Cole o conteúdo do arquivo correspondente e salve:

| Coluna | Arquivo |
|---|---|
| Licenças › Status | `formatacao/status-licenca.json` |
| Licenças › Risco | `formatacao/risco.json` |
| Licenças › Vencimento | `formatacao/vencimento.json` (mostra "Vence em Xd" ou "Vencida há Xd") |
| Atividades › Status | `formatacao/status-atividade.json` |

### 4. Criar os modos de exibição

São o equivalente às telas do painel:

- **Por unidade** (Licenças): **+ Adicionar modo de exibição > Lista**, depois **Agrupar por > Unidade**.
- **Agenda de vencimentos** (Licenças): **+ Adicionar modo de exibição > Calendário**, usando a coluna **Vencimento**.
- **Quadro por status** (Licenças e Atividades): **+ Adicionar modo de exibição > Quadro**, organizado por **Status**.
- **Atividades por licença** (Atividades): **Agrupar por > Licença**, com ordenação por **Ordem**.
- **Vencendo em 120 dias** (Licenças): filtro **Vencimento é menor que [Hoje]+120**.

### 5. Compartilhar com os colegas

Na lista, use **Compartilhar** ou **Configurações > Permissões**:

- dê **Editar** a quem atualiza as licenças;
- dê **Exibir** a quem só consulta.

Para remover alguém, tire a pessoa das permissões. Se o site já tiver os colegas como membros, eles já têm acesso.

### 6. Lembretes de vencimento (opcional)

Na lista Licenças, clique no cabeçalho **Vencimento** e escolha **Automatizar > Definir um lembrete**. Defina, por exemplo, **120 dias antes**. O Power Automate manda um e-mail ao responsável. Isso usa só recursos já incluídos no Microsoft 365. Se a opção não aparecer, o Power Automate está bloqueado na sua conta e esse passo pode ser pulado.

## O que muda em relação ao painel HTML

- **Atividades:** ficam numa lista separada. Para ver as de uma licença, filtre ou agrupe pela coluna **Licença**.
- **Relatório:** em vez de "Exportar relatório", use **Exportar > Exportar para Excel** em qualquer modo de exibição, ou imprima a página pelo navegador.
- **Gantt:** o modo de exibição Calendário substitui o Gantt. Para um Gantt de verdade, dá para conectar um gráfico do Excel à lista depois.
- **Status das atividades:** os valores foram traduzidos de "Working on it", "Stuck" e "Done" para Em andamento, Travado e Concluído.
- **Concórdia:** o nome da unidade foi padronizado com acento, o mesmo usado nas licenças.

## Cuidados

- **Dados sensíveis:** as listas têm CNPJs, endereços e nomes de pessoas (Responsável e Observação). Compartilhe só com quem precisa. Evite links do tipo "qualquer pessoa com o link".
- **Lista pessoal:** se você usar **Minhas listas**, transfira a lista para um site da equipe antes de mudar de função. Assim os dados não ficam presos à sua conta.
