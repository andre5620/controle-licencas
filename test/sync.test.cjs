const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');

const root = join(__dirname, '..');
const serviceSource = readFileSync(join(root, 'js', 'data-service.js'), 'utf8');
const appSource = readFileSync(join(root, 'js', 'app.js'), 'utf8');
const emptyModel = ()=>({version: 2, units: [], processTypes: [], processes: []});
const license = id=>({
  id, unidade: 'Fabrica', cidade: 'Cidade', uf: 'SP',
  categoria: 'Ambiental', tipoLicenca: 'LO', orgaoEmissor: 'Orgao',
  status: 'Pendente', activities: []
});

function createService({state = {model: emptyModel(), revision: 2}, tables = {}, fail} = {}){
  const calls = [];
  const client = {
    async rpc(name, args){
      calls.push({name, args});
      if(fail?.(name)) return {error: {message: 'Banco indisponivel', code: 'TEST'}};
      if(name === 'get_or_create_my_organization') return {data: 'org-1'};
      if(name === 'assign_my_legacy_rows') return {data: null};
      if(name === 'load_license_state') return {data: structuredClone(state)};
      if(name === 'save_license_state'){
        if(args.expected_revision !== state.revision){
          return {error: {code: '40001', message: 'Conflito'}};
        }
        state.model = structuredClone(args.new_model);
        return {data: ++state.revision};
      }
      throw new Error(`RPC inesperado: ${name}`);
    },
    from(table){
      calls.push({table});
      return {
        select(){ return this; },
        eq(key, value){ assert.equal(key, 'organization_id'); assert.equal(value, 'org-1'); return this; },
        order(key){ assert.equal(key, 'id'); return this; },
        async range(start, end){ return {data: (tables[table] || []).slice(start, end + 1)}; }
      };
    },
    auth: {
      async getSession(){ return {data: {session: {user: {id: 'user-1'}}}}; },
      async signInWithPassword(){ return {data: {session: {user: {id: 'user-1'}}}}; },
      async signOut(){ return {}; }
    }
  };
  const window = {
    SUPABASE_CONFIG: {required: true, url: 'https://example.invalid', anonKey: 'public-test-key'},
    supabase: {createClient: ()=>client}
  };
  vm.runInNewContext(serviceSource, {window});
  return {service: window.LicenseDataService, state, calls};
}

function createApp({remote = true, service = {}, storage = new Map(), withCatalog = false, withFlows = false} = {}){
  const elements = new Map();
  const errors = [];
  const element = id=>{
    if(!elements.has(id)){
      elements.set(id, {
        value: '', textContent: '', hidden: false, disabled: false, style: {},
        listeners: {}, classList: {add(){}, remove(){}},
        querySelectorAll: ()=>[],
        append(...nodes){ this.children = nodes; },
        attributes: {}, setAttribute(name, value){ this.attributes[name] = value; },
        removeAttribute(name){ delete this.attributes[name]; }, focus(){},
        addEventListener(name, callback){ this.listeners[name] = callback; }
      });
    }
    return elements.get(id);
  };
  const window = {
    DEFAULT_DATA: [license('L-1')],
    SUPABASE_CONFIG: {required: remote},
    LicenseDataService: {
      enabled: remote, auth: {getSession: async ()=>null},
      load: async ()=>({model: emptyModel(), revision: 2, organizationId: 'org-1'}),
      save: async (_model, revision)=>revision + 1,
      ...service
    },
    addEventListener(){}, location: {hash: '', reload(){}}
  };
  const context = vm.createContext({
    window, document: {
      getElementById: element, querySelector: selector=>selector === 'main' ? element('main') : null,
      querySelectorAll: ()=>[], activeElement: null, hidden: false, addEventListener(){},
      createElement: ()=>({listeners: {}, addEventListener(name, callback){ this.listeners[name] = callback; }})
    },
    localStorage: {getItem: key=>storage.get(key) ?? null, setItem: (key, value)=>storage.set(key, value)},
    console: {error: (...args)=>errors.push(args)}, crypto: webcrypto, URL, URLSearchParams,
    setTimeout: ()=>0, clearTimeout(){}, setInterval(){}, confirm: ()=>true
  });
  if(withCatalog) vm.runInContext(readFileSync(join(root, 'data', 'fluxo.js'), 'utf8'), context);
  if(withFlows) vm.runInContext(readFileSync(join(root, 'data', 'fluxos-processo.js'), 'utf8'), context);
  vm.runInContext(appSource, context);
  const run = code=>vm.runInContext(code, context);
  /* O modal de confirmação depende do DOM real; nos testes ele delega ao confirm() simulado. */
  run("render = ()=>{}; authenticatedUserId = 'user-1'; askConfirm = async options=>confirm(options.message);");
  return {run, element, storage, errors, context};
}

test('configuracao obrigatoria nao vira modo local quando o CDN falha', async ()=>{
  const window = {SUPABASE_CONFIG: {required: true}};
  vm.runInNewContext(serviceSource, {window});
  assert.equal(window.LicenseDataService.enabled, true);
  await assert.rejects(window.LicenseDataService.auth.getSession(), /carregar o Supabase/);
});

test('carrega snapshot central sem ler ou apagar as tabelas legadas', async ()=>{
  const {service, calls} = createService();
  const result = await service.load();
  assert.equal(result.revision, 2);
  assert.equal(result.organizationId, 'org-1');
  assert.equal(calls.some(call=>call.table), false);
});

test('grava em uma RPC atomica e envia a revisao esperada', async ()=>{
  const {service, state, calls} = createService();
  const model = {...emptyModel(), processes: [license('L-nova')]};
  assert.equal(await service.save(model, 2), 3);
  assert.equal(state.model.processes[0].id, 'L-nova');
  assert.equal(calls.filter(call=>call.name === 'save_license_state').length, 1);
  assert.equal(calls.some(call=>call.table), false);
});

test('duas maquinas nao sobrescrevem alteracoes de uma revisao mais recente', async ()=>{
  const state = {model: emptyModel(), revision: 1};
  const a = createService({state}).service;
  const b = createService({state}).service;
  const versionA = await a.load();
  const versionB = await b.load();
  await a.save({...emptyModel(), processes: [license('L-A')]}, versionA.revision);
  await assert.rejects(b.save({...emptyModel(), processes: [license('L-B')]}, versionB.revision),
    error=>error.code === '40001');
  assert.equal(state.model.processes[0].id, 'L-A');
});

test('migra tabelas legadas com paginacao e preserva atividades', async ()=>{
  const steps = Array.from({length: 1001}, (_, index)=>({
    id: `STEP-${index}`, process_id: 'L-1', name: 'Etapa', planned_date: null,
    completed_date: '2026-10-15', notes: 'Notas', model_deviation: true
  }));
  const {service} = createService({
    state: {model: null, revision: 0},
    tables: {
      units: [{id: 'U-1', payload: {nome: 'Fabrica'}, profile: {custom: true}, standard_flow: []}],
      process_types: [{id: 'TP-1', payload: {nome: 'LO'}, standard_steps: []}],
      processes: [{id: 'L-1', unit_id: 'U-1', process_type_id: 'TP-1', payload: {}}],
      process_steps: steps,
      environmental_obligations: [{unit_id: 'U-1', payload: {name: 'Obrigacao'}}]
    }
  });
  const {model, revision} = await service.load();
  assert.equal(revision, 0);
  assert.equal(model.processes[0].activities.length, 1001);
  assert.equal(model.processes[0].activities[0].dataRealizada, '2026-10-15');
  assert.equal(model.units[0].environmentalLicenses[0].name, 'Obrigacao');
});

test('erro ou migracao ausente e propagado sem fallback silencioso', async ()=>{
  const {service} = createService({fail: name=>name === 'load_license_state'});
  await assert.rejects(service.load(), error=>error.message === 'Banco indisponivel');
});

test('falha ao atribuir dados legados nao fica escondida pelo cache de organizacao', async ()=>{
  let failing = true;
  const {service} = createService({fail: name=>failing && name === 'assign_my_legacy_rows'});
  await assert.rejects(service.load());
  failing = false;
  assert.equal((await service.load()).organizationId, 'org-1');
});

test('sem sessao o painel permanece bloqueado', async ()=>{
  const app = createApp();
  await Promise.resolve();
  assert.equal(app.run('appReady'), false);
  assert.equal(app.element('btnNewLic').disabled, true);
  assert.equal(app.element('main').inert, true);
});

test('falha de carga remota nao abre os dados locais como base central', async ()=>{
  const app = createApp({service: {load: async ()=>{ throw new Error('Offline'); }}});
  app.storage.set('licencas-solinftec-v1', JSON.stringify([license('LOCAL')]));
  await assert.rejects(app.run('loadData()'), /Offline/);
  assert.equal(app.run('MODEL'), null);
});

test('so mostra sincronizado apos confirmacao e guarda rascunho antes do envio', async ()=>{
  let confirmSave;
  const app = createApp({service: {save: ()=>new Promise(resolve=>{ confirmSave = resolve; })}});
  await app.run('loadData()');
  app.run("DATA = [window.DEFAULT_DATA[0]];");
  const save = app.run('saveData()');
  await Promise.resolve();
  const key = 'licencas-solinftec-v1:user-1:org-1';
  assert.equal(JSON.parse(app.storage.get(key)).pending, true);
  assert.equal(app.element('saveText').textContent, 'sincronizando...');
  confirmSave(3);
  assert.equal(await save, true);
  assert.equal(app.element('saveText').textContent, 'sincronizado');
  assert.equal(JSON.parse(app.storage.get(key)).pending, false);
  assert.equal(JSON.parse(app.storage.get(key)).revision, 3);
});

test('erro de rede preserva pendencias e permite repetir o envio', async ()=>{
  let failing = true;
  const app = createApp({service: {save: async (_model, revision)=>{
    if(failing) throw new Error('Offline');
    return revision + 1;
  }}});
  await app.run('loadData()');
  app.run('DATA = [window.DEFAULT_DATA[0]];');
  assert.equal(await app.run('saveData()'), false);
  assert.equal(app.run('pendingChanges'), true);
  assert.equal(app.element('saveText').textContent, 'não sincronizado');
  failing = false;
  assert.equal(await app.run('saveData()'), true);
  assert.equal(app.run('remoteRevision'), 3);
});

test('conflito nao e repetido com uma revisao nova sem carregar o servidor', async ()=>{
  let calls = 0;
  const app = createApp({service: {save: async ()=>{
    calls++;
    throw {code: '40001', message: 'Conflito'};
  }}});
  await app.run('loadData()');
  assert.equal(await app.run('saveData()'), false);
  assert.equal(await app.run('saveData()'), false);
  assert.equal(calls, 1);
  assert.equal(app.run('conflict && pendingChanges'), true);
  assert.match(app.element('syncMessage').textContent, /Outra pessoa/);
});

