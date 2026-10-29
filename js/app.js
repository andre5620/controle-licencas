const DEFAULT_DATA = window.DEFAULT_DATA;
const DEFAULT_MODEL = window.DEFAULT_MODEL || null;
const SPREADSHEET_REFERENCE = window.SPREADSHEET_REFERENCE || null;
const SPREADSHEET_LICENSES = window.SPREADSHEET_LICENSES || {};
const PROCESS_FLOWS = window.PROCESS_FLOWS || {};

const APP_VERSION = '1.15.0';
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
let expandedActivities = new Set();
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
      setSaveState('var(--amber)', 'salvo só neste navegador', '', 'local');
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
    && activity.id === genericFlowActivityId(lic, activity.etapaPadraoId) && activity.status === 'Não iniciado'
    && !(activity.subatividades || []).length));
  imported.forEach(activity=>insertFlowActivity(lic, def, activity));
  def.nos.filter(node=>!node.decisao && !node.condicional).forEach(node=>ensureFlowActivity(lic, def, node));
  /* Etapas genéricas anteriores a uma etapa já concluída na planilha não podem travar o fluxo. */
  const order = flowOrder(def);
  const furthest = Math.max(-1, ...imported.filter(activity=>STEP_DONE.includes(activity.status))
    .map(activity=>order.indexOf(activity.etapaPadraoId)));
  lic.activities.forEach(activity=>{
    if(activity.id !== genericFlowActivityId(lic, activity.etapaPadraoId) || activity.status !== 'Não iniciado') return;
    if(order.indexOf(activity.etapaPadraoId) >= furthest) return;
    completeActivity(activity);
    activity.observacao = activity.observacao || 'Considerada concluída na importação da planilha';
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

/* Conclui a atividade junto com as subatividades abertas, para o status derivado não voltar atrás. */
function completeActivity(activity){
  activity.status = 'Done';
  activity.dataRealizada = todayStr();
  (activity.subatividades || []).filter(sub=>!STEP_DONE.includes(sub.status)).forEach(sub=>{
    sub.status = 'Done';
    sub.dataRealizada = todayStr();
  });
}

function resetFlowActivity(activity){
  Object.assign(activity, {status: 'Não iniciado', dataRealizada: ''});
  (activity.subatividades || []).forEach(sub=>Object.assign(sub, {status: 'Não iniciado', dataRealizada: ''}));
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
  flowActivities(lic, node.id).filter(activity=>!STEP_DONE.includes(activity.status)).forEach(completeActivity);
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

/* ---------------------------------------------------------------
   URGÊNCIA E ORDENAÇÃO
--------------------------------------------------------------- */
const SETTLED_STATUSES = ['Obtida','Dispensada','Não aplicável'];

/* Requer ação: vencida, dentro da janela de renovação (120 dias por padrão) ou risco alto em aberto. */
function needsAction(lic){
  const days = daysUntil(lic.vencimento);
  if(Number.isFinite(days) && days <= (renewalWindow(lic)?.lead ?? 120)) return true;
  return (lic.risco || '').toLowerCase() === 'alto' && !SETTLED_STATUSES.includes(lic.status);
}

const byLicenseId = (a, b)=>String(a.id).localeCompare(String(b.id), 'pt-BR', {numeric: true});
const dueDays = lic=>{
  const days = daysUntil(lic.vencimento);
  return Number.isFinite(days) ? days : Infinity;
};
const highRiskFirst = lic=>(lic.risco || '').toLowerCase() === 'alto' ? 0 : 1;
const LICENSE_SORTS = {
  urgencia: (a, b)=>dueDays(a) - dueDays(b) || highRiskFirst(a) - highRiskFirst(b) || byLicenseId(a, b),
  vencimento: (a, b)=>dueDays(a) - dueDays(b) || byLicenseId(a, b),
  id: byLicenseId,
  unidade: (a, b)=>(a.unidade || '').localeCompare(b.unidade || '', 'pt-BR') || byLicenseId(a, b)
};

function sortLicenses(list, mode){
  return [...list].sort(LICENSE_SORTS[mode] || byLicenseId);
}

/* Na ordem por urgência a lista é dividida em "Requer ação" e "Demais licenças". */
function groupByUrgency(list){
  return {
    acao: sortLicenses(list.filter(needsAction), 'urgencia'),
    demais: sortLicenses(list.filter(lic=>!needsAction(lic)), 'vencimento')
  };
}

const SYNC_PENDING_MESSAGE = 'Você tem alterações que ainda não estão disponíveis para a equipe.';
const LOCAL_ONLY_MESSAGE = 'Os dados estão salvos só neste navegador e não ficam disponíveis para a equipe.';
let syncBannerAction = null;

/* Indicador do cabeçalho e faixa abaixo dele. tone: 'pending' (padrão com mensagem), 'error' ou 'local'. */
function setSaveState(color, text, message = '', tone = message ? 'pending' : ''){
  document.getElementById('saveDot').style.background = color;
  document.getElementById('saveText').textContent = text;
  const banner = document.getElementById('syncBanner');
  const notice = document.getElementById('syncMessage');
  const action = document.getElementById('btnSyncNow');
  notice.textContent = message || (tone === 'local' ? LOCAL_ONLY_MESSAGE : tone === 'pending' ? SYNC_PENDING_MESSAGE : '');
  banner.hidden = !tone;
  if(tone === 'error') banner.classList.add('is-error');
  else banner.classList.remove('is-error');
  /* Em conflito, tentar de novo não resolve: o caminho é carregar a versão do servidor. */
  syncBannerAction = !remoteEnabled || tone === 'local' || !tone ? null : conflict ? 'btnReloadServer' : 'btnSync';
  action.hidden = !syncBannerAction;
  action.textContent = conflict ? 'Carregar servidor' : tone === 'error' ? 'Tentar novamente' : 'Sincronizar agora';
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
      : `${error.message || 'Não foi possível sincronizar.'} ${pendingChanges ? 'Suas alterações continuam neste navegador e ainda não estão disponíveis para a equipe.' : ''}`.trim(),
    'error');
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
          remoteEnabled ? 'sincronizado' : 'salvo só neste navegador', '', remoteEnabled ? '' : 'local');
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
const UNDO_TIMEOUT = 8000;

/* action opcional: {label, onClick}; com ação o aviso fica 8 s na tela. */
function showToast(msg, action = null){
  const t = document.getElementById('toast');
  clearTimeout(toastTimer);
  t.textContent = msg;
  if(action){
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', ()=>{
      t.classList.remove('show');
      action.onClick();
    });
    t.append(' ', button);
    t.classList.add('has-action');
  }else t.classList.remove('has-action');
  t.classList.add('show');
  toastTimer = setTimeout(()=>t.classList.remove('show'), action ? UNDO_TIMEOUT : 2200);
}

/* ---------------------------------------------------------------
   DESFAZER (ações reversíveis)
   A ação vale na hora em memória; a gravação espera o aviso expirar.
   Se outra edição gravar antes, a ação já vai junto e Desfazer grava a reversão.
--------------------------------------------------------------- */
let pendingUndo = null;

function undoable({apply, revert, message, undoneMessage = 'Ação desfeita'}){
  commitPendingUndo();
  try{
    apply();
  }catch(error){
    showToast(error.message);
    return false;
  }
  const entry = {revert, generation: editGeneration};
  entry.timer = setTimeout(()=>{
    if(pendingUndo !== entry) return;
    pendingUndo = null;
    if(editGeneration === entry.generation) void saveData();
  }, UNDO_TIMEOUT);
  pendingUndo = entry;
  render();
  showToast(message, {label: 'Desfazer', onClick: ()=>{
    if(pendingUndo !== entry) return;
    clearTimeout(entry.timer);
    pendingUndo = null;
    entry.revert();
    if(editGeneration !== entry.generation) void saveData();
    render();
    showToast(undoneMessage);
  }});
  return true;
}

/* A base foi substituída (restaurar, importar, carregar servidor): o Desfazer deixa de valer. */
function discardPendingUndo(){
  if(pendingUndo) clearTimeout(pendingUndo.timer);
  pendingUndo = null;
}

/* Grava na hora a ação que aguardava o Desfazer (antes de recarregar, sair ou sincronizar). */
function commitPendingUndo(){
  if(!pendingUndo) return null;
  const entry = pendingUndo;
  clearTimeout(entry.timer);
  pendingUndo = null;
  return editGeneration === entry.generation ? saveData() : null;
}

/* ---------------------------------------------------------------
   MODAL HELPERS
--------------------------------------------------------------- */
/* Ao abrir, foca o primeiro campo editável; ao fechar, devolve o foco a quem abriu. */
const modalOpeners = new Map();
const MODAL_FOCUSABLE = 'input:not([readonly]):not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])';

function openModal(id){
  const overlay = document.getElementById(id);
  if(!overlay.classList.contains?.('show')) modalOpeners.set(id, document.activeElement);
  overlay.classList.add('show');
  overlay.querySelector?.(MODAL_FOCUSABLE)?.focus();
}

function closeModal(id){
  document.getElementById(id).classList.remove('show');
  const opener = modalOpeners.get(id);
  modalOpeners.delete(id);
  if(opener?.isConnected) opener.focus();
}

['overlayNewLic', 'overlayUnit', 'overlayEvidence'].forEach(id=>{
  document.getElementById(id).addEventListener('keydown', event=>{
    if(event.key !== 'Escape') return;
    event.preventDefault();
    closeModal(id);
  });
});

/* Confirmação própria (substitui confirm()); resolve true ao confirmar. */
let confirmResolve = null;

function askConfirm({title = 'Confirmar ação', message, confirmLabel = 'Confirmar', danger = false}){
  confirmResolve?.(false);
  const ok = document.getElementById('btnConfirmOk');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  ok.textContent = confirmLabel;
  ok.className = `btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`;
  openModal('overlayConfirm');
  document.getElementById('btnConfirmCancel').focus();
  return new Promise(resolve=>{
    confirmResolve = value=>{
      confirmResolve = null;
      closeModal('overlayConfirm');
      resolve(value);
    };
  });
}

