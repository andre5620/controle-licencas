const DEFAULT_DATA = window.DEFAULT_DATA;
const DEFAULT_MODEL = window.DEFAULT_MODEL || null;
const SPREADSHEET_REFERENCE = window.SPREADSHEET_REFERENCE || null;
const SPREADSHEET_LICENSES = window.SPREADSHEET_LICENSES || {};
const PROCESS_FLOWS = window.PROCESS_FLOWS || {};

const APP_VERSION = '1.12.0';
const LICENSE_STATUSES = ['Pendente','Em análise','Condicionada','Obtida','Dispensada','Indeferida','Não aplicável'];
const OPEN_STATUSES = ['Pendente','Em análise','Condicionada','Indeferida'];
const ACTIVITY_STATUSES = ['Não iniciado','Working on it','Stuck','Done','N/A'];
const STEP_DONE = ['Done','N/A'];
const PROFILE_FIELDS = [
  ['Razão social', 'razaoSocial'], ['CNPJ', 'cnpj'], ['Endereço', 'endereco'],
  ['Atividade ambiental', 'atividadeAmbiental'], ['Atividades conduzidas', 'atividadesConduzidas'],
  ['Ocupação', 'ocupacao'], ['Área', 'area'], ['Extintores', 'extintores'],
  ['Hidrantes', 'hidrantes'], ['SPDA', 'spda'], ['Sistema de alarme', 'alarme']
];
const STORAGE_KEY = 'licencas-solinftec-v1';
let MODEL = null;
let DATA = [];
let expandedIds = new Set();
let activeView = 'list';
let activePanel = 'unit';
const remoteEnabled = Boolean(window.SUPABASE_CONFIG?.required || window.LicenseDataService?.enabled);
let cacheKey = STORAGE_KEY;
let authenticatedUserId = null;
let remoteRevision = 0;
let pendingChanges = false;
let conflict = false;
let editGeneration = 0;
let saveQueue = Promise.resolve();
let appReady = false;
let refreshing = false;