test('edicoes durante um envio sao serializadas e usam a revisao confirmada', async ()=>{
  const requests = [];
  const app = createApp({service: {save: (model, revision)=>new Promise(resolve=>{
    requests.push({model, revision, resolve});
  })}});
  await app.run('loadData()');
  app.run("DATA = [window.DEFAULT_DATA[0]]; DATA[0].notes = 'Primeira';");
  const first = app.run('saveData()');
  await Promise.resolve();
  app.run("DATA[0].notes = 'Segunda';");
  const second = app.run('saveData()');
  requests[0].resolve(3);
  await first;
  await Promise.resolve();
  assert.equal(requests[1].revision, 3);
  assert.equal(requests[1].model.processes[0].notes, 'Segunda');
  assert.equal(app.run('pendingChanges'), true);
  requests[1].resolve(4);
  await second;
  assert.equal(app.run('pendingChanges'), false);
});

test('rascunho pendente e recuperado por usuario e organizacao sem envio automatico', async ()=>{
  let calls = 0;
  const app = createApp({service: {save: async ()=>{ calls++; }}});
  app.storage.set('licencas-solinftec-v1:user-1:org-1', JSON.stringify({
    model: {...emptyModel(), processes: [license('PENDENTE')]}, revision: 1, pending: true
  }));
  await app.run('loadData()');
  assert.equal(app.run('DATA[0].id'), 'PENDENTE');
  assert.equal(app.run('conflict'), true);
  assert.equal(calls, 0);
});

test('cache de outro usuario e dados locais antigos nao sao enviados automaticamente', async ()=>{
  const app = createApp();
  app.storage.set('licencas-solinftec-v1:outro:org-1', JSON.stringify({
    model: {...emptyModel(), processes: [license('OUTRO')]}, revision: 2, pending: true
  }));
  app.storage.set('licencas-solinftec-v1', JSON.stringify([license('LOCAL')]));
  await app.run('loadData()');
  assert.equal(app.run('DATA.length'), 0);
});

test('atualizacao automatica carrega novas revisoes sem substituir edicoes pendentes', async ()=>{
  let revision = 2;
  const app = createApp({service: {load: async ()=>({
    model: {...emptyModel(), processes: [license(`L-${revision}`)]},
    revision, organizationId: 'org-1'
  })}});
  await app.run('loadData();');
  app.run('setAppReady(true);');
  revision = 3;
  await app.run('refreshFromServer()');
  assert.equal(app.run('DATA[0].id'), 'L-3');
  app.run('pendingChanges = true;');
  revision = 4;
  await app.run('refreshFromServer()');
  assert.equal(app.run('DATA[0].id'), 'L-3');
  await app.run('refreshFromServer(true)');
  assert.equal(app.run('DATA[0].id'), 'L-4');
  assert.equal(app.run('pendingChanges'), false);
});

test('uma edicao durante a consulta remota impede aplicar a resposta atrasada', async ()=>{
  let finish;
  let initial = true;
  const app = createApp({service: {load: async ()=>{
    if(initial) return {model: emptyModel(), revision: 2, organizationId: 'org-1'};
    return new Promise(resolve=>{ finish = resolve; });
  }}});
  await app.run('loadData()');
  app.run('setAppReady(true);');
  initial = false;
  const refresh = app.run('refreshFromServer()');
  await Promise.resolve();
  app.run('editGeneration++; pendingChanges = true;');
  finish({model: {...emptyModel(), processes: [license('ATRASADA')]}, revision: 3});
  await refresh;
  assert.equal(app.run('remoteRevision'), 2);
  assert.equal(app.run('DATA.length'), 0);
});

test('modo local permanece explicito e nao chama servidor', async ()=>{
  const app = createApp({remote: false, service: {save: ()=>assert.fail('Nao deveria enviar')}});
  await app.run('loadData()');
  assert.equal(app.element('saveText').textContent, 'salvo só neste navegador');
  assert.ok(app.storage.has('licencas-solinftec-v1'));
});

test('gravar uma licenca preserva perfis, obrigacoes e metadados das etapas', async ()=>{
  const app = createApp();
  app.run(`MODEL = {
    version: 2,
    units: [{id:'U-X', nome:'Fabrica', cidade:'Cidade', uf:'SP',
      profile:{custom:true}, environmentalLicenses:[{name:'Obrigacao'}], standardFlow:[{nome:'Fluxo'}],
      caracteristicasOperacionais:'Custom', observacoes:'Preservar'}],
    processTypes:[{id:'TP-X', nome:'LO', categoria:'Ambiental', orgaoEsperado:'Orgao',
      periodicidade:'Anual', etapasPadrao:[]}], processes:[]
  };
  DATA = [window.DEFAULT_DATA[0]];
  DATA[0].activities = [{id:'EP-X', name:'Etapa', dataRealizada:'2026-10-15', desvioModelo:true}];
  MODEL = modelFromLegacyData(DATA);`);
  assert.equal(app.run('MODEL.units[0].id'), 'U-X');
  assert.equal(app.run('MODEL.units[0].profile.custom'), true);
  assert.equal(app.run('MODEL.units[0].observacoes'), 'Preservar');
  assert.equal(app.run('MODEL.units[0].environmentalLicenses[0].name'), 'Obrigacao');
  assert.equal(app.run('MODEL.processTypes[0].periodicidade'), 'Anual');
  assert.equal(app.run('MODEL.processes[0].etapas[0].dataRealizada'), '2026-10-15');
  assert.equal(app.run('MODEL.processes[0].etapas[0].desvioModelo'), true);
});

test('base vazia inicializa dados padrao no servidor uma unica vez com revisao zero', async ()=>{
  const requests = [];
  const app = createApp({service: {
    load: async ()=>({model: null, revision: 0, organizationId: 'org-1'}),
    save: async (model, revision)=>{ requests.push({model, revision}); return 1; }
  }});
  await app.run('loadData()');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].revision, 0);
  assert.equal(requests[0].model.processes[0].id, 'L-1');
  assert.equal(app.run('remoteRevision'), 1);
});

test('snapshot vazio salvo e respeitado sem restaurar licencas padrao', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  assert.equal(app.run('DATA.length'), 0);
  assert.equal(app.run('pendingChanges'), false);
});

test('importacao local e explicita e so confirma sucesso apos gravacao', async ()=>{
  const requests = [];
  const app = createApp({service: {
    save: async (model, revision)=>{ requests.push({model, revision}); return revision + 1; }
  }});
  app.storage.set('licencas-solinftec-v1', JSON.stringify([license('IMPORTADA')]));
  await app.run('loadData()');
  assert.equal(requests.length, 0);
  await app.element('btnImportLocal').listeners.click();
  assert.equal(requests[0].model.processes[0].id, 'IMPORTADA');
  assert.equal(requests[0].revision, 2);
  assert.equal(app.element('toast').textContent, 'Dados locais enviados ao servidor');
  assert.ok(app.storage.has('licencas-solinftec-v1'));
});

test('falta de espaco local nao envia dados sem preservar o rascunho', async ()=>{
  let requests = 0;
  const app = createApp({service: {save: async ()=>{ requests++; }}});
  await app.run('loadData()');
  app.context.localStorage.setItem = ()=>{ throw new Error('Armazenamento cheio'); };
  assert.equal(await app.run('saveData()'), false);
  assert.equal(requests, 0);
  assert.equal(app.run('pendingChanges'), true);
  assert.match(app.element('syncMessage').textContent, /Armazenamento cheio/);
});

test('edicoes agrupadas concluem todas as promessas sem perder a ultima alteracao', async ()=>{
  const requests = [];
  const app = createApp({service: {
    save: async (model, revision)=>{ requests.push({model, revision}); return revision + 1; }
  }});
  await app.run('loadData()');
  const saves = app.run(`DATA = [window.DEFAULT_DATA[0]];
    DATA[0].notes = 'Primeira'; const firstSave = saveData();
    DATA[0].notes = 'Ultima'; const lastSave = saveData();
    Promise.all([firstSave, lastSave]);`);
  const results = await saves;
  assert.equal(results[0], false);
  assert.equal(results[1], true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model.processes[0].notes, 'Ultima');
});

test('a visao inicial e por unidade', ()=>{
  assert.equal(createApp().run('activePanel'), 'unit');
});

test('catalogo inicial tem oito unidades e nao duplica ou recria nomes editados', ()=>{
  const app = createApp({withCatalog: true});
  app.run('MODEL = applyReferenceData({version:2,units:[],processTypes:[],processes:[]});');
  assert.equal(app.run('MODEL.units.length'), 8);
  assert.equal(app.run("MODEL.units.find(unit=>unit.nome === 'LEM').uf"), 'BA');
  app.run("MODEL.units[0].nome = 'Fabrica renomeada'; MODEL = applyReferenceData(MODEL);");
  assert.equal(app.run('MODEL.units.length'), 8);
  assert.equal(app.run('MODEL.unitCatalogVersion'), 1);
});

test('salvar e excluir a ultima licenca nao remove a unidade cadastrada', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'U-EMPTY',nome:'Unidade vazia',cidade:'Cidade',uf:'SP'});
    DATA = [];`);
  await app.run('saveData()');
  assert.equal(app.run('MODEL.units[0].id'), 'U-EMPTY');
  app.run(`DATA = [{...window.DEFAULT_DATA[0],unidadeId:'U-EMPTY',unidade:'Unidade vazia'}];`);
  await app.run('saveData()');
  app.run('DATA = [];');
  await app.run('saveData()');
  assert.equal(app.run('MODEL.units.length'), 1);
});

test('cadastro valida campos, UF e nomes duplicados', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  const submit = ()=>app.element('unitForm').listeners.submit({preventDefault(){}});
  app.element('un_nome').value = 'Nova';
  app.element('un_cidade').value = 'Cidade';
  app.element('un_uf').value = 'XX';
  await submit();
  assert.equal(app.run('MODEL.units.length'), 0);
  assert.match(app.element('unitError').textContent, /UF válida/);
  app.element('un_uf').value = 'SP';
  await submit();
  assert.equal(app.run('MODEL.units.length'), 1);
  app.element('un_nome').value = 'nóva';
  await submit();
  assert.equal(app.run('MODEL.units.length'), 1);
  assert.match(app.element('unitError').textContent, /Já existe/);
});

test('editar unidade atualiza todas as licencas vinculadas e preserva seu ID', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL = modelFromLegacyData([window.DEFAULT_DATA[0]]);
    DATA = flattenModel(MODEL);
    editingUnitId = MODEL.units[0].id;`);
  const id = app.run('editingUnitId');
  app.element('un_nome').value = 'Nome atualizado';
  app.element('un_cidade').value = 'Nova cidade';
  app.element('un_uf').value = 'MT';
  await app.element('unitForm').listeners.submit({preventDefault(){}});
  assert.equal(app.run('MODEL.units.length'), 1);
  assert.equal(app.run('MODEL.units[0].id'), id);
  assert.equal(app.run('MODEL.processes[0].cidade'), 'Nova cidade');
  assert.equal(app.run('DATA[0].unidade'), 'Nome atualizado');
  assert.equal(app.run('flattenModel(MODEL)[0].uf'), 'MT');
});

