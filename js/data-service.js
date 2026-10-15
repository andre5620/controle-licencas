/* A base central e gravada atomicamente; tabelas antigas sao lidas na migracao. */
(function(){
  const config = window.SUPABASE_CONFIG || {};
  const configured = Boolean(config.url && config.anonKey);
  const client = configured && window.supabase?.createClient
    ? window.supabase.createClient(config.url, config.anonKey) : null;
  let organizationId = null;

  function requireClient(){
    if(!client) throw new Error('Não foi possível carregar o Supabase. Confira a configuração e a conexão com a internet.');
    return client;
  }

  async function ensureOrganization(){
    requireClient();
    if(organizationId) return organizationId;
    const {data, error} = await client.rpc('get_or_create_my_organization');
    if(error) throw error;
    const {error: legacyError} = await client.rpc('assign_my_legacy_rows', {target_org: data});
    if(legacyError) throw legacyError;
    organizationId = data;
    return organizationId;
  }

  async function readTable(table, orgId){
    const rows = [];
    for(let offset = 0; ; offset += 1000){
      const {data, error} = await client.from(table).select('*')
        .eq('organization_id', orgId).order('id').range(offset, offset + 999);
      if(error) throw error;
      rows.push(...data);
      if(data.length < 1000) return rows;
    }
  }

  async function loadLegacyModel(orgId){
    const [units, processTypes, processes, steps, obligations] = await Promise.all([
      readTable('units', orgId), readTable('process_types', orgId),
      readTable('processes', orgId), readTable('process_steps', orgId),
      readTable('environmental_obligations', orgId)
    ]);
    if(!units.length && !processTypes.length && !processes.length) return null;
    return {
      version: 2,
      units: units.map(unit=>({
        ...unit.payload, id: unit.id, profile: unit.profile,
        standardFlow: unit.standard_flow,
        environmentalLicenses: obligations.filter(item=>item.unit_id === unit.id).map(item=>item.payload)
      })),
      processTypes: processTypes.map(type=>({
        ...type.payload, id: type.id, etapasPadrao: type.standard_steps
      })),
      processes: processes.map(process=>{
        const activities = steps.filter(step=>step.process_id === process.id).map(step=>({
          id: step.id, name: step.name, owner: step.owner, status: step.status,
          date: step.planned_date || '', observacao: step.notes || '',
          etapaPadraoId: step.standard_step_id || '',
          dataRealizada: step.completed_date || '', dataPlanejada: step.planned_date || '',
          desvioModelo: Boolean(step.model_deviation)
        }));
        return {
          ...process.payload, id: process.id, unidadeId: process.unit_id,
          tipoProcessoId: process.process_type_id, etapas: activities, activities
        };
      })
    };
  }

  async function load(){
    const orgId = await ensureOrganization();
    const {data, error} = await client.rpc('load_license_state', {target_org: orgId});
    if(error) throw error;
    return {
      organizationId: orgId,
      revision: data.revision,
      model: data.model === null ? await loadLegacyModel(orgId) : data.model
    };
  }

  async function save(model, revision){
    const orgId = await ensureOrganization();
    const {data, error} = await client.rpc('save_license_state', {
      target_org: orgId, expected_revision: revision, new_model: model
    });
    if(error) throw error;
    return data;
  }

  async function getSession(){
    const {data, error} = await requireClient().auth.getSession();
    if(error) throw error;
    return data.session;
  }

  async function signIn(email, password){
    const {data, error} = await requireClient().auth.signInWithPassword({email, password});
    if(error) throw error;
    organizationId = null;
    return data.session;
  }

  async function signOut(){
    const {error} = await requireClient().auth.signOut();
    if(error) throw error;
    organizationId = null;
  }

  window.LicenseDataService = {
    enabled: Boolean(config.required || configured),
    load, save,
    auth: {getSession, signIn, signOut}
  };
})();