const todayStr = () => new Date().toISOString().slice(0,10);
const fmtDate = (iso) => {
  if(!iso) return '—';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const daysUntil = (iso) => {
  if(!iso) return null;
  const t = new Date(todayStr()+'T00:00:00');
  const v = new Date(iso+'T00:00:00');
  return Math.round((v-t)/86400000);
};

/* ---------------------------------------------------------------
   PERSISTENCE
--------------------------------------------------------------- */
async function loadData(){
  if(remoteEnabled){
    const remote = await window.LicenseDataService.load();
    cacheKey = `${STORAGE_KEY}:${authenticatedUserId}:${remote.organizationId}`;
    const draft = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    remoteRevision = remote.revision;
    if(draft?.pending){
      if(!isStructuredModel(draft.model) || !Number.isSafeInteger(draft.revision)){
        throw new Error('O rascunho local é inválido. Preserve uma cópia antes de limpar o armazenamento do navegador.');
      }
      MODEL = applyReferenceData(draft.model);
      DATA = flattenModel(MODEL);
      remoteRevision = draft.revision;
      pendingChanges = true;
      conflict = draft.revision !== remote.revision;
      setSaveState('var(--amber)', 'alterações pendentes',
        conflict ? 'A base central mudou. Exporte seu relatório antes de carregar a versão do servidor.'
          : 'Há alterações locais não sincronizadas. Clique em Sincronizar para enviá-las.');
      return;
    }
    if(remote.model){
      MODEL = applyReferenceData(remote.model);
      DATA = flattenModel(MODEL);
      if(remote.revision === 0) await saveData();
      else{
        cacheModel(false);
        setSaveState('var(--green)', 'sincronizado');
      }
      return;
    }
  }else{
    const raw = localStorage.getItem(cacheKey);
    if(raw){
      const stored = JSON.parse(raw);
      MODEL = isStructuredModel(stored) ? applyReferenceData(stored) : modelFromLegacyData(stored);
      DATA = flattenModel(MODEL);
      setSaveState('var(--amber)', 'salvo só neste navegador');
      return;
    }
  }
  MODEL = DEFAULT_MODEL
    ? JSON.parse(JSON.stringify(DEFAULT_MODEL))
    : modelFromLegacyData(DEFAULT_DATA);
  MODEL = applyReferenceData(MODEL);
  DATA = flattenModel(MODEL);
  await saveData();
}

function isStructuredModel(model){
  return model && Array.isArray(model.units) && Array.isArray(model.processTypes) && Array.isArray(model.processes);
}

function modelFromLegacyData(records){
  const units = (MODEL?.units || []).map(unit=>({...unit}));
  const unitByKey = new Map();
  const processTypes = [];
  const typeByKey = new Map();
  const previousUnits = MODEL?.units || [];
  const previousTypes = MODEL?.processTypes || [];
  const nextId = (prefix, previous, current)=>{
    const used = new Set([...previous, ...current].map(item=>item.id));
    let number = 1;
    while(used.has(`${prefix}-${String(number).padStart(3,'0')}`)) number++;
    return `${prefix}-${String(number).padStart(3,'0')}`;
  };
  const processes = records.map(record=>{
    const unitKey = `${record.unidade}|${record.cidade}|${record.uf}`;
    if(!unitByKey.has(unitKey)){
      const previous = previousUnits.find(unit=>unit.id === record.unidadeId)
        || previousUnits.find(unit=>
          `${unit.nome || unit.codigo}|${unit.cidade}|${unit.uf}` === unitKey);
      const unit = {
        ...previous,
        id: previous?.id || nextId('U', previousUnits, units),
        codigo: previous?.codigo || record.unidade,
        nome: previous?.nome || record.unidade,
        razaoSocial: previous?.razaoSocial ?? record.razaoSocial ?? '',
        cnpj: previous?.cnpj ?? record.cnpj ?? '',
        endereco: previous?.endereco ?? record.endereco ?? '',
        cidade: previous?.cidade || record.cidade || '',
        uf: previous?.uf || record.uf || '',
        caracteristicasOperacionais: previous?.caracteristicasOperacionais || '',
        caracteristicasAmbientais: previous?.caracteristicasAmbientais || '',
        risco: record.risco || 'NA',
        status: previous?.status || 'Ativa',
        observacoes: previous?.observacoes || ''
      };
      if(previous) units[units.findIndex(item=>item.id === previous.id)] = unit;
      else units.push(unit);
      unitByKey.set(unitKey, unit);
    }
    const typeKey = `${record.categoria}|${record.tipoLicenca}|${record.orgaoEmissor}`;
    if(!typeByKey.has(typeKey)){
      const previous = previousTypes.find(type=>
        `${type.categoria}|${type.nome}|${type.orgaoEsperado}` === typeKey);
      const type = {
        ...previous,
        id: previous?.id || nextId('TP', previousTypes, processTypes),
        codigo: record.tipoLicenca || `TIPO-${processTypes.length+1}`,
        nome: record.tipoLicenca || record.categoria || 'Processo regulatório',
        categoria: record.categoria || '',
        orgaoEsperado: record.orgaoEmissor || '',
        periodicidade: previous?.periodicidade || '',
        prazoPadraoDias: previous?.prazoPadraoDias || '',
        etapasPadrao: previous?.etapasPadrao || (record.activities || []).map((activity, index)=>({
          id: `ET-${String(index+1).padStart(3,'0')}`,
          ordem: index + 1,
          nome: activity.name || `Etapa ${index+1}`,
          descricao: '',
          responsavelPadrao: activity.owner || '',
          prazoRelativoDias: '',
          obrigatoria: true
        }))
      };
      processTypes.push(type);
      typeByKey.set(typeKey, type);
    }
    const unit = unitByKey.get(unitKey);
    const type = typeByKey.get(typeKey);
    return {
      ...record,
      unidade: unit.nome,
      cidade: unit.cidade,
      uf: unit.uf,
      unidadeId: unit.id,
      tipoProcessoId: type.id,
      etapas: (record.activities || []).map((activity, index)=>({
        ...activity,
        id: activity.id || `EP-${record.id}-${String(index+1).padStart(2,'0')}`,
        etapaPadraoId: activity.etapaPadraoId || type.etapasPadrao[index]?.id || '',
        dataPlanejada: activity.date || '',
        dataRealizada: activity.dataRealizada || '',
        desvioModelo: Boolean(activity.desvioModelo)
      }))
    };
  });
  return applyReferenceData({...MODEL, version: 2, units, processTypes, processes});
}

function normalizeKey(value){
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}

/* Busca o registro da planilha pelo nome da unidade, ignorando acentos. */
function unitReference(table, unit){
  const direct = table[unit.nome] || table[unit.codigo];
  if(direct) return direct;
  const key = normalizeKey(unit.nome || unit.codigo);
  const match = Object.entries(table).find(([name])=>normalizeKey(name)===key);
  return match ? match[1] : null;
}

function applyReferenceData(model){
  const references = SPREADSHEET_REFERENCE?.unitProfiles || {};
  if(!model.unitCatalogVersion){
    model.units = model.units || [];
    (SPREADSHEET_REFERENCE?.unitCatalog || []).forEach((seed, index)=>{
      const existing = model.units.find(unit=>normalizeKey(unit.nome || unit.codigo) === normalizeKey(seed.nome));
      if(existing) return;
      let id = `UC-${index+1}`;
      while(model.units.some(unit=>unit.id === id)) id += '-new';
      model.units.push({id, codigo: seed.nome, ...seed, status: 'Ativa'});
    });
    model.unitCatalogVersion = 1;
  }
  model.units = (model.units || []).map(unit=>({
    ...unit,
    profile: {...(unitReference(references, unit) || {}), ...(unit.profile || {})},
    environmentalLicenses: unit.environmentalLicenses || SPREADSHEET_LICENSES[unit.nome] || SPREADSHEET_LICENSES[unit.codigo] || []
  }));
  return model;
}

function flattenModel(model){
  const units = new Map((model.units || []).map(unit=>[unit.id, unit]));
  const types = new Map((model.processTypes || []).map(type=>[type.id, type]));
  return (model.processes || []).map(process=>{
    const unit = units.get(process.unidadeId) || {};
    const type = types.get(process.tipoProcessoId) || {};
    return {
      ...process,
      unidade: unit.nome || unit.codigo || process.unidade || '',
      cidade: unit.cidade || process.cidade || '',
      uf: unit.uf || process.uf || '',
      razaoSocial: process.razaoSocial || unit.razaoSocial || '',
      endereco: process.endereco || unit.endereco || '',
      cnpj: process.cnpj || unit.cnpj || '',
      risco: process.risco || unit.risco || 'NA',
      categoria: process.categoria || type.categoria || '',
      tipoLicenca: process.tipoLicenca || type.nome || '',
      orgaoEmissor: process.orgaoEmissor || type.orgaoEsperado || '',
      activities: process.activities || process.etapas || [],
      perfilUnidade: unit.profile || {},
      licencasUnidade: unit.environmentalLicenses || []
    };
  });
}

/* ---------------------------------------------------------------
   PROCESS FLOW (fluxograma de Licenças e Outorgas)
--------------------------------------------------------------- */
function suggestedFlowType(lic){
  return /outorga/i.test(`${lic.categoria || ''} ${lic.tipoLicenca || ''}`) ? 'outorga' : 'licenca';
}

function flowNode(def, id){
  return def.nos.find(node=>node.id === id) || def.etapasFinais?.[id] || null;
}

function flowOrder(def){
  return [...def.nos.map(node=>node.id), ...Object.keys(def.etapasFinais || {})];
}

function flowActivity(lic, id){
  return (lic.activities || []).find(activity=>activity.etapaPadraoId === id);
}

function flowActivities(lic, id){
  return (lic.activities || []).filter(activity=>activity.etapaPadraoId === id);
}

/* Uma etapa do fluxograma agrupa uma ou mais atividades; conclui quando todas estão concluídas. */
function stepDone(lic, id){
  const activities = flowActivities(lic, id);
  return activities.length > 0 && activities.every(activity=>STEP_DONE.includes(activity.status));
}

/* Percorre o fluxograma: etapas concluídas avançam; decisões registradas escolhem o caminho. */
function walkFlow(lic){
  const def = PROCESS_FLOWS[lic.fluxo?.tipo];
  if(!def) return null;
  const decisions = lic.fluxo.decisoes || {};
  const extras = lic.fluxo.extras || [];
  const items = [];
  let current = null;
  for(const node of def.nos){
    if(node.condicional && !extras.includes(node.id)) continue;
    if(node.decisao){
      const option = node.opcoes.find(item=>item.id === decisions[node.id]);
      const item = {node, option, state: option ? 'feito' : current ? 'futuro' : 'atual'};
      items.push(item);
      if(current) continue;
      if(!option){
        current = item;
        continue;
      }
      if(option.fim){
        const final = option.etapa && flowNode(def, option.etapa);
        if(final){
          const done = stepDone(lic, final.id);
          const finalItem = {node: final, state: done ? 'feito' : 'atual'};
          items.push(finalItem);
          if(!done) return {def, items, current: finalItem, fim: null};
        }
        return {def, items, current: null, fim: option.fim};
      }
      continue;
    }
    const done = stepDone(lic, node.id);
    const item = {node, state: done ? 'feito' : current ? 'futuro' : 'atual'};
    items.push(item);
    if(!current && !done) current = item;
  }
  return {def, items, current, fim: current ? null : def.fim};
}

function currentFlowNodeId(lic){
  return walkFlow(lic)?.current?.node.id || null;
}

function flowSummary(lic){
  const flow = walkFlow(lic);
  if(!flow) return 'Fluxo não aplicado';
  if(flow.fim) return `Concluído: ${flow.fim}`;
  const node = flow.current.node;
  return node.decisao ? `Decisão: ${node.decisao}` : `Etapa atual: ${node.nome}`;
}

/* Insere a atividade na ordem do fluxograma, depois das que já estão na mesma etapa. */
function insertFlowActivity(lic, def, activity){
  const order = flowOrder(def);
  const rank = order.indexOf(activity.etapaPadraoId);
  lic.activities = lic.activities || [];
  let position = lic.activities.findIndex(item=>order.indexOf(item.etapaPadraoId) > rank);
  if(position < 0){
    position = lic.activities.reduce((last, item, index)=>order.includes(item.etapaPadraoId) ? index + 1 : last, 0);
  }
  lic.activities.splice(position, 0, activity);
  return activity;
}

function genericFlowActivityId(lic, nodeId){
  return `${lic.id}-${nodeId}`;
}

function ensureFlowActivity(lic, def, node){
  return flowActivity(lic, node.id) || insertFlowActivity(lic, def, {
    id: genericFlowActivityId(lic, node.id), etapaPadraoId: node.id, name: node.nome,
    owner: node.area || '', status: 'Não iniciado', date: '', observacao: ''
  });
}

/* ---------------------------------------------------------------
   PLANILHA DA UNIDADE -> ATIVIDADES DA LICENÇA
--------------------------------------------------------------- */
const SHEET_STATUS = {'Concluído': 'Done', 'Em andamento': 'Working on it', 'Pendente': 'Não iniciado', 'Crítico': 'Stuck'};

/* A tabela da aba da unidade pertence à licença de Licenciamento Ambiental dessa unidade. */
function spreadsheetFlowFor(lic){
  if(!/licenciamento ambiental/i.test(lic.categoria || '')) return null;
  const unit = MODEL?.units?.find(item=>item.id === lic.unidadeId);
  const spec = unit && unitReference(SPREADSHEET_REFERENCE?.unitFlows || {}, unit);
  if(!spec?.etapas?.length) return null;
  const target = DATA.find(item=>item.unidadeId === unit.id && /licenciamento ambiental/i.test(item.categoria || ''));
  return !target || target.id === lic.id ? spec : null;
}

function sheetActivity(lic, step, index){
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(step.prazo || '');
  return {
    id: `${lic.id}-PL-${String(index + 1).padStart(2,'0')}`, etapaPadraoId: step.etapaFluxo,
    grupo: step.etapa || '', name: step.nome, owner: step.responsavel || '',
    status: SHEET_STATUS[step.status] || 'Não iniciado', date: dated ? step.prazo : '', dataRealizada: '',
    observacao: [!dated && step.prazo ? `Prazo: ${step.prazo}` : '', step.observacao].filter(Boolean).join(' · '),
    origem: 'planilha'
  };
}

function importSpreadsheetActivities(lic, def, spec){
  const before = currentFlowNodeId(lic);
  const imported = spec.etapas.map((step, index)=>sheetActivity(lic, step, index))
    .filter(activity=>def.nos.some(node=>node.id === activity.etapaPadraoId && !node.decisao));
  const covered = new Set(imported.map(activity=>activity.etapaPadraoId));
  lic.activities = (lic.activities || []).filter(activity=>!(covered.has(activity.etapaPadraoId)
    && activity.id === genericFlowActivityId(lic, activity.etapaPadraoId) && activity.status === 'Não iniciado'));
  imported.forEach(activity=>insertFlowActivity(lic, def, activity));
  def.nos.filter(node=>!node.decisao && !node.condicional).forEach(node=>ensureFlowActivity(lic, def, node));
  /* Etapas genéricas anteriores a uma etapa já concluída na planilha não podem travar o fluxo. */
  const order = flowOrder(def);
  const furthest = Math.max(-1, ...imported.filter(activity=>STEP_DONE.includes(activity.status))
    .map(activity=>order.indexOf(activity.etapaPadraoId)));
  lic.activities.forEach(activity=>{
    if(activity.id !== genericFlowActivityId(lic, activity.etapaPadraoId) || activity.status !== 'Não iniciado') return;
    if(order.indexOf(activity.etapaPadraoId) >= furthest) return;
    Object.assign(activity, {status: 'Done', observacao: activity.observacao || 'Considerada concluída na importação da planilha'});
  });
  lic.fluxo.decisoes = lic.fluxo.decisoes || {};
  const preset = [['LIC-G1', 'sim'], ['LIC-G2', 'exigida']].filter(([gate])=>!lic.fluxo.decisoes[gate]);
  preset.forEach(([gate, option])=>{ lic.fluxo.decisoes[gate] = option; });
  lic.fluxo.planilhaImportada = true;
  addFlowHistory(lic, `${imported.length} atividades importadas da planilha da unidade${preset.length ? '; decisões iniciais definidas pela planilha' : ''}`);
  syncFlowStatus(lic, before);
}

function importSpreadsheetFlow(lic){
  const spec = spreadsheetFlowFor(lic);
  if(lic.fluxo?.tipo !== 'licenca' || !spec) throw new Error('Não há planilha da unidade para esta licença.');
  if(lic.fluxo.planilhaImportada) throw new Error('As atividades da planilha já foram importadas.');
  importSpreadsheetActivities(lic, PROCESS_FLOWS.licenca, spec);
}

function resetFlowActivity(activity){
  Object.assign(activity, {status: 'Não iniciado', dataRealizada: ''});
  if(activity.puladaPeloFluxo){
    activity.observacao = '';
    delete activity.puladaPeloFluxo;
  }
}

function addFlowHistory(lic, texto){
  lic.fluxo.historico = [...(lic.fluxo.historico || []), {data: todayStr(), ciclo: lic.fluxo.ciclo, texto}].slice(-100);
}

/* Etapas que só aparecem em um caminho (pendência, indeferimento) saem quando o caminho é abandonado. */
function dropConditionalStep(lic, id){
  lic.fluxo.extras = (lic.fluxo.extras || []).filter(item=>item !== id);
  lic.activities = (lic.activities || []).filter(activity=>activity.etapaPadraoId !== id || activity.status === 'Done');
}

/* Ao chegar na espera pelo órgão, a licença passa a "Em análise". */
function syncFlowStatus(lic, previousNodeId){
  const node = walkFlow(lic)?.current?.node;
  if(node?.analise && node.id !== previousNodeId) lic.status = 'Em análise';
}

function applyFlow(lic, tipo){
  const def = PROCESS_FLOWS[tipo];
  if(!def) throw new Error('Selecione um fluxo válido.');
  if(lic.fluxo) throw new Error('Esta licença já segue um fluxo.');
  const spec = tipo === 'licenca' ? spreadsheetFlowFor(lic) : null;
  lic.fluxo = {tipo, ciclo: 1, decisoes: {}, extras: [], historico: []};
  addFlowHistory(lic, `Fluxo ${def.nome} aplicado`);
  if(spec) importSpreadsheetActivities(lic, def, spec);
  else def.nos.filter(node=>!node.decisao && !node.condicional).forEach(node=>ensureFlowActivity(lic, def, node));
}

function completeFlowStep(lic, stepId){
  const flow = walkFlow(lic);
  const node = flow?.current?.node;
  if(!node || node.decisao || node.id !== stepId){
    throw new Error('Esta etapa não é mais a etapa atual. Carregue o servidor.');
  }
  ensureFlowActivity(lic, flow.def, node);
  flowActivities(lic, node.id).filter(activity=>!STEP_DONE.includes(activity.status)).forEach(activity=>{
    activity.status = 'Done';
    activity.dataRealizada = todayStr();
  });
  syncFlowStatus(lic, stepId);
}

function decideFlow(lic, gateId, optionId){
  const flow = walkFlow(lic);
  const node = flow?.current?.node;
  if(!node?.decisao || node.id !== gateId){
    throw new Error('Esta decisão não está mais pendente. Carregue o servidor.');
  }
  const option = node.opcoes.find(item=>item.id === optionId);
  if(!option) throw new Error('Opção inválida para esta decisão.');
  const {def} = flow;
  const state = lic.fluxo;
  state.decisoes = state.decisoes || {};
  state.extras = state.extras || [];
  if(option.retorna){
    const from = def.nos.findIndex(item=>item.id === option.retorna);
    const to = def.nos.findIndex(item=>item.id === gateId);
    if(!state.extras.includes(option.retorna)) state.extras.push(option.retorna);
    ensureFlowActivity(lic, def, def.nos[from]);
    def.nos.slice(from, to + 1).forEach(item=>{
      if(item.condicional && item.id !== option.retorna){
        if(option.reiniciaTudo) dropConditionalStep(lic, item.id);
        return;
      }
      if(item.repete === false && !option.reiniciaTudo) return;
      if(item.decisao) delete state.decisoes[item.id];
      else flowActivities(lic, item.id).forEach(resetFlowActivity);
    });
  }else{
    state.decisoes[gateId] = optionId;
    (option.pula || []).forEach(id=>{
      ensureFlowActivity(lic, def, flowNode(def, id));
      flowActivities(lic, id).filter(activity=>activity.status !== 'Done').forEach(activity=>{
        Object.assign(activity, {status: 'N/A', puladaPeloFluxo: true,
          observacao: activity.observacao || `Não aplicável: ${node.decisao} ${option.rotulo}`});
      });
    });
    if(option.etapa) ensureFlowActivity(lic, def, flowNode(def, option.etapa));
  }
  if(option.status) lic.status = option.status;
  addFlowHistory(lic, `${node.decisao} ${option.rotulo}`);
  syncFlowStatus(lic, gateId);
}

/* Novo ciclo de renovação: etapas voltam ao início; o histórico permanece. */
function startFlowCycle(lic){
  const flow = walkFlow(lic);
  if(!flow) throw new Error('Esta licença ainda não segue um fluxo.');
  const ids = new Set(flowOrder(flow.def));
  const pathOnly = new Set([
    ...flow.def.nos.filter(node=>node.condicional).map(node=>node.id),
    ...Object.keys(flow.def.etapasFinais || {})
  ]);
  lic.activities = (lic.activities || []).filter(activity=>!pathOnly.has(activity.etapaPadraoId));
  lic.activities.forEach(activity=>{
    if(!ids.has(activity.etapaPadraoId)) return;
    resetFlowActivity(activity);
    activity.date = '';
  });
  Object.assign(lic.fluxo, {ciclo: (lic.fluxo.ciclo || 1) + 1, decisoes: {}, extras: []});
  addFlowHistory(lic, `Ciclo ${lic.fluxo.ciclo} iniciado`);
}

/* ---------------------------------------------------------------
   CALENDÁRIO DE VENCIMENTOS (ciclo mensal)
--------------------------------------------------------------- */
function addDaysIso(iso, days){
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0,10);
}

function renewalWindow(lic){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(lic.vencimento || '')) return null;
  const custom = Number(lic.antecedenciaDias);
  const def = PROCESS_FLOWS[lic.fluxo?.tipo || suggestedFlowType(lic)];
  const lead = Number.isInteger(custom) && custom > 0 ? custom : (def?.antecedenciaDias || 120);
  return {lead, abertura: addDaysIso(lic.vencimento, -lead), vencimento: lic.vencimento};
}