test('nova licenca exige unidade e usa cidade e UF oficiais mesmo se formulario for adulterado', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.element('nl_id').value = 'NOVA';
  app.element('nl_tipo').value = 'LO';
  app.element('nl_orgao').value = 'Órgão';
  app.element('nl_status').value = 'Pendente';
  const save = ()=>app.element('btnSaveNewLic').listeners.click();
  await save();
  assert.equal(app.run('DATA.length'), 0);
  assert.match(app.element('newLicError').textContent, /Selecione uma unidade/);
  assert.equal(app.element('nl_unidade').attributes['aria-invalid'], 'true');
  app.run("MODEL.units.push({id:'U-1',nome:'Oficial',cidade:'Sinop',uf:'MT'});");
  app.element('nl_unidade').value = 'U-1';
  app.element('nl_unidade').listeners.change();
  assert.equal(app.element('nl_cidade').value, 'Sinop');
  assert.equal(app.element('nl_uf').value, 'MT');
  app.element('nl_cidade').value = 'Errada';
  await save();
  assert.equal(app.run('MODEL.processes[0].unidadeId'), 'U-1');
  assert.equal(app.run('MODEL.processes[0].cidade'), 'Sinop');
  assert.equal(app.run('MODEL.units.length'), 1);
});

test('unidade sem licenca aparece no painel e na busca por cidade', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run("MODEL.units.push({id:'U-1',nome:'Sem licenca',cidade:'Sinop',uf:'MT'});");
  app.element('fBusca').value = 'Sinop';
  app.run('renderUnitPanel([]);');
  assert.match(app.element('unitPanel').innerHTML, /Sem licenca/);
  assert.match(app.element('unitPanel').innerHTML, /Nenhuma licença cadastrada/);
  app.element('fStatus').value = 'Obtida';
  app.run('renderUnitPanel([]);');
  assert.doesNotMatch(app.element('unitPanel').innerHTML, /Sem licenca/);
});

test('unidade sem licenca e recuperada em outra sessao pela base central', async ()=>{
  let stored = emptyModel();
  let revision = 1;
  const service = {
    load: async ()=>({model: structuredClone(stored), revision, organizationId:'org-1'}),
    save: async model=>{ stored = structuredClone(model); return ++revision; }
  };
  const first = createApp({service});
  await first.run('loadData()');
  first.run("MODEL.units.push({id:'INDEPENDENTE',nome:'Independente',cidade:'Cidade',uf:'SP'});");
  await first.run('saveData()');
  const second = createApp({service});
  await second.run('loadData()');
  assert.equal(second.run('MODEL.units[0].id'), 'INDEPENDENTE');
  assert.equal(second.run('DATA.length'), 0);
});

test('perfil completo e salvo, permite limpar campos e preserva dados extras e comprovantes', async ()=>{
  const app = createApp({withCatalog: true});
  await app.run('loadData()');
  app.run(`const unit = MODEL.units.find(u=>u.nome === 'Fábrica');
    unit.profile.extra = 'Preservar'; unit.evidenceLinks = [{name:'Arquivo',url:'https://1drv.ms/x/test'}];
    openUnitEditor(unit.id);`);
  assert.notEqual(app.element('up_cnpj').value, '');
  app.element('up_razaoSocial').value = 'Empresa atualizada';
  app.element('up_cnpj').value = '';
  app.element('up_endereco').value = 'Novo endereco';
  app.element('up_extintores').value = '12';
  await app.element('unitForm').listeners.submit({preventDefault(){}});
  app.run('MODEL = applyReferenceData(MODEL);');
  assert.equal(app.run("MODEL.units.find(u=>u.nome === 'Fábrica').profile.razaoSocial"), 'Empresa atualizada');
  assert.equal(app.run("MODEL.units.find(u=>u.nome === 'Fábrica').profile.cnpj"), '');
  assert.equal(app.run("MODEL.units.find(u=>u.nome === 'Fábrica').profile.extintores"), '12');
  assert.equal(app.run("MODEL.units.find(u=>u.nome === 'Fábrica').profile.extra"), 'Preservar');
  assert.equal(app.run("MODEL.units.find(u=>u.nome === 'Fábrica').evidenceLinks.length"), 1);
});

test('perfil editado atualiza dados nas licencas sem perder atividades', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL = modelFromLegacyData([window.DEFAULT_DATA[0]]);
    DATA = flattenModel(MODEL); DATA[0].activities = [{name:'Etapa'}];
    openUnitEditor(MODEL.units[0].id);`);
  app.element('up_razaoSocial').value = 'Empresa';
  app.element('up_cnpj').value = 'Novo CNPJ';
  await app.element('unitForm').listeners.submit({preventDefault(){}});
  assert.equal(app.run('MODEL.processes[0].cnpj'), 'Novo CNPJ');
  assert.equal(app.run('DATA[0].perfilUnidade.razaoSocial'), 'Empresa');
  assert.equal(app.run('MODEL.processes[0].activities[0].name'), 'Etapa');
});

test('somente links HTTPS validos do OneDrive e SharePoint sao aceitos', ()=>{
  const app = createApp();
  for(const url of ['https://1drv.ms/f/test','https://onedrive.live.com/?id=123',
    'https://empresa-my.sharepoint.com/:f:/g/personal/test']){
    assert.equal(app.run(`oneDriveUrl(${JSON.stringify(url)})`), url);
  }
  for(const url of ['javascript:alert(1)','http://1drv.ms/test','https://1drv.ms.evil.invalid/test',
    'https://evilsharepoint.com/test','https://example.com','https://user:pass@1drv.ms/test',
    'https://1drv.ms:8080/test','not a url']){
    assert.throws(()=>app.run(`oneDriveUrl(${JSON.stringify(url)})`));
  }
});

test('vinculos de unidade e licenca podem ser criados e editados separadamente e persistem', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL = modelFromLegacyData([window.DEFAULT_DATA[0]]);
    DATA = flattenModel(MODEL); openEvidenceEditor('unit', MODEL.units[0].id);`);
  const submit = ()=>app.element('evidenceForm').listeners.submit({preventDefault(){}});
  app.element('evidenceName').value = 'Pasta da unidade';
  app.element('evidenceUrl').value = 'https://1drv.ms/f/unit';
  await submit();
  assert.equal(app.run('MODEL.units[0].evidenceLinks[0].name'), 'Pasta da unidade');
  app.run("openEvidenceEditor('license', DATA[0].id);");
  app.element('evidenceName').value = 'Licenca PDF';
  app.element('evidenceUrl').value = 'https://empresa.sharepoint.com/licenca.pdf';
  await submit();
  assert.equal(app.run('MODEL.processes[0].evidenceLinks[0].name'), 'Licenca PDF');
  app.run("openEvidenceEditor('license', DATA[0].id, 0);");
  app.element('evidenceName').value = 'PDF atualizado';
  await submit();
  assert.equal(app.run('MODEL.processes[0].evidenceLinks.length'), 1);
  assert.equal(app.run('MODEL.processes[0].evidenceLinks[0].name'), 'PDF atualizado');
  assert.equal(app.run('MODEL.units[0].evidenceLinks[0].name'), 'Pasta da unidade');
});

test('vinculos invalidos ou duplicados nao sao salvos e exibem erro', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'U-1',nome:'Teste',cidade:'Cidade',uf:'SP'});
    openEvidenceEditor('unit','U-1');`);
  const submit = ()=>app.element('evidenceForm').listeners.submit({preventDefault(){}});
  app.element('evidenceName').value = 'Arquivo';
  app.element('evidenceUrl').value = 'https://example.com/file';
  await submit();
  assert.match(app.element('evidenceError').textContent, /HTTPS do OneDrive/);
  assert.equal(app.run('MODEL.units[0].evidenceLinks'), undefined);
  app.element('evidenceUrl').value = 'https://1drv.ms/f/test';
  await submit();
  app.run("openEvidenceEditor('unit','U-1');");
  app.element('evidenceName').value = 'Duplicado';
  app.element('evidenceUrl').value = 'https://1drv.ms/f/test';
  await submit();
  assert.match(app.element('evidenceError').textContent, /já está vinculado/);
  assert.equal(app.run('MODEL.units[0].evidenceLinks.length'), 1);
});

test('renderizacao de comprovantes escapa conteudo e nao torna URL insegura clicavel', ()=>{
  const app = createApp();
  const markup = app.run(`renderEvidence('unit',{id:'U-1',evidenceLinks:[
    {name:'<script>alert(1)</script>',url:'javascript:alert(1)'},
    {name:'Arquivo',url:'https://1drv.ms/f/test'}]})`);
  assert.doesNotMatch(markup, /href="javascript:|<script>/);
  assert.match(markup, /link inválido/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /&lt;script&gt;/);
});

test('pagina completa usa link com ID estavel e aceita caracteres especiais', ()=>{
  const app = createApp();
  app.run("window.location.hash = '#unit=' + encodeURIComponent('U-1 /?#');");
  assert.equal(app.run('currentUnitId()'), 'U-1 /?#');
  app.run("navigatePanel('#licenses');");
  assert.equal(app.run('activePanel'), 'license');
  assert.equal(app.run('currentUnitId()'), null);
  app.run("navigatePanel('#units');");
  assert.equal(app.run('activePanel'), 'unit');
});

test('pagina da unidade mostra todos os dados e licencas independente dos filtros da lista', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL = modelFromLegacyData([window.DEFAULT_DATA[0]]);
    DATA = flattenModel(MODEL);
    MODEL.units[0].profile = {cnpj:'CNPJ completo',extintores:'12'};
    MODEL.units[0].evidenceLinks = [{name:'Pasta unidade',url:'https://1drv.ms/f/unit'}];
    MODEL.units[0].environmentalLicenses = [{tipo:'Obrigacao',numero:'123'}];
`);
  app.element('fBusca').value = 'Sem resultado';
  app.run('renderUnitDetail(MODEL.units[0].id);');
  const html = app.element('unitPanel').innerHTML;
  for(const value of ['CNPJ completo','Pasta unidade','Obrigacao','L-1','Voltar às unidades']){
    assert.ok(html.includes(value), value);
  }
});

