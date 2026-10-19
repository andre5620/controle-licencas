/* Padrões extraídos de Controle de etapas - Fluxo.xlsx.
   flowTemplate: aba "Fluxo Transversal" (referência geral).
   unitFlows: tabela de etapas da aba de cada unidade; responsáveis indicados por área. */
window.SPREADSHEET_REFERENCE = {
  unitCatalog: [
    {nome: 'Fábrica', cidade: 'Araçatuba', uf: 'SP'},
    {nome: 'NY Tower', cidade: 'Araçatuba', uf: 'SP'},
    {nome: 'Concórdia', cidade: 'Araçatuba', uf: 'SP'},
    {nome: 'NetZero Farm', cidade: 'Araçatuba', uf: 'SP'},
    {nome: 'Balsas', cidade: 'Balsas', uf: 'MA'},
    {nome: 'LEM', cidade: 'Luís Eduardo Magalhães', uf: 'BA'},
    {nome: 'Sinop', cidade: 'Sinop', uf: 'MT'},
    {nome: 'Querência', cidade: 'Querência', uf: 'MT'}
  ],
  source: 'Controle de etapas - Fluxo.xlsx',
  flowTemplate: [
    'Estatuto Social Tecsoil (atualizado)',
    'Contrato de locação (ou matrícula, se próprio)',
    'Procuração atualizada (para o representante ou consultoria)',
    'Documento pessoal + comprovante de endereço do responsável legal',
    'Telefone do responsável legal',
    'IPTU (capa e contracapa) ou código do imóvel',
    'Planta baixa',
    'Relatório fotográfico (fachada, frente, internas)',
    'Certidão Negativa de Débitos Municipais (CND)',
    'Certificado do Corpo de Bombeiros ou CCBM, se exigido',
    'Formulário autodeclaratório, quando aplicável',
    'PGRS, quando aplicável',
    'MTR, quando aplicável',
    'Insumos, fichas técnicas e composição de materiais, quando aplicável',
    'Emissão de guia ou taxa municipal',
    'Pagamento dentro do prazo aplicável',
    'Protocolo no sistema',
    'Acompanhamento periódico do processo',
    'Emissão da licença, certidão ou dispensa',
    'Arquivamento do documento final',
    'Documentação do caminho das pedras'
  ],
  unitFlows: {
    'Fábrica': {
      titulo: 'Processo de emissão da LO',
      etapas: [
        {etapa: '1. Abertura', nome: 'Reunião de alinhamento de escopo e prioridades', responsavel: 'Sustentabilidade / Consultoria', status: 'Concluído', prazo: '', observacao: 'Realizada em abril'},
        {etapa: '1. Abertura', nome: 'Definição de cronograma (Monday.com)', responsavel: 'Sustentabilidade / Consultoria', status: 'Em andamento', prazo: '', observacao: 'Link enviado 26/06'},
        {etapa: '2. Levantamento', nome: 'Visita técnica inicial (aspectos e impactos)', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-05-11', observacao: ''},
        {etapa: '2. Levantamento', nome: 'Visita complementar com técnico (equipamentos)', responsavel: 'Consultoria + técnico', status: 'Concluído', prazo: '2026-08-28', observacao: 'Técnico fez levantamento de campo'},
        {etapa: '3. Documentação', nome: 'Estatuto Social Tecsoil', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: 'Versão 11/07/2025'},
        {etapa: '3. Documentação', nome: 'MCE e planta protocolada (processo anterior LO)', responsavel: 'Fábrica', status: 'Concluído', prazo: '', observacao: 'Solicitado 28/08'},
        {etapa: '3. Documentação', nome: 'PGRS (Plano de Gerenciamento de Resíduos)', responsavel: 'Solinftec', status: 'Concluído', prazo: '', observacao: 'Manter 2024; orçamento para atualizar 4 unidades'},
        {etapa: '4. Dados Técnicos', nome: 'Insumos: químicos, água, combustíveis', responsavel: 'Fábrica', status: 'Concluído', prazo: '', observacao: 'Solicitado 20/05'},
        {etapa: '4. Dados Técnicos', nome: 'Ficha técnica de materiais', responsavel: 'Fábrica', status: 'Concluído', prazo: '', observacao: 'Solicitado 20/05'},
        {etapa: '4. Dados Técnicos', nome: 'Especificação de metais (mecânica)', responsavel: 'Fábrica', status: 'Concluído', prazo: '', observacao: 'Solicitado 20/05'},
        {etapa: '4. Dados Técnicos', nome: 'Estrutura: Processo/Peça/Composição/Ciclo/Reutilização/Origem', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-06-23', observacao: 'Agrupamento enviado'},
        {etapa: '4. Dados Técnicos', nome: 'MTR (Manifesto de Transporte de Resíduos)', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-05-12', observacao: 'Enviado'},
        {etapa: '5. Análise Técnica', nome: 'Matriz LAIA', responsavel: 'Consultoria', status: 'Em andamento', prazo: '', observacao: 'Em elaboração'},
        {etapa: '5. Análise Técnica', nome: 'Estudo de caso e cruzamento com legislação', responsavel: 'Consultoria', status: 'Em andamento', prazo: '', observacao: ''},
        {etapa: '6. Plano', nome: 'Plano de Monitoramento', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: 'Depende da matriz LAIA'},
        {etapa: '6. Plano', nome: 'Reunião de alinhamento com Solinftec', responsavel: 'Consultoria / Sustentabilidade', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '7. Renovação LO', nome: 'Montagem do processo de renovação', responsavel: 'Consultoria', status: 'Em andamento', prazo: '', observacao: 'Iniciado 10/09'},
        {etapa: '7. Renovação LO', nome: 'Protocolo no órgão estadual', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '7. Renovação LO', nome: 'Pagamento de taxas', responsavel: 'Financeiro', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'LO renovada', responsavel: 'Órgão estadual', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'Arquivamento e documentação do fluxo', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: ''}
      ]
    },
    'Balsas': {
      titulo: 'Processo de dispensa',
      etapas: [
        {etapa: '1. Abertura', nome: 'Verificar enquadramento (DLA → Certidão Ambiental)', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-09-09', observacao: 'DLA não se aplica mais'},
        {etapa: '1. Abertura', nome: 'Confirmar Certidão de Uso e Ocupação do Solo', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-09-09', observacao: 'Protocolado'},
        {etapa: '2. Documentação', nome: 'Estatuto Social Tecsoil', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '2. Documentação', nome: 'Contrato de locação', responsavel: 'Sustentabilidade', status: 'Pendente', prazo: '', observacao: 'Solicitado 17/04'},
        {etapa: '2. Documentação', nome: 'Procuração atualizada', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '2026-05-07', observacao: ''},
        {etapa: '2. Documentação', nome: 'Documento pessoal + comprovante do responsável legal', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-08-14', observacao: ''},
        {etapa: '2. Documentação', nome: 'Telefone do responsável legal', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-08-18', observacao: 'Telefone do analista de Sustentabilidade'},
        {etapa: '3. Imóvel', nome: 'IPTU (capa e contracapa) — código do imóvel', responsavel: 'Sustentabilidade / Facilities', status: 'Em andamento', prazo: '', observacao: 'Divergência: matrícula 11051 vs cadastro prefeitura'},
        {etapa: '3. Imóvel', nome: 'Planta baixa das salas', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-08-27', observacao: ''},
        {etapa: '3. Imóvel', nome: 'Relatório fotográfico (fachada, frente, internas)', responsavel: 'Facilities', status: 'Concluído', prazo: '2026-08-25', observacao: 'Consultoria alertou: fotos de uma sala só'},
        {etapa: '4. Segurança', nome: 'CCBM em nome do CNPJ', responsavel: 'Facilities', status: 'Crítico', prazo: 'Urgente', observacao: 'Certificado no CPF do dono; SEMMA recusa'},
        {etapa: '4. Segurança', nome: 'Sinalização, iluminação, extintores', responsavel: 'Facilities', status: 'Pendente', prazo: '', observacao: 'A confirmar'},
        {etapa: '5. Taxas', nome: 'Emissão de guia/taxa municipal', responsavel: 'Consultoria', status: 'Concluído', prazo: '', observacao: 'Boleto ~R$ 50–60'},
        {etapa: '5. Taxas', nome: 'Pagamento em até 1 dia útil', responsavel: 'Financeiro', status: 'Concluído', prazo: '2026-07-13', observacao: 'Comprovante enviado 15/07'},
        {etapa: '5. Taxas', nome: 'Protocolo no sistema SEMMA', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-09-09', observacao: 'Processo encerra a cada comunicação'},
        {etapa: '6. Certidão Uso', nome: 'Solicitação da Certidão de Uso e Ocupação do Solo', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-09-09', observacao: 'Para Alvará'},
        {etapa: '7. Acompanhamento', nome: 'Verificar sistema a cada 2 dias', responsavel: 'Consultoria', status: 'Em andamento', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'Certidão Ambiental emitida', responsavel: 'SEMMA Balsas', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'Certidão de Uso e Ocupação do Solo emitida', responsavel: 'SEMMA Balsas', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'Arquivamento e documentação do fluxo', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: ''}
      ]
    },
    'LEM': {
      titulo: 'Controle de etapas da unidade',
      etapas: [
        {etapa: '1. Abertura', nome: 'Verificar enquadramento (dispensa vs licença)', responsavel: 'Consultoria', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '2. Documentação', nome: 'Estatuto Social Tecsoil', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '2. Documentação', nome: 'Contrato de locação', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-10', observacao: ''},
        {etapa: '2. Documentação', nome: 'Procuração atualizada', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '2. Documentação', nome: 'Documento pessoal + comprovante do responsável legal', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-08-14', observacao: ''},
        {etapa: '3. Imóvel', nome: 'IPTU (capa e contracapa)', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-28', observacao: ''},
        {etapa: '3. Imóvel', nome: 'CND Municipal (CNPJ 12.456.606/0009-72)', responsavel: 'Financeiro', status: 'Concluído', prazo: '2026-08-25', observacao: 'Emitida'},
        {etapa: '4. Segurança', nome: 'Licença do Corpo de Bombeiros', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-10', observacao: ''},
        {etapa: '5. Taxas', nome: 'Emissão de guia para pagamento', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-09-09', observacao: ''},
        {etapa: '5. Taxas', nome: 'Pagamento da guia (venc. 28/09)', responsavel: 'Financeiro', status: 'Crítico', prazo: '2026-09-28', observacao: 'Protocolo travado até pagamento'},
        {etapa: '5. Taxas', nome: 'Envio do comprovante', responsavel: 'Sustentabilidade', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '5. Taxas', nome: 'Protocolo no sistema', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: 'Só após pagamento'},
        {etapa: '6. Acompanhamento', nome: 'Verificar sistema periodicamente', responsavel: 'Consultoria', status: 'Em andamento', prazo: '', observacao: ''},
        {etapa: '7. Emissão', nome: 'Dispensa de Licença emitida', responsavel: 'SEMA LEM', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '7. Emissão', nome: 'Arquivamento e documentação do fluxo', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: ''}
      ]
    },
    'Sinop': {
      titulo: 'Controle de etapas da unidade',
      etapas: [
        {etapa: '1. Abertura', nome: 'Verificar enquadramento no sistema integrado MT', responsavel: 'Consultoria', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '1. Abertura', nome: 'Confirmar área do escritório (355 m²)', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-08-06', observacao: 'Não enquadra em AVCB complexo'},
        {etapa: '2. Documentação', nome: 'Estatuto Social Tecsoil', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '2. Documentação', nome: 'Contrato de locação', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-10', observacao: ''},
        {etapa: '2. Documentação', nome: 'Procuração atualizada', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '3. Imóvel', nome: 'Verificar gás, agrotóxicos, área >750 m²', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-29', observacao: 'Todas respostas "Não"'},
        {etapa: '4. Formulário', nome: 'Formulário autodeclaratório ("PÁGINA A PREENCHER")', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-07-29', observacao: 'Preenchido em nome do responsável legal'},
        {etapa: '5. Segurança', nome: 'Licença do Corpo de Bombeiros (AP9190_2026)', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-10', observacao: 'Enviado'},
        {etapa: '5. Segurança', nome: 'Renovação da Licença do Corpo de Bombeiros', responsavel: 'Facilities', status: 'Em andamento', prazo: '', observacao: 'Solicitada 10/08 (estava vencida)'},
        {etapa: '6. Vig. Sanitária', nome: 'Avaliação após bombeiros', responsavel: 'Vig. Sanitária MT', status: 'Pendente', prazo: '', observacao: 'Indeferimento anterior por falta de bombeiros'},
        {etapa: '7. Acompanhamento', nome: 'Verificar sistema integrado', responsavel: 'Consultoria', status: 'Em andamento', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'Declaração de Não Licenciamento', responsavel: 'Meio Ambiente MT', status: 'Concluído', prazo: '2026-07-27', observacao: 'DECLARAÇÃO DE NÃO LICENCIAMENTO_SINOP 2026.pdf'},
        {etapa: '8. Emissão', nome: 'Licença do Corpo de Bombeiros (renovação)', responsavel: 'CBM MT', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'Licença da Vigilância Sanitária', responsavel: 'Vig. Sanitária MT', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '8. Emissão', nome: 'Arquivamento e documentação do fluxo', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: ''}
      ]
    },
    'Querência': {
      titulo: 'Controle de etapas da unidade',
      etapas: [
        {etapa: '1. Abertura', nome: 'Verificar enquadramento no sistema integrado MT', responsavel: 'Consultoria', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '1. Abertura', nome: 'Confirmar área e características do imóvel', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-29', observacao: ''},
        {etapa: '2. Documentação', nome: 'Estatuto Social Tecsoil', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '2. Documentação', nome: 'Contrato de locação', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-10', observacao: ''},
        {etapa: '2. Documentação', nome: 'Procuração atualizada', responsavel: 'Sustentabilidade / Jurídico', status: 'Concluído', prazo: '', observacao: ''},
        {etapa: '3. Imóvel', nome: 'Verificar agrotóxicos', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-29', observacao: 'Não há em Querência'},
        {etapa: '3. Imóvel', nome: 'Verificar gás, área >750 m²', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-29', observacao: 'Todas respostas "Não"'},
        {etapa: '4. Formulário', nome: 'Formulário autodeclaratório ("PÁGINA A PREENCHER")', responsavel: 'Consultoria', status: 'Concluído', prazo: '2026-07-29', observacao: 'Preenchido em nome do responsável legal'},
        {etapa: '5. Segurança', nome: 'Licença do Corpo de Bombeiros (AP9191_2026)', responsavel: 'Sustentabilidade', status: 'Concluído', prazo: '2026-07-10', observacao: 'Enviado'},
        {etapa: '5. Segurança', nome: 'Ajuste da Licença do Corpo de Bombeiros', responsavel: 'Facilities', status: 'Em andamento', prazo: '', observacao: '"Já foi emitido mas tem que ajustar"'},
        {etapa: '6. Acompanhamento', nome: 'Verificar sistema integrado', responsavel: 'Consultoria', status: 'Em andamento', prazo: '', observacao: ''},
        {etapa: '7. Emissão', nome: 'Dispensa de Licença', responsavel: 'Meio Ambiente MT', status: 'Concluído', prazo: '2026-07-27', observacao: 'DISPENSA DE LICENÇA QUERÊNCIA 2026.pdf'},
        {etapa: '7. Emissão', nome: 'Licença do Corpo de Bombeiros (ajuste)', responsavel: 'CBM MT', status: 'Pendente', prazo: '', observacao: ''},
        {etapa: '7. Emissão', nome: 'Arquivamento e documentação do fluxo', responsavel: 'Consultoria', status: 'Pendente', prazo: '', observacao: ''}
      ]
    }
  },
  unitProfiles: {
    'Fábrica': {
      razaoSocial: 'TECSOIL AUTOMACAO E SISTEMAS S.A', cnpj: '12.456.606/0005-49',
      endereco: 'Rua Anhanguera, 3227 - Jd. Nova Yorque - Araçatuba/SP',
      atividadeAmbiental: '28.33-0-00 - Fabricação de máquinas e equipamentos para agricultura e pecuária',
      atividadesConduzidas: 'fábrica, almoxarifado, manutenção de equipamentos',
      ocupacao: 'Imóvel locado', area: '2609,85 m²', extintores: '20 extintores',
      hidrantes: '3 unidades', spda: 'Possui, com adequação em andamento',
      alarme: 'Sim, com monitoramento 24h'
    },
    'Balsas': {
      razaoSocial: 'TECSOIL AUTOMACAO E SISTEMAS S.A', cnpj: '12.456.606/0012-78',
      endereco: 'Rua Dr Justo Pedrosa, 252, Centro, 2º andar, sala 25, Balsas/MA',
      atividadeAmbiental: '70.20-4-00 - Consultoria em gestão empresarial',
      atividadesConduzidas: 'escritório administrativo (em implantação)', ocupacao: 'Imóvel locado',
      area: '988 m²', extintores: '4', hidrantes: 'Sim', spda: 'Aguardando verificação',
      alarme: 'Sim, com monitoramento 24h'
    },
    'LEM': {
      razaoSocial: 'TECSOIL AUTOMACAO E SISTEMAS S.A', cnpj: '12.456.606/0009-72',
      endereco: 'Rua São Francisco, 1339, Quadra 03, Lote 04, Luís Eduardo Magalhães/BA',
      atividadeAmbiental: '62.02-3-00 - Desenvolvimento e licenciamento de programas de computador',
      atividadesConduzidas: 'escritório administrativo', ocupacao: 'Imóvel locado',
      area: '350 m²', extintores: '4 unidades', hidrantes: 'Sim', spda: 'Em renovação',
      alarme: 'Sim, com monitoramento 24h'
    },
    'Sinop': {
      razaoSocial: 'TECSOIL AUTOMACAO E SISTEMAS S.A', cnpj: '12.456.606/0006-20',
      endereco: 'Avenida dos Tarumãs, 3065, Jardim Maringá 2, Sinop/MT',
      atividadeAmbiental: '62.02-3-00 - Desenvolvimento e licenciamento de programas de computador',
      atividadesConduzidas: 'escritório, manutenção, produção de equipamentos e almoxarifado', ocupacao: 'Imóvel locado',
      area: '735,56 m²', extintores: '4 unidades', hidrantes: '1 compartilhado', spda: 'Não',
      alarme: 'Sim, com monitoramento 24h'
    },
    'Querência': {
      razaoSocial: 'TECSOIL AUTOMACAO E SISTEMAS S.A', cnpj: '12.456.606/0008-91',
      endereco: 'Rua Rio Grande do Sul, 313, Setor A, Querência/MT',
      atividadeAmbiental: '62.02-3-00 - Desenvolvimento e licenciamento de programas de computador',
      atividadesConduzidas: 'escritório administrativo', ocupacao: 'Imóvel locado',
      area: '619 m²', extintores: '3 unidades', hidrantes: 'Uso geral do prédio', spda: 'Não',
      alarme: 'Sim, com monitoramento 24h'
    },
    'Concordia': {
      razaoSocial: 'TECSOIL AUTOMACAO E SISTEMAS S.A', cnpj: '12.456.606/0002-04',
      endereco: 'Rua Abrahão Vinhas, 242, salas 1 e 2, Araçatuba/SP',
      atividadeAmbiental: '26.51-5-00 - Fabricação de aparelhos e equipamentos de medida',
      atividadesConduzidas: 'escritório, manutenção, produção, hardware, software e comércio', ocupacao: 'Imóvel próprio',
      area: '865 m²', extintores: '12 unidades', hidrantes: '3 unidades', spda: 'Não',
      alarme: 'Sim, com monitoramento 24h'
    },
    'NY Tower': {
      razaoSocial: 'TECSOIL AUTOMACAO E SISTEMAS S.A.', cnpj: '12.456.606/0001-15',
      endereco: 'Avenida Brasília, 2121, 22º andar, Araçatuba/SP',
      atividadeAmbiental: '62.02-3-00 - Desenvolvimento e licenciamento de programas de computador',
      atividadesConduzidas: 'escritório, desenvolvimento de hardware e software, importação e comércio', ocupacao: 'Imóvel locado',
      area: '46777 m²', extintores: '6', hidrantes: '2 de parede', spda: 'Sim',
      alarme: '2 alarmes e 14 detectores de fumaça'
    },
    'NetZero Farm': {
      razaoSocial: 'TECSOIL FARM PESQUISA E DESENVOLVIMENTO LTDA', cnpj: '44.385.732/0001-12',
      endereco: 'Rod. Marechal Rondon Km 541 Oeste, Araçatuba/SP',
      atividadeAmbiental: '72.10-0-00 - Pesquisa e desenvolvimento experimental',
      atividadesConduzidas: 'Pesquisa e desenvolvimento experimental', ocupacao: 'Imóvel próprio',
      area: '113,40 m²', extintores: '3', hidrantes: 'Não possui', spda: 'Sim',
      alarme: 'Sim, com monitoramento 24h'
    }
  }
};
