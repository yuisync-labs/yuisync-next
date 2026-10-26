-- Compatibility mirror for installations that still project tenant metadata to
-- Supabase. The production checkout/onboarding flow is enforced by Edge/D1;
-- this table keeps the Postgres model equivalent without duplicating tenants as
-- a second `organizations` entity.
begin;

create table if not exists public.tenant_plan_access (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_slug text not null check (plan_slug in ('yui-start', 'yui-pro', 'yui-prime-ia', 'yui-elite')),
  allowed_modules jsonb not null default '[]'::jsonb check (jsonb_typeof(allowed_modules) = 'array'),
  onboarding_completed boolean not null default false,
  status text not null default 'active' check (status in (
    'active', 'trialing', 'past_due', 'incomplete', 'incomplete_expired',
    'paused', 'canceled', 'unpaid', 'inactive'
  )),
  source text not null default 'legacy' check (source in ('stripe', 'legacy', 'manual')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_tenant_plan_access_status
  on public.tenant_plan_access(status, updated_at desc, tenant_id);

insert into public.tenant_plan_access (
  tenant_id,
  plan_slug,
  allowed_modules,
  onboarding_completed,
  status,
  source
)
select
  tenant.id,
  'yui-elite',
  '["agenda","clients_pets","sales_pos","cash_control","inventory","service_orders_delivery","whatsapp_basic","team_commissions","petbot_ai","campaigns_reengagement","ai_satisfaction","multi_instance","custom_configuration"]'::jsonb,
  true,
  'active',
  'legacy'
from public.tenants tenant
on conflict (tenant_id) do nothing;

alter table public.tenant_plan_access enable row level security;

drop policy if exists tenant_plan_access_select on public.tenant_plan_access;
create policy tenant_plan_access_select
on public.tenant_plan_access
for select
to authenticated
using (public.has_tenant_access(tenant_id));

revoke insert, update, delete on public.tenant_plan_access from authenticated;
grant select on public.tenant_plan_access to authenticated;
grant all on public.tenant_plan_access to service_role;

commit;
