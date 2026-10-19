/* Fluxograma do processo - Sustentabilidade: Licenças e Outorgas (v1.0).
   Etapas seguem as raias do fluxograma; decisões registram o caminho escolhido. */
(function(){
  const SUSTENTABILIDADE = 'Sustentabilidade (Analista)';
  const AREAS_INTERNAS = 'Áreas internas (Facilities, Jurídico, Fábrica)';
  const FABRICA = 'Fábrica / Facilities';
  const FISCAL = 'Fiscal / Financeiro';

  window.PROCESS_FLOWS = {
    licenca: {
      nome: 'Regulatório Licenças',
      ciclo: 'Ciclo mensal de acompanhamento',
      antecedenciaDias: 120,
      fim: 'Licença emitida dentro do prazo',
      nos: [
        {id: 'LIC-01', nome: 'Consultar o calendário de vencimentos', area: SUSTENTABILIDADE},
        {id: 'LIC-G1', decisao: 'Jurisdição exige licenciamento (Brasil)?', opcoes: [
          {id: 'sim', rotulo: 'Sim'},
          {id: 'nao', rotulo: 'Não, operação fora do Brasil', status: 'Não aplicável',
            fim: 'Licenciamento não aplicável à jurisdição'}
        ]},
        {id: 'LIC-02', nome: 'Identificar a licença a ser reportada', area: SUSTENTABILIDADE},
        {id: 'LIC-G2', decisao: 'Licença exigida ou dispensa?', opcoes: [
          {id: 'exigida', rotulo: 'Exigida (licença ou certidão de dispensa a requerer)', status: 'Pendente'},
          {id: 'dispensa', rotulo: 'Dispensa sem requerimento', status: 'Dispensada', etapa: 'LIC-D', fim: 'Dispensa de licença'}
        ]},
        {id: 'LIC-I', nome: 'Licença indeferida – acionar consultoria e jurídico', area: SUSTENTABILIDADE, condicional: true},
        {id: 'LIC-03', nome: 'Acessar o sistema do órgão licenciador', area: SUSTENTABILIDADE},
        {id: 'LIC-04', nome: 'Solicitar documentação às áreas internas', area: SUSTENTABILIDADE},
        {id: 'LIC-05', nome: 'Reunir e enviar documentos e informações', area: AREAS_INTERNAS},
        {id: 'LIC-P', nome: 'Atender a pendência apontada pelo órgão', area: SUSTENTABILIDADE, condicional: true},
        {id: 'LIC-06', nome: 'Preencher formulário e anexar documentos no sistema do órgão', area: SUSTENTABILIDADE},
        {id: 'LIC-07', nome: 'Encaminhar o boleto da taxa ao time fiscal', area: SUSTENTABILIDADE, repete: false},
        {id: 'LIC-08', nome: 'Agendar e efetuar o pagamento da taxa', area: FISCAL, repete: false,
          nota: 'Alinhar com o time Fiscal para realizar o pagamento antes do vencimento da taxa.'},
        {id: 'LIC-09', nome: 'Aguardar emissão junto ao órgão', area: SUSTENTABILIDADE, analise: true},
        {id: 'LIC-G3', decisao: 'Resultado do órgão', analise: true, opcoes: [
          {id: 'emitida', rotulo: 'Emitida (licença, certidão ou dispensa)', status: 'Obtida'},
          {id: 'pendencia', rotulo: 'Pendência identificada', status: 'Pendente', retorna: 'LIC-P'},
          {id: 'indeferida', rotulo: 'Indeferida', status: 'Indeferida', retorna: 'LIC-I', reiniciaTudo: true}
        ]},
        {id: 'LIC-10', nome: 'Registrar o documento emitido e atualizar o calendário', area: SUSTENTABILIDADE,
          nota: 'Atualize a data de emissão e o vencimento do documento.'}
      ],
      etapasFinais: {
        'LIC-D': {id: 'LIC-D', nome: 'Registrar a dispensa e atualizar o calendário', area: SUSTENTABILIDADE}
      }
    },
    outorga: {
      nome: 'Regulatório Outorgas',
      ciclo: 'Calendário anual da outorga',
      antecedenciaDias: 120,
      fim: 'Outorga ou dispensa registrada',
      nos: [
        {id: 'OUT-01', nome: 'Acompanhar as datas de vencimento das outorgas', area: SUSTENTABILIDADE},
        {id: 'OUT-G1', decisao: 'Captação sujeita a outorga (Brasil)?', opcoes: [
          {id: 'sim', rotulo: 'Sim'},
          {id: 'nao', rotulo: 'Não, operação fora do Brasil', status: 'Não aplicável',
            fim: 'Outorga não aplicável à jurisdição'}
        ]},
        {id: 'OUT-02', nome: 'Identificar o órgão outorgante e o tipo de outorga', area: SUSTENTABILIDADE},
        {id: 'OUT-I', nome: 'Avaliar as alternativas de abastecimento', area: SUSTENTABILIDADE, condicional: true},
        {id: 'OUT-03', nome: 'Acessar o portal do órgão de recursos hídricos', area: SUSTENTABILIDADE},
        {id: 'OUT-04', nome: 'Solicitar laudo técnico e dados de consumo', area: SUSTENTABILIDADE},
        {id: 'OUT-05', nome: 'Emitir laudo de potabilidade e consolidar dados de consumo', area: FABRICA},
        {id: 'OUT-P', nome: 'Atender a pendência apontada pelo órgão', area: SUSTENTABILIDADE, condicional: true},
        {id: 'OUT-06', nome: 'Preencher e enviar a renovação ou dispensa', area: SUSTENTABILIDADE},
        {id: 'OUT-G2', decisao: 'Há taxa aplicável?', repete: false, opcoes: [
          {id: 'sim', rotulo: 'Sim'},
          {id: 'nao', rotulo: 'Não', pula: ['OUT-07']}
        ]},
        {id: 'OUT-07', nome: 'Efetuar o pagamento da taxa', area: FISCAL, repete: false,
          nota: 'Alinhar com o time Fiscal para realizar o pagamento antes do vencimento da taxa.'},
        {id: 'OUT-08', nome: 'Acompanhar emissão junto ao órgão (processo em análise)', area: SUSTENTABILIDADE, analise: true},
        {id: 'OUT-G3', decisao: 'Resultado do órgão', analise: true, opcoes: [
          {id: 'emitida', rotulo: 'Outorga emitida', status: 'Obtida'},
          {id: 'dispensa', rotulo: 'Dispensa concedida', status: 'Dispensada'},
          {id: 'pendencia', rotulo: 'Pendência identificada', status: 'Pendente', retorna: 'OUT-P'},
          {id: 'indeferida', rotulo: 'Indeferida', status: 'Indeferida', retorna: 'OUT-I', reiniciaTudo: true}
        ]},
        {id: 'OUT-09', nome: 'Registrar a portaria e atualizar o calendário', area: SUSTENTABILIDADE,
          nota: 'Atualize a data de emissão e o vencimento da outorga.'}
      ],
      etapasFinais: {}
    }
  };
})();
