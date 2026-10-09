const DEFAULT_DATA = window.DEFAULT_DATA;
const DEFAULT_MODEL = window.DEFAULT_MODEL || null;
const SPREADSHEET_REFERENCE = window.SPREADSHEET_REFERENCE || null;
const SPREADSHEET_LICENSES = window.SPREADSHEET_LICENSES || {};

const APP_VERSION = '1.5.0';
const STORAGE_KEY = 'licencas-solinftec-v1';
let MODEL = null;
let DATA = [];
let expandedIds = new Set();
let activeView = 'list';
let activePanel = 'license';

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
  if(window.LicenseDataService?.enabled){
    try{
      const remoteModel = await window.LicenseDataService.load();
      if(remoteModel){
        MODEL = applyReferenceData(remoteModel);
        DATA = flattenModel(MODEL);
        return;
      }
    }catch(e){ /* usa o cache local quando a base remota não estiver disponível */ }
  }
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const stored = JSON.parse(raw);
      const isModel = stored.units && stored.processTypes && stored.processes;
      MODEL = isModel ? applyReferenceData(stored) : modelFromLegacyData(stored);
      DATA = flattenModel(MODEL);
      if(!isModel) await saveData(true);
      return;
    }
  }catch(e){ /* key doesn't exist yet */ }
  MODEL = DEFAULT_MODEL
    ? JSON.parse(JSON.stringify(DEFAULT_MODEL))
    : modelFromLegacyData(DEFAULT_DATA);
  MODEL = applyReferenceData(MODEL);
  DATA = flattenModel(MODEL);
  await saveData(true);
}

