/* Padrões extraídos de Controle de etapas - Fluxo.xlsx. */
window.SPREADSHEET_REFERENCE = {
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
