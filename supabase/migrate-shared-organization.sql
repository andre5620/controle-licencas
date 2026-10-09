-- Execute depois de supabase/schema.sql.
-- Adiciona uma organizacao compartilhada entre os colaboradores.

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.units add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.process_types add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.processes add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.process_steps add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.environmental_obligations add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.documents add column if not exists organization_id uuid references public.organizations(id) on delete cascade;

create index if not exists units_organization_id_idx on public.units(organization_id);
create index if not exists process_types_organization_id_idx on public.process_types(organization_id);
create index if not exists processes_organization_id_idx on public.processes(organization_id);
create index if not exists process_steps_organization_id_idx on public.process_steps(organization_id);
create index if not exists obligations_organization_id_idx on public.environmental_obligations(organization_id);
create index if not exists members_user_id_idx on public.organization_members(user_id);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function public.get_or_create_my_organization()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result_org uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;

  select organization_id into result_org
  from public.organization_members
  where user_id = auth.uid()
  order by created_at
  limit 1;

  if result_org is null then
    insert into public.organizations (name, created_by)
    values ('Organização Solinftec', auth.uid())
    returning id into result_org;

    insert into public.organization_members (organization_id, user_id, role)
    values (result_org, auth.uid(), 'owner');
  end if;

  return result_org;
end;
$$;

grant execute on function public.get_or_create_my_organization() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;

create or replace function public.is_org_owner(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

grant execute on function public.is_org_owner(uuid) to authenticated;

create or replace function public.assign_my_legacy_rows(target_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.units set organization_id = target_org
    where organization_id is null and tenant_id = auth.uid();
  update public.process_types set organization_id = target_org
    where organization_id is null and tenant_id = auth.uid();
  update public.processes set organization_id = target_org
    where organization_id is null and tenant_id = auth.uid();
  update public.process_steps set organization_id = target_org
    where organization_id is null and tenant_id = auth.uid();
  update public.environmental_obligations set organization_id = target_org
    where organization_id is null and tenant_id = auth.uid();
  update public.documents set organization_id = target_org
    where organization_id is null and tenant_id = auth.uid();
end;
$$;

grant execute on function public.assign_my_legacy_rows(uuid) to authenticated;

drop policy if exists "members can read organizations" on public.organizations;
drop policy if exists "members can read memberships" on public.organization_members;
drop policy if exists "owners can manage memberships" on public.organization_members;
create policy "members can read organizations" on public.organizations
  for select using (public.is_org_member(id));
create policy "members can read memberships" on public.organization_members
  for select using (user_id = auth.uid() or public.is_org_member(organization_id));
create policy "owners can manage memberships" on public.organization_members
  for all using (public.is_org_owner(organization_id))
  with check (public.is_org_owner(organization_id));

-- Substitui as politicas antigas, que isolavam cada registro pelo usuario.
drop policy if exists "tenant members can read units" on public.units;
drop policy if exists "tenant members can write units" on public.units;
drop policy if exists "tenant members can read process types" on public.process_types;
drop policy if exists "tenant members can write process types" on public.process_types;
drop policy if exists "tenant members can read processes" on public.processes;
drop policy if exists "tenant members can write processes" on public.processes;
drop policy if exists "tenant members can read steps" on public.process_steps;
drop policy if exists "tenant members can write steps" on public.process_steps;
drop policy if exists "tenant members can read obligations" on public.environmental_obligations;
drop policy if exists "tenant members can write obligations" on public.environmental_obligations;
drop policy if exists "tenant members can read documents" on public.documents;
drop policy if exists "tenant members can write documents" on public.documents;
drop policy if exists "organization members can read units" on public.units;
drop policy if exists "organization members can write units" on public.units;
drop policy if exists "organization members can read process types" on public.process_types;
drop policy if exists "organization members can write process types" on public.process_types;
drop policy if exists "organization members can read processes" on public.processes;
drop policy if exists "organization members can write processes" on public.processes;
drop policy if exists "organization members can read steps" on public.process_steps;
drop policy if exists "organization members can write steps" on public.process_steps;
drop policy if exists "organization members can read obligations" on public.environmental_obligations;
drop policy if exists "organization members can write obligations" on public.environmental_obligations;
drop policy if exists "organization members can read documents" on public.documents;
drop policy if exists "organization members can write documents" on public.documents;

create policy "organization members can read units" on public.units
  for select using (public.is_org_member(organization_id));
create policy "organization members can write units" on public.units
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "organization members can read process types" on public.process_types
  for select using (public.is_org_member(organization_id));
create policy "organization members can write process types" on public.process_types
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "organization members can read processes" on public.processes
  for select using (public.is_org_member(organization_id));
create policy "organization members can write processes" on public.processes
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "organization members can read steps" on public.process_steps
  for select using (public.is_org_member(organization_id));
create policy "organization members can write steps" on public.process_steps
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "organization members can read obligations" on public.environmental_obligations
  for select using (public.is_org_member(organization_id));
create policy "organization members can write obligations" on public.environmental_obligations
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "organization members can read documents" on public.documents
  for select using (public.is_org_member(organization_id));
create policy "organization members can write documents" on public.documents
  for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));

-- Para adicionar outro colaborador a organizacao do primeiro usuario:
-- insert into public.organization_members (organization_id, user_id, role)
-- values ('ID_DA_ORGANIZACAO', 'UUID_DO_USUARIO', 'member');
-- O ID pode ser consultado com:
-- select id, name from public.organizations;
-- O UUID do colaborador aparece em Authentication > Users.