test('unidade sem processos tem pagina completa e link inexistente mostra erro sem outra base', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'VAZIA',nome:'Unidade vazia',cidade:'Cidade',uf:'SP'});
    renderUnitDetail('VAZIA');`);
  assert.match(app.element('unitPanel').innerHTML, /adicionar a primeira/);
  assert.match(app.element('unitPanel').innerHTML, /Editar unidade/);
  app.run("renderUnitDetail('inexistente');");
  assert.match(app.element('unitPanel').innerHTML, /Unidade não encontrada/);
  assert.doesNotMatch(app.element('unitPanel').innerHTML, /Unidade vazia/);
});

test('cards sao resumos com links diretos sem carregar formularios e comprovantes', async ()=>{
  const app = createApp({withCatalog:true});
  await app.run('loadData()');
  app.run('renderUnitPanel(DATA);');
  const html = app.element('unitPanel').innerHTML;
  assert.match(html, /href="#unit=/);
  assert.match(html, /Abrir unidade/);
  assert.doesNotMatch(html, /evidence-section|Perfil completo da unidade|class="lic-body"/);
});

test('exclusao de unidade com licencas e bloqueada mesmo com filtros ativos', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run('MODEL = modelFromLegacyData([window.DEFAULT_DATA[0]]); DATA = flattenModel(MODEL);');
  app.element('fBusca').value = 'Nao encontra nada';
  app.context.confirm = ()=>assert.fail('Nao deve confirmar exclusao bloqueada');
  assert.equal(await app.run('deleteUnit(MODEL.units[0].id)'), false);
  assert.equal(app.run('MODEL.units.length'), 1);
  assert.match(app.element('toast').textContent, /possui licenças vinculadas/);
});

test('cancelar exclusao preserva perfil e comprovantes', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run("MODEL.units.push({id:'U-X',nome:'Teste',profile:{area:'10'},evidenceLinks:[{name:'Pasta',url:'https://1drv.ms/f/x'}]});");
  app.context.confirm = ()=>false;
  assert.equal(await app.run("deleteUnit('U-X')"), false);
  assert.equal(app.run('MODEL.units[0].profile.area'), '10');
  assert.equal(app.run('MODEL.units[0].evidenceLinks.length'), 1);
});

test('unidade inicial excluida nao reaparece apos salvar e recarregar', async ()=>{
  let stored;
  const app = createApp({withCatalog:true, service:{
    save: async model=>{ stored = structuredClone(model); return 3; }
  }});
  await app.run('loadData()');
  app.element('fUnidade').value = 'Fábrica';
  assert.equal(await app.run("deleteUnit(MODEL.units.find(u=>u.nome === 'Fábrica').id)"), true);
  assert.equal(app.run('MODEL.units.length'), 7);
  assert.equal(app.element('fUnidade').value, '');
  assert.equal(app.run('window.location.hash'), '#view=unidades');
  const next = createApp({withCatalog:true, service:{
    load: async ()=>({model:structuredClone(stored),revision:3,organizationId:'org-1'})
  }});
  await next.run('loadData()');
  assert.equal(next.run('MODEL.units.length'), 7);
  assert.equal(next.run("MODEL.units.some(u=>u.nome === 'Fábrica')"), false);
});

test('falha de rede ao excluir preserva rascunho e nao anuncia sucesso', async ()=>{
  const app = createApp({service:{save:async()=>{throw new Error('Offline');}}});
  await app.run('loadData()');
  app.run("MODEL.units.push({id:'U-X',nome:'Teste'});");
  assert.equal(await app.run("deleteUnit('U-X')"), false);
  assert.equal(app.run('pendingChanges'), true);
  assert.match(app.element('toast').textContent, /pendente/);
  const cache = JSON.parse(app.storage.get('licencas-solinftec-v1:user-1:org-1'));
  assert.equal(cache.model.units.length, 0);
  assert.equal(cache.pending, true);
});

test('exclusao concorrente nao sobrescreve licenca adicionada no servidor', async ()=>{
  const app = createApp({service:{save:async()=>{throw {code:'40001',message:'Conflito'};}}});
  await app.run('loadData()');
  app.run("MODEL.units.push({id:'U-X',nome:'Teste'});");
  assert.equal(await app.run("deleteUnit('U-X')"), false);
  assert.equal(app.run('conflict'), true);
  assert.equal(app.run('pendingChanges'), true);
  assert.match(app.element('syncMessage').textContent, /Outra pessoa/);
});

const flowLicense = (extra = {})=>JSON.stringify({...license('L-F'), ...extra});
const flowSteps = app=>({
  done: id=>app.run(`completeFlowStep(lic, '${id}')`),
  decide: (gate, option)=>app.run(`decideFlow(lic, '${gate}', '${option}')`),
  current: ()=>app.run('currentFlowNodeId(lic)'),
  status: id=>app.run(`flowActivity(lic, '${id}')?.status`)
});

test('aplicar fluxo acrescenta as etapas com a area responsavel e mantem as atividades atuais', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var lic = ${flowLicense({activities: [{name: 'Atividade antiga', status: 'Done'}]})};
    applyFlow(lic, 'licenca');`);
  assert.equal(app.run('lic.activities.length'), 11);
  assert.equal(app.run('lic.activities[0].owner'), 'Sustentabilidade (Analista)');
  assert.equal(app.run("flowActivity(lic, 'LIC-05').owner"), 'Áreas internas (Facilities, Jurídico, Fábrica)');
  assert.equal(app.run("flowActivity(lic, 'LIC-08').owner"), 'Fiscal / Financeiro');
  assert.equal(app.run('lic.activities[10].name'), 'Atividade antiga');
  assert.equal(app.run("flowActivity(lic, 'LIC-P')"), undefined);
  assert.throws(()=>app.run("applyFlow(lic, 'outorga')"), /já segue um fluxo/);
});

test('fluxo de licencas trata pendencia sem repetir o pagamento e conclui com a licenca emitida', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var lic = ${flowLicense()}; applyFlow(lic, 'licenca');`);
  const flow = flowSteps(app);
  flow.done('LIC-01'); flow.decide('LIC-G1', 'sim'); flow.done('LIC-02'); flow.decide('LIC-G2', 'exigida');
  assert.equal(app.run('lic.status'), 'Pendente');
  ['LIC-03','LIC-04','LIC-05','LIC-06','LIC-07','LIC-08'].forEach(flow.done);
  assert.equal(flow.current(), 'LIC-09');
  assert.equal(app.run('lic.status'), 'Em análise');
  flow.done('LIC-09'); flow.decide('LIC-G3', 'pendencia');
  assert.equal(app.run('lic.status'), 'Pendente');
  assert.equal(flow.current(), 'LIC-P');
  assert.equal(flow.status('LIC-06'), 'Não iniciado');
  assert.equal(flow.status('LIC-08'), 'Done');
  flow.done('LIC-P'); flow.done('LIC-06');
  assert.equal(flow.current(), 'LIC-09');
  assert.equal(app.run('lic.status'), 'Em análise');
  flow.done('LIC-09'); flow.decide('LIC-G3', 'emitida');
  assert.equal(app.run('lic.status'), 'Obtida');
  flow.done('LIC-10');
  assert.equal(app.run('walkFlow(lic).fim'), 'Licença emitida dentro do prazo');
  assert.equal(app.run('flowSummary(lic)'), 'Concluído: Licença emitida dentro do prazo');
  app.run('startFlowCycle(lic)');
  assert.equal(app.run('lic.fluxo.ciclo'), 2);
  assert.equal(flow.current(), 'LIC-01');
  assert.equal(app.run("flowActivity(lic, 'LIC-P')"), undefined);
  assert.equal(app.run('lic.status'), 'Obtida');
  assert.ok(app.run('lic.fluxo.historico.length') >= 6);
});

test('indeferimento reinicia o processo a partir da consultoria e descarta a pendencia aberta', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var lic = ${flowLicense()}; applyFlow(lic, 'licenca');`);
  const flow = flowSteps(app);
  flow.done('LIC-01'); flow.decide('LIC-G1', 'sim'); flow.done('LIC-02'); flow.decide('LIC-G2', 'exigida');
  ['LIC-03','LIC-04','LIC-05','LIC-06','LIC-07','LIC-08','LIC-09'].forEach(flow.done);
  flow.decide('LIC-G3', 'pendencia');
  flow.done('LIC-P'); flow.done('LIC-06'); flow.done('LIC-09');
  flow.decide('LIC-G3', 'indeferida');
  assert.equal(app.run('lic.status'), 'Indeferida');
  assert.equal(flow.current(), 'LIC-I');
  assert.equal(flow.status('LIC-08'), 'Não iniciado');
  assert.equal(app.run("lic.fluxo.extras.includes('LIC-P')"), false);
  flow.done('LIC-I');
  assert.equal(flow.current(), 'LIC-03');
});

test('dispensa e jurisdicao fora do Brasil encerram o fluxo pelo caminho do fluxograma', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var lic = ${flowLicense()}; applyFlow(lic, 'licenca');`);
  const flow = flowSteps(app);
  flow.done('LIC-01'); flow.decide('LIC-G1', 'sim'); flow.done('LIC-02'); flow.decide('LIC-G2', 'dispensa');
  assert.equal(app.run('lic.status'), 'Dispensada');
  assert.equal(flow.current(), 'LIC-D');
  flow.done('LIC-D');
  assert.equal(app.run('walkFlow(lic).fim'), 'Dispensa de licença');
  app.run(`lic = ${flowLicense()}; applyFlow(lic, 'licenca');`);
  flow.done('LIC-01'); flow.decide('LIC-G1', 'nao');
  assert.equal(app.run('lic.status'), 'Não aplicável');
  assert.equal(app.run('walkFlow(lic).fim'), 'Licenciamento não aplicável à jurisdição');
});

test('outorga sem taxa marca o pagamento como nao aplicavel e mantem a decisao na pendencia', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var lic = ${flowLicense({categoria: 'Outorga de Água'})}; applyFlow(lic, suggestedFlowType(lic));`);
  assert.equal(app.run('lic.fluxo.tipo'), 'outorga');
  assert.equal(app.run("flowActivity(lic, 'OUT-05').owner"), 'Fábrica / Facilities');
  const flow = flowSteps(app);
  flow.done('OUT-01'); flow.decide('OUT-G1', 'sim');
  ['OUT-02','OUT-03','OUT-04','OUT-05','OUT-06'].forEach(flow.done);
  flow.decide('OUT-G2', 'nao');
  assert.equal(flow.status('OUT-07'), 'N/A');
  assert.equal(flow.current(), 'OUT-08');
  assert.equal(app.run('lic.status'), 'Em análise');
  flow.done('OUT-08'); flow.decide('OUT-G3', 'pendencia');
  assert.equal(flow.current(), 'OUT-P');
  flow.done('OUT-P'); flow.done('OUT-06');
  assert.equal(flow.current(), 'OUT-08');
  assert.equal(flow.status('OUT-07'), 'N/A');
  flow.done('OUT-08'); flow.decide('OUT-G3', 'dispensa');
  assert.equal(app.run('lic.status'), 'Dispensada');
  assert.equal(flow.current(), 'OUT-09');
});