function modelFromLegacyData(records){
  const units = [];
  const unitByKey = new Map();
  const processTypes = [];
  const typeByKey = new Map();
  const processes = records.map(record=>{
    const unitKey = `${record.unidade}|${record.cidade}|${record.uf}`;
    if(!unitByKey.has(unitKey)){
      const unit = {
        id: `U-${String(units.length+1).padStart(3,'0')}`,
        codigo: record.unidade,
        nome: record.unidade,
        razaoSocial: record.razaoSocial || '',
        cnpj: record.cnpj || '',
        endereco: record.endereco || '',
        cidade: record.cidade || '',
        uf: record.uf || '',
        caracteristicasOperacionais: '',
        caracteristicasAmbientais: '',
        risco: record.risco || 'NA',
        status: 'Ativa',
        observacoes: ''
      };
      units.push(unit);
      unitByKey.set(unitKey, unit);
    }
    const typeKey = `${record.categoria}|${record.tipoLicenca}|${record.orgaoEmissor}`;
    if(!typeByKey.has(typeKey)){
      const type = {
        id: `TP-${String(processTypes.length+1).padStart(3,'0')}`,
        codigo: record.tipoLicenca || `TIPO-${processTypes.length+1}`,
        nome: record.tipoLicenca || record.categoria || 'Processo regulatório',
        categoria: record.categoria || '',
        orgaoEsperado: record.orgaoEmissor || '',
        periodicidade: '',
        prazoPadraoDias: '',
        etapasPadrao: (record.activities || []).map((activity, index)=>({
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
      unidadeId: unit.id,
      tipoProcessoId: type.id,
      etapas: (record.activities || []).map((activity, index)=>({
        ...activity,
        id: `EP-${record.id}-${String(index+1).padStart(2,'0')}`,
        etapaPadraoId: type.etapasPadrao[index]?.id || '',
        dataPlanejada: activity.date || '',
        dataRealizada: '',
        desvioModelo: false
      }))
    };
  });
  return applyReferenceData({version: 2, units, processTypes, processes});
}

function applyReferenceData(model){
  const references = SPREADSHEET_REFERENCE?.unitProfiles || {};
  const flow = SPREADSHEET_REFERENCE?.flowTemplate || [];
  const normalizeKey = value=>String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
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
      unidade: process.unidade || unit.nome || unit.codigo || '',
      cidade: process.cidade || unit.cidade || '',
      uf: process.uf || unit.uf || '',
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

let saveTimer = null;
async function saveData(silent){
  const dot = document.getElementById('saveDot');
  const txt = document.getElementById('saveText');
  dot.style.background = 'var(--amber)';
  txt.textContent = 'salvando...';
  clearTimeout(saveTimer);
  return new Promise(resolve=>{
    saveTimer = setTimeout(async ()=>{
      try{
        MODEL = modelFromLegacyData(DATA);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(MODEL));
        if(window.LicenseDataService?.enabled){
          await window.LicenseDataService.save(MODEL);
        }
        dot.style.background = 'var(--green)';
        txt.textContent = 'salvo';
      }catch(e){
        dot.style.background = 'var(--red)';
        txt.textContent = 'erro ao salvar';
      }
      resolve();
    }, silent ? 0 : 400);
  });
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
  const unidades = [...new Set(DATA.map(l=>l.unidade).filter(Boolean))].sort();
  const statuses = [...new Set(DATA.map(l=>l.status).filter(Boolean))].sort();
  const riscos = [...new Set(DATA.map(l=>l.risco).filter(Boolean))].sort();
  const fu = document.getElementById('fUnidade');
  const fs = document.getElementById('fStatus');
  const fr = document.getElementById('fRisco');
  const cur = {u:fu.value, s:fs.value, r:fr.value};
  fu.innerHTML = '<option value="">Todas as unidades</option>' + unidades.map(u=>`<option>${u}</option>`).join('');
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
}

function renderUnitPanel(list){
  const root = document.getElementById('unitPanel');
  const grouped = new Map();
  list.forEach(lic=>{
    if(!grouped.has(lic.unidade)) grouped.set(lic.unidade, []);
    grouped.get(lic.unidade).push(lic);
  });
  if(!grouped.size){
    root.innerHTML = '<div class="empty">Nenhuma unidade encontrada com os filtros atuais.</div>';
    return;
  }
  root.innerHTML = `<div class="unit-panel-grid">${[...grouped.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name, licenses])=>{
    const sample = licenses[0];
    const profile = sample.perfilUnidade || {};
    const done = licenses.reduce((sum, lic)=>sum+(lic.activities||[]).filter(a=>a.status==='Done').length,0);
    const activityTotal = licenses.reduce((sum, lic)=>sum+(lic.activities||[]).length,0);
    return `<article class="unit-panel">
      <div class="unit-panel-head"><div><div class="unit-panel-kicker">Unidade</div><h2>${esc(name)}</h2><p>${esc(sample.cidade || '')}${sample.uf ? `/${esc(sample.uf)}` : ''}</p></div><button class="btn btn-ghost" data-open-unit="${esc(name)}">Ver licenças</button></div>
      <div class="unit-summary"><span><strong>${licenses.length}</strong> processos</span><span><strong>${sample.licencasUnidade?.length || 0}</strong> obrigações</span><span><strong>${done}/${activityTotal}</strong> etapas concluídas</span></div>
      <div class="unit-profile-strip"><span><b>Razão social</b>${esc(profile.razaoSocial || sample.razaoSocial || 'Não informado')}</span><span><b>Atividade</b>${esc(profile.atividadesConduzidas || 'Não informado')}</span><span><b>Área</b>${esc(profile.area || 'Não informado')}</span></div>
      <div class="unit-processes"><div class="section-label">Processos da unidade</div>${licenses.map(lic=>`<button class="unit-process" data-open-license="${esc(lic.id)}"><span><strong>${esc(lic.tipoLicenca || lic.categoria || 'Processo')}</strong><small>${esc(lic.id)} · ${esc(lic.status || 'Sem status')}</small></span><span class="badge ${statusBadgeClass(lic.status)}">${esc(lic.status || '—')}</span></button>`).join('')}</div>
    </article>`;
  }).join('')}</div>`;
  attachUnitPanelEvents();
}

function attachUnitPanelEvents(){
  document.querySelectorAll('[data-open-unit]').forEach(button=>button.addEventListener('click', ()=>{
    document.getElementById('fUnidade').value = button.dataset.openUnit;
    activePanel = 'license';
    activeView = 'list';
    render();
  }));
  document.querySelectorAll('[data-open-license]').forEach(button=>button.addEventListener('click', ()=>{
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
    <div class="field"><label>${label}</label><input type="${type}" data-lic="${esc(lic.id)}" data-field="${key}" value="${esc(lic[key]||'')}"></div>`;
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
  const fields = [
    ['Razão social', 'razaoSocial'],
    ['CNPJ', 'cnpj'],
    ['Endereço', 'endereco'],
    ['Atividade ambiental', 'atividadeAmbiental'],
    ['Atividades conduzidas', 'atividadesConduzidas'],
    ['Ocupação', 'ocupacao'],
    ['Área', 'area'],
    ['Extintores', 'extintores'],
    ['Hidrantes', 'hidrantes'],
    ['SPDA', 'spda'],
    ['Sistema de alarme', 'alarme']
  ].filter(([, key])=>profile[key]);
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
    tr.querySelector('[data-del-act]').addEventListener('click', ()=>{
      lic.activities.splice(idx,1);
      saveData();
      render();
      showToast('Atividade removida');
    });
  });

  document.querySelectorAll('[data-add-act]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      const lic = DATA.find(l=>l.id===btn.dataset.addAct);
      lic.activities.push({name:'Nova atividade', owner:'', status:'Não iniciado', date:'', observacao:''});
      saveData();
      render();
      showToast('Atividade adicionada');
    });
  });

  document.querySelectorAll('[data-del-lic]').forEach(btn=>{
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      if(!confirm(`Excluir a licença ${btn.dataset.delLic}? Esta ação não pode ser desfeita.`)) return;
      DATA = DATA.filter(l=>l.id!==btn.dataset.delLic);
      saveData();
      render();
      showToast('Licença excluída');
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
  if(!confirm('Restaurar os dados originais da planilha? Todas as edições feitas neste navegador serão perdidas.')) return;
  DATA = JSON.parse(JSON.stringify(DEFAULT_DATA));
  await saveData(true);
  render();
  showToast('Dados originais restaurados');
});

document.getElementById('btnNewLic').addEventListener('click', ()=>openModal('overlayNewLic'));
document.getElementById('btnSaveNewLic').addEventListener('click', ()=>{
  const id = document.getElementById('nl_id').value.trim();
  if(!id){ showToast('Informe um ID para a licença'); return; }
  if(DATA.some(l=>l.id===id)){ showToast('Já existe uma licença com esse ID'); return; }
  const lic = {
    id,
    unidade: document.getElementById('nl_unidade').value.trim(),
    cidade: document.getElementById('nl_cidade').value.trim(),
    uf: document.getElementById('nl_uf').value.trim().toUpperCase(),
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
  saveData();
  closeModal('overlayNewLic');
  expandedIds.add(id);
  render();
  showToast('Licença criada');
  ['nl_id','nl_unidade','nl_cidade','nl_uf','nl_razao','nl_categoria','nl_orgao','nl_tipo','nl_emissao','nl_vencimento','nl_notes']
    .forEach(i=>document.getElementById(i).value='');
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
  closeModal('overlayAuth');
  await loadData();
  render();
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
  await window.LicenseDataService.auth.signOut();
  window.location.reload();
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
(async function init(){
  document.getElementById('todayChip').textContent = 'Hoje: ' + fmtDate(todayStr());
  const versionEl = document.getElementById('appVersion');
  if(versionEl) versionEl.textContent = 'v' + APP_VERSION;
  if(window.LicenseDataService?.enabled){
    try{
      const session = await window.LicenseDataService.auth.getSession();
      if(!session){
        openModal('overlayAuth');
        return;
      }
      await startAuthenticatedApp(session);
      return;
    }catch(error){
      openModal('overlayAuth');
      showAuthError('Não foi possível conectar ao Supabase.');
      return;
    }
  }
  await loadData();
  render();
})();
