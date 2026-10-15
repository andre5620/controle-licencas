const DEFAULT_DATA = window.DEFAULT_DATA;
const DEFAULT_MODEL = window.DEFAULT_MODEL || null;
const SPREADSHEET_REFERENCE = window.SPREADSHEET_REFERENCE || null;
const SPREADSHEET_LICENSES = window.SPREADSHEET_LICENSES || {};

const APP_VERSION = '1.8.0';
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

function applyReferenceData(model){
  const references = SPREADSHEET_REFERENCE?.unitProfiles || {};
  const flow = SPREADSHEET_REFERENCE?.flowTemplate || [];
  const normalizeKey = value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
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
  const referenceFor = unit=>{
    const direct = references[unit.nome] || references[unit.codigo];
    if(direct) return direct;
    const key = normalizeKey(unit.nome || unit.codigo);
    const match = Object.entries(references).find(([name])=>normalizeKey(name)===key);
    return match ? match[1] : {};
  };
  model.units = (model.units || []).map(unit=>{
    const reference = referenceFor(unit);
    return {
      ...unit,
      profile: {...reference, ...(unit.profile || {})},
      environmentalLicenses: unit.environmentalLicenses || SPREADSHEET_LICENSES[unit.nome] || SPREADSHEET_LICENSES[unit.codigo] || [],
      standardFlow: unit.standardFlow || flow.map((name, index)=>({
        id: `FT-${String(index+1).padStart(2,'0')}`,
        ordem: index + 1,
        nome: name,
        obrigatoria: true
      }))
    };
  });
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
      licencasUnidade: unit.environmentalLicenses || [],
      fluxoPadrao: unit.standardFlow || []
    };
  });
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
  if(s==='dispensada') return 'b-dispensada';
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
  const pendentes = list.filter(l=>l.status==='Pendente'||l.status==='Condicionada').length;
  const vencidas = list.filter(l=>l.vencimento && daysUntil(l.vencimento)<0).length;
  const altoRisco = list.filter(l=>(l.risco||'').toLowerCase()==='alto').length;
  const kpis = [
    {n:total, l:'Licenças no escopo', cls:''},
    {n:obtidas, l:'Obtidas', cls:'accent-green'},
    {n:pendentes, l:'Pendentes / condicionadas', cls:'accent-amber'},
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
  root.hidden = activePanel !== 'license' || activeView !== 'list';
  unitPanel.hidden = activePanel !== 'unit';
  gantt.hidden = activePanel !== 'license' || activeView !== 'gantt';
  document.getElementById('btnLicensePanel').classList.toggle('active', activePanel === 'license');
  document.getElementById('btnUnitPanel').classList.toggle('active', activePanel === 'unit');
  document.getElementById('btnListView').classList.toggle('active', activeView === 'list');
  document.getElementById('btnGanttView').classList.toggle('active', activeView === 'gantt');
  if(activePanel === 'unit'){
    renderUnitPanel(list);
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
      <div class="unit-actions"><button class="btn" data-open-unit="${esc(name)}">Ver licenças</button><button class="btn" data-new-unit-license="${esc(unit.id)}">+ Nova licença</button></div>
      <div class="unit-profile-strip"><span><b>Razão social</b>${esc(profile.razaoSocial || sample.razaoSocial || 'Não informado')}</span><span><b>Atividade</b>${esc(profile.atividadesConduzidas || 'Não informado')}</span><span><b>Área</b>${esc(profile.area || 'Não informado')}</span></div>
      <details class="standard-flow"><summary>Perfil completo da unidade</summary>
        ${renderUnitProfile({perfilUnidade: profile})}
      </details>
      ${renderEvidence('unit', unit)}
      <div class="unit-processes"><div class="section-label">Processos da unidade</div>${licenses.map(lic=>`<button class="unit-process" data-open-license="${esc(lic.id)}"><span><strong>${esc(lic.tipoLicenca || lic.categoria || 'Processo')}</strong><small>${esc(lic.id)} · ${esc(lic.status || 'Sem status')}</small></span><span class="badge ${statusBadgeClass(lic.status)}">${esc(lic.status || '—')}</span></button>`).join('') || '<p>Nenhuma licença cadastrada.</p>'}</div>
    </article>`;
  }).join('')}</div>`;
  attachUnitPanelEvents();
  attachEvidenceEvents(root);
}

function attachUnitPanelEvents(){
  document.querySelectorAll('[data-edit-unit]').forEach(button=>button.addEventListener('click', ()=>{
    openUnitEditor(button.dataset.editUnit);
  }));
  document.querySelectorAll('[data-new-unit-license]').forEach(button=>button.addEventListener('click', ()=>{
    openNewLicense(button.dataset.newUnitLicense);
  }));
  document.querySelectorAll('[data-open-unit]').forEach(button=>button.addEventListener('click', ()=>{
    document.getElementById('fUnidade').value = button.dataset.openUnit;
    activePanel = 'license';
    activeView = 'list';
    render();
  }));
  document.querySelectorAll('[data-open-license]').forEach(button=>button.addEventListener('click', ()=>{
    document.getElementById('fUnidade').value = DATA.find(lic=>lic.id === button.dataset.openLicense)?.unidade || '';
    expandedIds.add(button.dataset.openLicense);
    activePanel = 'license';
    activeView = 'list';
    render();
  }));
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
        <div class="sub">${esc(lic.orgaoEmissor||'—')} · ${lic.cidade?esc(lic.cidade)+'/'+esc(lic.uf):''} · ${doneCount}/${lic.activities.length} atividades concluídas</div>
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
    ${sel('Status','status',['Pendente','Condicionada','Obtida','Dispensada'])}
    ${f('Data de Emissão','dataEmissao','date')}
    ${f('Vencimento','vencimento','date')}
    <div class="field full"><label>Notas</label><textarea data-lic="${esc(lic.id)}" data-field="notes">${esc(lic.notes||'')}</textarea></div>
  </div>`;
}

function renderUnitProfile(lic){
  const profile = lic.perfilUnidade || {};
  const licenses = lic.licencasUnidade || [];
  const flow = lic.fluxoPadrao || [];
  const fields = PROFILE_FIELDS.filter(([, key])=>profile[key]);
  if(!fields.length) return '';
  return `<div class="section-label">Perfil da unidade</div>
    <div class="field-grid unit-profile">
      ${fields.map(([label, key])=>`<div class="field ${['endereco','atividadeAmbiental','atividadesConduzidas'].includes(key)?'wide':''}"><label>${label}</label><div class="profile-value">${esc(profile[key])}</div></div>`).join('')}
    </div>
    ${licenses.length?`<details class="standard-flow"><summary>Obrigações ambientais (${licenses.length})</summary><ul>${licenses.map(item=>`<li><strong>${esc(item.tipo)}</strong> · ${esc(item.orgao)} · ${esc(item.numero || 'sem número')} · ${esc(item.risco)}</li>`).join('')}</ul></details>`:''}
    ${flow.length?`<details class="standard-flow"><summary>Fluxo padrão da unidade (${flow.length} etapas)</summary><ol>${flow.map(step=>`<li>${esc(step.nome)}</li>`).join('')}</ol></details>`:''}`;
}

function renderActivities(lic){
  const rows = lic.activities.map((a,i)=>{
    const overdue = a.date && daysUntil(a.date)<0 && a.status!=='Done';
    return `
    <tr data-lic="${esc(lic.id)}" data-idx="${i}">
      <td><input data-af="name" value="${esc(a.name)}"></td>
      <td><input data-af="owner" value="${esc(a.owner||'')}" placeholder="responsável"></td>
      <td>
        <select data-af="status" class="act-status ${actStatusClass(a.status)}">
          ${['Não iniciado','Working on it','Stuck','Done'].map(s=>`<option ${s===a.status?'selected':''}>${s}</option>`).join('')}
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
    <thead><tr><th style="width:24%">Atividade</th><th style="width:16%">Responsável</th><th style="width:16%">Status</th><th style="width:13%">Data</th><th style="width:25%">Observação</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
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
        lic.activities[idx][el.dataset.af] = el.value;
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
document.getElementById('btnLicensePanel').addEventListener('click', ()=>{ activePanel='license'; render(); });
document.getElementById('btnUnitPanel').addEventListener('click', ()=>{ activePanel='unit'; render(); });
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
  activePanel = 'unit';
  closeModal('overlayUnit');
  render();
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
  openModal('overlayNewLic');
}

document.getElementById('nl_unidade').addEventListener('change', fillNewLicenseUnit);
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
  const pendentes = list.filter(l=>l.status==='Pendente'||l.status==='Condicionada').length;
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
      <div class="rep-kpi"><b>${pendentes}</b>Pendentes / condicionadas</div>
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
    render();
    setAppReady(true);
  }catch(error){
    reportSyncError(error);
  }
})();