function monthBounds(month){
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2,'0')}`};
}

function shiftMonth(month, delta){
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0,7);
}

function calendarGroups(list, month){
  const {start, end} = monthBounds(month);
  const groups = {acao: [], vencidas: [], aguardar: [], semData: []};
  list.forEach(lic=>{
    const span = renewalWindow(lic);
    if(!span) groups.semData.push({lic});
    else if(span.vencimento < start) groups.vencidas.push({lic, span});
    else if(span.abertura <= end) groups.acao.push({lic, span});
    else groups.aguardar.push({lic, span});
  });
  const byDate = key=>(a, b)=>a.span[key].localeCompare(b.span[key]);
  groups.acao.sort(byDate('vencimento'));
  groups.vencidas.sort(byDate('vencimento'));
  groups.aguardar.sort(byDate('abertura'));
  return groups;
}

function setSaveState(color, text, message = ''){
  document.getElementById('saveDot').style.background = color;
  document.getElementById('saveText').textContent = text;
  const notice = document.getElementById('syncMessage');
  notice.textContent = message;
  notice.hidden = !message;
}

function cacheModel(pending){
  localStorage.setItem(cacheKey, JSON.stringify(remoteEnabled
    ? {model: MODEL, revision: remoteRevision, pending} : MODEL));
}

function reportSyncError(error){
  console.error('Falha na sincronização de licenças:', error);
  if(error.code === '40001') conflict = true;
  setSaveState('var(--red)', pendingChanges ? 'não sincronizado' : 'erro de conexão',
    conflict
      ? 'Outra pessoa atualizou a base. Suas alterações continuam neste navegador. Exporte o relatório para preservá-las antes de carregar a versão do servidor.'
      : `${error.message || 'Não foi possível sincronizar.'} ${pendingChanges ? 'Alterações pendentes; clique em Sincronizar para tentar novamente.' : ''}`);
}

function saveData(){
  const generation = ++editGeneration;
  pendingChanges = true;
  MODEL = modelFromLegacyData(DATA);
  const snapshot = JSON.parse(JSON.stringify(MODEL));
  try{
    cacheModel(true);
  }catch(error){
    reportSyncError(error);
    return Promise.resolve(false);
  }
  setSaveState('var(--amber)', remoteEnabled ? 'sincronizando...' : 'salvando localmente...');
  saveQueue = saveQueue.then(async ()=>{
    if(generation !== editGeneration) return false;
    try{
      if(remoteEnabled){
        if(conflict) throw new Error('Carregue a versão do servidor para resolver o conflito.');
        remoteRevision = await window.LicenseDataService.save(snapshot, remoteRevision);
      }
      pendingChanges = generation !== editGeneration;
      cacheModel(pendingChanges);
      if(!pendingChanges){
        setSaveState(remoteEnabled ? 'var(--green)' : 'var(--amber)',
          remoteEnabled ? 'sincronizado' : 'salvo só neste navegador');
      }
      return true;
    }catch(error){
      reportSyncError(error);
      return false;
    }
  });
  return saveQueue;
}

async function refreshFromServer(discardPending = false){
  if(!remoteEnabled || !appReady || refreshing || (pendingChanges && !discardPending)) return;
  refreshing = true;
  const generation = editGeneration;
  try{
    await saveQueue;
    const remote = await window.LicenseDataService.load();
    if(generation !== editGeneration || (pendingChanges && !discardPending)) return;
    if(!remote.model) throw new Error('A base central ainda não foi inicializada.');
    if(remote.revision !== remoteRevision || discardPending){
      MODEL = applyReferenceData(remote.model);
      DATA = flattenModel(MODEL);
      remoteRevision = remote.revision;
      pendingChanges = false;
      conflict = false;
      cacheModel(false);
      render();
    }
    setSaveState('var(--green)', 'sincronizado');
  }catch(error){
    reportSyncError(error);
  }finally{
    refreshing = false;
  }
}

/* ---------------------------------------------------------------
   TOAST
--------------------------------------------------------------- */
let toastTimer=null;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------------
   MODAL HELPERS
--------------------------------------------------------------- */
function openModal(id){ document.getElementById(id).classList.add('show'); }
function closeModal(id){ document.getElementById(id).classList.remove('show'); }

/* ---------------------------------------------------------------
   STATUS BADGE HELPERS
--------------------------------------------------------------- */
function statusBadgeClass(status){
  const s = (status||'').toLowerCase();
  if(s==='obtida') return 'b-obtida';
  if(s==='condicionada') return 'b-condicionada';
  if(s==='dispensada' || s==='não aplicável') return 'b-dispensada';
  if(s==='em análise') return 'b-analise';
  if(s==='indeferida') return 'b-indeferida';
  return 'b-pendente';
}
function riscoBadgeClass(r){
  const s=(r||'NA').toLowerCase();
  if(s==='alto') return 'b-risco-alto';
  if(s==='médio'||s==='medio') return 'b-risco-médio';
  if(s==='baixo') return 'b-risco-baixo';
  return 'b-risco-na';
}
function vencimentoBadge(iso){
  if(!iso) return null;
  const d = daysUntil(iso);
  if(d<0) return {cls:'b-venc-vencido', txt:`Vencida há ${Math.abs(d)}d`};
  if(d<=120) return {cls:'b-venc-alerta', txt:`Vence em ${d}d`};
  return {cls:'b-venc-ok', txt:`Vence em ${d}d`};
}
function actStatusClass(status){
  const s=(status||'').toLowerCase();
  if(s==='done') return 'st-done';
  if(s==='working on it') return 'st-working';
  if(s==='stuck') return 'st-stuck';
  return 'st-nao';
}

/* ---------------------------------------------------------------
   KPIs
--------------------------------------------------------------- */
function renderKPIs(list){
  const total = list.length;
  const obtidas = list.filter(l=>l.status==='Obtida').length;
  const pendentes = list.filter(l=>OPEN_STATUSES.includes(l.status)).length;
  const vencidas = list.filter(l=>l.vencimento && daysUntil(l.vencimento)<0).length;
  const altoRisco = list.filter(l=>(l.risco||'').toLowerCase()==='alto').length;
  const kpis = [
    {n:total, l:'Licenças no escopo', cls:''},
    {n:obtidas, l:'Obtidas', cls:'accent-green'},
    {n:pendentes, l:'Pendentes / em andamento', cls:'accent-amber'},
    {n:vencidas, l:'Vencidas ou em atraso', cls:'accent-red'},
    {n:altoRisco, l:'Risco alto', cls:'accent-purple'},
  ];
  document.getElementById('kpiRow').innerHTML = kpis.map(k=>`
    <div class="kpi ${k.cls}"><div class="num">${k.n}</div><div class="lbl">${k.l}</div></div>
  `).join('');
}

/* ---------------------------------------------------------------
   FILTERS
--------------------------------------------------------------- */
function populateFilterOptions(){
  const unidades = [...new Set((MODEL?.units || []).map(unit=>unit.nome || unit.codigo).filter(Boolean))].sort();
  const statuses = [...new Set(DATA.map(l=>l.status).filter(Boolean))].sort();
  const riscos = [...new Set(DATA.map(l=>l.risco).filter(Boolean))].sort();
  const fu = document.getElementById('fUnidade');
  const fs = document.getElementById('fStatus');
  const fr = document.getElementById('fRisco');
  const cur = {u:fu.value, s:fs.value, r:fr.value};
  fu.innerHTML = '<option value="">Todas as unidades</option>' + unidades.map(u=>`<option>${esc(u)}</option>`).join('');
  fs.innerHTML = '<option value="">Todos os status</option>' + statuses.map(s=>`<option>${s}</option>`).join('');
  fr.innerHTML = '<option value="">Todos os riscos</option>' + riscos.map(r=>`<option>${r}</option>`).join('');
  fu.value = cur.u; fs.value = cur.s; fr.value = cur.r;
}
function getFiltered(){
  const u = document.getElementById('fUnidade').value;
  const s = document.getElementById('fStatus').value;
  const r = document.getElementById('fRisco').value;
  const q = document.getElementById('fBusca').value.trim().toLowerCase();
  return DATA.filter(l=>{
    if(u && l.unidade!==u) return false;
    if(s && l.status!==s) return false;
    if(r && l.risco!==r) return false;
    if(q){
      const hay = `${l.id} ${l.tipoLicenca} ${l.orgaoEmissor} ${l.unidade} ${l.categoria} ${l.razaoSocial}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------------------------------------------------------------
   RENDER LICENSE LIST
--------------------------------------------------------------- */
function render(){
  populateFilterOptions();
  const list = getFiltered();
  renderKPIs(list);
  const root = document.getElementById('licList');
  const unitPanel = document.getElementById('unitPanel');
  const gantt = document.getElementById('ganttView');
  const calendar = document.getElementById('calendarPanel');
  const unitId = activePanel === 'unit' ? currentUnitId() : null;
  const unitDetail = Boolean(unitId);
  document.getElementById('dashboardFilters').hidden = unitDetail;
  document.getElementById('kpiRow').hidden = unitDetail;
  if(activePanel !== 'license' || activeView !== 'list') root.innerHTML = '';
  if(activePanel !== 'unit') unitPanel.innerHTML = '';
  if(activePanel !== 'calendar') calendar.innerHTML = '';
  root.hidden = activePanel !== 'license' || activeView !== 'list';
  unitPanel.hidden = activePanel !== 'unit';
  calendar.hidden = activePanel !== 'calendar';
  gantt.hidden = activePanel !== 'license' || activeView !== 'gantt';
  document.getElementById('viewSwitch').hidden = activePanel !== 'license';
  document.getElementById('btnLicensePanel').classList.toggle('active', activePanel === 'license');
  document.getElementById('btnUnitPanel').classList.toggle('active', activePanel === 'unit');
  document.getElementById('btnCalendarPanel').classList.toggle('active', activePanel === 'calendar');
  document.getElementById('btnListView').classList.toggle('active', activeView === 'list');
  document.getElementById('btnGanttView').classList.toggle('active', activeView === 'gantt');
  if(activePanel === 'calendar'){
    renderCalendar(list);
    return;
  }
  if(activePanel === 'unit'){
    if(unitId) renderUnitDetail(unitId);
    else renderUnitPanel(list);
    return;
  }
  if(activeView === 'gantt'){
    renderGantt(list);
    return;
  }
  if(list.length===0){
    root.innerHTML = `<div class="empty">Nenhuma licença encontrada com os filtros atuais.</div>`;
    return;
  }
  root.innerHTML = list.map(lic=>renderCard(lic)).join('');
  attachCardEvents();
  attachEvidenceEvents(root);
}

function currentUnitId(){
  return new URLSearchParams((window.location.hash || '').slice(1)).get('unit');
}

function navigatePanel(hash){
  window.location.hash = hash;
  applyPanelRoute();
}

function applyPanelRoute(){
  const hash = window.location.hash;
  activePanel = hash === '#licenses' ? 'license' : hash === '#calendar' ? 'calendar' : 'unit';
  if(appReady) render();
}

window.addEventListener('hashchange', applyPanelRoute);

function openLicense(id){
  expandedIds.add(id);
  activeView = 'list';
  navigatePanel('#licenses');
  const card = window.CSS ? document.querySelector(`.lic-card[data-id="${window.CSS.escape(id)}"]`) : null;
  card?.scrollIntoView({block: 'start'});
}

let calendarMonth = todayStr().slice(0,7);

