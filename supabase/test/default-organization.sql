-- Execute no SQL Editor DEPOIS de migrate-default-organization.sql.
-- Cria contas de teste temporarias e desfaz todas as alteracoes ao terminar.
begin;

do $$
declare
  target_org uuid;
  other_org uuid;
  first_user uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  anonymous_user uuid := gen_random_uuid();
  original_org_count integer;
  memberships_count integer;
begin
  select organization_id into target_org from public.app_organization where singleton;
  if target_org is null then
    raise exception 'Execute migrate-default-organization.sql antes do teste.';
  end if;
  select count(*) into original_org_count from public.organizations;

  insert into auth.users (id, email, is_anonymous) values
    (first_user, first_user::text || '@example.invalid', false),
    (second_user, second_user::text || '@example.invalid', false),
    (anonymous_user, null, true);
  insert into public.organizations (name, created_by)
    values ('Organizacao anterior de teste', first_user) returning id into other_org;
  insert into public.organization_members (organization_id, user_id, role, created_at)
    values (other_org, first_user, 'owner', now() - interval '1 day');

  perform set_config('request.jwt.claim.sub', first_user::text, true);
  if public.get_or_create_my_organization() is distinct from target_org then
    raise exception 'O primeiro usuario nao recebeu a organizacao oficial.';
  end if;
  perform public.get_or_create_my_organization();
  select count(*) into memberships_count from public.organization_members
    where organization_id = target_org and user_id = first_user;
  if memberships_count <> 1 then
    raise exception 'A repeticao do login duplicou ou perdeu o vinculo.';
  end if;
  if not exists (select 1 from public.organization_members
    where organization_id = other_org and user_id = first_user and role = 'owner') then
    raise exception 'O vinculo anterior foi alterado.';
  end if;

  perform set_config('request.jwt.claim.sub', second_user::text, true);
  if public.get_or_create_my_organization() is distinct from target_org then
    raise exception 'O segundo usuario nao recebeu acesso a mesma organizacao.';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'O segundo usuario nao recebeu vinculo com a organizacao.';
  end if;
  if public.is_org_owner(target_org) then
    raise exception 'Uma conta nova nao deve ganhar administracao dos vinculos.';
  end if;
  insert into public.organization_members (organization_id, user_id, role)
    values (target_org, first_user, 'owner')
    on conflict (organization_id, user_id) do update set role = 'owner';
  perform set_config('request.jwt.claim.sub', first_user::text, true);
  perform public.get_or_create_my_organization();
  if not public.is_org_owner(target_org) then
    raise exception 'O login rebaixou um owner existente.';
  end if;

  perform set_config('request.jwt.claim.sub', anonymous_user::text, true);
  begin
    perform public.get_or_create_my_organization();
    raise exception 'Uma conta anonima recebeu acesso.';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_or_create_my_organization();
    raise exception 'Uma chamada sem sessao recebeu acesso.';
  exception when insufficient_privilege then null;
  end;
  if has_function_privilege('anon', 'public.get_or_create_my_organization()', 'execute')
    or has_table_privilege('authenticated', 'public.app_organization', 'update') then
    raise exception 'Permissoes permitem escolher a base sem administracao.';
  end if;
  if (select count(*) from public.organizations) <> original_org_count + 1 then
    raise exception 'Um login criou uma organizacao extra.';
  end if;
  raise notice 'OK: mesma organizacao, logins repetidos, vinculos antigos e bloqueio anonimo.';
end;
$$;

rollback;