document.getElementById('btnConfirmOk').addEventListener('click', ()=>confirmResolve?.(true));
document.getElementById('btnConfirmCancel').addEventListener('click', ()=>confirmResolve?.(false));
document.getElementById('overlayConfirm').addEventListener('click', event=>{
  if(event.target.id === 'overlayConfirm') confirmResolve?.(false);
});
document.getElementById('overlayConfirm').addEventListener('keydown', event=>{
  if(event.key === 'Escape'){
    event.preventDefault();
    confirmResolve?.(false);
  }else if(event.key === 'Tab'){
    /* Mantém o foco entre os dois botões enquanto o modal está aberto. */
    event.preventDefault();
    const cancel = document.getElementById('btnConfirmCancel');
    (document.activeElement === cancel ? document.getElementById('btnConfirmOk') : cancel).focus();
  }
});

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
/* Prazo em linguagem humana: dias até 60, meses aproximados até 2 anos e anos acima disso. */
function humanSpan(days){
  if(days <= 60) return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  if(days <= 730) return `~${Math.round(days / 30.4)} meses`;
  const years = Math.round(days / 365);
  return `~${years} ${years === 1 ? 'ano' : 'anos'}`;
}

function vencimentoBadge(iso){
  if(!iso) return null;
  const d = daysUntil(iso);
  const title = `Vencimento: ${fmtDate(iso)}`;
  if(d === -1) return {cls:'b-venc-vencido', txt:'Venceu ontem', title};
  if(d<0) return {cls:'b-venc-vencido', txt:`Vencida há ${humanSpan(-d)}`, title};
  const txt = d === 0 ? 'Vence hoje' : d === 1 ? 'Vence amanhã' : `Vence em ${humanSpan(d)}`;
  return {cls: d<=120 ? 'b-venc-alerta' : 'b-venc-ok', txt, title};
}
function actStatusClass(status){
  const s=(status||'').toLowerCase();
  if(s==='done') return 'st-done';
  if(s==='working on it') return 'st-working';
  if(s==='stuck') return 'st-stuck';
  return 'st-nao';
}

/* Dias de atraso de uma atividade ou subatividade: Data fim no passado e ainda não concluída. */
function activityLateDays(item){
  if(!item?.dataFim || STEP_DONE.includes(item.status)) return 0;
  const days = daysUntil(item.dataFim);
  return days < 0 ? -days : 0;
}

function lateActivities(lic){
  const late = [];
  (lic.activities || []).forEach(activity=>{
    const days = activityLateDays(activity);
    if(days) late.push({activity, days});
    (activity.subatividades || []).forEach(sub=>{
      const subDays = activityLateDays(sub);
      if(subDays) late.push({activity, sub, days: subDays});
    });
  });
  return late;
}

function lateBadge(item){
  const days = activityLateDays(item);
  return days ? `<span class="act-alert" role="img" aria-label="Fora do prazo: atrasada há ${esc(humanSpan(days))}" title="Data fim: ${esc(fmtDate(item.dataFim))}">⚠ Atrasada há ${esc(humanSpan(days))}</span>` : '';
}

/* Com subatividades, o status da atividade é calculado: só conclui quando todas estão concluídas. */
function deriveActivityStatus(activity){
  const subs = activity.subatividades || [];
  if(!subs.length) return activity.status;
  let status;
  if(subs.every(sub=>STEP_DONE.includes(sub.status))) status = subs.every(sub=>sub.status === 'N/A') ? 'N/A' : 'Done';
  else if(subs.some(sub=>sub.status === 'Stuck')) status = 'Stuck';
  else if(subs.some(sub=>sub.status !== 'Não iniciado')) status = 'Working on it';
  else status = 'Não iniciado';
  activity.status = status;
  activity.dataRealizada = STEP_DONE.includes(status) ? (activity.dataRealizada || todayStr()) : '';
  return status;
}

function nextSubId(activity, lic, idx){
  const base = activity.id || `${lic.id}-A${idx + 1}`;
  const used = new Set((activity.subatividades || []).map(sub=>sub.id));
  let n = (activity.subatividades || []).length + 1;
  let id;
  do id = `${base}-S${String(n++).padStart(2,'0')}`; while(used.has(id));
  return id;
}

/* Data fim não pode ser anterior à data de início. */
function dateRangeError(item, field, value){
  const inicio = field === 'dataInicio' ? value : item.dataInicio;
  const fim = field === 'dataFim' ? value : item.dataFim;
  return inicio && fim && fim < inicio ? 'A data fim não pode ser anterior à data de início.' : '';
}

/* ---------------------------------------------------------------
   KPIs
--------------------------------------------------------------- */
/* Filtros rápidos acionados pelos KPIs; combinam com os selects sem alterar seus valores. */
const QUICK_FILTERS = {
  obtidas: l=>l.status==='Obtida',
  pendentes: l=>OPEN_STATUSES.includes(l.status),
  vencidas: l=>Boolean(l.vencimento) && daysUntil(l.vencimento)<0,
  vencer: l=>Boolean(l.vencimento) && daysUntil(l.vencimento)>=0 && daysUntil(l.vencimento)<=120,
  alto: l=>(l.risco||'').toLowerCase()==='alto'
};
let quickFilter = null;
let unitQuickFilter = null;

function kpiButton(key, n, label, cls, active){
  return `<button type="button" class="kpi ${cls}" data-kpi="${key}" aria-pressed="${active}">
    <span class="num">${n}</span><span class="lbl">${label}</span></button>`;
}

