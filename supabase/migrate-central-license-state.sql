-- Execute depois de schema.sql e migrate-shared-organization.sql.
-- O modelo completo evita deletes em cascata e e salvo em uma unica transacao.
begin;

create table if not exists public.organization_license_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  model jsonb not null,
  revision bigint not null check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);

alter table public.organization_license_state enable row level security;
revoke all on public.organization_license_state from anon, authenticated;
grant select on public.organization_license_state to authenticated;
drop policy if exists "members can read license state" on public.organization_license_state;
create policy "members can read license state"
  on public.organization_license_state for select to authenticated
  using (public.is_org_member(organization_id));

create or replace function public.load_license_state(target_org uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'Sem acesso a esta organizacao' using errcode = '42501';
  end if;
  select jsonb_build_object('model', model, 'revision', revision) into result
    from public.organization_license_state where organization_id = target_org;
  return coalesce(result, '{"model":null,"revision":0}'::jsonb);
end;
$$;

create or replace function public.save_license_state(
  target_org uuid, expected_revision bigint, new_model jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next_revision bigint;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'Sem acesso a esta organizacao' using errcode = '42501';
  end if;
  if expected_revision is null or expected_revision < 0
    or jsonb_typeof(new_model) is distinct from 'object'
    or jsonb_typeof(new_model->'units') is distinct from 'array'
    or jsonb_typeof(new_model->'processTypes') is distinct from 'array'
    or jsonb_typeof(new_model->'processes') is distinct from 'array' then
    raise exception 'Modelo ou revisao invalida' using errcode = '22023';
  end if;

  if expected_revision = 0 then
    insert into public.organization_license_state (organization_id, model, revision, updated_by)
      values (target_org, new_model, 1, auth.uid())
      on conflict (organization_id) do nothing
      returning revision into next_revision;
  else
    update public.organization_license_state
      set model = new_model, revision = revision + 1, updated_at = now(), updated_by = auth.uid()
      where organization_id = target_org and revision = expected_revision
      returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'Outra pessoa atualizou a base. Carregue a versao do servidor antes de salvar novamente.'
      using errcode = '40001';
  end if;
  return next_revision;
end;
$$;

revoke all on function public.load_license_state(uuid) from public, anon;
revoke all on function public.save_license_state(uuid, bigint, jsonb) from public, anon;
grant execute on function public.load_license_state(uuid) to authenticated;
grant execute on function public.save_license_state(uuid, bigint, jsonb) to authenticated;

commit;