test('etapas e decisoes fora de ordem sao recusadas sem alterar a licenca', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var lic = ${flowLicense()}; applyFlow(lic, 'licenca'); var before = JSON.stringify(lic);`);
  assert.throws(()=>app.run("decideFlow(lic, 'LIC-G3', 'emitida')"), /não está mais pendente/);
  assert.throws(()=>app.run("completeFlowStep(lic, 'LIC-05')"), /não é mais a etapa atual/);
  assert.throws(()=>app.run("applyFlow({id:'X', activities:[]}, 'inexistente')"), /fluxo válido/);
  assert.equal(app.run('JSON.stringify(lic) === before'), true);
});

test('fluxo e etapas persistem na base central e voltam ao carregar', async ()=>{
  let stored;
  const app = createApp({withFlows: true, service: {save: async model=>{ stored = structuredClone(model); return 3; }}});
  await app.run('loadData()');
  app.run("DATA = [window.DEFAULT_DATA[0]]; applyFlow(DATA[0], 'outorga'); completeFlowStep(DATA[0], 'OUT-01');");
  assert.equal(await app.run('saveData()'), true);
  assert.equal(stored.processes[0].fluxo.tipo, 'outorga');
  const next = createApp({withFlows: true, service: {
    load: async ()=>({model: structuredClone(stored), revision: 3, organizationId: 'org-1'})
  }});
  await next.run('loadData()');
  assert.equal(next.run('currentFlowNodeId(DATA[0])'), 'OUT-G1');
  assert.equal(next.run("flowActivity(DATA[0], 'OUT-01').dataRealizada.length"), 10);
});

test('calendario separa janelas abertas, vencidas, proximos ciclos e licencas sem vencimento', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var groups = calendarGroups([
    {id: 'A', vencimento: '2026-12-15'},
    {id: 'B', vencimento: '2027-06-01'},
    {id: 'C', vencimento: '2027-06-01', antecedenciaDias: '250'},
    {id: 'D', vencimento: '2026-09-30'},
    {id: 'E', vencimento: ''}
  ], '2026-10');
  var ids = key=>groups[key].map(item=>item.lic.id).join(',');`);
  assert.equal(app.run("ids('acao')"), 'A,C');
  assert.equal(app.run("ids('aguardar')"), 'B');
  assert.equal(app.run("ids('vencidas')"), 'D');
  assert.equal(app.run("ids('semData')"), 'E');
  assert.equal(app.run('groups.acao[0].span.abertura'), '2026-08-17');
  assert.equal(app.run("renewalWindow({vencimento: '2026-12-15', antecedenciaDias: 'abc'}).lead"), 120);
  assert.equal(app.run("monthBounds('2026-02').end"), '2026-02-28');
  assert.equal(app.run("shiftMonth('2026-12', 1)"), '2027-01');
  assert.equal(app.run("shiftMonth('2026-01', -1)"), '2025-12');
});

test('calendario e fluxo renderizam conteudo escapado e as acoes do fluxograma', ()=>{
  const app = createApp({withFlows: true});
  app.run(`calendarMonth = '2026-10';
    renderCalendar([{id: '<b>X</b>', unidade: 'U', status: 'Pendente', vencimento: '2026-12-15'}]);`);
  const html = app.element('calendarPanel').innerHTML;
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>X<\/b>/);
  assert.match(html, /Abrir licença/);
  assert.match(html, /Fluxo não aplicado/);
  assert.match(html, /outubro de 2026/);
  const pending = app.run(`renderFlow(${flowLicense({categoria: 'Outorga de Água'})})`);
  assert.match(pending, /Aplicar fluxo/);
  assert.match(pending, /value="outorga" selected/);
  const applied = app.run(`var lic = ${flowLicense()}; applyFlow(lic, 'licenca'); renderFlow(lic)`);
  assert.match(applied, /Concluir etapa/);
  assert.match(applied, /Consultar o calendário de vencimentos/);
  assert.match(applied, /Histórico do fluxo/);
  app.run("completeFlowStep(lic, 'LIC-01')");
  assert.match(app.run('renderFlow(lic)'), /data-option="nao"/);
});


const sheetApp = async ()=>{
  const app = createApp({withCatalog: true, withFlows: true});
  await app.run('loadData()');
  app.run(`var unitId = name=>MODEL.units.find(unit=>unit.nome === name).id;
    var addLicense = (id, unit, categoria = 'Licenciamento Ambiental')=>{
      const lic = {id, unidadeId: unitId(unit), unidade: unit, categoria, tipoLicenca: 'LO', status: 'Pendente',
        activities: [{name: 'Atividade antiga', owner: '', status: 'Não iniciado', date: '', observacao: ''}]};
      DATA.push(lic);
      return lic;
    };
    var names = (lic, id)=>flowActivities(lic, id).map(activity=>activity.name).join('|');`);
  return app;
};

test('aplicar fluxo importa a tabela da unidade ligando cada atividade a uma etapa do fluxograma', async ()=>{
  const app = await sheetApp();
  app.run("var lic = addLicense('L-004', 'Fábrica'); applyFlow(lic, 'licenca');");
  assert.equal(app.run("lic.activities.filter(activity=>activity.origem === 'planilha').length"), 21);
  assert.equal(app.run('lic.fluxo.planilhaImportada'), true);
  assert.equal(app.run("lic.fluxo.decisoes['LIC-G1'] + '/' + lic.fluxo.decisoes['LIC-G2']"), 'sim/exigida');
  assert.equal(app.run("names(lic, 'LIC-04')"), 'Visita técnica inicial (aspectos e impactos)|Visita complementar com técnico (equipamentos)');
  assert.equal(app.run("flowActivity(lic, 'LIC-01').id"), 'L-004-LIC-01');
  assert.equal(app.run("flowActivity(lic, 'LIC-01').status"), 'Done');
  assert.equal(app.run("flowActivity(lic, 'LIC-03').observacao"), 'Considerada concluída na importação da planilha');
  assert.equal(app.run("lic.activities.find(activity=>activity.name === 'Matriz LAIA').status"), 'Working on it');
  assert.equal(app.run("lic.activities.find(activity=>activity.name === 'Matriz LAIA').owner"), 'Consultoria');
  assert.equal(app.run('lic.activities[lic.activities.length - 1].name'), 'Atividade antiga');
  assert.equal(app.run('currentFlowNodeId(lic)'), 'LIC-02');
  app.run("flowActivities(lic, 'LIC-02').forEach(activity=>{ activity.status = 'Done'; });");
  assert.equal(app.run('currentFlowNodeId(lic)'), 'LIC-05');
  assert.equal(app.run("stepDone(lic, 'LIC-05')"), false);
});

test('etapa so conclui com todas as atividades; pendencia reinicia todas as atividades do envio', async ()=>{
  const app = await sheetApp();
  app.run("var lic = addLicense('L-012', 'Balsas'); applyFlow(lic, 'licenca');");
  const ccbm = "lic.activities.find(activity=>activity.name === 'CCBM em nome do CNPJ')";
  assert.equal(app.run(`${ccbm}.status`), 'Stuck');
  assert.match(app.run(`${ccbm}.observacao`), /^Prazo: Urgente · Certificado no CPF/);
  assert.equal(app.run('currentFlowNodeId(lic)'), 'LIC-05');
  app.run("completeFlowStep(lic, 'LIC-05')");
  assert.equal(app.run("flowActivities(lic, 'LIC-05').every(activity=>activity.status === 'Done')"), true);
  assert.equal(app.run('currentFlowNodeId(lic)'), 'LIC-09');
  assert.equal(app.run('lic.status'), 'Em análise');
  app.run("completeFlowStep(lic, 'LIC-09'); decideFlow(lic, 'LIC-G3', 'pendencia');");
  assert.equal(app.run("flowActivities(lic, 'LIC-06').map(activity=>activity.status).join(',')"), 'Não iniciado,Não iniciado');
  assert.equal(app.run("flowActivities(lic, 'LIC-09')[0].status"), 'Não iniciado');
  assert.equal(app.run("flowActivities(lic, 'LIC-08')[0].status"), 'Done');
  assert.equal(app.run('currentFlowNodeId(lic)'), 'LIC-P');
});

test('etapas sem item na planilha recebem atividade generica e nao travam o fluxo', async ()=>{
  const app = await sheetApp();
  app.run("var lic = addLicense('L-010', 'Sinop'); applyFlow(lic, 'licenca');");
  for(const step of ['LIC-07', 'LIC-08']){
    assert.equal(app.run(`flowActivity(lic, '${step}').id`), `L-010-${step}`);
    assert.equal(app.run(`flowActivity(lic, '${step}').status`), 'Done');
  }
  assert.equal(app.run('currentFlowNodeId(lic)'), 'LIC-05');
});

test('outorgas e outras licencas da unidade continuam com as etapas genericas', async ()=>{
  const app = await sheetApp();
  app.run(`var main = addLicense('L-004', 'Fábrica');
    var water = addLicense('L-005', 'Fábrica', 'Outorga de Água'); applyFlow(water, 'outorga');
    var other = addLicense('L-099', 'Fábrica'); applyFlow(other, 'licenca');`);
  assert.equal(app.run("water.activities.some(activity=>activity.origem === 'planilha')"), false);
  assert.equal(app.run("other.activities.some(activity=>activity.origem === 'planilha')"), false);
  assert.equal(app.run('spreadsheetFlowFor(main).etapas.length'), 21);
  assert.equal(app.run("spreadsheetFlowFor(addLicense('L-100', 'NY Tower'))"), null);
});

test('licenca que ja seguia o fluxo importa a planilha uma vez sem duplicar etapas genericas', async ()=>{
  const app = await sheetApp();
  app.run(`var lic = addLicense('L-012', 'Balsas');
    var saved = SPREADSHEET_REFERENCE.unitFlows; delete SPREADSHEET_REFERENCE.unitFlows;
    applyFlow(lic, 'licenca'); completeFlowStep(lic, 'LIC-01');
    SPREADSHEET_REFERENCE.unitFlows = saved;`);
  assert.match(app.run('renderFlow(lic)'), /Importar atividades da planilha/);
  app.run('importSpreadsheetFlow(lic)');
  assert.equal(app.run("lic.activities.filter(activity=>activity.origem === 'planilha').length"), 20);
  assert.equal(app.run("flowActivities(lic, 'LIC-02').every(activity=>activity.origem === 'planilha')"), true);
  assert.equal(app.run("flowActivities(lic, 'LIC-01').length"), 1);
  assert.equal(app.run('new Set(lic.activities.map(activity=>activity.id)).size === lic.activities.length'), true);
  assert.doesNotMatch(app.run('renderFlow(lic)'), /Importar atividades da planilha/);
  assert.throws(()=>app.run('importSpreadsheetFlow(lic)'), /já foram importadas/);
});

