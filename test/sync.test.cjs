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

function createApp({remote = true, service = {}, storage = new Map(), withCatalog = false} = {}){
  const elements = new Map();
  const errors = [];
  const element = id=>{
    if(!elements.has(id)){
      elements.set(id, {
        value: '', textContent: '', hidden: false, disabled: false, style: {},
        listeners: {}, classList: {add(){}, remove(){}},
        querySelectorAll: ()=>[],
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
      querySelectorAll: ()=>[], activeElement: null, hidden: false
    },
    localStorage: {getItem: key=>storage.get(key) ?? null, setItem: (key, value)=>storage.set(key, value)},
    console: {error: (...args)=>errors.push(args)}, crypto: webcrypto, URL, URLSearchParams,
    setTimeout: ()=>0, clearTimeout(){}, setInterval(){}, confirm: ()=>true
  });
  if(withCatalog) vm.runInContext(readFileSync(join(root, 'data', 'fluxo.js'), 'utf8'), context);
  vm.runInContext(appSource, context);
  const run = code=>vm.runInContext(code, context);
  run("render = ()=>{}; authenticatedUserId = 'user-1';");
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
  const save = ()=>app.element('btnSaveNewLic').listeners.click();
  await save();
  assert.equal(app.run('DATA.length'), 0);
  assert.match(app.element('toast').textContent, /Selecione/);
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
    MODEL.units[0].standardFlow = [{nome:'Etapa padrao'}];`);
  app.element('fBusca').value = 'Sem resultado';
  app.run('renderUnitDetail(MODEL.units[0].id);');
  const html = app.element('unitPanel').innerHTML;
  for(const value of ['CNPJ completo','Pasta unidade','Obrigacao','Etapa padrao','L-1','Voltar às unidades']){
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
  assert.equal(app.run('window.location.hash'), '#units');
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
