/* Persistência remota opcional. Sem configuração, o app permanece local. */
(function(){
  const config = window.SUPABASE_CONFIG || {};
  const hasConfig = Boolean(config.url && config.anonKey && window.supabase?.createClient);
  const client = hasConfig ? window.supabase.createClient(config.url, config.anonKey) : null;
  let organizationId = null;

  const rowsToModel = (units, processTypes, processes, steps, obligations) => {
    const stepsByProcess = new Map();
    steps.forEach(step=>{
      if(!stepsByProcess.has(step.process_id)) stepsByProcess.set(step.process_id, []);
      stepsByProcess.get(step.process_id).push({
        id: step.id,
        name: step.name,
        owner: step.owner || '',
        status: step.status || 'Não iniciado',
        date: step.planned_date || '',
        observacao: step.notes || '',
        etapaPadraoId: step.standard_step_id || '',
        dataRealizada: step.completed_date || '',
        dataPlanejada: step.planned_date || '',
        desvioModelo: Boolean(step.model_deviation)
      });
    });
    const obligationsByUnit = new Map();
    obligations.forEach(item=>{
      if(!obligationsByUnit.has(item.unit_id)) obligationsByUnit.set(item.unit_id, []);
      obligationsByUnit.get(item.unit_id).push(item.payload || {});
    });
    return {
      version: 2,
      units: units.map(unit=>({
        ...unit.payload,
        id: unit.id,
        profile: unit.profile || {},
        environmentalLicenses: obligationsByUnit.get(unit.id) || [],
        standardFlow: unit.standard_flow || []
      })),
      processTypes: processTypes.map(type=>({
        ...type.payload,
        id: type.id,
        etapasPadrao: type.standard_steps || type.payload?.etapasPadrao || []
      })),
      processes: processes.map(process=>({
        ...process.payload,
        id: process.id,
        unidadeId: process.unit_id,
        tipoProcessoId: process.process_type_id,
        etapas: stepsByProcess.get(process.id) || [],
        activities: stepsByProcess.get(process.id) || []
      }))
    };
  };

  const modelToRows = (model, orgId) => {
    const units = (model.units || []).map(unit=>({
      id: unit.id,
      organization_id: orgId,
      payload: {...unit, id: undefined, profile: undefined, environmentalLicenses: undefined, standardFlow: undefined},
      profile: unit.profile || {},
      standard_flow: unit.standardFlow || []
    }));
    const processTypes = (model.processTypes || []).map(type=>({
      id: type.id,
      organization_id: orgId,
      payload: {...type, id: undefined, etapasPadrao: undefined},
      standard_steps: type.etapasPadrao || []
    }));
    const processes = (model.processes || []).map(process=>({
      id: process.id,
      organization_id: orgId,
      unit_id: process.unidadeId,
      process_type_id: process.tipoProcessoId,
      payload: {...process, id: undefined, unidadeId: undefined, tipoProcessoId: undefined, etapas: undefined, activities: undefined}
    }));
    const steps = [];
    (model.processes || []).forEach(process=>{
      (process.etapas || process.activities || []).forEach((step, index)=>steps.push({
        id: step.id || `STEP-${process.id}-${index+1}`,
        organization_id: orgId,
        process_id: process.id,
        standard_step_id: step.etapaPadraoId || '',
        name: step.name || `Etapa ${index+1}`,
        owner: step.owner || '',
        status: step.status || 'Não iniciado',
        planned_date: step.dataPlanejada || step.date || '',
        completed_date: step.dataRealizada || '',
        notes: step.observacao || '',
        model_deviation: Boolean(step.desvioModelo)
      }));
    });
    const obligations = [];
    (model.units || []).forEach(unit=>(unit.environmentalLicenses || []).forEach((payload, index)=>obligations.push({
      id: `${unit.id}-OB-${index+1}`,
      organization_id: orgId,
      unit_id: unit.id,
      payload
    })));
    return {units, processTypes, processes, steps, obligations};
  };

  async function ensureOrganization(){
    if(!client) return null;
    if(organizationId) return organizationId;
    const {data, error} = await client.rpc('get_or_create_my_organization');
    if(error) throw error;
    organizationId = data;
    const {error: legacyError} = await client.rpc('assign_my_legacy_rows', {target_org: organizationId});
    if(legacyError) throw legacyError;
    return organizationId;
  }

  async function readTable(table){
    const orgId = await ensureOrganization();
    const {data, error} = await client.from(table).select('*').eq('organization_id', orgId);
    if(error) throw error;
    return data || [];
  }

  async function load(){
    if(!client) return null;
    await ensureOrganization();
    const [units, processTypes, processes, steps, obligations] = await Promise.all([
      readTable('units'), readTable('process_types'), readTable('processes'),
      readTable('process_steps'), readTable('environmental_obligations')
    ]);
    if(!units.length && !processTypes.length && !processes.length) return null;
    return rowsToModel(units, processTypes, processes, steps, obligations);
  }

  async function replaceTable(table, rows){
    const orgId = await ensureOrganization();
    const {error: deleteError} = await client.from(table).delete().eq('organization_id', orgId);
    if(deleteError) throw deleteError;
    if(!rows.length) return;
    const {error: insertError} = await client.from(table).insert(rows);
    if(insertError) throw insertError;
  }

  async function save(model){
    if(!client) return false;
    const rows = modelToRows(model, await ensureOrganization());
    await replaceTable('process_steps', rows.steps);
    await replaceTable('environmental_obligations', rows.obligations);
    await replaceTable('processes', rows.processes);
    await replaceTable('process_types', rows.processTypes);
    await replaceTable('units', rows.units);
    return true;
  }

  async function getSession(){
    if(!client) return null;
    const {data, error} = await client.auth.getSession();
    if(error) throw error;
    return data.session;
  }

  async function signIn(email, password){
    if(!client) throw new Error('Supabase não está configurado.');
    const {data, error} = await client.auth.signInWithPassword({email, password});
    if(error) throw error;
    return data.session;
  }

  async function signOut(){
    if(!client) return;
    const {error} = await client.auth.signOut();
    if(error) throw error;
  }

  window.LicenseDataService = {
    enabled: hasConfig,
    load,
    save,
    auth: {getSession, signIn, signOut}
  };
})();