function renderCalendar(list){
  const root = document.getElementById('calendarPanel');
  const groups = calendarGroups(list, calendarMonth);
  const {start, end} = monthBounds(calendarMonth);
  const label = new Intl.DateTimeFormat('pt-BR', {month: 'long', year: 'numeric', timeZone: 'UTC'})
    .format(new Date(`${start}T00:00:00Z`));
  const dueThisMonth = groups.acao.filter(({span})=>span.vencimento <= end).length;
  const item = ({lic, span})=>{
    const tags = [];
    if(span){
      tags.push(`<span class="badge b-condicionada">${span.abertura < start ? 'Janela aberta desde' : 'Janela abre em'} ${esc(fmtDate(span.abertura))}</span>`);
      tags.push(`<span class="badge ${span.vencimento <= end ? 'b-venc-vencido' : 'b-venc-ok'}">Vence em ${esc(fmtDate(span.vencimento))}</span>`);
    }
    return `<li class="calendar-item">
      <div class="calendar-info"><strong>${esc(lic.id)} · ${esc(lic.tipoLicenca || lic.categoria || '—')}</strong>
        <p>${esc(lic.unidade)} · ${esc(lic.orgaoEmissor || '—')}</p>
        <p class="calendar-flow">${esc(flowSummary(lic))}</p></div>
      <div class="calendar-meta"><span class="badge ${statusBadgeClass(lic.status)}">${esc(lic.status || '—')}</span>${tags.join('')}
        <button class="btn" data-open-license="${esc(lic.id)}">Abrir licença</button></div>
    </li>`;
  };
  const itemList = entries=>`<ul class="calendar-list">${entries.map(item).join('')}</ul>`;
  root.innerHTML = `<div class="calendar-head">
      <button class="btn" data-month="-1" aria-label="Mês anterior">‹</button>
      <h2>${esc(label)}</h2>
      <button class="btn" data-month="1" aria-label="Próximo mês">›</button>
      <button class="btn btn-ghost" data-month="0">Mês atual</button>
    </div>
    <p class="calendar-help">Ciclo mensal de acompanhamento: a janela de renovação abre alguns dias antes do vencimento (120 por padrão, ajustável em cada licença). Licenças com a janela aberta seguem o fluxo; as demais aguardam o próximo ciclo.</p>
    <div class="unit-detail-summary">
      <div class="kpi accent-amber"><div class="num">${groups.acao.length}</div><div class="lbl">Janela aberta no mês</div></div>
      <div class="kpi accent-red"><div class="num">${dueThisMonth}</div><div class="lbl">Vencem no mês</div></div>
      <div class="kpi accent-red"><div class="num">${groups.vencidas.length}</div><div class="lbl">Vencidas antes do mês</div></div>
      <div class="kpi"><div class="num">${groups.aguardar.length}</div><div class="lbl">Aguardar próximo ciclo</div></div>
    </div>
    <section class="unit-detail-section"><h2>Ação neste ciclo (${groups.acao.length})</h2>
      ${groups.acao.length ? itemList(groups.acao) : '<p>Nenhuma janela de renovação aberta neste mês.</p>'}
    </section>
    <section class="unit-detail-section"><h2>Vencidas (${groups.vencidas.length})</h2>
      ${groups.vencidas.length ? itemList(groups.vencidas) : '<p>Nenhuma licença vencida antes deste mês.</p>'}
    </section>
    <section class="unit-detail-section"><details><summary><h2>Aguardar o próximo ciclo (${groups.aguardar.length})</h2></summary>
      ${itemList(groups.aguardar)}</details>
    </section>
    <section class="unit-detail-section"><details><summary><h2>Sem data de vencimento (${groups.semData.length})</h2></summary>
      <p class="calendar-help">Dispensas e licenças sem validade: revise se continuam aplicáveis.</p>
      ${itemList(groups.semData)}</details>
    </section>`;
  root.querySelectorAll('[data-month]').forEach(button=>button.addEventListener('click', ()=>{
    const delta = Number(button.dataset.month);
    calendarMonth = delta ? shiftMonth(calendarMonth, delta) : todayStr().slice(0,7);
    render();
  }));
  root.querySelectorAll('[data-open-license]').forEach(button=>button.addEventListener('click', ()=>{
    openLicense(button.dataset.openLicense);
  }));
}

function renderUnitDetail(id){
  const root = document.getElementById('unitPanel');
  const unit = MODEL.units.find(item=>item.id === id);
  const back = '<button class="btn" data-back-units>← Voltar às unidades</button>';
  if(!unit){
    root.innerHTML = `${back}<p class="empty" role="status">Unidade não encontrada nesta organização.</p>`;
    attachUnitPanelEvents();
    return;
  }
  const licenses = DATA.filter(lic=>lic.unidadeId === id);
  const pending = licenses.filter(lic=>OPEN_STATUSES.includes(lic.status)).length;
  const expired = licenses.filter(lic=>lic.vencimento && daysUntil(lic.vencimento) < 0).length;
  const due = licenses.filter(lic=>lic.vencimento && daysUntil(lic.vencimento) >= 0 && daysUntil(lic.vencimento) <= 120).length;
  root.innerHTML = `<article class="unit-detail">
    ${back}
    <header class="unit-detail-header"><div><div class="unit-panel-kicker">Unidade</div>
      <h1 tabindex="-1" id="unitDetailTitle">${esc(unit.nome || unit.codigo)}</h1>
      <p>${esc(unit.cidade)} / ${esc(unit.uf)}</p></div>
      <div class="unit-actions"><button class="btn" data-edit-unit="${esc(unit.id)}">Editar unidade</button>
        <button class="btn btn-danger" data-delete-unit="${esc(unit.id)}">Excluir unidade</button>
        <button class="btn btn-primary" data-new-unit-license="${esc(unit.id)}">+ Nova licença</button></div>
    </header>
    <div class="unit-detail-summary">
      <div class="kpi"><div class="num">${licenses.length}</div><div class="lbl">Licenças</div></div>
      <div class="kpi"><div class="num">${pending}</div><div class="lbl">Pendentes / em andamento</div></div>
      <div class="kpi"><div class="num">${expired}</div><div class="lbl">Vencidas</div></div>
      <div class="kpi"><div class="num">${due}</div><div class="lbl">Vencem em até 120 dias</div></div>
    </div>
    <section class="unit-detail-section" aria-label="Perfil da unidade">
      ${renderUnitProfile({perfilUnidade: unit.profile || {}}) || '<h2>Perfil da unidade</h2><p>Perfil ainda não preenchido. Use Editar unidade.</p>'}
    </section>
    <section class="unit-detail-section">${renderEvidence('unit', unit)}</section>
    <section class="unit-detail-section"><h2>Obrigações ambientais</h2>
      ${(unit.environmentalLicenses || []).map(item=>`<div class="notes-box"><strong>${esc(item.tipo)}</strong>
        <p>${esc(item.orgao)} · ${esc(item.numero || 'Sem número')}</p>
        <p>${esc(item.motivacao || '')}</p><p>${esc(item.risco || '')}</p></div>`).join('') || '<p>Nenhuma obrigação cadastrada.</p>'}
    </section>
    <section class="unit-detail-section">${renderUnitFlow(unit)}</section>
    <section class="unit-detail-section"><h2>Licenças da unidade</h2>
      ${licenses.map(lic=>renderCard(lic)).join('') || '<p>Nenhuma licença cadastrada. Use + Nova licença para adicionar a primeira.</p>'}
    </section>
  </article>`;
  attachUnitPanelEvents();
  attachCardEvents();
  attachEvidenceEvents(root);
}

/* Diagrama em raias do fluxograma, com o andamento das atividades de cada etapa. */
function renderFlowDiagram(lic, flow = walkFlow(lic)){
  if(!flow) return '';
  const {def} = flow;
  const states = new Map(flow.items.map(item=>[item.node.id, item]));
  const extras = lic.fluxo.extras || [];
  const nodes = [];
  def.nos.forEach(node=>{
    if(node.condicional && !extras.includes(node.id)) return;
    nodes.push(node);
    const final = states.get(node.id)?.option?.etapa;
    if(final && states.has(final)) nodes.push(flowNode(def, final));
  });
  const lanes = [...new Set(nodes.map(node=>node.area).filter(Boolean))];
  let lane = lanes[0];
  const cells = nodes.map((node, index)=>{
    if(node.area) lane = node.area;
    const item = states.get(node.id);
    const state = item?.state || 'inativo';
    const position = `grid-row:${lanes.indexOf(lane) + 1};grid-column:${index + 2}`;
    if(node.decisao){
      return `<div class="dg-node dg-gate dg-${state}" style="${position}">
        <span class="dg-diamond" aria-hidden="true"></span><strong>${esc(node.decisao)}</strong>
        <small>${item?.option ? esc(item.option.rotulo) : state === 'atual' ? 'Aguardando decisão' : 'Decisão'}</small></div>`;
    }
    const activities = flowActivities(lic, node.id);
    const done = activities.filter(activity=>STEP_DONE.includes(activity.status)).length;
    return `<div class="dg-node dg-${state}" style="${position}" title="${esc(activities.map(activity=>`${activity.status} · ${activity.name}`).join('\n'))}">
      <span class="dg-num">${index + 1}</span><strong>${esc(node.nome)}</strong>
      <small>${done}/${activities.length} ${activities.length === 1 ? 'atividade' : 'atividades'}</small></div>`;
  }).join('');
  const columns = `grid-template-columns:118px repeat(${nodes.length}, 132px)`;
  return `<div class="flow-diagram"><div class="dg-grid" style="${columns}">
      ${lanes.map((name, index)=>`<div class="dg-band" style="grid-row:${index + 1}"></div><div class="dg-lane" style="grid-row:${index + 1}">${esc(name)}</div>`).join('')}
      ${cells}
    </div>
    <div class="dg-legend"><span class="dg-key dg-feito">Concluída</span><span class="dg-key dg-atual">Atual</span><span class="dg-key dg-futuro">A fazer</span></div>
  </div>`;
}

function renderUnitFlow(unit){
  const licenses = DATA.filter(lic=>lic.unidadeId === unit.id);
  const flows = licenses.filter(lic=>PROCESS_FLOWS[lic.fluxo?.tipo]);
  const target = licenses.find(lic=>spreadsheetFlowFor(lic));
  const hint = target && !target.fluxo
    ? `<p class="flow-help">Aplicar o fluxo de Licenças na licença ${esc(target.id)} importa as ${spreadsheetFlowFor(target).etapas.length} atividades da planilha desta unidade, cada uma ligada a uma etapa do fluxograma.</p>` : '';
  if(!flows.length){
    return `<h2>Fluxo da unidade</h2><p>Nenhuma licença desta unidade segue o fluxograma ainda. Abra uma licença abaixo e use Aplicar fluxo.</p>${hint}`;
  }
  return `<h2>Fluxo da unidade</h2>${hint}
    ${flows.map(lic=>`<div class="unit-flow-license">
      <div class="unit-flow-head"><div><strong>${esc(lic.id)} · ${esc(lic.tipoLicenca || lic.categoria || '—')}</strong>
        <p>${esc(PROCESS_FLOWS[lic.fluxo.tipo].nome)} · ${esc(flowSummary(lic))}</p></div>
        <button class="btn" data-open-unit-license="${esc(lic.id)}">Abrir licença</button></div>
      ${renderFlowDiagram(lic)}
    </div>`).join('')}`;
}

function renderUnitPanel(list){
  const root = document.getElementById('unitPanel');
  const selected = document.getElementById('fUnidade').value;
  const query = document.getElementById('fBusca').value.trim().toLowerCase();
  const licenseFilter = document.getElementById('fStatus').value || document.getElementById('fRisco').value;
  const entries = (MODEL?.units || []).map(unit=>({
    unit, licenses: list.filter(lic=>lic.unidadeId === unit.id)
  })).filter(({unit, licenses})=>{
    if(selected && (unit.nome || unit.codigo) !== selected) return false;
    if(licenses.length) return true;
    if(licenseFilter || DATA.some(lic=>lic.unidadeId === unit.id)) return false;
    return !query || `${unit.nome} ${unit.cidade} ${unit.uf}`.toLowerCase().includes(query);
  });
  if(!entries.length){
    root.innerHTML = '<div class="empty">Nenhuma unidade encontrada com os filtros atuais.</div>';
    return;
  }
  root.innerHTML = `<div class="unit-panel-grid">${entries.sort((a,b)=>a.unit.nome.localeCompare(b.unit.nome)).map(({unit, licenses})=>{
    const name = unit.nome || unit.codigo;
    const sample = unit;
    const profile = unit.profile || {};
    const done = licenses.reduce((sum, lic)=>sum+(lic.activities||[]).filter(a=>a.status==='Done').length,0);
    const activityTotal = licenses.reduce((sum, lic)=>sum+(lic.activities||[]).length,0);
    return `<article class="unit-panel">
      <div class="unit-panel-head"><div><div class="unit-panel-kicker">Unidade</div><h2>${esc(name)}</h2><p>${esc(sample.cidade || '')}${sample.uf ? `/${esc(sample.uf)}` : ''}</p></div><button class="btn btn-ghost" data-edit-unit="${esc(unit.id)}">Editar unidade</button></div>
      <div class="unit-summary"><span><strong>${licenses.length}</strong> processos</span><span><strong>${unit.environmentalLicenses?.length || 0}</strong> obrigações</span><span><strong>${done}/${activityTotal}</strong> etapas concluídas</span></div>
      <div class="unit-actions"><a class="btn" href="#unit=${encodeURIComponent(unit.id)}">Abrir unidade</a><button class="btn" data-new-unit-license="${esc(unit.id)}">+ Nova licença</button></div>
      <div class="unit-profile-strip"><span><b>Razão social</b>${esc(profile.razaoSocial || sample.razaoSocial || 'Não informado')}</span><span><b>Atividade</b>${esc(profile.atividadesConduzidas || 'Não informado')}</span><span><b>Área</b>${esc(profile.area || 'Não informado')}</span></div>
      ${!licenses.length ? '<p>Nenhuma licença cadastrada.</p>' : ''}
    </article>`;
  }).join('')}</div>`;
  attachUnitPanelEvents();
  attachEvidenceEvents(root);
}

