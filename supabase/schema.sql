-- Execute no SQL Editor do Supabase.
-- O app usa uma organizacao por usuario autenticado como tenant inicial.
create extension if not exists pgcrypto;

create table if not exists public.units (
  id text primary key,
  tenant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  standard_flow jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.process_types (
  id text primary key,
  tenant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  standard_steps jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.processes (
  id text primary key,
  tenant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unit_id text not null references public.units(id) on delete cascade,
  process_type_id text references public.process_types(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.process_steps (
  id text primary key,
  tenant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  process_id text not null references public.processes(id) on delete cascade,
  standard_step_id text,
  name text not null,
  owner text not null default '',
  status text not null default 'Não iniciado',
  planned_date date,
  completed_date date,
  notes text not null default '',
  model_deviation boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.environmental_obligations (
  id text primary key,
  tenant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unit_id text not null references public.units(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  unit_id text references public.units(id) on delete cascade,
  process_id text references public.processes(id) on delete cascade,
  name text not null,
  storage_path text not null,
  document_type text not null default '',
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists processes_unit_id_idx on public.processes(unit_id);
create index if not exists process_steps_process_id_idx on public.process_steps(process_id);
create index if not exists obligations_unit_id_idx on public.environmental_obligations(unit_id);

alter table public.units enable row level security;
alter table public.process_types enable row level security;
alter table public.processes enable row level security;
alter table public.process_steps enable row level security;
alter table public.environmental_obligations enable row level security;
alter table public.documents enable row level security;

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

create policy "tenant members can read units" on public.units for select using (tenant_id = auth.uid());
create policy "tenant members can write units" on public.units for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "tenant members can read process types" on public.process_types for select using (tenant_id = auth.uid());
create policy "tenant members can write process types" on public.process_types for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "tenant members can read processes" on public.processes for select using (tenant_id = auth.uid());
create policy "tenant members can write processes" on public.processes for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "tenant members can read steps" on public.process_steps for select using (tenant_id = auth.uid());
create policy "tenant members can write steps" on public.process_steps for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "tenant members can read obligations" on public.environmental_obligations for select using (tenant_id = auth.uid());
create policy "tenant members can write obligations" on public.environmental_obligations for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
create policy "tenant members can read documents" on public.documents for select using (tenant_id = auth.uid());
create policy "tenant members can write documents" on public.documents for all using (tenant_id = auth.uid()) with check (tenant_id = auth.uid());