test('coluna etapa do fluxo religa a atividade e persiste a ligacao', async ()=>{
  let stored;
  const app = createApp({withCatalog: true, withFlows: true, service: {save: async model=>{ stored = structuredClone(model); return 3; }}});
  await app.run('loadData()');
  app.run(`var lic = {id: 'L-004', unidadeId: MODEL.units.find(unit=>unit.nome === 'Fábrica').id, unidade: 'Fábrica',
      categoria: 'Licenciamento Ambiental', status: 'Pendente', activities: []};
    DATA.push(lic); applyFlow(lic, 'licenca');`);
  const markup = app.run('renderActivities(lic)');
  assert.match(markup, /Etapa do fluxo/);
  assert.match(markup, /data-af="etapaPadraoId"/);
  assert.match(markup, /value="LIC-04" selected/);
  app.run("lic.activities.find(activity=>activity.name === 'Definição de cronograma (Monday.com)').etapaPadraoId = '';");
  assert.equal(app.run('currentFlowNodeId(lic)'), 'LIC-05');
  assert.equal(await app.run('saveData()'), true);
  const saved = stored.processes.find(process=>process.id === 'L-004');
  assert.equal(saved.activities.find(activity=>activity.name === 'Matriz LAIA').etapaPadraoId, 'LIC-05');
  assert.equal(saved.fluxo.planilhaImportada, true);
});

test('diagrama em raias mostra contadores e a pagina da unidade exibe o fluxo das licencas', async ()=>{
  const app = await sheetApp();
  app.run(`var lic = addLicense('L-004', 'Fábrica'); applyFlow(lic, 'licenca');
    lic.activities[0].name = '<b>X</b>';`);
  const diagram = app.run('renderFlowDiagram(lic)');
  for(const value of ['Sustentabilidade (Analista)', 'Áreas internas (Facilities, Jurídico, Fábrica)', 'Fiscal / Financeiro',
    '2/2 atividades', 'dg-atual', 'Exigida (licença ou certidão de dispensa a requerer)']){
    assert.ok(diagram.includes(value), value);
  }
  assert.doesNotMatch(diagram, /<b>X<\/b>/);
  app.run("renderUnitDetail(unitId('Fábrica'));");
  const unit = app.element('unitPanel').innerHTML;
  assert.match(unit, /Fluxo da unidade/);
  assert.match(unit, /dg-grid/);
  assert.match(unit, /data-open-unit-license="L-004"/);
  app.run("addLicense('L-012', 'Balsas'); renderUnitDetail(unitId('Balsas'));");
  assert.match(app.element('unitPanel').innerHTML, /licença L-012 importa as 20 atividades da planilha/);
  app.run("renderUnitDetail(unitId('NY Tower'));");
  assert.match(app.element('unitPanel').innerHTML, /Nenhuma licença desta unidade segue o fluxograma/);
});

test('lista por urgencia separa o que requer acao e ordena vencidas primeiro', ()=>{
  const app = createApp();
  app.run(`var day = n=>addDaysIso(todayStr(), n);
    var list = [
      {id:'L-001', status:'Obtida', risco:'Baixo', vencimento: day(900)},
      {id:'L-002', status:'Obtida', risco:'Baixo', vencimento: day(-10)},
      {id:'L-003', status:'Pendente', risco:'Alto'},
      {id:'L-004', status:'Obtida', risco:'Baixo', vencimento: day(-200)},
      {id:'L-005', status:'Obtida', risco:'Baixo', vencimento: day(30)},
      {id:'L-006', status:'Obtida', risco:'Alto'},
      {id:'L-007', status:'Obtida', risco:'Baixo', vencimento: day(300)}
    ];
    var groups = groupByUrgency(list);`);
  assert.equal(app.run("groups.acao.map(l=>l.id).join()"), 'L-004,L-002,L-005,L-003');
  assert.equal(app.run("groups.demais.map(l=>l.id).join()"), 'L-007,L-001,L-006');
  assert.equal(app.run("sortLicenses(list, 'id').map(l=>l.id).join()"), 'L-001,L-002,L-003,L-004,L-005,L-006,L-007');
  assert.equal(app.run("needsAction({id:'X', status:'Pendente', risco:'Baixo', vencimento: day(130), antecedenciaDias: 150})"), true);
});

test('painel de unidades ordena pela quantidade de licencas que requerem acao', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'U-A',nome:'Alfa',cidade:'C',uf:'SP'},{id:'U-B',nome:'Beta',cidade:'C',uf:'SP'});
    renderUnitPanel([
      {id:'L-1', unidadeId:'U-A', status:'Obtida', risco:'Baixo', activities:[]},
      {id:'L-2', unidadeId:'U-B', status:'Pendente', risco:'Alto', activities:[]}
    ]);`);
  const html = app.element('unitPanel').innerHTML;
  assert.ok(html.indexOf('Beta') < html.indexOf('Alfa'));
  assert.match(html, /1 requer ação/);
});

test('filtro rapido dos KPIs combina com os selects e nao altera seus valores', ()=>{
  const app = createApp();
  app.run(`DATA = [
    {id:'L-1', unidade:'A', status:'Obtida', risco:'Alto', vencimento: addDaysIso(todayStr(), -5)},
    {id:'L-2', unidade:'A', status:'Pendente', risco:'Baixo'},
    {id:'L-3', unidade:'B', status:'Obtida', risco:'Baixo', vencimento: addDaysIso(todayStr(), -1)}
  ];`);
  app.run("quickFilter = 'vencidas';");
  assert.equal(app.run('getFiltered().map(l=>l.id).join()'), 'L-1,L-3');
  assert.equal(app.run('getFiltered({ignoreQuick: true}).length'), 3);
  app.element('fUnidade').value = 'A';
  assert.equal(app.run('getFiltered().map(l=>l.id).join()'), 'L-1');
  assert.equal(app.element('fStatus').value, '');
  app.run("renderKPIs(getFiltered({ignoreQuick: true}));");
  assert.match(app.element('kpiRow').innerHTML, /data-kpi="vencidas" aria-pressed="true"/);
  assert.match(app.element('kpiRow').innerHTML, /data-kpi="obtidas" aria-pressed="false"/);
  app.element('btnClearFilters').listeners.click();
  assert.equal(app.run('quickFilter'), null);
});

test('KPIs da pagina da unidade filtram as licencas da unidade', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'U-1',nome:'Unidade',cidade:'C',uf:'SP'});
    DATA = [{id:'L-VENC', unidadeId:'U-1', unidade:'Unidade', status:'Obtida', vencimento: addDaysIso(todayStr(), -3), activities:[]},
      {id:'L-OK', unidadeId:'U-1', unidade:'Unidade', status:'Obtida', activities:[]}];
    unitQuickFilter = {unitId:'U-1', key:'vencidas'}; renderUnitDetail('U-1');`);
  const html = app.element('unitPanel').innerHTML;
  assert.match(html, /data-id="L-VENC"/);
  assert.doesNotMatch(html, /data-id="L-OK"/);
  assert.match(html, /1 de 2/);
});

test('card da licenca abre em leitura e so altera a licenca ao salvar a edicao', async ()=>{
  const requests = [];
  const app = createApp({service: {save: async (model, revision)=>{ requests.push(model); return revision + 1; }}});
  await app.run('loadData()');
  app.run(`MODEL = modelFromLegacyData([{...window.DEFAULT_DATA[0], vencimento:'2027-03-05', notes:'<b>nota</b>'}]);
    DATA = flattenModel(MODEL);`);
  const read = app.run('renderFields(DATA[0])');
  assert.doesNotMatch(read, /<input|<select|<textarea/);
  assert.match(read, /05\/03\/2027/);
  assert.match(read, /Editar licença/);
  assert.match(read, /&lt;b&gt;nota/);
  await app.run("startLicenseEdit(DATA[0].id)");
  const editing = app.run('renderFields(DATA[0])');
  assert.match(editing, /<label for="ed_L-1_orgaoEmissor">/);
  assert.match(editing, /Salvar/);
  app.run("licenseEditor.draft.orgaoEmissor = 'Novo órgão'; licenseEditor.dirty = true;");
  app.run('cancelLicenseEdit()');
  assert.equal(app.run('DATA[0].orgaoEmissor'), 'Orgao');
  await app.run("startLicenseEdit(DATA[0].id)");
  app.run("licenseEditor.draft.orgaoEmissor = 'Novo órgão'; licenseEditor.dirty = true;");
  assert.equal(requests.length, 0);
  assert.equal(await app.run('saveLicenseEdit()'), true);
  assert.equal(app.run('DATA[0].orgaoEmissor'), 'Novo órgão');
  assert.equal(app.run('licenseEditor'), null);
  assert.equal(requests.at(-1).processes[0].orgaoEmissor, 'Novo órgão');
});

test('trocar de card com rascunho pede confirmacao e o perfil da unidade nao e editavel na licenca', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run("licenseEditor = {id:'L-A', draft:{notes:'x'}, dirty:true};");
  app.context.confirm = ()=>false;
  assert.equal(await app.run("startLicenseEdit('L-B')"), false);
  assert.equal(app.run('licenseEditor.id'), 'L-A');
  const profile = app.run(`renderUnitProfile({unidadeId:'U 1', perfilUnidade:{razaoSocial:'Empresa', cnpj:'00', area:'10 m²', extintores:'3'}})`);
  assert.match(profile, /Empresa/);
  assert.match(profile, /href="#unit=U%201"/);
  assert.doesNotMatch(profile, /<input|extintores|3<\/span>/i);
});

test('abas refletem a visao no hash e aceitam os enderecos antigos e a pagina da unidade', ()=>{
  const app = createApp();
  const route = hash=>app.run(`navigatePanel(${JSON.stringify(hash)}); [activePanel, activeView, currentViewKey()].join()`);
  assert.equal(route('#view=gantt'), 'license,gantt,gantt');
  assert.equal(route('#view=licencas'), 'license,list,licencas');
  assert.equal(route('#view=calendario'), 'calendar,list,calendario');
  assert.equal(route('#view=unidades'), 'unit,list,unidades');
  assert.equal(route('#licenses'), 'license,list,licencas');
  assert.equal(route('#calendar'), 'calendar,list,calendario');
  assert.equal(route('#unit=U-1'), 'unit,list,unidades');
  assert.equal(app.run('currentUnitId()'), 'U-1');
  app.run("navigatePanel('#view=gantt');");
  assert.equal(route(''), 'license,gantt,gantt');
  assert.equal(route('#view=invalida'), 'license,gantt,gantt');
});

