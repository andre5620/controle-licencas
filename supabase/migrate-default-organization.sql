-- Execute depois das migracoes de organizacao compartilhada e base central.
-- ANTES: desative "Allow new users to sign up" em Authentication.
-- Todas as contas nao anonimas deste projeto terao acesso a base escolhida.
begin;

create table if not exists public.app_organization (
  singleton boolean primary key default true check (singleton),
  organization_id uuid not null references public.organizations(id)
);

alter table public.app_organization enable row level security;
revoke all on public.app_organization from public, anon, authenticated;

do $$
declare
  -- Com varias organizacoes, substitua NULL pelo UUID da base oficial:
  -- selected_org uuid := 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  selected_org uuid := null;
  organization_count integer;
  initial_owner uuid;
begin
  if selected_org is null then
    select organization_id into selected_org from public.app_organization where singleton;
  end if;
  if selected_org is null then
    select count(*) into organization_count from public.organizations;
    if organization_count > 1 then
      raise exception 'Existem varias organizacoes. Informe o UUID da base oficial em selected_org neste script. Nenhum dado foi alterado.';
    elsif organization_count = 1 then
      select id into selected_org from public.organizations;
    else
      select id into initial_owner from auth.users
        where not coalesce(is_anonymous, false) order by created_at, id limit 1;
      if initial_owner is null then
        raise exception 'Crie primeiro sua conta em Authentication > Users e execute novamente.';
      end if;
      insert into public.organizations (name, created_by)
        values ('Organizacao Solinftec', initial_owner) returning id into selected_org;
      insert into public.organization_members (organization_id, user_id, role)
        values (selected_org, initial_owner, 'owner');
    end if;
  end if;
  if not exists (select 1 from public.organizations where id = selected_org) then
    raise exception 'O UUID escolhido em selected_org nao corresponde a uma organizacao existente.';
  end if;

  insert into public.app_organization (singleton, organization_id)
    values (true, selected_org)
    on conflict (singleton) do update set organization_id = excluded.organization_id;

  insert into public.organization_members (organization_id, user_id, role)
    select selected_org, id, 'member' from auth.users
      where not coalesce(is_anonymous, false)
    on conflict (organization_id, user_id) do nothing;
end;
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
  if auth.uid() is null or not exists (
    select 1 from auth.users
      where id = auth.uid() and not coalesce(is_anonymous, false)
  ) then
    raise exception 'Entre com uma conta cadastrada pelo administrador.' using errcode = '42501';
  end if;

  select organization_id into result_org from public.app_organization where singleton;
  if result_org is null then
    raise exception 'A organizacao compartilhada ainda nao foi configurada.';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
    values (result_org, auth.uid(), 'member')
    on conflict (organization_id, user_id) do nothing;

  return result_org;
end;
$$;

revoke all on function public.get_or_create_my_organization() from public, anon;
grant execute on function public.get_or_create_my_organization() to authenticated;

commit;