function attachUnitPanelEvents(){
  document.querySelectorAll('[data-delete-unit]').forEach(button=>button.addEventListener('click', ()=>{
    void deleteUnit(button.dataset.deleteUnit);
  }));
  document.querySelectorAll('[data-back-units]').forEach(button=>button.addEventListener('click', ()=>navigatePanel('#units')));
  document.querySelectorAll('[data-open-unit-license]').forEach(button=>button.addEventListener('click', ()=>{
    const id = button.dataset.openUnitLicense;
    expandedIds.add(id);
    render();
    const card = window.CSS ? document.querySelector(`.lic-card[data-id="${window.CSS.escape(id)}"]`) : null;
    card?.scrollIntoView({block: 'start'});
  }));
  document.querySelectorAll('[data-edit-unit]').forEach(button=>button.addEventListener('click', ()=>{
    openUnitEditor(button.dataset.editUnit);
  }));
  document.querySelectorAll('[data-new-unit-license]').forEach(button=>button.addEventListener('click', ()=>{
    openNewLicense(button.dataset.newUnitLicense);
  }));
}

async function deleteUnit(id){
  const unit = MODEL.units.find(item=>item.id === id);
  if(!unit){
    showToast('A unidade não está mais disponível. Carregue o servidor.');
    return false;
  }
  if(DATA.some(lic=>lic.unidadeId === id)){
    showToast('Não é possível excluir: a unidade possui licenças vinculadas. Remova ou transfira as licenças antes.');
    return false;
  }
  if(!confirm(`Excluir a unidade "${unit.nome || unit.codigo}" para todos os colaboradores? O perfil, as obrigações, o fluxo e os vínculos de comprovantes serão removidos. Arquivos no OneDrive não serão apagados.`)){
    return false;
  }
  MODEL.units = MODEL.units.filter(item=>item.id !== id);
  if(document.getElementById('fUnidade').value === (unit.nome || unit.codigo)){
    document.getElementById('fUnidade').value = '';
  }
  const saving = saveData();
  navigatePanel('#units');
  const saved = await saving;
  showToast(saved ? 'Unidade excluída' : 'Exclusão local pendente de sincronização');
  return saved;
}

function dateMs(iso){
  return iso ? Date.parse(`${iso}T00:00:00Z`) : null;
}

function renderGantt(list){
  const root = document.getElementById('ganttView');
  const dated = list.filter(l=>l.dataEmissao || l.vencimento);
  if(!dated.length){
    root.innerHTML = '<div class="empty">Nenhuma licença possui datas para exibir no Gantt.</div>';
    return;
  }
  const startMs = Math.min(...dated.map(l=>dateMs(l.dataEmissao || l.vencimento)));
  const endMs = Math.max(...dated.map(l=>dateMs(l.vencimento || l.dataEmissao)));
  const monthStart = new Date(startMs); monthStart.setUTCDate(1);
  const monthEnd = new Date(endMs); monthEnd.setUTCDate(1); monthEnd.setUTCMonth(monthEnd.getUTCMonth()+1);
  const totalMs = monthEnd - monthStart;
  const months = [];
  for(let d=new Date(monthStart); d<monthEnd; d.setUTCMonth(d.getUTCMonth()+1)){
    months.push(new Intl.DateTimeFormat('pt-BR',{month:'short',year:'numeric',timeZone:'UTC'}).format(d));
  }
  const pos = ms => Math.max(0, Math.min(100, ((ms-monthStart)/totalMs)*100));
  const todayPosition = pos(dateMs(todayStr()));
  const rows = dated.map(lic=>{
    const barStart = dateMs(lic.dataEmissao || lic.vencimento);
    const barEnd = dateMs(lic.vencimento || lic.dataEmissao);
    const left = pos(barStart);
    const width = Math.max(1.2, pos(barEnd)-left);
    const markers = (lic.activities||[]).filter(a=>a.date).map(a=>`<span class="gantt-marker" style="left:${pos(dateMs(a.date))}%" title="${esc(a.name)} · ${fmtDate(a.date)}"></span>`).join('');
    return `<div class="gantt-row">
      <div class="gantt-license"><strong>${esc(lic.id)} · ${esc(lic.tipoLicenca)}</strong><span>${esc(lic.unidade)} · ${esc(lic.status)}</span></div>
      <div class="gantt-track" style="--gantt-months:${months.length};--today-position:${todayPosition}%">
        <span class="gantt-bar ${statusBadgeClass(lic.status)}" style="left:${left}%;width:${width}%" title="${esc(fmtDate(lic.dataEmissao))} até ${esc(fmtDate(lic.vencimento))}"></span>${markers}
      </div>
    </div>`;
  }).join('');
  root.innerHTML = `<div class="gantt-shell">
    <div class="gantt-head"><div class="gantt-label">Licença</div><div class="gantt-months" style="grid-template-columns:repeat(${months.length},1fr)">${months.map(m=>`<div class="gantt-month">${m}</div>`).join('')}</div></div>
    ${rows}
    <div class="gantt-legend"><span><i class="legend-bar"></i>Período da licença</span><span><i class="legend-marker"></i>Atividade</span><span><i></i>Hoje</span></div>
  </div>`;
}

function renderCard(lic){
  const open = expandedIds.has(lic.id);
  const venc = vencimentoBadge(lic.vencimento);
  const doneCount = lic.activities.filter(a=>a.status==='Done').length;
  return `
  <div class="lic-card ${open?'open':''}" data-id="${esc(lic.id)}">
    <div class="lic-head" data-toggle="${esc(lic.id)}">
      <svg class="chev" viewBox="0 0 24 24"><path fill="currentColor" d="M9 6l6 6-6 6"/></svg>
      <div class="lic-id">${esc(lic.id)}</div>
      <div class="lic-title">
        <div class="name">${esc(lic.tipoLicenca||lic.categoria||'—')} · ${esc(lic.unidade)}</div>
        <div class="sub">${esc(lic.orgaoEmissor||'—')} · ${lic.cidade?esc(lic.cidade)+'/'+esc(lic.uf):''} · ${doneCount}/${lic.activities.length} atividades concluídas${lic.fluxo ? ` · ${esc(flowSummary(lic))}` : ''}</div>
      </div>
      <div class="badges">
        <span class="badge ${statusBadgeClass(lic.status)}">${esc(lic.status||'—')}</span>
        <span class="badge ${riscoBadgeClass(lic.risco)}">Risco ${esc(lic.risco||'NA')}</span>
        ${venc?`<span class="badge ${venc.cls}">${venc.txt}</span>`:''}
      </div>
    </div>
    <div class="lic-body">
      ${renderFields(lic)}
        ${renderUnitProfile(lic)}
      ${renderEvidence('license', lic)}
      ${renderFlow(lic)}
      ${renderActivities(lic)}
      ${lic.notes?`<div class="notes-box">📝 ${esc(lic.notes)}</div>`:''}
      <div class="card-footer">
        <span style="font-size:11px;color:var(--ink-soft);">Última atualização: ${esc(lic.lastUpdated||'—')}</span>
        <button class="btn btn-danger" data-del-lic="${esc(lic.id)}">Excluir licença</button>
      </div>
    </div>
  </div>`;
}

function renderFields(lic){
  const f = (label,key,type='text')=>`
    <div class="field"><label>${label}</label><input type="${type}" data-lic="${esc(lic.id)}" data-field="${key}" value="${esc(lic[key]||'')}" ${['unidade','cidade','uf'].includes(key) ? 'readonly title="Altere pelo cadastro da unidade"' : ''}></div>`;
  const sel = (label,key,options)=>`
    <div class="field"><label>${label}</label>
    <select data-lic="${esc(lic.id)}" data-field="${key}">
      ${options.map(o=>`<option ${o===lic[key]?'selected':''}>${o}</option>`).join('')}
    </select></div>`;
  return `<div class="field-grid">
    ${f('Unidade','unidade')}
    ${f('Cidade','cidade')}
    ${f('UF','uf')}
    ${sel('Risco','risco',['NA','Baixo','Médio','Alto'])}
    <div class="field wide"><label>Razão Social</label><input data-lic="${esc(lic.id)}" data-field="razaoSocial" value="${esc(lic.razaoSocial||'')}"></div>
    <div class="field wide"><label>Categoria</label><input data-lic="${esc(lic.id)}" data-field="categoria" value="${esc(lic.categoria||'')}"></div>
    ${f('Órgão Emissor','orgaoEmissor')}
    ${f('Tipo de Licença','tipoLicenca')}
    ${sel('Status','status',LICENSE_STATUSES)}
    ${f('Data de Emissão','dataEmissao','date')}
    ${f('Vencimento','vencimento','date')}
    <div class="field"><label>Janela de renovação (dias)</label><input type="number" min="1" step="1" data-lic="${esc(lic.id)}" data-field="antecedenciaDias" value="${esc(lic.antecedenciaDias||'')}" placeholder="${esc(PROCESS_FLOWS[lic.fluxo?.tipo || suggestedFlowType(lic)]?.antecedenciaDias || 120)}" title="Dias antes do vencimento em que a renovação entra no ciclo mensal"></div>
    <div class="field full"><label>Notas</label><textarea data-lic="${esc(lic.id)}" data-field="notes">${esc(lic.notes||'')}</textarea></div>
  </div>`;
}

function renderUnitProfile(lic){
  const profile = lic.perfilUnidade || {};
  const licenses = lic.licencasUnidade || [];
  const fields = PROFILE_FIELDS.filter(([, key])=>profile[key]);
  if(!fields.length) return '';
  return `<div class="section-label">Perfil da unidade</div>
    <div class="field-grid unit-profile">
      ${fields.map(([label, key])=>`<div class="field ${['endereco','atividadeAmbiental','atividadesConduzidas'].includes(key)?'wide':''}"><label>${label}</label><div class="profile-value">${esc(profile[key])}</div></div>`).join('')}
    </div>
    ${licenses.length?`<details class="standard-flow"><summary>Obrigações ambientais (${licenses.length})</summary><ul>${licenses.map(item=>`<li><strong>${esc(item.tipo)}</strong> · ${esc(item.orgao)} · ${esc(item.numero || 'sem número')} · ${esc(item.risco)}</li>`).join('')}</ul></details>`:''}`;
}

function flowStepOptions(lic){
  const def = PROCESS_FLOWS[lic.fluxo?.tipo];
  if(!def) return [];
  const extras = lic.fluxo.extras || [];
  return [
    ...def.nos.filter(node=>!node.decisao && (!node.condicional || extras.includes(node.id))),
    ...Object.values(def.etapasFinais || {}).filter(node=>flowActivity(lic, node.id))
  ];
}