test('estados vazios oferecem a acao direta: aplicar fluxo, vincular comprovante e criar licenca', async ()=>{
  const app = await sheetApp();
  app.run("addLicense('L-012', 'Balsas'); addLicense('L-020', 'Balsas', 'Outorga de Água'); renderUnitDetail(unitId('Balsas'));");
  const html = app.element('unitPanel').innerHTML;
  assert.match(html, /data-flow-apply-direct="L-012" data-flow-type="licenca">Aplicar fluxo de Licenças na L-012/);
  assert.match(html, /data-flow-type="outorga">Aplicar fluxo de Outorgas na L-020/);
  assert.match(html, /licença L-012 importa as 20 atividades da planilha/);
  assert.match(html, /Cole o link de um arquivo ou pasta do OneDrive/);
  app.run("renderUnitDetail(unitId('NY Tower'));");
  const empty = app.element('unitPanel').innerHTML;
  assert.doesNotMatch(empty, /data-flow-apply-direct/);
  assert.match(empty, /\+ Criar primeira licença/);
  assert.equal(await app.run("runFlowAction('L-012', lic=>applyFlow(lic, 'licenca'), 'Fluxo aplicado')"), true);
  assert.equal(app.run("DATA.find(l=>l.id === 'L-012').fluxo.tipo"), 'licenca');
});

test('prazos de vencimento aparecem em linguagem humana com a data exata no title', ()=>{
  const app = createApp();
  const badge = days=>app.run(`vencimentoBadge(addDaysIso(todayStr(), ${days}))`);
  const text = days=>badge(days).txt;
  assert.equal(text(0), 'Vence hoje');
  assert.equal(text(1), 'Vence amanhã');
  assert.equal(text(45), 'Vence em 45 dias');
  assert.equal(text(60), 'Vence em 60 dias');
  assert.equal(text(243), 'Vence em ~8 meses');
  assert.equal(text(800), 'Vence em ~2 anos');
  assert.equal(text(-1), 'Venceu ontem');
  assert.equal(text(-30), 'Vencida há 30 dias');
  assert.equal(text(-122), 'Vencida há ~4 meses');
  assert.equal(badge(-5).cls, 'b-venc-vencido');
  assert.equal(badge(100).cls, 'b-venc-alerta');
  assert.equal(badge(200).cls, 'b-venc-ok');
  assert.equal(app.run("vencimentoBadge('2027-03-05').title"), 'Vencimento: 05/03/2027');
});

test('faixa de sincronizacao aparece com pendencias, fica vermelha no erro e some ao sincronizar', async ()=>{
  let fail = true;
  const app = createApp({service: {save: async (_model, revision)=>{
    if(fail) throw new Error('Offline');
    return revision + 1;
  }}});
  await app.run('loadData()');
  await app.run('saveData()');
  assert.equal(app.element('syncBanner').hidden, false);
  assert.equal(app.element('btnSyncNow').hidden, false);
  assert.equal(app.element('btnSyncNow').textContent, 'Tentar novamente');
  assert.match(app.element('syncMessage').textContent, /Offline.*ainda não estão disponíveis para a equipe/);
  assert.equal(app.run('syncBannerAction'), 'btnSync');
  fail = false;
  await app.run('saveData()');
  assert.equal(app.element('syncBanner').hidden, true);
  app.run("conflict = true; reportSyncError({code: '40001', message: 'Conflito'});");
  assert.equal(app.element('btnSyncNow').textContent, 'Carregar servidor');
  assert.equal(app.run('syncBannerAction'), 'btnReloadServer');
  app.run("conflict = false; setSaveState('var(--amber)', 'alterações pendentes', '', 'pending');");
  assert.equal(app.element('syncMessage').textContent, 'Você tem alterações que ainda não estão disponíveis para a equipe.');
  assert.equal(app.element('btnSyncNow').textContent, 'Sincronizar agora');
});

test('modo local mostra a faixa de dados so neste navegador sem botao de sincronizar', async ()=>{
  const app = createApp({remote: false});
  await app.run('loadData()');
  assert.equal(app.element('syncBanner').hidden, false);
  assert.match(app.element('syncMessage').textContent, /só neste navegador/);
  assert.equal(app.element('btnSyncNow').hidden, true);
});

test('remover comprovante vale na hora, adia a gravacao e pode ser desfeito', async ()=>{
  const requests = [];
  const app = createApp({service: {save: async (model, revision)=>{ requests.push(structuredClone(model)); return revision + 1; }}});
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'U-1',nome:'Teste',cidade:'C',uf:'SP',
    evidenceLinks:[{name:'A',url:'https://1drv.ms/f/a'},{name:'B',url:'https://1drv.ms/f/b'}]});`);
  const undo = ()=>app.element('toast').children[1].listeners.click();
  assert.equal(app.run("removeEvidenceLink('unit', 'U-1', 0)"), true);
  assert.equal(app.run('MODEL.units[0].evidenceLinks.map(l=>l.name).join()'), 'B');
  assert.equal(requests.length, 0);
  assert.match(app.element('toast').textContent, /removido/);
  assert.equal(app.element('toast').children[1].textContent, 'Desfazer');
  undo();
  assert.equal(app.run('MODEL.units[0].evidenceLinks.map(l=>l.name).join()'), 'A,B');
  assert.equal(requests.length, 0);
  app.run("removeEvidenceLink('unit', 'U-1', 1)");
  await app.run('commitPendingUndo()');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].units[0].evidenceLinks.length, 1);
  app.run("removeEvidenceLink('unit', 'U-1', 0)");
  await app.run('saveData()');
  assert.equal(requests.length, 2);
  undo();
  await app.run('saveQueue');
  assert.equal(requests.length, 3);
  assert.equal(requests[2].units[0].evidenceLinks[0].name, 'A');
});

test('concluir etapa pode ser desfeito e restaura as atividades', ()=>{
  const app = createApp({withFlows: true});
  app.run(`DATA = [${JSON.stringify({id: 'L-F', categoria: 'Ambiental', tipoLicenca: 'LO', status: 'Pendente', activities: []})}];
    applyFlow(DATA[0], 'licenca');`);
  const step = app.run('currentFlowNodeId(DATA[0])');
  assert.equal(app.run(`completeFlowStepUndoable('L-F', ${JSON.stringify(step)}, 1)`), true);
  assert.notEqual(app.run('currentFlowNodeId(DATA[0])'), step);
  app.element('toast').children[1].listeners.click();
  assert.equal(app.run('currentFlowNodeId(DATA[0])'), step);
  assert.equal(app.run(`completeFlowStepUndoable('L-F', 'ETAPA-ERRADA', 1)`), false);
  assert.match(app.element('toast').textContent, /não é mais a etapa atual/);
});

test('nova licenca gera o proximo ID e valida os obrigatorios sem alert', async ()=>{
  const app = createApp({withFlows: true});
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'U-1',nome:'Oficial',cidade:'Sinop',uf:'MT'});
    DATA = [{id:'L-009'},{id:'L-013'},{id:'X-99'}];`);
  assert.equal(app.run('nextLicenseId()'), 'L-014');
  app.run("DATA = []; openNewLicense('U-1');");
  assert.equal(app.element('nl_id').value, 'L-001');
  assert.equal(app.element('nl_id').readOnly, true);
  app.element('nl_tipo').value = '';
  app.element('nl_orgao').value = ' ';
  app.element('nl_status').value = 'Pendente';
  await app.element('btnSaveNewLic').listeners.click();
  assert.equal(app.run('DATA.length'), 0);
  assert.equal(app.element('newLicError').hidden, false);
  assert.match(app.element('newLicError').textContent, /tipo de licença.*órgão emissor/);
  assert.equal(app.element('nl_tipo').attributes['aria-invalid'], 'true');
  assert.equal(app.element('nl_unidade').attributes['aria-invalid'], undefined);
  app.element('nl_tipo').value = 'LO';
  app.element('nl_orgao').value = 'SEMA';
  await app.element('btnSaveNewLic').listeners.click();
  assert.equal(app.run('DATA[0].id'), 'L-001');
  assert.equal(app.element('newLicError').hidden, true);
  app.run("openNewLicense('U-1');");
  app.element('btnEditNewLicId').listeners.click();
  assert.equal(app.element('nl_id').readOnly, false);
  app.element('nl_id').value = 'L-001';
  app.element('nl_tipo').value = 'LO';
  app.element('nl_orgao').value = 'SEMA';
  await app.element('btnSaveNewLic').listeners.click();
  assert.match(app.element('newLicError').textContent, /Já existe uma licença com o ID L-001/);
});

test('obrigacoes ambientais aparecem em tabela com status e prazo da licenca correspondente', async ()=>{
  const app = createApp();
  await app.run('loadData()');
  app.run(`MODEL.units.push({id:'U-1',nome:'Fábrica',cidade:'C',uf:'SP',environmentalLicenses:[
      {tema:'Licenciamento', orgao:'CETESB', tipo:'Licença de Operação - LO', numero:'123', motivacao:'Obrigatoriedade'},
      {orgao:'SEMA MT', tipo:'Ofício de dispensa', numero:'', motivacao:'Dispensada'},
      {orgao:'<b>X</b>', tipo:'Outra'}]});
    DATA = [{id:'L-1', unidadeId:'U-1', unidade:'Fábrica', orgaoEmissor:'Cetesb', tipoLicenca:'Licença de Operação', status:'Obtida', vencimento:'2028-01-31', activities:[]}];
    renderUnitDetail('U-1');`);
  const html = app.element('unitPanel').innerHTML;
  assert.match(html, /class="obligations-table"/);
  assert.match(html, /<span class="badge b-obtida">Obtida<\/span><\/td>\s*<td data-label="Prazo">31\/01\/2028/);
  assert.match(html, /b-dispensada">Dispensada/);
  assert.match(html, /data-label="Nº\/Processo">—/);
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt;/);
});

test('controle de etapas das unidades nao publica nomes de pessoas', ()=>{
  const window = {};
  vm.runInNewContext(readFileSync(join(root, 'data', 'fluxo.js'), 'utf8'), {window});
  const text = JSON.stringify(window.SPREADSHEET_REFERENCE.unitFlows);
  assert.doesNotMatch(text, /André|Carolina|Mirian|Enrique/);
});

test('datas de inicio e fim e subatividades persistem no modelo', async ()=>{
  let stored;
  const app = createApp({service: {save: async model=>{ stored = structuredClone(model); return 3; }}});
  await app.run('loadData()');
  app.run(`MODEL = modelFromLegacyData([window.DEFAULT_DATA[0]]); DATA = flattenModel(MODEL);
    DATA[0].activities = [{name:'Vistoria', status:'Não iniciado', dataInicio:'2026-01-10', dataFim:'2026-02-10',
    subatividades:[{id:'S-1', name:'Agendar', status:'Done', dataInicio:'2026-01-10', dataFim:'2026-01-20'}]}];`);
  assert.equal(await app.run('saveData()'), true);
  const activity = stored.processes[0].activities[0];
  assert.equal(activity.dataInicio, '2026-01-10');
  assert.equal(activity.dataFim, '2026-02-10');
  assert.equal(activity.subatividades[0].name, 'Agendar');
  assert.equal(app.run('flattenModel(MODEL)[0].activities[0].subatividades[0].dataFim'), '2026-01-20');
});

