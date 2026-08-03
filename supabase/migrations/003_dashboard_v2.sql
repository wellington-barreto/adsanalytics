-- AdsPilot Analytics V2
-- Configuracoes dinamicas por campanha e suporte ao dashboard autenticado.

create table if not exists campaign_settings (
  user_id uuid not null,
  customer_id text not null,
  campaign_id text not null,
  campaign_type text not null default 'main'
    check (campaign_type in ('main', 'test')),
  commission_value numeric(14,2),
  test_limit_percent numeric(7,2) not null default 75
    check (test_limit_percent > 0 and test_limit_percent <= 500),
  test_start_date date,
  currency_code text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, customer_id, campaign_id)
);

create index if not exists campaign_settings_lookup
  on campaign_settings(user_id, customer_id, campaign_id);

alter table campaign_settings enable row level security;

drop policy if exists "campaign_settings_owner_all" on campaign_settings;
create policy "campaign_settings_owner_all" on campaign_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