function renderActivities(lic){
  const steps = flowStepOptions(lic);
  const rows = lic.activities.map((a,i)=>{
    const overdue = a.date && daysUntil(a.date)<0 && a.status!=='Done';
    const linked = steps.some(node=>node.id === a.etapaPadraoId);
    const stepCell = steps.length ? `<td><select data-af="etapaPadraoId" class="act-step" aria-label="Etapa do fluxo">
        <option value="" ${linked ? '' : 'selected'}>— sem etapa —</option>
        ${steps.map(node=>`<option value="${esc(node.id)}" ${node.id === a.etapaPadraoId ? 'selected' : ''}>${esc(node.nome)}</option>`).join('')}
      </select></td>` : '';
    return `
    <tr data-lic="${esc(lic.id)}" data-idx="${i}">
      <td><input data-af="name" value="${esc(a.name)}"></td>${stepCell}
      <td><input data-af="owner" value="${esc(a.owner||'')}" placeholder="responsável"></td>
      <td>
        <select data-af="status" class="act-status ${actStatusClass(a.status)}">
          ${ACTIVITY_STATUSES.map(s=>`<option ${s===a.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" data-af="date" value="${esc(a.date||'')}" class="${overdue?'act-overdue':''}"></td>
      <td><input data-af="observacao" value="${esc(a.observacao||'')}" placeholder="observação"></td>
      <td><button class="del-x" data-del-act="1" title="Remover atividade">✕</button></td>
    </tr>`;
  }).join('');
  return `
  <div class="section-label">Atividades / etapas
    <button class="btn" style="padding:5px 10px;font-size:12px;" data-add-act="${esc(lic.id)}">+ Adicionar atividade</button>
  </div>
  <table class="act-table">
    <thead><tr>${steps.length
      ? '<th style="width:22%">Atividade</th><th style="width:18%">Etapa do fluxo</th><th style="width:13%">Responsável</th><th style="width:13%">Status</th><th style="width:11%">Data</th><th style="width:20%">Observação</th>'
      : '<th style="width:24%">Atividade</th><th style="width:16%">Responsável</th><th style="width:16%">Status</th><th style="width:13%">Data</th><th style="width:25%">Observação</th>'}<th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderFlow(lic){
  const flow = walkFlow(lic);
  if(!flow){
    const suggested = suggestedFlowType(lic);
    const spec = spreadsheetFlowFor(lic);
    return `<section class="flow-section"><div class="section-label">Fluxo do processo</div>
      <p class="flow-help">Esta licença ainda não segue o fluxograma. ${spec
        ? `Aplicar o fluxo de Licenças importa as ${spec.etapas.length} atividades da planilha da unidade, cada uma ligada a uma etapa do fluxograma, e mantém as atividades atuais.`
        : 'Aplicar o fluxo acrescenta as etapas e mantém as atividades atuais.'}</p>
      <div class="flow-apply"><select data-flow-type aria-label="Fluxo do processo">
        ${Object.entries(PROCESS_FLOWS).map(([key, def])=>`<option value="${esc(key)}" ${key===suggested?'selected':''}>${esc(def.nome)}</option>`).join('')}
      </select><button class="btn btn-primary" data-flow-apply="${esc(lic.id)}">Aplicar fluxo</button></div>
    </section>`;
  }
  const {def, current, fim} = flow;
  let action;
  if(fim){
    action = `<div class="flow-current flow-finished"><div class="flow-kicker">Fluxo concluído</div><strong>${esc(fim)}</strong>
      <p>Quando a próxima janela de renovação abrir, inicie um novo ciclo.</p>
      <button class="btn" data-flow-cycle="${esc(lic.id)}">Iniciar novo ciclo</button></div>`;
  }else if(current.node.decisao){
    action = `<div class="flow-current"><div class="flow-kicker">Decisão</div><strong>${esc(current.node.decisao)}</strong>
      <div class="unit-actions">${current.node.opcoes.map(option=>`<button class="btn" data-flow-decide="${esc(lic.id)}" data-gate="${esc(current.node.id)}" data-option="${esc(option.id)}">${esc(option.rotulo)}</button>`).join('')}</div></div>`;
  }else{
    const pending = flowActivities(lic, current.node.id).filter(activity=>!STEP_DONE.includes(activity.status));
    action = `<div class="flow-current"><div class="flow-kicker">Etapa atual${current.node.area ? ` · ${esc(current.node.area)}` : ''}</div>
      <strong>${esc(current.node.nome)}</strong>${current.node.nota ? `<p>${esc(current.node.nota)}</p>` : ''}
      ${pending.length ? `<p>Atividades pendentes desta etapa:</p><ul class="flow-pending">${pending.map(activity=>`<li>${esc(activity.name)}${activity.owner ? ` <small>· ${esc(activity.owner)}</small>` : ''}</li>`).join('')}</ul>` : ''}
      <button class="btn btn-primary" data-flow-complete="${esc(lic.id)}" data-step="${esc(current.node.id)}" data-count="${pending.length}">${pending.length > 1 ? `Concluir as ${pending.length} atividades da etapa` : 'Concluir etapa'}</button></div>`;
  }
  const importable = def === PROCESS_FLOWS.licenca && !lic.fluxo.planilhaImportada && spreadsheetFlowFor(lic);
  const history = [...(lic.fluxo.historico || [])].reverse();
  return `<section class="flow-section"><div class="section-label">Fluxo · ${esc(def.nome)} · ciclo ${esc(lic.fluxo.ciclo || 1)}</div>
    ${importable ? `<div class="flow-import"><p class="flow-help">A planilha da unidade tem ${importable.etapas.length} atividades para esta licença. Importar liga cada uma a uma etapa do fluxograma e substitui as etapas genéricas ainda não iniciadas.</p>
      <button class="btn" data-flow-import="${esc(lic.id)}">Importar atividades da planilha</button></div>` : ''}
    ${action}
    ${renderFlowDiagram(lic, flow)}
    ${history.length ? `<details class="standard-flow"><summary>Histórico do fluxo (${history.length})</summary><ul>${history.map(entry=>`<li>${esc(fmtDate(entry.data))} · ciclo ${esc(entry.ciclo)} · ${esc(entry.texto)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

async function runFlowAction(id, action, message){
  const lic = DATA.find(item=>item.id === id);
  try{
    if(!lic) throw new Error('A licença não está mais disponível. Carregue o servidor.');
    action(lic);
  }catch(error){
    showToast(error.message);
    return false;
  }
  const saving = saveData();
  render();
  const saved = await saving;
  showToast(saved ? message : `${message} localmente; sincronização pendente`);
  return saved;
}

function esc(s){
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function oneDriveUrl(value){
  let url;
  try{
    url = new URL(value);
  }catch{
    throw new Error('Informe um link válido do OneDrive.');
  }
  const host = url.hostname.toLowerCase();
  if(url.protocol !== 'https:' || url.username || url.password || url.port
    || !(host === '1drv.ms' || host === 'onedrive.live.com'
      || host.endsWith('.sharepoint.com'))){
    throw new Error('Use um link HTTPS do OneDrive (1drv.ms, onedrive.live.com ou sua organização em sharepoint.com).');
  }
  return url.href;
}

function renderEvidence(scope, record){
  const links = record.evidenceLinks || [];
  const rows = links.map((link, index)=>{
    let anchor;
    try{
      anchor = `<a href="${esc(oneDriveUrl(link.url))}" target="_blank" rel="noopener noreferrer">${esc(link.name)}</a>`;
    }catch{
      anchor = `<span>${esc(link.name)} — link inválido; edite o vínculo.</span>`;
    }
    return `<li>${anchor}<div class="unit-actions">
      <button class="btn" data-evidence-edit="${index}" data-scope="${scope}" data-record="${esc(record.id)}">Editar</button>
      <button class="btn btn-danger" data-evidence-delete="${index}" data-scope="${scope}" data-record="${esc(record.id)}">Remover vínculo</button>
    </div></li>`;
  }).join('');
  return `<section class="evidence-section"><div class="section-label">Comprovantes · OneDrive</div>
    ${links.length ? `<ul class="evidence-list">${rows}</ul>` : '<p>Nenhum comprovante vinculado.</p>'}
    <button class="btn" data-evidence-add data-scope="${scope}" data-record="${esc(record.id)}">+ Vincular comprovante</button>
  </section>`;
}

let evidenceTarget = null;

function evidenceRecord(scope, id){
  return (scope === 'unit' ? MODEL.units : DATA).find(record=>record.id === id);
}

function openEvidenceEditor(scope, id, index = null){
  const record = evidenceRecord(scope, id);
  if(!record){ showToast('O registro não está mais disponível. Carregue o servidor.'); return; }
  const link = index === null ? null : record.evidenceLinks?.[index];
  if(index !== null && !link){ showToast('O vínculo não está mais disponível.'); return; }
  evidenceTarget = {scope, id, index};
  document.getElementById('evidenceTitle').textContent = scope === 'unit'
    ? 'Comprovante da unidade · OneDrive' : 'Comprovante da licença · OneDrive';
  document.getElementById('evidenceName').value = link?.name || '';
  document.getElementById('evidenceUrl').value = link?.url || '';
  document.getElementById('evidenceError').hidden = true;
  openModal('overlayEvidence');
}

function attachEvidenceEvents(root){
  root.querySelectorAll('[data-evidence-add], [data-evidence-edit]').forEach(button=>{
    button.addEventListener('click', ()=>openEvidenceEditor(button.dataset.scope,
      button.dataset.record, button.hasAttribute('data-evidence-edit') ? Number(button.dataset.evidenceEdit) : null));
  });
  root.querySelectorAll('[data-evidence-delete]').forEach(button=>{
    button.addEventListener('click', async ()=>{
      const record = evidenceRecord(button.dataset.scope, button.dataset.record);
      const index = Number(button.dataset.evidenceDelete);
      if(!record?.evidenceLinks?.[index]){ showToast('O vínculo não está mais disponível.'); return; }
      if(!confirm('Remover este vínculo para todos os colaboradores? O arquivo não será excluído do OneDrive.')) return;
      record.evidenceLinks.splice(index, 1);
      const saving = saveData();
      render();
      showToast(await saving ? 'Vínculo removido' : 'Remoção pendente de sincronização');
    });
  });
}

document.getElementById('evidenceForm').addEventListener('submit', async event=>{
  event.preventDefault();
  const error = document.getElementById('evidenceError');
  try{
    if(!evidenceTarget) throw new Error('Selecione uma unidade ou licença para vincular o comprovante.');
    const record = evidenceRecord(evidenceTarget.scope, evidenceTarget.id);
    if(!record) throw new Error('O registro não está mais disponível. Feche esta janela e carregue o servidor.');
    const name = document.getElementById('evidenceName').value.trim();
    if(!name) throw new Error('Informe um nome para o comprovante.');
    const url = oneDriveUrl(document.getElementById('evidenceUrl').value.trim());
    const links = record.evidenceLinks || [];
    if(links.some((link, index)=>index !== evidenceTarget.index && link.url === url)){
      throw new Error('Este link já está vinculado a este registro.');
    }
    if(evidenceTarget.index === null) links.push({name, url});
    else{
      if(!links[evidenceTarget.index]) throw new Error('O vínculo não está mais disponível.');
      links[evidenceTarget.index] = {...links[evidenceTarget.index], name, url};
    }
    record.evidenceLinks = links;
  }catch(cause){
    error.textContent = cause.message;
    error.hidden = false;
    return;
  }
  const saving = saveData();
  closeModal('overlayEvidence');
  render();
  showToast(await saving ? 'Comprovante vinculado' : 'Vínculo salvo localmente; sincronização pendente');
});

/* ---------------------------------------------------------------
   EVENTS
--------------------------------------------------------------- */
function attachCardEvents(){
  document.querySelectorAll('[data-toggle]').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.getAttribute('data-toggle');
      if(expandedIds.has(id)) expandedIds.delete(id); else expandedIds.add(id);
      render();
    });
  });

  document.querySelectorAll('.field-grid input, .field-grid select, .field-grid textarea').forEach(el=>{
    el.addEventListener('click', e=>e.stopPropagation());
    el.addEventListener('change', ()=>{
      const lic = DATA.find(l=>l.id===el.dataset.lic);
      if(!lic) return;
      lic[el.dataset.field] = el.value;
      saveData();
      // light re-render for badges without collapsing focus abruptly
      render();
    });
  });

  document.querySelectorAll('.act-table').forEach(t=>t.addEventListener('click', e=>e.stopPropagation()));

  document.querySelectorAll('.act-table tbody tr').forEach(tr=>{
    const lic = DATA.find(l=>l.id===tr.dataset.lic);
    const idx = +tr.dataset.idx;
    tr.querySelectorAll('[data-af]').forEach(el=>{
      el.addEventListener('change', ()=>{
        const before = currentFlowNodeId(lic);
        const activity = lic.activities[idx];
        activity[el.dataset.af] = el.value;
        if(el.dataset.af === 'status'){
          activity.dataRealizada = STEP_DONE.includes(el.value) ? (activity.dataRealizada || todayStr()) : '';
        }
        if(['status', 'etapaPadraoId'].includes(el.dataset.af)) syncFlowStatus(lic, before);
        saveData();
        render();
      });
    });
    tr.querySelector('[data-del-act]').addEventListener('click', async ()=>{
      lic.activities.splice(idx,1);
      const saving = saveData();
      render();
      showToast(await saving ? 'Atividade removida' : 'Remoção pendente de sincronização');
    });
  });

  document.querySelectorAll('[data-add-act]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      const lic = DATA.find(l=>l.id===btn.dataset.addAct);
      lic.activities.push({name:'Nova atividade', owner:'', status:'Não iniciado', date:'', observacao:''});
      const saving = saveData();
      render();
      showToast(await saving ? 'Atividade adicionada' : 'Atividade pendente de sincronização');
    });
  });

  document.querySelectorAll('[data-flow-apply]').forEach(btn=>btn.addEventListener('click', ()=>{
    const type = btn.parentElement.querySelector('[data-flow-type]').value;
    void runFlowAction(btn.dataset.flowApply, lic=>applyFlow(lic, type), 'Fluxo aplicado');
  }));
  document.querySelectorAll('[data-flow-complete]').forEach(btn=>btn.addEventListener('click', ()=>{
    const count = Number(btn.dataset.count);
    if(count > 1 && !confirm(`Marcar as ${count} atividades pendentes desta etapa como concluídas?`)) return;
    void runFlowAction(btn.dataset.flowComplete, lic=>completeFlowStep(lic, btn.dataset.step), 'Etapa concluída');
  }));
  document.querySelectorAll('[data-flow-import]').forEach(btn=>btn.addEventListener('click', ()=>{
    void runFlowAction(btn.dataset.flowImport, importSpreadsheetFlow, 'Atividades da planilha importadas');
  }));
  document.querySelectorAll('[data-flow-decide]').forEach(btn=>btn.addEventListener('click', ()=>{
    void runFlowAction(btn.dataset.flowDecide, lic=>decideFlow(lic, btn.dataset.gate, btn.dataset.option), 'Decisão registrada');
  }));
  document.querySelectorAll('[data-flow-cycle]').forEach(btn=>btn.addEventListener('click', ()=>{
    if(!confirm('Iniciar um novo ciclo de renovação? As etapas do fluxo voltam para "Não iniciado"; o histórico é mantido.')) return;
    void runFlowAction(btn.dataset.flowCycle, startFlowCycle, 'Novo ciclo iniciado');
  }));

  document.querySelectorAll('[data-del-lic]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      if(!confirm(`Excluir a licença ${btn.dataset.delLic}${remoteEnabled ? ' para todos os colaboradores' : ''}? Esta ação não pode ser desfeita.`)) return;
      DATA = DATA.filter(l=>l.id!==btn.dataset.delLic);
      const saving = saveData();
      render();
      showToast(await saving ? 'Licença excluída' : 'Exclusão pendente de sincronização');
    });
  });
}

document.getElementById('fUnidade').addEventListener('change', render);
document.getElementById('fStatus').addEventListener('change', render);
document.getElementById('fRisco').addEventListener('change', render);
document.getElementById('fBusca').addEventListener('input', render);
document.getElementById('btnLicensePanel').addEventListener('click', ()=>navigatePanel('#licenses'));
document.getElementById('btnUnitPanel').addEventListener('click', ()=>navigatePanel('#units'));
document.getElementById('btnCalendarPanel').addEventListener('click', ()=>navigatePanel('#calendar'));
document.getElementById('btnListView').addEventListener('click', ()=>{ activeView='list'; render(); });
document.getElementById('btnGanttView').addEventListener('click', ()=>{ activeView='gantt'; render(); });
document.getElementById('btnClearFilters').addEventListener('click', ()=>{
  document.getElementById('fUnidade').value='';
  document.getElementById('fStatus').value='';
  document.getElementById('fRisco').value='';
  document.getElementById('fBusca').value='';
  render();
});

document.getElementById('btnReset').addEventListener('click', async ()=>{
  if(!confirm(remoteEnabled
    ? 'Restaurar licenças e unidades originais para TODOS os colaboradores? As alterações da base central e unidades personalizadas serão substituídas.'
    : 'Restaurar licenças e unidades originais da planilha? Todas as edições e unidades personalizadas deste navegador serão perdidas.')) return;
  DATA = JSON.parse(JSON.stringify(DEFAULT_DATA));
  MODEL = null;
  const saved = await saveData();
  render();
  showToast(saved ? 'Dados originais restaurados' : 'Restauração pendente de sincronização');
});

document.getElementById('btnSync').addEventListener('click', async ()=>{
  if(pendingChanges) await saveData();
  else await refreshFromServer();
});

document.getElementById('btnReloadServer').addEventListener('click', async ()=>{
  if(pendingChanges && !confirm('Descartar as alterações pendentes deste navegador e carregar a base central? Exporte o relatório antes, se precisar preservá-las.')) return;
  await refreshFromServer(true);
});

document.getElementById('btnImportLocal').addEventListener('click', async ()=>{
  try{
    if(conflict) throw new Error('Carregue a versão do servidor antes de importar.');
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) throw new Error('Não há dados do modo local neste navegador.');
    const stored = JSON.parse(raw);
    if(!isStructuredModel(stored) && !Array.isArray(stored)){
      throw new Error('Os dados locais não têm um formato válido.');
    }
    if(!confirm('Substituir a base central pelos dados antigos deste navegador? Isso afetará todos os colaboradores da organização.')) return;
    MODEL = isStructuredModel(stored) ? applyReferenceData(stored) : modelFromLegacyData(stored);
    DATA = flattenModel(MODEL);
    const saved = await saveData();
    render();
    showToast(saved ? 'Dados locais enviados ao servidor' : 'Importação pendente de sincronização');
  }catch(error){
    reportSyncError(error);
  }
});

const BRAZIL_UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
let editingUnitId = null;

function openUnitEditor(id = null){
  editingUnitId = id;
  const unit = MODEL.units.find(item=>item.id === id);
  document.getElementById('unitEditorTitle').textContent = unit ? 'Editar unidade' : 'Nova unidade';
  document.getElementById('un_nome').value = unit?.nome || '';
  document.getElementById('un_cidade').value = unit?.cidade || '';
  document.getElementById('un_uf').innerHTML = '<option value="">Selecione</option>'
    + BRAZIL_UFS.map(uf=>`<option>${uf}</option>`).join('');
  document.getElementById('un_uf').value = unit?.uf || '';
  document.getElementById('unitProfileFields').innerHTML = PROFILE_FIELDS.map(([label, key])=>
    `<div class="field"><label for="up_${key}">${label}</label><input id="up_${key}"></div>`
  ).join('');
  PROFILE_FIELDS.forEach(([, key])=>{
    document.getElementById(`up_${key}`).value = unit?.profile?.[key] ?? unit?.[key] ?? '';
  });
  document.getElementById('unitError').hidden = true;
  openModal('overlayUnit');
}

document.getElementById('btnNewUnit').addEventListener('click', ()=>openUnitEditor());
document.getElementById('unitForm').addEventListener('submit', async event=>{
  event.preventDefault();
  const nome = document.getElementById('un_nome').value.trim();
  const cidade = document.getElementById('un_cidade').value.trim();
  const uf = document.getElementById('un_uf').value;
  const error = document.getElementById('unitError');
  const key = value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const fail = message=>{ error.textContent = message; error.hidden = false; };
  if(!nome || !cidade || !BRAZIL_UFS.includes(uf)){
    fail('Informe o nome, a cidade e uma UF válida.');
    return;
  }
  if(MODEL.units.some(unit=>unit.id !== editingUnitId && key(unit.nome || unit.codigo) === key(nome))){
    fail('Já existe uma unidade com esse nome.');
    return;
  }
  let unit = MODEL.units.find(item=>item.id === editingUnitId);
  if(editingUnitId && !unit){
    fail('A unidade não está mais disponível. Feche esta janela e carregue o servidor.');
    return;
  }
  const profile = {...unit?.profile};
  PROFILE_FIELDS.forEach(([, key])=>{
    profile[key] = document.getElementById(`up_${key}`).value.trim();
  });
  if(unit){
    const oldName = unit.nome;
    Object.assign(unit, {nome, codigo: nome, cidade, uf, profile,
      razaoSocial: profile.razaoSocial, cnpj: profile.cnpj, endereco: profile.endereco});
    DATA.forEach(lic=>{
      if(lic.unidadeId === unit.id) Object.assign(lic, {
        unidade: nome, cidade, uf, razaoSocial: profile.razaoSocial,
        cnpj: profile.cnpj, endereco: profile.endereco, perfilUnidade: profile
      });
    });
    if(document.getElementById('fUnidade').value === oldName){
      document.getElementById('fUnidade').value = '';
    }
  }else{
    unit = {id: `U-${crypto.randomUUID()}`, nome, codigo: nome, cidade, uf, status: 'Ativa',
      profile, razaoSocial: profile.razaoSocial, cnpj: profile.cnpj, endereco: profile.endereco};
    MODEL.units.push(unit);
  }
  const saving = saveData();
  closeModal('overlayUnit');
  navigatePanel(`#unit=${encodeURIComponent(unit.id)}`);
  showToast(await saving ? 'Unidade salva' : 'Unidade salva localmente; sincronização pendente');
});

function fillNewLicenseUnit(){
  const unit = MODEL.units.find(item=>item.id === document.getElementById('nl_unidade').value);
  document.getElementById('nl_cidade').value = unit?.cidade || '';
  document.getElementById('nl_uf').value = unit?.uf || '';
  document.getElementById('nl_razao').value = unit?.razaoSocial || unit?.profile?.razaoSocial || '';
}

function openNewLicense(unitId = ''){
  const select = document.getElementById('nl_unidade');
  select.innerHTML = '<option value="">Selecione uma unidade</option>' + [...MODEL.units]
    .sort((a,b)=>a.nome.localeCompare(b.nome))
    .map(unit=>`<option value="${esc(unit.id)}">${esc(unit.nome)} — ${esc(unit.cidade)}/${esc(unit.uf)}</option>`).join('');
  select.value = unitId;
  fillNewLicenseUnit();
  suggestNewLicenseFlow();
  openModal('overlayNewLic');
}

function suggestNewLicenseFlow(){
  document.getElementById('nl_fluxo').value = suggestedFlowType({
    categoria: document.getElementById('nl_categoria').value,
    tipoLicenca: document.getElementById('nl_tipo').value
  });
}

document.getElementById('nl_unidade').addEventListener('change', fillNewLicenseUnit);
document.getElementById('nl_categoria').addEventListener('change', suggestNewLicenseFlow);
document.getElementById('nl_tipo').addEventListener('change', suggestNewLicenseFlow);
document.getElementById('btnNewLic').addEventListener('click', ()=>openNewLicense());
document.getElementById('btnSaveNewLic').addEventListener('click', async ()=>{
  const id = document.getElementById('nl_id').value.trim();
  if(!id){ showToast('Informe um ID para a licença'); return; }
  if(DATA.some(l=>l.id===id)){ showToast('Já existe uma licença com esse ID'); return; }
  const unit = MODEL.units.find(item=>item.id === document.getElementById('nl_unidade').value);
  if(!unit){ showToast('Selecione uma unidade cadastrada'); return; }
  const lic = {
    id,
    unidadeId: unit.id,
    unidade: unit.nome,
    cidade: unit.cidade,
    uf: unit.uf,
    razaoSocial: document.getElementById('nl_razao').value.trim(),
    endereco: '',
    cnpj: '',
    categoria: document.getElementById('nl_categoria').value.trim(),
    orgaoEmissor: document.getElementById('nl_orgao').value.trim(),
    tipoLicenca: document.getElementById('nl_tipo').value.trim(),
    nProcesso: '',
    risco: document.getElementById('nl_risco').value,
    owner: '',
    status: document.getElementById('nl_status').value,
    dataEmissao: document.getElementById('nl_emissao').value,
    vencimento: document.getElementById('nl_vencimento').value,
    notes: document.getElementById('nl_notes').value.trim(),
    lastUpdated: 'Criado manualmente em ' + fmtDate(todayStr()),
    activities: []
  };
  const flowType = document.getElementById('nl_fluxo').value;
  if(flowType) applyFlow(lic, flowType);
  DATA.push(lic);
  const saving = saveData();
  closeModal('overlayNewLic');
  expandedIds.add(id);
  document.getElementById('fUnidade').value = '';
  document.getElementById('fStatus').value = '';
  document.getElementById('fRisco').value = '';
  document.getElementById('fBusca').value = '';
  render();
  ['nl_id','nl_unidade','nl_cidade','nl_uf','nl_razao','nl_categoria','nl_orgao','nl_tipo','nl_emissao','nl_vencimento','nl_notes']
    .forEach(i=>document.getElementById(i).value='');
  showToast(await saving ? 'Licença criada' : 'Licença criada localmente; sincronização pendente');
});

/* ---------------------------------------------------------------
   EXPORT REPORT
--------------------------------------------------------------- */
document.getElementById('btnExport').addEventListener('click', buildAndPrintReport);

function setAuthenticatedUser(session){
  const userChip = document.getElementById('userChip');
  const signOut = document.getElementById('btnSignOut');
  const email = session?.user?.email || '';
  userChip.textContent = email;
  userChip.hidden = !email;
  signOut.hidden = !session;
}

function showAuthError(message){
  const error = document.getElementById('authError');
  error.textContent = message;
  error.hidden = !message;
}

async function startAuthenticatedApp(session){
  setAuthenticatedUser(session);
  authenticatedUserId = session.user.id;
  await loadData();
  applyPanelRoute();
  render();
  setAppReady(true);
  closeModal('overlayAuth');
}

document.getElementById('authForm').addEventListener('submit', async event=>{
  event.preventDefault();
  const button = document.getElementById('btnAuthSubmit');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  showAuthError('');
  button.disabled = true;
  button.textContent = 'Entrando...';
  try{
    const session = await window.LicenseDataService.auth.signIn(email, password);
    await startAuthenticatedApp(session);
  }catch(error){
    showAuthError(error.message || 'Não foi possível entrar. Confira o e-mail e a senha.');
  }finally{
    button.disabled = false;
    button.textContent = 'Entrar';
  }
});

document.getElementById('btnSignOut').addEventListener('click', async ()=>{
  if(pendingChanges && !confirm('Há alterações não sincronizadas. Elas permanecerão como rascunho neste navegador. Deseja sair?')) return;
  try{
    await saveQueue;
    await window.LicenseDataService.auth.signOut();
    window.location.reload();
  }catch(error){
    reportSyncError(error);
  }
});

function buildAndPrintReport(){
  const list = DATA;
  const total = list.length;
  const obtidas = list.filter(l=>l.status==='Obtida').length;
  const pendentes = list.filter(l=>OPEN_STATUSES.includes(l.status)).length;
  const vencidas = list.filter(l=>l.vencimento && daysUntil(l.vencimento)<0);
  const alerta = list.filter(l=>l.vencimento && daysUntil(l.vencimento)>=0 && daysUntil(l.vencimento)<=120);
  const altoRisco = list.filter(l=>(l.risco||'').toLowerCase()==='alto').length;
  const totalActivities = list.reduce((sum,l)=>sum+(l.activities||[]).length,0);
  const doneActivities = list.reduce((sum,l)=>sum+(l.activities||[]).filter(a=>a.status==='Done').length,0);
  const stuckActs = [];
  list.forEach(l=>(l.activities||[]).forEach(a=>{
    if(a.status==='Stuck' || (a.date && daysUntil(a.date)<0 && a.status!=='Done')){
      stuckActs.push({lic:l.id, unidade:l.unidade, ...a});
    }
  }));

  const value = (text) => esc(text || 'Não informado');
  const rows = (arr, mapper) => arr.map(mapper).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;">Nenhum registro</td></tr>';
  const activityRows = (lic) => (lic.activities||[]).map(a=>`
    <tr><td>${value(a.name)}</td><td>${value(a.owner)}</td><td>${value(a.status)}</td><td>${a.date?fmtDate(a.date):'Não informado'}</td><td>${value(a.observacao)}</td></tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;">Nenhuma atividade cadastrada</td></tr>';
  const licenseDetails = list.map((lic, index)=>`
    <section class="rep-license ${index ? 'rep-license-break' : ''}">
      <div class="rep-license-header">
        <div><span class="rep-license-id">${value(lic.id)}</span><strong>${value(lic.tipoLicenca || lic.categoria)}</strong></div>
        <div class="rep-license-badges"><span>${value(lic.status)}</span><span>Risco: ${value(lic.risco)}</span></div>
      </div>
      <div class="rep-detail-grid">
        <div><b>Unidade</b><span>${value(lic.unidade)}</span></div>
        <div><b>Cidade / UF</b><span>${lic.cidade ? `${value(lic.cidade)} / ${value(lic.uf)}` : 'Não informado'}</span></div>
        <div class="rep-detail-wide"><b>Razão social</b><span>${value(lic.razaoSocial)}</span></div>
        <div class="rep-detail-wide"><b>Endereço</b><span>${value(lic.endereco)}</span></div>
        <div><b>CNPJ</b><span>${value(lic.cnpj)}</span></div>
        <div><b>Nº do processo</b><span>${value(lic.nProcesso)}</span></div>
        <div><b>Categoria</b><span>${value(lic.categoria)}</span></div>
        <div><b>Órgão emissor</b><span>${value(lic.orgaoEmissor)}</span></div>
        <div><b>Data de emissão</b><span>${lic.dataEmissao ? fmtDate(lic.dataEmissao) : 'Não informado'}</span></div>
        <div><b>Vencimento</b><span>${lic.vencimento ? fmtDate(lic.vencimento) : 'Não informado'}</span></div>
        <div><b>Responsável</b><span>${value(lic.owner)}</span></div>
        <div><b>Última atualização</b><span>${value(lic.lastUpdated)}</span></div>
        <div class="rep-detail-wide"><b>Fluxo do processo</b><span>${value(lic.fluxo ? `${PROCESS_FLOWS[lic.fluxo.tipo]?.nome || ''} · ciclo ${lic.fluxo.ciclo || 1} · ${flowSummary(lic)}` : '')}</span></div>
        <div class="rep-detail-wide"><b>Notas</b><span class="rep-notes">${value(lic.notes)}</span></div>
      </div>
      <div class="rep-subtitle">Atividades / etapas (${(lic.activities||[]).length})</div>
      <table class="rep-table rep-activities-table">
        <thead><tr><th>Atividade</th><th>Responsável</th><th>Status</th><th>Data</th><th>Observação</th></tr></thead>
        <tbody>${activityRows(lic)}</tbody>
      </table>
    </section>
  `).join('');

  const html = `
    <div class="rep-header">
      <div>
        <div class="rep-title">Relatório de Status — Licenças Regulatórias</div>
        <div class="rep-date">Solinftec · Gerado em ${fmtDate(todayStr())}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:var(--ink-soft);">
        Av. Brasília, 2.121 – Edif. New York Tower<br>Jardim Nova York – Araçatuba/SP<br>+55 (18) 3622-2270
      </div>
    </div>

    <div class="rep-kpis">
      <div class="rep-kpi"><b>${total}</b>Licenças no escopo</div>
      <div class="rep-kpi"><b>${obtidas}</b>Obtidas</div>
      <div class="rep-kpi"><b>${pendentes}</b>Pendentes / em andamento</div>
      <div class="rep-kpi"><b>${vencidas.length}</b>Vencidas</div>
      <div class="rep-kpi"><b>${alerta.length}</b>Vencimento em até 120 dias</div>
      <div class="rep-kpi"><b>${altoRisco}</b>Risco alto</div>
      <div class="rep-kpi"><b>${doneActivities}/${totalActivities}</b>Atividades concluídas</div>
    </div>

    <div class="rep-section-title">Licenças vencidas ou em atraso</div>
    <table class="rep-table">
      <thead><tr><th>ID</th><th>Unidade</th><th>Tipo</th><th>Órgão</th><th>Vencimento</th><th>Situação</th></tr></thead>
      <tbody>${rows(vencidas, l=>`<tr><td>${esc(l.id)}</td><td>${esc(l.unidade)}</td><td>${esc(l.tipoLicenca)}</td><td>${esc(l.orgaoEmissor)}</td><td>${fmtDate(l.vencimento)}</td><td>Vencida há ${Math.abs(daysUntil(l.vencimento))} dias</td></tr>`)}</tbody>
    </table>

    <div class="rep-section-title">Vencimento próximo (até 120 dias)</div>
    <table class="rep-table">
      <thead><tr><th>ID</th><th>Unidade</th><th>Tipo</th><th>Órgão</th><th>Vencimento</th><th>Dias restantes</th></tr></thead>
      <tbody>${rows(alerta, l=>`<tr><td>${esc(l.id)}</td><td>${esc(l.unidade)}</td><td>${esc(l.tipoLicenca)}</td><td>${esc(l.orgaoEmissor)}</td><td>${fmtDate(l.vencimento)}</td><td>${daysUntil(l.vencimento)} dias</td></tr>`)}</tbody>
    </table>

    <div class="rep-section-title">Atividades travadas ou em atraso</div>
    <table class="rep-table">
      <thead><tr><th>Licença</th><th>Unidade</th><th>Atividade</th><th>Responsável</th><th>Status</th><th>Observação</th></tr></thead>
      <tbody>${rows(stuckActs, a=>`<tr><td>${esc(a.lic)}</td><td>${esc(a.unidade)}</td><td>${esc(a.name)}</td><td>${esc(a.owner||'—')}</td><td>${esc(a.status)}</td><td>${esc(a.observacao||'—')}</td></tr>`)}</tbody>
    </table>

    <div class="rep-section-title">Visão geral por licença</div>
    <table class="rep-table">
      <thead><tr><th>ID</th><th>Unidade</th><th>Categoria</th><th>Órgão</th><th>Risco</th><th>Status</th><th>Atividades</th></tr></thead>
      <tbody>${rows(list, l=>`<tr><td>${value(l.id)}</td><td>${value(l.unidade)}</td><td>${value(l.categoria)}</td><td>${value(l.orgaoEmissor)}</td><td>${value(l.risco)}</td><td>${value(l.status)}</td><td>${(l.activities||[]).filter(a=>a.status==='Done').length}/${(l.activities||[]).length}</td></tr>`)}</tbody>
    </table>

    <div class="rep-section-title">Detalhamento das licenças</div>
    ${licenseDetails}

    <div class="rep-wave"></div>
    <div class="rep-footer">
      Relatório gerado automaticamente a partir do painel de controle de licenças regulatórias. As informações aqui apresentadas devem ser validadas pela área responsável antes de qualquer decisão formal ou protocolo junto a órgãos reguladores.
    </div>
  `;
  document.getElementById('print-area').innerHTML = html;
  window.print();
}

/* ---------------------------------------------------------------
   INIT
--------------------------------------------------------------- */
function setAppReady(ready){
  appReady = ready;
  document.querySelector('main').inert = !ready;
  ['btnNewLic', 'btnNewUnit', 'btnReset', 'btnExport', 'btnSync', 'btnReloadServer', 'btnImportLocal']
    .forEach(id=>document.getElementById(id).disabled = !ready);
  ['btnSync', 'btnReloadServer', 'btnImportLocal']
    .forEach(id=>document.getElementById(id).hidden = !remoteEnabled);
}

function refreshWhenIdle(){
  if(document.hidden || document.activeElement?.matches('input, textarea, select')
    || document.querySelector('#overlayNewLic.show, #overlayUnit.show, #overlayEvidence.show')) return;
  void refreshFromServer();
}

window.addEventListener('focus', refreshWhenIdle);
window.addEventListener('online', refreshWhenIdle);
window.addEventListener('beforeunload', event=>{
  if(!pendingChanges) return;
  event.preventDefault();
  event.returnValue = '';
});
setInterval(refreshWhenIdle, 15000);

(async function init(){
  setAppReady(false);
  document.getElementById('todayChip').textContent = 'Hoje: ' + fmtDate(todayStr());
  const versionEl = document.getElementById('appVersion');
  if(versionEl) versionEl.textContent = 'v' + APP_VERSION;
  if(remoteEnabled){
    try{
      if(!window.LicenseDataService) throw new Error('O serviço de dados não carregou. Recarregue a página.');
      const session = await window.LicenseDataService.auth.getSession();
      if(!session){
        openModal('overlayAuth');
        return;
      }
      await startAuthenticatedApp(session);
      return;
    }catch(error){
      console.error('Falha ao abrir a base central:', error);
      openModal('overlayAuth');
      showAuthError(`Não foi possível abrir a base central: ${error.message || 'confira a conexão e execute as migrações SQL.'}`);
      return;
    }
  }
  try{
    await loadData();
    applyPanelRoute();
    render();
    setAppReady(true);
  }catch(error){
    reportSyncError(error);
  }
})();