test('atividade ou subatividade com data fim vencida e nao concluida fica fora do prazo', ()=>{
  const app = createApp();
  app.run(`var day = n=>addDaysIso(todayStr(), n);`);
  assert.equal(app.run("activityLateDays({status:'Working on it', dataFim: day(-1)})"), 1);
  assert.equal(app.run("activityLateDays({status:'Done', dataFim: day(-1)})"), 0);
  assert.equal(app.run("activityLateDays({status:'N/A', dataFim: day(-5)})"), 0);
  assert.equal(app.run("activityLateDays({status:'Stuck', dataFim: day(0)})"), 0);
  assert.equal(app.run("activityLateDays({status:'Stuck'})"), 0);
  app.run(`var lic = {id:'L-9', unidade:'U', status:'Pendente', activities:[
    {name:'<b>X</b>', status:'Working on it', dataFim: day(-3), subatividades:[
      {name:'<i>Sub</i>', status:'Não iniciado', dataFim: day(-2)}, {name:'Ok', status:'Done', dataFim: day(-2)}]},
    {name:'Em dia', status:'Working on it', dataFim: day(4)}]};`);
  assert.equal(app.run('lateActivities(lic).length'), 2);
  const card = app.run('renderCard(lic)');
  assert.match(card, /⚠ 2 atividades fora do prazo/);
  app.run("lic.activities[0].subatividades[0].status = 'Done';");
  assert.match(app.run('renderCard(lic)'), /⚠ 1 atividade fora do prazo/);
  app.run("expandedActivities.add(activityKey(lic, lic.activities[0], 0)); lic.activities[0].subatividades[0].status = 'Stuck';");
  const table = app.run('renderActivities(lic)');
  assert.match(table, /Atrasada há 3 dias/);
  assert.match(table, /Atrasada há 2 dias/);
  assert.match(table, /data-af="dataInicio"/);
  assert.match(table, /Subatividades 1\/2/);
  assert.match(table, /disabled title="Status calculado pelas subatividades"/);
  assert.doesNotMatch(table, /<b>X<\/b>|<i>Sub<\/i>/);
  assert.match(table, /&lt;i&gt;Sub&lt;\/i&gt;/);
});

test('status da atividade e calculado pelas subatividades e nao aceita fim antes do inicio', ()=>{
  const app = createApp();
  app.run(`var a = {name:'A', status:'Não iniciado', subatividades:[{status:'Done'},{status:'Não iniciado'}]};`);
  assert.equal(app.run('deriveActivityStatus(a)'), 'Working on it');
  app.run("a.subatividades[1].status = 'Stuck';");
  assert.equal(app.run('deriveActivityStatus(a)'), 'Stuck');
  app.run("a.subatividades[1].status = 'N/A';");
  assert.equal(app.run('deriveActivityStatus(a)'), 'Done');
  assert.equal(app.run('a.dataRealizada'), app.run('todayStr()'));
  app.run("a.subatividades.forEach(sub=>sub.status = 'Não iniciado');");
  assert.equal(app.run('deriveActivityStatus(a)'), 'Não iniciado');
  assert.equal(app.run('a.dataRealizada'), '');
  assert.equal(app.run("deriveActivityStatus({status:'Stuck'})"), 'Stuck');
  assert.match(app.run("dateRangeError({dataInicio:'2026-03-10'}, 'dataFim', '2026-03-01')"), /não pode ser anterior/);
  assert.equal(app.run("dateRangeError({dataFim:'2026-03-10'}, 'dataInicio', '2026-03-01')"), '');
  assert.equal(app.run("nextSubId({id:'EP-1', subatividades:[{id:'EP-1-S01'}]}, {id:'L'}, 0)"), 'EP-1-S02');
});

test('concluir a etapa conclui as subatividades e o novo ciclo as reabre', ()=>{
  const app = createApp({withFlows: true});
  app.run(`var lic = ${flowLicense()}; applyFlow(lic, 'licenca');
    flowActivity(lic, 'LIC-01').subatividades = [{name:'Parte 1', status:'Não iniciado'}, {name:'Parte 2', status:'Done'}];`);
  app.run("completeFlowStep(lic, 'LIC-01')");
  assert.equal(app.run("flowActivity(lic, 'LIC-01').subatividades.every(sub=>sub.status === 'Done')"), true);
  assert.equal(app.run("deriveActivityStatus(flowActivity(lic, 'LIC-01'))"), 'Done');
  app.run("resetFlowActivity(flowActivity(lic, 'LIC-01'))");
  assert.equal(app.run("flowActivity(lic, 'LIC-01').subatividades.every(sub=>sub.status === 'Não iniciado')"), true);
});

test('importar a planilha preserva subatividades e conclui as das etapas puladas', async ()=>{
  const app = await sheetApp();
  app.run(`var lic = addLicense('L-012', 'Balsas');
    var saved = SPREADSHEET_REFERENCE.unitFlows; delete SPREADSHEET_REFERENCE.unitFlows;
    applyFlow(lic, 'licenca');
    SPREADSHEET_REFERENCE.unitFlows = saved;
    lic.activities.filter(activity=>activity.id === genericFlowActivityId(lic, activity.etapaPadraoId))
      .forEach(activity=>{ activity.subatividades = [{id: activity.id + '-S01', name: 'Parte', status: 'Não iniciado'}]; });
    importSpreadsheetFlow(lic);`);
  assert.equal(app.run("lic.activities.some(activity=>activity.id === genericFlowActivityId(lic, 'LIC-02') && activity.subatividades.length === 1)"), true);
  const skipped = "lic.activities.filter(activity=>activity.observacao === 'Considerada concluída na importação da planilha')";
  assert.ok(app.run(`${skipped}.length`) > 0);
  assert.equal(app.run(`${skipped}.every(activity=>activity.status === 'Done' && activity.subatividades.every(sub=>sub.status === 'Done'))`), true);
});

test('indicadores de desempenho calculam conformidade, vencimentos, prazos e avanco do fluxo', ()=>{
  const app = createApp();
  app.run(`var day = n=>addDaysIso(todayStr(), n);
    var list = [
      {id:'L-1', unidade:'Fábrica', status:'Obtida', risco:'Baixo', vencimento: day(400), activities:[]},
      {id:'L-2', unidade:'Fábrica', status:'Obtida', risco:'Alto', vencimento: day(-10), activities:[]},
      {id:'L-3', unidade:'Balsas', status:'Dispensada', activities:[]},
      {id:'L-4', unidade:'Balsas', status:'Não aplicável', activities:[]},
      {id:'L-5', unidade:'<b>Sinop</b>', status:'Pendente', risco:'Alto', vencimento: day(30), fluxo:{tipo:'licenca'}, activities:[
        {name:'Mãe', etapaPadraoId:'LIC-01', status:'Working on it', subatividades:[
          {name:'No prazo', status:'Done', dataFim: day(-5), dataRealizada: day(-6)},
          {name:'Atrasada', status:'Done', dataFim: day(-5), dataRealizada: day(-2)},
          {name:'Sem conclusão', status:'Done', dataFim: day(-5)},
          {name:'Aberta', status:'Stuck', dataFim: day(-4)}]},
        {name:'Etapa 2', etapaPadraoId:'LIC-02', status:'Done', dataFim: day(-1), dataRealizada: day(-1)}]},
      {id:'L-6', unidade:'Balsas', status:'Obtida', risco:'Baixo', vencimento: day(60), activities:[]},
      {id:'L-7', unidade:'Balsas', status:'Condicionada', risco:'Baixo', vencimento: day(90), activities:[
        {name:'Protocolo', status:'Working on it', dataInicio: day(-3)}]},
      {id:'L-8', unidade:'Balsas', status:'Obtida', risco:'Baixo', vencimento: day(50), activities:[
        {name:'Antiga', status:'Working on it', dataInicio: day(-400)}]}];
    var ind = Object.fromEntries(computeIndicators(list).map(item=>[item.id, item.result]));`);
  // Base aplicável: 7 (L-4 sai); conformes: L-1, L-3, L-6, L-8 (L-2 vencida, L-5 pendente, L-7 condicionada).
  assert.equal(app.run('ind.conformidade.value'), 57.1);
  assert.equal(app.run('ind.conformidade.display'), '57,1%');
  assert.equal(app.run('ind.conformidade.status'), 'critico');
  assert.equal(app.run("ind.vencidas.rows.map(row=>row.lic.id).join()"), 'L-2');
  // Renovação: só vigentes na janela sem início na janela (L-5 pendente fica fora; L-7 já iniciou; L-8 iniciou antes da janela).
  assert.equal(app.run("ind.renovacao.rows.map(row=>row.lic.id).join()"), 'L-8,L-6');
  assert.equal(app.run("ind.risco.rows.map(row=>row.lic.id).join()"), 'L-5');
  // Prazo mede as subatividades, não a mãe: 2 no prazo (sub + Etapa 2) de 3 medidas; 1 sem data de conclusão.
  assert.equal(app.run('ind.prazo.value'), 66.7);
  assert.match(app.run('ind.prazo.note'), /^1 atividade/);
  assert.equal(app.run("ind.prazo.rows.map(row=>row.nome).join()"), 'Mãe › Atrasada');
  assert.equal(app.run('ind.atraso.value'), 4);
  assert.equal(app.run('ind.atraso.status'), 'alerta');
  assert.equal(app.run('ind.avanco.value'), 50);
  assert.equal(app.run('ind.avanco.status'), 'info');
  assert.equal(app.run("computeIndicators([]).find(item=>item.id === 'conformidade').result.status"), 'vazio');

  app.run("selectedIndicator = 'avanco'; renderIndicators(list);");
  let html = app.element('indicatorsPanel').innerHTML;
  assert.match(html, /data-ind="avanco" aria-pressed="true"/);
  assert.match(html, /&lt;b&gt;Sinop&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Sinop<\/b>/);
  assert.match(html, /Ficha técnica dos indicadores/);
  app.run("selectedIndicator = 'prazo'; renderIndicators(list);");
  html = app.element('indicatorsPanel').innerHTML;
  assert.match(html, /data-open-lic="L-5"/);
  assert.match(html, /Mãe › Atrasada/);
});

test('aba indicadores tem rota propria no endereco', ()=>{
  const app = createApp();
  const route = hash=>app.run(`navigatePanel(${JSON.stringify(hash)}); [activePanel, currentViewKey()].join()`);
  assert.equal(route('#view=indicadores'), 'indicators,indicadores');
  assert.equal(route('#view=licencas'), 'license,licencas');
});