function renderKPIs(list){
  const count = key=>list.filter(QUICK_FILTERS[key]).length;
  const kpis = [
    ['', list.length, 'Licenças no escopo', ''],
    ['obtidas', count('obtidas'), 'Obtidas', 'accent-green'],
    ['pendentes', count('pendentes'), 'Pendentes / em andamento', 'accent-amber'],
    ['vencidas', count('vencidas'), 'Vencidas ou em atraso', 'accent-red'],
    ['alto', count('alto'), 'Risco alto', 'accent-purple'],
  ];
  const row = document.getElementById('kpiRow');
  row.innerHTML = kpis.map(([key, n, label, cls])=>kpiButton(key, n, label, cls, Boolean(key) && key === quickFilter)).join('');
  row.querySelectorAll('[data-kpi]').forEach(button=>button.addEventListener('click', ()=>{
    const key = button.dataset.kpi;
    quickFilter = key && key !== quickFilter ? key : null;
    if(activePanel === 'license' && activeView === 'list') render();
    else navigatePanel('#view=licencas');
    document.querySelector(`#kpiRow [data-kpi="${key}"]`)?.focus();
  }));
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
function getFiltered({ignoreQuick = false} = {}){
  const u = document.getElementById('fUnidade').value;
  const s = document.getElementById('fStatus').value;
  const r = document.getElementById('fRisco').value;
  const q = document.getElementById('fBusca').value.trim().toLowerCase();
  const quick = ignoreQuick ? null : QUICK_FILTERS[quickFilter];
  return DATA.filter(l=>{
    if(quick && !quick(l)) return false;
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
  /* Os números dos KPIs ignoram o filtro rápido para que continuem servindo de atalho. */
  renderKPIs(getFiltered({ignoreQuick: true}));
  const list = getFiltered();
  const root = document.getElementById('licList');
  const unitPanel = document.getElementById('unitPanel');
  const gantt = document.getElementById('ganttView');
  const calendar = document.getElementById('calendarPanel');
  const indicators = document.getElementById('indicatorsPanel');
  const unitId = activePanel === 'unit' ? currentUnitId() : null;
  const unitDetail = Boolean(unitId);
  document.getElementById('dashboardFilters').hidden = unitDetail;
  document.getElementById('kpiRow').hidden = unitDetail || activePanel === 'indicators';
  if(activePanel !== 'license' || activeView !== 'list') root.innerHTML = '';
  if(activePanel !== 'unit') unitPanel.innerHTML = '';
  if(activePanel !== 'calendar') calendar.innerHTML = '';
  if(activePanel !== 'indicators') indicators.innerHTML = '';
  root.hidden = activePanel !== 'license' || activeView !== 'list';
  unitPanel.hidden = activePanel !== 'unit';
  calendar.hidden = activePanel !== 'calendar';
  indicators.hidden = activePanel !== 'indicators';
  gantt.hidden = activePanel !== 'license' || activeView !== 'gantt';
  document.getElementById('fOrdem').hidden = activePanel !== 'license' || activeView !== 'list';
  updateFilterCount();
  const current = currentViewKey();
  VIEW_TABS.forEach(([id, view])=>{
    const tab = document.getElementById(id);
    tab.setAttribute('aria-selected', String(view === current));
    tab.tabIndex = view === current ? 0 : -1;
  });
  if(activePanel === 'calendar'){
    renderCalendar(list);
    return;
  }
  if(activePanel === 'indicators'){
    renderIndicators(list);
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
  const order = document.getElementById('fOrdem').value || 'urgencia';
  if(order === 'urgencia'){
    const {acao, demais} = groupByUrgency(list);
    const group = (id, title, items, empty)=>`<section class="lic-group" aria-labelledby="${id}">
      <h2 class="lic-group-head" id="${id}">${title} <span class="lic-group-count">· ${items.length}</span></h2>
      ${items.length ? items.map(lic=>renderCard(lic)).join('') : `<p class="lic-group-empty">${empty}</p>`}
    </section>`;
    root.innerHTML = group('grpAcao', 'Requer ação', acao, 'Nenhuma licença requer ação agora ✓')
      + (demais.length ? group('grpDemais', 'Demais licenças', demais, '') : '');
  }else{
    root.innerHTML = sortLicenses(list, order).map(lic=>renderCard(lic)).join('');
  }
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

/* Abas de visão: refletidas no hash (#view=...), sem quebrar #unit=ID nem os endereços antigos. */
const VIEW_ROUTES = {
  unidades: {panel: 'unit'},
  licencas: {panel: 'license', view: 'list'},
  calendario: {panel: 'calendar'},
  gantt: {panel: 'license', view: 'gantt'},
  indicadores: {panel: 'indicators'}
};
const LEGACY_VIEW_HASHES = {'#units': 'unidades', '#licenses': 'licencas', '#calendar': 'calendario'};
const VIEW_TABS = [['btnUnitPanel', 'unidades'], ['btnLicensePanel', 'licencas'], ['btnCalendarPanel', 'calendario'], ['btnGanttView', 'gantt'], ['btnIndicatorsPanel', 'indicadores']];
const VIEW_PREFERENCE_KEY = 'licencas-solinftec-ui:view';

function currentViewKey(){
  if(activePanel === 'unit') return 'unidades';
  if(activePanel === 'calendar') return 'calendario';
  if(activePanel === 'indicators') return 'indicadores';
  return activeView === 'gantt' ? 'gantt' : 'licencas';
}

function routeView(hash){
  if(LEGACY_VIEW_HASHES[hash]) return LEGACY_VIEW_HASHES[hash];
  const params = new URLSearchParams(hash.slice(1));
  if(params.get('unit')) return 'unidades';
  const view = params.get('view');
  return VIEW_ROUTES[view] ? view : null;
}

function storedView(){
  try{
    const view = localStorage.getItem(VIEW_PREFERENCE_KEY);
    return VIEW_ROUTES[view] ? view : null;
  }catch{
    return null;
  }
}

function applyPanelRoute(){
  const routed = routeView(window.location.hash || '');
  const view = routed || storedView() || 'unidades';
  activePanel = VIEW_ROUTES[view].panel;
  activeView = VIEW_ROUTES[view].view || activeView;
  if(routed){
    try{ localStorage.setItem(VIEW_PREFERENCE_KEY, view); }catch{ /* preferência opcional */ }
  }
  if(appReady) render();
}

window.addEventListener('hashchange', applyPanelRoute);

function openLicense(id){
  expandedIds.add(id);
  navigatePanel('#view=licencas');
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
  const unitFilter = unitQuickFilter?.unitId === id ? unitQuickFilter.key : null;
  const shown = unitFilter ? licenses.filter(QUICK_FILTERS[unitFilter]) : licenses;
  const count = key=>licenses.filter(QUICK_FILTERS[key]).length;
  const unitKpis = [['', licenses.length, 'Licenças'], ['pendentes', count('pendentes'), 'Pendentes / em andamento'],
    ['vencidas', count('vencidas'), 'Vencidas'], ['vencer', count('vencer'), 'Vencem em até 120 dias']];
  root.innerHTML = `<article class="unit-detail">
    ${back}
    <header class="unit-detail-header"><div><div class="unit-panel-kicker">Unidade</div>
      <h1 tabindex="-1" id="unitDetailTitle">${esc(unit.nome || unit.codigo)}</h1>
      <p>${esc(unit.cidade)} / ${esc(unit.uf)}</p></div>
      <div class="unit-actions"><button class="btn" data-edit-unit="${esc(unit.id)}">Editar unidade</button>
        <button class="btn btn-danger" data-delete-unit="${esc(unit.id)}">Excluir unidade</button>
        <button class="btn btn-primary" data-new-unit-license="${esc(unit.id)}">+ Nova licença</button></div>
    </header>
    <div class="unit-detail-summary" id="unitKpis">
      ${unitKpis.map(([key, n, label])=>kpiButton(key, n, label, '', Boolean(key) && key === unitFilter)).join('')}
    </div>
    <section class="unit-detail-section" aria-label="Perfil da unidade">
      ${renderUnitProfileRead(unit)}
    </section>
    <section class="unit-detail-section">${renderEvidence('unit', unit)}</section>
    <section class="unit-detail-section"><h2>Obrigações ambientais</h2>
      ${renderObligations(unit, licenses)}
    </section>
    <section class="unit-detail-section">${renderUnitFlow(unit)}</section>
    <section class="unit-detail-section" id="unitLicenses"><h2>Licenças da unidade${unitFilter ? ` <span class="lic-group-count">· ${shown.length} de ${licenses.length}</span>` : ''}</h2>
      ${!licenses.length ? `<div class="empty-cta"><p>Nenhuma licença cadastrada nesta unidade. Use o botão abaixo para adicionar a primeira.</p>
          <button class="btn btn-primary" type="button" data-new-unit-license="${esc(unit.id)}">+ Criar primeira licença</button></div>`
        : shown.map(lic=>renderCard(lic)).join('') || '<p>Nenhuma licença desta unidade com o filtro selecionado.</p>'}
    </section>
  </article>`;
  root.querySelectorAll('#unitKpis [data-kpi]').forEach(button=>button.addEventListener('click', ()=>{
    const key = button.dataset.kpi;
    unitQuickFilter = key && key !== unitFilter ? {unitId: id, key} : null;
    render();
    document.querySelector(`#unitKpis [data-kpi="${key}"]`)?.focus({preventScroll: true});
    document.getElementById('unitLicenses')?.scrollIntoView({block: 'start', behavior: 'smooth'});
  }));
  attachUnitPanelEvents();
  attachCardEvents();
  attachEvidenceEvents(root);
}

/* Status e prazo da obrigação: os dela, se houver; senão os da licença da unidade com o mesmo órgão e tipo. */
function obligationLicense(item, licenses){
  const orgao = normalizeKey(item.orgao);
  const tipo = normalizeKey(item.tipo);
  if(!orgao || !tipo) return null;
  return licenses.find(lic=>{
    const licTipo = normalizeKey(lic.tipoLicenca);
    return normalizeKey(lic.orgaoEmissor) === orgao && licTipo && (licTipo.includes(tipo) || tipo.includes(licTipo));
  }) || null;
}

function obligationStatus(item, license){
  if(item.status) return item.status;
  if(license?.status) return license.status;
  return /dispens|inexig/i.test(item.motivacao || '') ? 'Dispensada' : '';
}

function renderObligations(unit, licenses){
  const items = unit.environmentalLicenses || [];
  if(!items.length) return '<p>Nenhuma obrigação cadastrada.</p>';
  const rows = items.map(item=>{
    const license = obligationLicense(item, licenses);
    const status = obligationStatus(item, license);
    const prazo = item.prazo || item.vencimento || license?.vencimento || '';
    return `<tr>
      <td data-label="Obrigação"><strong>${esc(item.tipo || item.name || '—')}</strong>
        ${item.tema || item.motivacao ? `<small>${esc([item.tema, item.motivacao].filter(Boolean).join(' · '))}</small>` : ''}</td>
      <td data-label="Órgão">${esc(item.orgao || '—')}</td>
      <td data-label="Nº/Processo">${esc(item.numero || '—')}</td>
      <td data-label="Status">${status ? `<span class="badge ${statusBadgeClass(status)}">${esc(status)}</span>` : '—'}</td>
      <td data-label="Prazo">${/^\d{4}-\d{2}-\d{2}$/.test(prazo) ? esc(fmtDate(prazo)) : esc(prazo || '—')}</td>
    </tr>`;
  }).join('');
  return `<table class="obligations-table">
    <thead><tr><th scope="col">Obrigação</th><th scope="col">Órgão</th><th scope="col">Nº/Processo</th><th scope="col">Status</th><th scope="col">Prazo</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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
  /* Botões que aplicam o fluxo sugerido direto daqui, sem precisar abrir a licença. */
  const applyButton = lic=>{
    const type = suggestedFlowType(lic);
    if(lic.fluxo || !PROCESS_FLOWS[type]) return '';
    return `<button class="btn ${lic === target ? 'btn-primary' : ''}" type="button" data-flow-apply-direct="${esc(lic.id)}" data-flow-type="${esc(type)}">Aplicar fluxo de ${type === 'outorga' ? 'Outorgas' : 'Licenças'} na ${esc(lic.id)}</button>`;
  };
  if(!flows.length){
    const buttons = licenses.map(applyButton).join('');
    return `<h2>Fluxo da unidade</h2><p>Nenhuma licença desta unidade segue o fluxograma ainda.${buttons ? '' : ' Cadastre uma licença para aplicar o fluxo.'}</p>${hint}
      ${buttons ? `${target ? '' : '<p class="flow-help">Aplicar o fluxo acrescenta as etapas do fluxograma e mantém as atividades atuais da licença.</p>'}<div class="unit-actions">${buttons}</div>` : ''}`;
  }
  return `<h2>Fluxo da unidade</h2>${hint}${hint ? `<div class="unit-actions">${applyButton(target)}</div>` : ''}
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
  const entries = (MODEL?.units || []).map(unit=>{
    const licenses = list.filter(lic=>lic.unidadeId === unit.id);
    return {unit, licenses, urgent: licenses.filter(needsAction).length};
  }).filter(({unit, licenses})=>{
    if(selected && (unit.nome || unit.codigo) !== selected) return false;
    if(licenses.length) return true;
    if(licenseFilter || DATA.some(lic=>lic.unidadeId === unit.id)) return false;
    return !query || `${unit.nome} ${unit.cidade} ${unit.uf}`.toLowerCase().includes(query);
  });
  if(!entries.length){
    root.innerHTML = '<div class="empty">Nenhuma unidade encontrada com os filtros atuais.</div>';
    return;
  }
  /* Unidades com mais licenças que requerem ação aparecem primeiro. */
  entries.sort((a,b)=>b.urgent - a.urgent || (a.unit.nome || '').localeCompare(b.unit.nome || '', 'pt-BR'));
  root.innerHTML = `<div class="unit-panel-grid">${entries.map(({unit, licenses, urgent})=>{
    const name = unit.nome || unit.codigo;
    const sample = unit;
    const profile = unit.profile || {};
    const done = licenses.reduce((sum, lic)=>sum+(lic.activities||[]).filter(a=>a.status==='Done').length,0);
    const activityTotal = licenses.reduce((sum, lic)=>sum+(lic.activities||[]).length,0);
    return `<article class="unit-panel">
      <div class="unit-panel-head"><div><div class="unit-panel-kicker">Unidade</div><h2>${esc(name)}</h2>${urgent ? `<span class="badge badge-acao">${urgent} ${urgent === 1 ? 'requer' : 'requerem'} ação</span>` : ''}<p>${esc(sample.cidade || '')}${sample.uf ? `/${esc(sample.uf)}` : ''}</p></div><button class="btn btn-ghost" data-edit-unit="${esc(unit.id)}">Editar unidade</button></div>
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
  document.querySelectorAll('[data-back-units]').forEach(button=>button.addEventListener('click', ()=>navigatePanel('#view=unidades')));
  document.querySelectorAll('[data-open-unit-license]').forEach(button=>button.addEventListener('click', ()=>{
    const id = button.dataset.openUnitLicense;
    expandedIds.add(id);
    render();
    const card = window.CSS ? document.querySelector(`.lic-card[data-id="${window.CSS.escape(id)}"]`) : null;
    card?.scrollIntoView({block: 'start'});
  }));
  document.querySelectorAll('[data-flow-apply-direct]').forEach(button=>button.addEventListener('click', ()=>{
    const type = button.dataset.flowType;
    void runFlowAction(button.dataset.flowApplyDirect, lic=>applyFlow(lic, type), 'Fluxo aplicado');
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
  if(!await askConfirm({
    title: 'Excluir unidade',
    message: `Excluir a unidade "${unit.nome || unit.codigo}" para todos os colaboradores? O perfil, as obrigações, o fluxo e os vínculos de comprovantes serão removidos. Arquivos no OneDrive não serão apagados.`,
    confirmLabel: `Excluir ${unit.nome || unit.codigo}`, danger: true
  })){
    return false;
  }
  MODEL.units = MODEL.units.filter(item=>item.id !== id);
  if(document.getElementById('fUnidade').value === (unit.nome || unit.codigo)){
    document.getElementById('fUnidade').value = '';
  }
  const saving = saveData();
  navigatePanel('#view=unidades');
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

/* ---------------------------------------------------------------
   INDICADORES DE DESEMPENHO DO PROCESSO (POP, seção 7)
   Calculados sobre as licenças no escopo dos filtros, com o estado atual da base.
--------------------------------------------------------------- */
const IND_STATUS_LABEL = {ok: 'Dentro da meta', alerta: 'Atenção', critico: 'Fora da meta', info: 'Acompanhamento', vazio: 'Sem dados'};
const percent = (num, den)=>den ? Math.round(num / den * 1000) / 10 : null;
const fmtPercent = value=>value === null ? '—' : `${String(value).replace('.', ',')}%`;
const VALID_LICENSE_STATUSES = ['Obtida', 'Condicionada'];
const licenseIsExpired = lic=>Boolean(lic.vencimento) && daysUntil(lic.vencimento) < 0;
const highRiskOpen = lic=>(lic.risco || '').toLowerCase() === 'alto' && !SETTLED_STATUSES.includes(lic.status);

/* Itens executáveis: as subatividades quando existem; senão, a própria atividade (evita contar em dobro). */
function leafActivities(lic){
  const items = [];
  (lic.activities || []).forEach(activity=>{
    const subs = activity.subatividades || [];
    if(subs.length) subs.forEach(sub=>items.push({lic, item: sub, nome: `${activity.name} › ${sub.name}`}));
    else items.push({lic, item: activity, nome: activity.name});
  });
  return items;
}

/* Renovação iniciada: licença em análise ou alguma atividade em andamento/concluída desde a abertura da janela. */
function renewalStarted(lic, abertura){
  if(lic.status === 'Em análise') return true;
  return leafActivities(lic).some(({item})=>(['Working on it', 'Stuck'].includes(item.status)
      && (!item.dataInicio || item.dataInicio >= abertura))
    || (item.status === 'Done' && (item.dataRealizada || '') >= abertura));
}

const INDICATORS = [
  {
    id: 'conformidade', nome: 'Índice de conformidade legal',
    objetivo: 'Medir a parcela das licenças aplicáveis que estão regulares (obtidas e vigentes, ou dispensadas).',
    formula: '(licenças obtidas e vigentes + dispensadas) ÷ licenças aplicáveis × 100',
    unidade: '%', meta: '100%', fonte: 'Status e vencimento das licenças',
    compute(list){
      const aplicaveis = list.filter(lic=>lic.status !== 'Não aplicável');
      const conformes = aplicaveis.filter(lic=>lic.status === 'Dispensada' || (lic.status === 'Obtida' && !licenseIsExpired(lic)));
      const value = percent(conformes.length, aplicaveis.length);
      const ids = new Set(conformes.map(lic=>lic.id));
      return {
        value, display: fmtPercent(value), sub: `${conformes.length} de ${aplicaveis.length} licenças`,
        status: value === null ? 'vazio' : value >= 100 ? 'ok' : value >= 90 ? 'alerta' : 'critico',
        detailTitle: 'Licenças não conformes',
        rows: aplicaveis.filter(lic=>!ids.has(lic.id)).map(lic=>({lic,
          motivo: licenseIsExpired(lic) ? `Vencida há ${humanSpan(-daysUntil(lic.vencimento))}` : `Status: ${lic.status || 'não informado'}`}))
      };
    }
  },
  {
    id: 'vencidas', nome: 'Licenças vencidas',
    objetivo: 'Identificar licenças com data de vencimento já ultrapassada.',
    formula: 'nº de licenças com vencimento anterior a hoje',
    unidade: 'nº', meta: '0', fonte: 'Vencimento das licenças',
    compute(list){
      const rows = list.filter(licenseIsExpired)
        .sort((a, b)=>a.vencimento.localeCompare(b.vencimento))
        .map(lic=>({lic, motivo: `Venceu em ${fmtDate(lic.vencimento)} (há ${humanSpan(-daysUntil(lic.vencimento))})`}));
      return {value: rows.length, display: String(rows.length), sub: 'licenças', status: rows.length ? 'critico' : 'ok',
        detailTitle: 'Licenças vencidas', rows};
    }
  },
  {
    id: 'renovacao', nome: 'Renovação em risco',
    objetivo: 'Antecipar vencimentos: licenças dentro da janela de renovação sem processo iniciado.',
    formula: 'nº de licenças vigentes dentro da janela de renovação (120 dias por padrão) sem atividade iniciada na janela',
    unidade: 'nº', meta: '0', fonte: 'Vencimento, janela de renovação e atividades',
    compute(list){
      const rows = [];
      list.forEach(lic=>{
        const span = renewalWindow(lic);
        if(!VALID_LICENSE_STATUSES.includes(lic.status) || !span || licenseIsExpired(lic)
          || span.abertura > todayStr() || renewalStarted(lic, span.abertura)) return;
        rows.push({lic, dias: daysUntil(lic.vencimento),
          motivo: `Vence em ${humanSpan(daysUntil(lic.vencimento))}; janela aberta em ${fmtDate(span.abertura)}`});
      });
      rows.sort((a, b)=>a.dias - b.dias);
      return {value: rows.length, display: String(rows.length), sub: 'licenças', status: rows.length ? 'alerta' : 'ok',
        detailTitle: 'Licenças na janela sem renovação iniciada', rows};
    }
  },
  {
    id: 'risco', nome: 'Risco alto em aberto',
    objetivo: 'Acompanhar a exposição a licenças de risco alto ainda não regularizadas.',
    formula: 'nº de licenças com risco alto e status diferente de Obtida, Dispensada ou Não aplicável',
    unidade: 'nº', meta: '0', fonte: 'Risco e status das licenças',
    compute(list){
      const rows = list.filter(highRiskOpen).map(lic=>({lic, motivo: `Status: ${lic.status || 'não informado'}`}));
      return {value: rows.length, display: String(rows.length), sub: 'licenças', status: rows.length ? 'critico' : 'ok',
        detailTitle: 'Licenças de risco alto em aberto', rows};
    }
  },
  {
    id: 'prazo', nome: 'Atividades concluídas no prazo',
    objetivo: 'Medir o cumprimento dos prazos planejados das atividades e subatividades.',
    formula: 'concluídas até a data Fim ÷ concluídas com data Fim e data de conclusão registradas × 100',
    unidade: '%', meta: '≥ 90%', fonte: 'Atividades e subatividades (data Fim e data de conclusão)',
    compute(list){
      const done = list.flatMap(leafActivities).filter(({item})=>item.status === 'Done' && item.dataFim);
      const measured = done.filter(({item})=>item.dataRealizada);
      const late = measured.filter(({item})=>item.dataRealizada > item.dataFim);
      const value = percent(measured.length - late.length, measured.length);
      const semData = done.length - measured.length;
      return {
        value, display: fmtPercent(value),
        sub: measured.length ? `${measured.length - late.length} de ${measured.length} atividades` : 'nenhuma atividade concluída com data Fim',
        status: value === null ? 'vazio' : value >= 90 ? 'ok' : value >= 75 ? 'alerta' : 'critico',
        detailTitle: 'Atividades concluídas após a data Fim',
        note: semData ? `${semData} atividade(s) concluída(s) sem data de conclusão registrada ficaram fora do cálculo.` : '',
        rows: late.map(({lic, item, nome})=>({lic, nome,
          motivo: `Fim ${fmtDate(item.dataFim)} · concluída em ${fmtDate(item.dataRealizada)}`}))
      };
    }
  },
  {
    id: 'atraso', nome: 'Atraso médio das atividades',
    objetivo: 'Dimensionar o atraso das atividades em aberto com data Fim já ultrapassada.',
    formula: 'soma dos dias de atraso ÷ nº de atividades em aberto fora do prazo',
    unidade: 'dias', meta: '0 dia', fonte: 'Atividades e subatividades (data Fim e status)',
    compute(list){
      const late = list.flatMap(leafActivities).map(entry=>({...entry, dias: activityLateDays(entry.item)})).filter(entry=>entry.dias);
      const value = late.length ? Math.round(late.reduce((sum, entry)=>sum + entry.dias, 0) / late.length) : 0;
      late.sort((a, b)=>b.dias - a.dias);
      return {
        value, display: `${value} ${value === 1 ? 'dia' : 'dias'}`,
        sub: late.length ? `${late.length} atividade(s) fora do prazo` : 'nenhuma atividade em atraso',
        status: !late.length ? 'ok' : value <= 15 ? 'alerta' : 'critico',
        detailTitle: 'Atividades em aberto fora do prazo',
        rows: late.map(({lic, item, nome, dias})=>({lic, nome,
          motivo: `Atrasada há ${humanSpan(dias)} (Fim ${fmtDate(item.dataFim)}) · ${item.status}`}))
      };
    }
  },
  {
    id: 'avanco', nome: 'Avanço do fluxo por unidade',
    objetivo: 'Acompanhar a execução das etapas do fluxograma de Licenças e Outorgas em cada unidade.',
    formula: 'atividades de etapas do fluxo concluídas (Done ou N/A) ÷ total de atividades de etapas do fluxo × 100',
    unidade: '%', meta: 'Acompanhamento', fonte: 'Atividades vinculadas ao fluxograma',
    compute(list){
      const byUnit = new Map();
      list.filter(lic=>lic.fluxo).forEach(lic=>{
        const steps = (lic.activities || []).filter(activity=>activity.etapaPadraoId);
        if(!steps.length) return;
        const entry = byUnit.get(lic.unidade) || {unidade: lic.unidade, done: 0, total: 0, licencas: 0};
        entry.done += steps.filter(activity=>STEP_DONE.includes(activity.status)).length;
        entry.total += steps.length;
        entry.licencas += 1;
        byUnit.set(lic.unidade, entry);
      });
      const units = [...byUnit.values()].map(entry=>({...entry, pct: percent(entry.done, entry.total)}))
        .sort((a, b)=>a.pct - b.pct || a.unidade.localeCompare(b.unidade, 'pt-BR'));
      const done = units.reduce((sum, entry)=>sum + entry.done, 0);
      const total = units.reduce((sum, entry)=>sum + entry.total, 0);
      const value = percent(done, total);
      return {value, display: fmtPercent(value), sub: total ? `${done} de ${total} etapas · ${units.length} unidade(s)` : 'nenhuma licença com fluxo aplicado',
        status: value === null ? 'vazio' : 'info', detailTitle: 'Avanço por unidade', units};
    }
  }
];

const INDICATOR_COMMON = {periodicidade: 'Mensal', responsavel: 'Sustentabilidade'};
let selectedIndicator = 'conformidade';

function computeIndicators(list){
  return INDICATORS.map(def=>({...INDICATOR_COMMON, ...def, result: def.compute(list)}));
}

function renderIndicatorDetail(ind){
  const r = ind.result;
  let body;
  if(ind.id === 'avanco'){
    body = r.units.length ? `<ul class="ind-bars">${r.units.map(entry=>`<li>
        <span class="ind-bar-label">${esc(entry.unidade)} <small>${entry.licencas} licença(s)</small></span>
        <span class="ind-bar-track" role="img" aria-label="${esc(entry.unidade)}: ${fmtPercent(entry.pct)}"><span class="ind-bar-fill" style="width:${entry.pct}%"></span></span>
        <span class="ind-bar-value">${fmtPercent(entry.pct)} <small>${entry.done}/${entry.total}</small></span>
      </li>`).join('')}</ul>`
      : '<p class="ind-empty">Nenhuma licença no escopo segue o fluxograma.</p>';
  }else{
    body = r.rows.length ? `<table class="ind-table">
        <thead><tr><th>Licença</th><th>Unidade</th>${r.rows.some(row=>row.nome) ? '<th>Atividade</th>' : ''}<th>Situação</th></tr></thead>
        <tbody>${r.rows.map(row=>`<tr>
          <td><button type="button" class="link-btn" data-open-lic="${esc(row.lic.id)}">${esc(row.lic.id)}</button> <span class="ind-muted">${esc(row.lic.tipoLicenca || '')}</span></td>
          <td>${esc(row.lic.unidade)}</td>${r.rows.some(item=>item.nome) ? `<td>${esc(row.nome || '—')}</td>` : ''}<td>${esc(row.motivo)}</td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="ind-empty">Nenhum item fora da meta ✓</p>';
  }
  return `<section class="ind-detail" aria-labelledby="indDetailTitle">
    <h2 id="indDetailTitle">${esc(r.detailTitle)} <span class="ind-muted">· ${esc(ind.nome)}</span></h2>
    <p class="ind-formula"><b>Fórmula:</b> ${esc(ind.formula)} · <b>Meta:</b> ${esc(ind.meta)}</p>
    ${r.note ? `<p class="ind-note">${esc(r.note)}</p>` : ''}
    ${body}
  </section>`;
}

function renderIndicators(list){
  const root = document.getElementById('indicatorsPanel');
  const indicators = computeIndicators(list);
  if(!indicators.some(ind=>ind.id === selectedIndicator)) selectedIndicator = indicators[0].id;
  const selected = indicators.find(ind=>ind.id === selectedIndicator);
  root.innerHTML = `
    <p class="ind-intro">Indicadores de desempenho do processo (POP, seção 7) calculados sobre as <b>${list.length}</b> licença(s) no escopo dos filtros, com a situação de hoje (${fmtDate(todayStr())}). Clique em um indicador para ver o que compõe o resultado.</p>
    <div class="ind-grid">${indicators.map(ind=>`
      <button type="button" class="ind-card ind-${ind.result.status}" data-ind="${ind.id}" aria-pressed="${ind.id === selectedIndicator}">
        <span class="ind-name">${esc(ind.nome)}</span>
        <span class="ind-value">${esc(ind.result.display)}</span>
        <span class="ind-sub">${esc(ind.result.sub)}</span>
        <span class="ind-foot"><span class="ind-chip">${IND_STATUS_LABEL[ind.result.status]}</span><span>Meta: ${esc(ind.meta)}</span></span>
      </button>`).join('')}
    </div>
    ${renderIndicatorDetail(selected)}
    <details class="ind-sheet">
      <summary>Ficha técnica dos indicadores</summary>
      <div class="ind-sheet-scroll"><table class="ind-table">
        <thead><tr><th>Indicador</th><th>Objetivo</th><th>Fórmula</th><th>Unidade</th><th>Meta</th><th>Periodicidade</th><th>Fonte</th><th>Responsável</th></tr></thead>
        <tbody>${indicators.map(ind=>`<tr><td><b>${esc(ind.nome)}</b></td><td>${esc(ind.objetivo)}</td><td>${esc(ind.formula)}</td><td>${esc(ind.unidade)}</td><td>${esc(ind.meta)}</td><td>${esc(ind.periodicidade)}</td><td>${esc(ind.fonte)}</td><td>${esc(ind.responsavel)}</td></tr>`).join('')}</tbody>
      </table></div>
    </details>`;
  root.querySelectorAll('[data-ind]').forEach(button=>button.addEventListener('click', ()=>{
    selectedIndicator = button.dataset.ind;
    renderIndicators(list);
    root.querySelector(`[data-ind="${selectedIndicator}"]`)?.focus();
  }));
  root.querySelectorAll('[data-open-lic]').forEach(button=>button.addEventListener('click', ()=>openLicense(button.dataset.openLic)));
}

function renderCard(lic){
  const open = expandedIds.has(lic.id);
  const venc = vencimentoBadge(lic.vencimento);
  const doneCount = lic.activities.filter(a=>a.status==='Done').length;
  const late = lateActivities(lic);
  const lateTitle = late.map(item=>item.sub ? `${item.activity.name} › ${item.sub.name}` : item.activity.name).join('\n');
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
        ${venc?`<span class="badge ${venc.cls}" title="${esc(venc.title)}">${esc(venc.txt)}</span>`:''}
        ${late.length ? `<span class="badge badge-late" title="${esc(lateTitle)}">⚠ ${late.length} ${late.length === 1 ? 'atividade fora do prazo' : 'atividades fora do prazo'}</span>` : ''}
      </div>
    </div>
    <div class="lic-body">
      ${renderUnitProfile(lic)}
      ${renderFields(lic)}
      ${renderEvidence('license', lic)}
      ${renderFlow(lic)}
      ${renderActivities(lic)}
      <div class="card-footer">
        <span style="font-size:11px;color:var(--ink-soft);">Última atualização: ${esc(lic.lastUpdated||'—')}</span>
        <button class="btn btn-danger" data-del-lic="${esc(lic.id)}">Excluir licença</button>
      </div>
    </div>
  </div>`;
}

/* Só um card fica em edição por vez; as mudanças ficam no rascunho até Salvar. */
let licenseEditor = null;
const LICENSE_EDIT_FIELDS = ['risco','razaoSocial','categoria','orgaoEmissor','tipoLicenca','status','dataEmissao','vencimento','antecedenciaDias','notes'];

function readItem(label, value, cls = ''){
  const text = String(value ?? '').trim();
  return `<div class="${cls}"><dt>${label}</dt><dd class="${text ? '' : 'is-empty'}">${text ? esc(text) : '—'}</dd></div>`;
}

function renderFields(lic){
  const id = esc(lic.id);
  const defaultLead = PROCESS_FLOWS[lic.fluxo?.tipo || suggestedFlowType(lic)]?.antecedenciaDias || 120;
  if(licenseEditor?.id !== lic.id){
    return `<div class="section-label">Dados da licença
        <button class="btn btn-small" type="button" data-edit-lic="${id}">Editar licença</button></div>
      <dl class="read-grid">
        ${readItem('Unidade', lic.unidade)}
        ${readItem('Cidade / UF', lic.cidade ? `${lic.cidade}/${lic.uf || ''}` : '')}
        ${readItem('Risco', lic.risco)}
        ${readItem('Status', lic.status)}
        ${readItem('Razão social', lic.razaoSocial, 'wide')}
        ${readItem('Categoria', lic.categoria, 'wide')}
        ${readItem('Órgão emissor', lic.orgaoEmissor)}
        ${readItem('Tipo de licença', lic.tipoLicenca)}
        ${readItem('Data de emissão', lic.dataEmissao ? fmtDate(lic.dataEmissao) : '')}
        ${readItem('Vencimento', lic.vencimento ? fmtDate(lic.vencimento) : '')}
        ${readItem('Janela de renovação', `${lic.antecedenciaDias || defaultLead} dias${lic.antecedenciaDias ? '' : ' (padrão)'}`)}
        ${readItem('Notas', lic.notes, 'full notes')}
      </dl>`;
  }
  const value = key=>licenseEditor.draft[key] ?? lic[key] ?? '';
  const inputId = key=>`ed_${id}_${key}`;
  const f = (label,key,type='text',cls='')=>`
    <div class="field ${cls}"><label for="${inputId(key)}">${label}</label><input id="${inputId(key)}" type="${type}" data-lic="${id}" data-field="${key}" value="${esc(value(key))}"></div>`;
  const sel = (label,key,options)=>`
    <div class="field"><label for="${inputId(key)}">${label}</label>
    <select id="${inputId(key)}" data-lic="${id}" data-field="${key}">
      ${options.map(o=>`<option ${o===value(key)?'selected':''}>${esc(o)}</option>`).join('')}
    </select></div>`;
  return `<div class="license-editor" data-editor="${id}">
    <div class="section-label">Editando dados da licença<span class="editor-hint">Esc cancela · Ctrl+Enter salva</span></div>
    <dl class="read-grid">
      ${readItem('Unidade', lic.unidade)}
      ${readItem('Cidade / UF', lic.cidade ? `${lic.cidade}/${lic.uf || ''}` : '')}
    </dl>
    <div class="field-grid">
      ${sel('Risco','risco',['NA','Baixo','Médio','Alto'])}
      ${sel('Status','status',LICENSE_STATUSES)}
      ${f('Razão social','razaoSocial','text','wide')}
      ${f('Categoria','categoria','text','wide')}
      ${f('Órgão emissor','orgaoEmissor')}
      ${f('Tipo de licença','tipoLicenca')}
      ${f('Data de emissão','dataEmissao','date')}
      ${f('Vencimento','vencimento','date')}
      <div class="field"><label for="${inputId('antecedenciaDias')}">Janela de renovação (dias)</label><input id="${inputId('antecedenciaDias')}" type="number" min="1" step="1" data-lic="${id}" data-field="antecedenciaDias" value="${esc(value('antecedenciaDias'))}" placeholder="${esc(defaultLead)}" title="Dias antes do vencimento em que a renovação entra no ciclo mensal"></div>
      <div class="field full"><label for="${inputId('notes')}">Notas</label><textarea id="${inputId('notes')}" data-lic="${id}" data-field="notes">${esc(value('notes'))}</textarea></div>
    </div>
    <div class="editor-actions">
      <button class="btn" type="button" data-edit-cancel="${id}">Cancelar</button>
      <button class="btn btn-primary" type="button" data-edit-save="${id}">Salvar</button>
    </div>
  </div>`;
}

/* Abre o editor de uma licença, confirmando antes de descartar o rascunho de outra. */
async function startLicenseEdit(id){
  if(licenseEditor?.dirty && licenseEditor.id !== id && !await askConfirm({
    message: `Descartar as alterações não salvas da licença ${licenseEditor.id}?`, confirmLabel: 'Descartar alterações', danger: true
  })) return false;
  licenseEditor = {id, draft: {}, dirty: false};
  expandedIds.add(id);
  render();
  document.querySelector(`[data-editor="${window.CSS ? CSS.escape(id) : id}"] [data-field]`)?.focus();
  return true;
}

function focusEditButton(id){
  document.querySelector(`[data-edit-lic="${window.CSS ? CSS.escape(id) : id}"]`)?.focus();
}

function cancelLicenseEdit(){
  const id = licenseEditor?.id;
  licenseEditor = null;
  render();
  if(id) focusEditButton(id);
}

async function saveLicenseEdit(){
  const editor = licenseEditor;
  const lic = editor && DATA.find(item=>item.id === editor.id);
  if(!lic){
    licenseEditor = null;
    showToast('A licença não está mais disponível. Carregue o servidor.');
    render();
    return false;
  }
  LICENSE_EDIT_FIELDS.forEach(key=>{
    if(key in editor.draft) lic[key] = editor.draft[key];
  });
  licenseEditor = null;
  const saving = saveData();
  render();
  focusEditButton(lic.id);
  const saved = await saving;
  showToast(saved ? 'Licença salva' : 'Licença salva localmente; sincronização pendente');
  return saved;
}

/* Dentro da licença o perfil aparece resumido; a edição fica na página da unidade. */
function renderUnitProfile(lic){
  const profile = lic.perfilUnidade || {};
  const parts = [['Razão social', profile.razaoSocial || lic.razaoSocial], ['CNPJ', profile.cnpj || lic.cnpj], ['Área', profile.area]]
    .filter(([, value])=>value);
  return `<div class="unit-profile-line"><span class="unit-profile-line-label">Perfil da unidade</span>
    <span class="unit-profile-line-values">${parts.map(([label, value])=>`<span><b>${label}:</b> ${esc(value)}</span>`).join(' · ') || 'Perfil ainda não preenchido.'}</span>
    ${lic.unidadeId ? `<a href="#unit=${encodeURIComponent(lic.unidadeId)}">Ver/editar perfil da unidade →</a>` : ''}
  </div>`;
}

function renderUnitProfileRead(unit){
  const profile = unit.profile || {};
  const wide = ['endereco','atividadeAmbiental','atividadesConduzidas'];
  return `<h2>Perfil da unidade</h2>
    <dl class="read-grid">
      ${PROFILE_FIELDS.map(([label, key])=>readItem(label, profile[key] ?? unit[key], wide.includes(key) ? 'wide' : '')).join('')}
    </dl>`;
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

function activityKey(lic, activity, index){
  return `${lic.id}:${activity.id || index}`;
}

function renderActivities(lic){
  const steps = flowStepOptions(lic);
  const columns = steps.length ? 9 : 8;
  const rows = lic.activities.map((a,i)=>{
    const overdue = a.date && daysUntil(a.date)<0 && a.status!=='Done';
    const linked = steps.some(node=>node.id === a.etapaPadraoId);
    const subs = a.subatividades || [];
    const subsDone = subs.filter(sub=>STEP_DONE.includes(sub.status)).length;
    const key = activityKey(lic, a, i);
    const subsOpen = expandedActivities.has(key);
    const stepCell = steps.length ? `<td><select data-af="etapaPadraoId" class="act-step" aria-label="Etapa do fluxo">
        <option value="" ${linked ? '' : 'selected'}>— sem etapa —</option>
        ${steps.map(node=>`<option value="${esc(node.id)}" ${node.id === a.etapaPadraoId ? 'selected' : ''}>${esc(node.nome)}</option>`).join('')}
      </select></td>` : '';
    const subRows = subs.map((sub, j)=>`
          <tr data-sub-idx="${j}" class="${activityLateDays(sub) ? 'act-late' : ''}">
            <td><input data-sf="name" value="${esc(sub.name)}" aria-label="Subatividade">${lateBadge(sub)}</td>
            <td><input data-sf="owner" value="${esc(sub.owner||'')}" placeholder="Definir responsável" aria-label="Responsável da subatividade"></td>
            <td><select data-sf="status" class="act-status ${actStatusClass(sub.status)}" aria-label="Status da subatividade">
              ${ACTIVITY_STATUSES.map(s=>`<option ${s===sub.status?'selected':''}>${s}</option>`).join('')}
            </select></td>
            <td><input type="date" data-sf="dataInicio" value="${esc(sub.dataInicio||'')}" aria-label="Data início da subatividade"></td>
            <td><input type="date" data-sf="dataFim" value="${esc(sub.dataFim||'')}" class="${activityLateDays(sub)?'act-overdue':''}" aria-label="Data fim da subatividade"></td>
            <td><button class="del-x" data-del-sub="1" title="Remover subatividade" aria-label="Remover subatividade">✕</button></td>
          </tr>`).join('');
    const subSection = subsOpen ? `
    <tr class="sub-row" data-lic="${esc(lic.id)}" data-parent="${i}"><td colspan="${columns}">
      <table class="sub-table" aria-label="Subatividades de ${esc(a.name)}">
        <thead><tr><th scope="col" style="width:30%">Subatividade</th><th scope="col" style="width:20%">Responsável</th><th scope="col" style="width:17%">Status</th><th scope="col" style="width:15%">Início</th><th scope="col" style="width:15%">Fim</th><th></th></tr></thead>
        <tbody>${subRows || `<tr><td colspan="6" class="sub-empty">Nenhuma subatividade. Com subatividades, o status da atividade passa a ser calculado por elas.</td></tr>`}</tbody>
      </table>
      <button class="btn sub-add" data-add-sub="1">+ Adicionar subatividade</button>
    </td></tr>` : '';
    return `
    <tr class="act-row ${activityLateDays(a) ? 'act-late' : ''}" data-lic="${esc(lic.id)}" data-idx="${i}">
      <td><input data-af="name" value="${esc(a.name)}" aria-label="Atividade">
        <button type="button" class="sub-toggle" data-sub-toggle="${esc(key)}" aria-expanded="${subsOpen}">${subsOpen ? '▾' : '▸'} ${subs.length ? `Subatividades ${subsDone}/${subs.length}` : 'Subatividades'}</button>
        ${lateBadge(a)}</td>${stepCell}
      <td><input data-af="owner" value="${esc(a.owner||'')}" placeholder="Definir responsável" aria-label="Responsável"></td>
      <td>
        <select data-af="status" class="act-status ${actStatusClass(a.status)}" aria-label="Status"${subs.length ? ' disabled title="Status calculado pelas subatividades"' : ''}>
          ${ACTIVITY_STATUSES.map(s=>`<option ${s===a.status?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td><input type="date" data-af="date" value="${esc(a.date||'')}" class="${overdue?'act-overdue':''}" aria-label="Data"></td>
      <td><input type="date" data-af="dataInicio" value="${esc(a.dataInicio||'')}" aria-label="Data início"></td>
      <td><input type="date" data-af="dataFim" value="${esc(a.dataFim||'')}" class="${activityLateDays(a)?'act-overdue':''}" aria-label="Data fim"></td>
      <td><input data-af="observacao" value="${esc(a.observacao||'')}" placeholder="Adicionar observação" aria-label="Observação"></td>
      <td><button class="del-x" data-del-act="1" title="Remover atividade">✕</button></td>
    </tr>${subSection}`;
  }).join('');
  return `
  <div class="section-label">Atividades / etapas
    <button class="btn" style="padding:5px 10px;font-size:12px;" data-add-act="${esc(lic.id)}">+ Adicionar atividade</button>
  </div>
  <div class="table-scroll"><table class="act-table">
    <thead><tr>${steps.length
      ? '<th style="width:19%">Atividade</th><th style="width:14%">Etapa do fluxo</th><th style="width:11%">Responsável</th><th style="width:11%">Status</th><th style="width:10%">Data</th><th style="width:10%">Início</th><th style="width:10%">Fim</th><th style="width:15%">Observação</th>'
      : '<th style="width:21%">Atividade</th><th style="width:13%">Responsável</th><th style="width:13%">Status</th><th style="width:11%">Data</th><th style="width:11%">Início</th><th style="width:11%">Fim</th><th style="width:20%">Observação</th>'}<th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
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
    ${links.length ? `<ul class="evidence-list">${rows}</ul>` : '<p class="evidence-empty">Nenhum comprovante vinculado.</p>'}
    <div class="evidence-add">
      <button class="btn" type="button" data-evidence-add data-scope="${scope}" data-record="${esc(record.id)}">+ Vincular comprovante</button>
      ${links.length ? '' : '<span class="evidence-help">Cole o link de um arquivo ou pasta do OneDrive.</span>'}
    </div>
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
    button.addEventListener('click', ()=>{
      removeEvidenceLink(button.dataset.scope, button.dataset.record, Number(button.dataset.evidenceDelete));
    });
  });
}

/* Remove o vínculo na hora, com Desfazer; o arquivo no OneDrive nunca é apagado. */
function removeEvidenceLink(scope, id, index){
  const record = evidenceRecord(scope, id);
  const link = record?.evidenceLinks?.[index];
  if(!link){ showToast('O vínculo não está mais disponível.'); return false; }
  return undoable({
    apply: ()=>record.evidenceLinks.splice(index, 1),
    revert: ()=>{
      record.evidenceLinks = record.evidenceLinks || [];
      record.evidenceLinks.splice(Math.min(index, record.evidenceLinks.length), 0, link);
    },
    message: `Vínculo "${link.name}" removido. O arquivo continua no OneDrive.`,
    undoneMessage: 'Vínculo restaurado'
  });
}

/* Conclui as atividades da etapa atual na hora, com Desfazer. */
function completeFlowStepUndoable(id, stepId, count){
  const lic = DATA.find(item=>item.id === id);
  if(!lic){ showToast('A licença não está mais disponível. Carregue o servidor.'); return false; }
  const before = JSON.parse(JSON.stringify(lic));
  return undoable({
    apply: ()=>completeFlowStep(lic, stepId),
    revert: ()=>{
      Object.keys(lic).forEach(key=>delete lic[key]);
      Object.assign(lic, before);
    },
    message: count > 1 ? `${count} atividades da etapa concluídas` : 'Etapa concluída',
    undoneMessage: 'Conclusão da etapa desfeita'
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
    el.addEventListener('click', async ()=>{
      const id = el.getAttribute('data-toggle');
      if(expandedIds.has(id)){
        if(licenseEditor?.id === id){
          if(licenseEditor.dirty && !await askConfirm({
            message: `Descartar as alterações não salvas da licença ${id}?`, confirmLabel: 'Descartar alterações', danger: true
          })) return;
          licenseEditor = null;
        }
        expandedIds.delete(id);
      }else expandedIds.add(id);
      render();
    });
  });

  /* Campos do editor só alteram o rascunho; a licença muda ao clicar em Salvar. */
  document.querySelectorAll('[data-editor] [data-field]').forEach(el=>{
    const update = ()=>{
      if(licenseEditor?.id !== el.dataset.lic) return;
      licenseEditor.draft[el.dataset.field] = el.value;
      licenseEditor.dirty = true;
    };
    el.addEventListener('input', update);
    el.addEventListener('change', update);
  });
  document.querySelectorAll('[data-editor]').forEach(editor=>editor.addEventListener('keydown', event=>{
    if(event.key === 'Escape'){
      event.preventDefault();
      cancelLicenseEdit();
    }else if(event.key === 'Enter' && (event.ctrlKey || event.metaKey)){
      event.preventDefault();
      void saveLicenseEdit();
    }
  }));
  document.querySelectorAll('[data-edit-lic]').forEach(btn=>btn.addEventListener('click', ()=>{
    void startLicenseEdit(btn.dataset.editLic);
  }));
  document.querySelectorAll('[data-edit-cancel]').forEach(btn=>btn.addEventListener('click', cancelLicenseEdit));
  document.querySelectorAll('[data-edit-save]').forEach(btn=>btn.addEventListener('click', ()=>{ void saveLicenseEdit(); }));

  document.querySelectorAll('.act-table').forEach(t=>t.addEventListener('click', e=>e.stopPropagation()));

  document.querySelectorAll('.act-table tbody tr.act-row').forEach(tr=>{
    const lic = DATA.find(l=>l.id===tr.dataset.lic);
    const idx = +tr.dataset.idx;
    tr.querySelectorAll('[data-af]').forEach(el=>{
      el.addEventListener('change', ()=>{
        const before = currentFlowNodeId(lic);
        const activity = lic.activities[idx];
        if(el.dataset.af === 'status' && (activity.subatividades || []).length){
          el.value = activity.status;
          return;
        }
        const rangeError = dateRangeError(activity, el.dataset.af, el.value);
        if(rangeError){
          el.value = activity[el.dataset.af] || '';
          showToast(rangeError);
          return;
        }
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

  document.querySelectorAll('[data-sub-toggle]').forEach(btn=>btn.addEventListener('click', ()=>{
    const key = btn.dataset.subToggle;
    if(expandedActivities.has(key)) expandedActivities.delete(key);
    else expandedActivities.add(key);
    render();
  }));

  document.querySelectorAll('.act-table tr.sub-row').forEach(row=>{
    const lic = DATA.find(l=>l.id===row.dataset.lic);
    const activity = lic?.activities[+row.dataset.parent];
    if(!activity) return;
    /* Toda mudança em subatividade recalcula a atividade e pode avançar o fluxograma. */
    const commit = message=>{
      const before = currentFlowNodeId(lic);
      deriveActivityStatus(activity);
      syncFlowStatus(lic, before);
      const saving = saveData();
      render();
      if(message) saving.then(ok=>showToast(ok ? message : `${message} (pendente de sincronização)`));
    };
    row.querySelector('[data-add-sub]').addEventListener('click', ()=>{
      activity.subatividades = activity.subatividades || [];
      activity.subatividades.push({id: nextSubId(activity, lic, +row.dataset.parent), name: 'Nova subatividade',
        owner: '', status: 'Não iniciado', dataInicio: '', dataFim: '', dataRealizada: ''});
      commit('Subatividade adicionada');
    });
    row.querySelectorAll('tr[data-sub-idx]').forEach(subRow=>{
      const sub = activity.subatividades[+subRow.dataset.subIdx];
      subRow.querySelectorAll('[data-sf]').forEach(el=>el.addEventListener('change', ()=>{
        const field = el.dataset.sf;
        const rangeError = dateRangeError(sub, field, el.value);
        if(rangeError){
          el.value = sub[field] || '';
          showToast(rangeError);
          return;
        }
        sub[field] = el.value;
        if(field === 'status') sub.dataRealizada = STEP_DONE.includes(el.value) ? (sub.dataRealizada || todayStr()) : '';
        commit();
      }));
      subRow.querySelector('[data-del-sub]').addEventListener('click', async ()=>{
        if(!await askConfirm({title: 'Remover subatividade', message: `Remover a subatividade "${sub.name}"?`,
          confirmLabel: 'Remover subatividade', danger: true})) return;
        activity.subatividades.splice(activity.subatividades.indexOf(sub), 1);
        commit('Subatividade removida');
      });
    });
  });

  document.querySelectorAll('[data-add-act]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      const lic = DATA.find(l=>l.id===btn.dataset.addAct);
      lic.activities.push({name:'Nova atividade', owner:'', status:'Não iniciado', date:'', dataInicio:'', dataFim:'', observacao:'', subatividades:[]});
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
    completeFlowStepUndoable(btn.dataset.flowComplete, btn.dataset.step, Number(btn.dataset.count));
  }));
  document.querySelectorAll('[data-flow-import]').forEach(btn=>btn.addEventListener('click', ()=>{
    void runFlowAction(btn.dataset.flowImport, importSpreadsheetFlow, 'Atividades da planilha importadas');
  }));
  document.querySelectorAll('[data-flow-decide]').forEach(btn=>btn.addEventListener('click', ()=>{
    void runFlowAction(btn.dataset.flowDecide, lic=>decideFlow(lic, btn.dataset.gate, btn.dataset.option), 'Decisão registrada');
  }));
  document.querySelectorAll('[data-flow-cycle]').forEach(btn=>btn.addEventListener('click', async ()=>{
    if(!await askConfirm({
      title: 'Novo ciclo de renovação',
      message: `Iniciar um novo ciclo de renovação da licença ${btn.dataset.flowCycle}? As etapas do fluxo voltam para "Não iniciado"; o histórico é mantido.`,
      confirmLabel: 'Iniciar novo ciclo'
    })) return;
    void runFlowAction(btn.dataset.flowCycle, startFlowCycle, 'Novo ciclo iniciado');
  }));

  document.querySelectorAll('[data-del-lic]').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.stopPropagation();
      if(!await askConfirm({
        title: 'Excluir licença',
        message: `Excluir a licença ${btn.dataset.delLic}${remoteEnabled ? ' para todos os colaboradores' : ''}? Esta ação não pode ser desfeita.`,
        confirmLabel: `Excluir ${btn.dataset.delLic}`, danger: true
      })) return;
      DATA = DATA.filter(l=>l.id!==btn.dataset.delLic);
      if(licenseEditor?.id === btn.dataset.delLic) licenseEditor = null;
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
document.getElementById('fOrdem').addEventListener('change', render);

/* No celular os filtros ficam recolhidos atrás de "Filtros (n)". */
function updateFilterCount(){
  const active = ['fUnidade', 'fStatus', 'fRisco', 'fBusca'].filter(id=>document.getElementById(id).value.trim()).length
    + (quickFilter ? 1 : 0);
  document.getElementById('btnFilters').textContent = active ? `Filtros (${active})` : 'Filtros';
}

document.getElementById('btnFilters').addEventListener('click', ()=>{
  const filters = document.getElementById('dashboardFilters');
  const open = document.getElementById('btnFilters').getAttribute('aria-expanded') !== 'true';
  document.getElementById('btnFilters').setAttribute('aria-expanded', String(open));
  if(open) filters.classList.add('is-open');
  else filters.classList.remove('is-open');
});
VIEW_TABS.forEach(([id, view])=>{
  document.getElementById(id).addEventListener('click', ()=>navigatePanel(`#view=${view}`));
});
/* Setas, Home e End movem entre as abas e já ativam a visão escolhida. */
document.getElementById('viewTabs').addEventListener('keydown', event=>{
  const ids = VIEW_TABS.map(([id])=>id);
  const index = ids.indexOf(document.activeElement?.id);
  const next = {ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: ids.length - 1}[event.key];
  if(index < 0 || next === undefined) return;
  event.preventDefault();
  const tab = document.getElementById(ids[(next + ids.length) % ids.length]);
  tab.click();
  tab.focus();
});
document.getElementById('btnClearFilters').addEventListener('click', ()=>{
  document.getElementById('fUnidade').value='';
  document.getElementById('fStatus').value='';
  document.getElementById('fRisco').value='';
  document.getElementById('fBusca').value='';
  quickFilter = null;
  render();
});

/* ---------------------------------------------------------------
   MENU "MAIS" DO CABEÇALHO
--------------------------------------------------------------- */
const moreButton = document.getElementById('btnMore');
const moreMenu = document.getElementById('moreMenu');
/* Itens ocultos pelo CSS (atalhos só do celular) também ficam fora da navegação por setas. */
const moreMenuItems = ()=>[...moreMenu.querySelectorAll('[role="menuitem"]')]
  .filter(item=>!item.hidden && !item.disabled && item.getClientRects().length);

/* No celular, + Nova unidade e Exportar ficam no menu e acionam os botões originais. */
moreMenu.querySelectorAll('[data-proxy]').forEach(item=>item.addEventListener('click', ()=>{
  document.getElementById(item.dataset.proxy).click();
}));

function openMoreMenu(focus = 'first'){
  document.getElementById('moreMenuDivider').hidden =
    !['btnSync','btnReloadServer','btnImportLocal'].some(id=>!document.getElementById(id).hidden);
  moreMenu.hidden = false;
  moreButton.setAttribute('aria-expanded', 'true');
  const items = moreMenuItems();
  (focus === 'last' ? items[items.length - 1] : items[0])?.focus();
}

function closeMoreMenu(returnFocus = false){
  if(moreMenu.hidden) return;
  moreMenu.hidden = true;
  moreButton.setAttribute('aria-expanded', 'false');
  if(returnFocus) moreButton.focus();
}

moreButton.addEventListener('click', ()=>{
  if(moreMenu.hidden) openMoreMenu();
  else closeMoreMenu();
});
moreButton.addEventListener('keydown', event=>{
  if(event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  openMoreMenu(event.key === 'ArrowUp' ? 'last' : 'first');
});
moreMenu.addEventListener('keydown', event=>{
  const items = moreMenuItems();
  const index = items.indexOf(document.activeElement);
  const move = {ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1}[event.key];
  if(move !== undefined){
    event.preventDefault();
    items[(move + items.length) % items.length]?.focus();
  }else if(event.key === 'Escape'){
    event.preventDefault();
    closeMoreMenu(true);
  }else if(event.key === 'Tab'){
    closeMoreMenu();
  }
});
/* Fecha antes de executar o item, para que a ação possa mover o foco (ex.: abrir um modal). */
moreMenu.addEventListener('click', event=>{
  if(event.target.closest('[role="menuitem"]')) closeMoreMenu(true);
}, true);
document.addEventListener('click', event=>{
  if(!event.target.closest?.('.menu')) closeMoreMenu();
});

document.getElementById('btnReset').addEventListener('click', async ()=>{
  if(!await askConfirm({
    title: 'Restaurar dados originais',
    message: remoteEnabled
      ? 'Restaurar licenças e unidades originais para TODOS os colaboradores? As alterações da base central e unidades personalizadas serão substituídas.'
      : 'Restaurar licenças e unidades originais da planilha? Todas as edições e unidades personalizadas deste navegador serão perdidas.',
    confirmLabel: 'Restaurar dados', danger: true
  })) return;
  discardPendingUndo();
  DATA = JSON.parse(JSON.stringify(DEFAULT_DATA));
  MODEL = null;
  const saved = await saveData();
  render();
  showToast(saved ? 'Dados originais restaurados' : 'Restauração pendente de sincronização');
});

document.getElementById('btnSyncNow').addEventListener('click', ()=>{
  if(syncBannerAction) document.getElementById(syncBannerAction).click();
});

document.getElementById('btnSync').addEventListener('click', async ()=>{
  const committing = commitPendingUndo();
  if(committing) await committing;
  else if(pendingChanges) await saveData();
  else await refreshFromServer();
});

document.getElementById('btnReloadServer').addEventListener('click', async ()=>{
  if((pendingChanges || pendingUndo) && !await askConfirm({
    title: 'Descartar alterações pendentes',
    message: 'Descartar as alterações pendentes deste navegador e carregar a base central? Exporte o relatório antes, se precisar preservá-las.',
    confirmLabel: 'Descartar e carregar servidor', danger: true
  })) return;
  discardPendingUndo();
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
    if(!await askConfirm({
      title: 'Importar dados locais',
      message: 'Substituir a base central pelos dados antigos deste navegador? Isso afetará todos os colaboradores da organização.',
      confirmLabel: 'Substituir base central', danger: true
    })) return;
    discardPendingUndo();
    MODEL =isStructuredModel(stored) ? applyReferenceData(stored) : modelFromLegacyData(stored);
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
  const idInput = document.getElementById('nl_id');
  idInput.value = nextLicenseId();
  idInput.readOnly = true;
  document.getElementById('btnEditNewLicId').hidden = false;
  showNewLicenseErrors([]);
  fillNewLicenseUnit();
  suggestNewLicenseFlow();
  openModal('overlayNewLic');
}

/* Próximo L-NNN livre, a partir do maior número já usado. */
function nextLicenseId(){
  const numbers = DATA.map(lic=>/^L-(\d+)$/.exec(lic.id || '')).filter(Boolean).map(match=>Number(match[1]));
  return `L-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`;
}

const NEW_LICENSE_FIELDS = ['nl_id', 'nl_unidade', 'nl_orgao', 'nl_tipo', 'nl_status'];

function validateNewLicense(){
  const value = id=>document.getElementById(id).value.trim();
  const errors = [];
  const id = value('nl_id');
  if(!id) errors.push(['nl_id', 'Informe um ID para a licença.']);
  else if(DATA.some(lic=>lic.id === id)) errors.push(['nl_id', `Já existe uma licença com o ID ${id}.`]);
  if(!MODEL.units.some(unit=>unit.id === value('nl_unidade'))) errors.push(['nl_unidade', 'Selecione uma unidade cadastrada.']);
  if(!value('nl_tipo')) errors.push(['nl_tipo', 'Informe o tipo de licença.']);
  if(!value('nl_orgao')) errors.push(['nl_orgao', 'Informe o órgão emissor.']);
  if(!LICENSE_STATUSES.includes(value('nl_status'))) errors.push(['nl_status', 'Selecione o status.']);
  return errors;
}

/* Mensagem inline e aria-invalid nos campos com problema; o foco vai para o primeiro. */
function showNewLicenseErrors(errors){
  const box = document.getElementById('newLicError');
  const invalid = new Set(errors.map(([id])=>id));
  NEW_LICENSE_FIELDS.forEach(id=>{
    const field = document.getElementById(id);
    if(invalid.has(id)) field.setAttribute('aria-invalid', 'true');
    else field.removeAttribute('aria-invalid');
  });
  box.textContent = errors.map(([, message])=>message).join(' ');
  box.hidden = !errors.length;
  if(errors.length){
    const first = document.getElementById(errors[0][0]);
    if(first.id === 'nl_id') first.readOnly = false;
    first.focus();
  }
}

document.getElementById('btnEditNewLicId').addEventListener('click', ()=>{
  const input = document.getElementById('nl_id');
  input.readOnly = false;
  document.getElementById('btnEditNewLicId').hidden = true;
  input.focus();
  input.select?.();
});

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
  const errors = validateNewLicense();
  showNewLicenseErrors(errors);
  if(errors.length) return;
  const id = document.getElementById('nl_id').value.trim();
  const unit = MODEL.units.find(item=>item.id === document.getElementById('nl_unidade').value);
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
  commitPendingUndo();
  if(pendingChanges && !await askConfirm({
    title: 'Sair com alterações pendentes',
    message: 'Há alterações não sincronizadas. Elas permanecerão como rascunho neste navegador. Deseja sair?',
    confirmLabel: 'Sair mesmo assim'
  })) return;
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
    if(a.status==='Stuck' || (a.date && daysUntil(a.date)<0 && a.status!=='Done') || activityLateDays(a)){
      stuckActs.push({lic:l.id, unidade:l.unidade, ...a});
    }
    (a.subatividades||[]).forEach(sub=>{
      if(sub.status==='Stuck' || activityLateDays(sub)){
        stuckActs.push({lic:l.id, unidade:l.unidade, ...sub, name:`${a.name} › ${sub.name}`, observacao:''});
      }
    });
  }));

  const value = (text) => esc(text || 'Não informado');
  const dateValue = (iso) => iso ? fmtDate(iso) : '—';
  const rows = (arr, mapper) => arr.map(mapper).join('') || '<tr><td colspan="6" style="text-align:center;color:#999;">Nenhum registro</td></tr>';
  const activityRows = (lic) => (lic.activities||[]).map(a=>`
    <tr><td>${value(a.name)}${activityLateDays(a) ? ' <b class="rep-late">(fora do prazo)</b>' : ''}</td><td>${value(a.owner)}</td><td>${value(a.status)}</td><td>${a.date?fmtDate(a.date):'Não informado'}</td><td>${dateValue(a.dataInicio)}</td><td>${dateValue(a.dataFim)}</td><td>${value(a.observacao)}</td></tr>
    ${(a.subatividades||[]).map(sub=>`<tr class="rep-sub"><td>↳ ${value(sub.name)}${activityLateDays(sub) ? ' <b class="rep-late">(fora do prazo)</b>' : ''}</td><td>${value(sub.owner)}</td><td>${value(sub.status)}</td><td>—</td><td>${dateValue(sub.dataInicio)}</td><td>${dateValue(sub.dataFim)}</td><td></td></tr>`).join('')}
  `).join('') || '<tr><td colspan="7" style="text-align:center;color:#999;">Nenhuma atividade cadastrada</td></tr>';
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
        <thead><tr><th>Atividade</th><th>Responsável</th><th>Status</th><th>Data</th><th>Início</th><th>Fim</th><th>Observação</th></tr></thead>
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

    <div class="rep-section-title">Indicadores de desempenho do processo</div>
    <table class="rep-table">
      <thead><tr><th>Indicador</th><th>Resultado</th><th>Base</th><th>Meta</th><th>Situação</th></tr></thead>
      <tbody>${computeIndicators(list).map(ind=>`<tr><td>${esc(ind.nome)}</td><td><b>${esc(ind.result.display)}</b></td><td>${esc(ind.result.sub)}</td><td>${esc(ind.meta)}</td><td>${IND_STATUS_LABEL[ind.result.status]}</td></tr>`).join('')}</tbody>
    </table>

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
  ['btnNewLic', 'btnNewUnit', 'btnReset', 'btnExport', 'btnSync', 'btnReloadServer', 'btnImportLocal', 'menuNewUnit', 'menuExport']
    .forEach(id=>document.getElementById(id).disabled = !ready);
  ['btnSync', 'btnReloadServer', 'btnImportLocal']
    .forEach(id=>document.getElementById(id).hidden = !remoteEnabled);
}

function refreshWhenIdle(){
  if(document.hidden || licenseEditor?.dirty || pendingUndo || document.activeElement?.matches('input, textarea, select')
    || document.querySelector('#overlayNewLic.show, #overlayUnit.show, #overlayEvidence.show, #overlayConfirm.show')) return;
  void refreshFromServer();
}

window.addEventListener('focus', refreshWhenIdle);
window.addEventListener('online', refreshWhenIdle);
window.addEventListener('beforeunload', event=>{
  /* Guarda como rascunho local (gravação síncrona) a ação que aguardava o Desfazer. */
  commitPendingUndo();
  if(!pendingChanges && !licenseEditor?.dirty) return;
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
