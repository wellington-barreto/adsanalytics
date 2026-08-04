-- AdsPilot Analytics V2.3
-- Ciclos configuráveis e histórico imutável de orçamento/CPA.

alter table campaign_settings
  add column if not exists commission_visibility text not null default 'always'
    check (commission_visibility in ('always','no_sales')),
  add column if not exists show_cpa_cycle boolean not null default true,
  add column if not exists cycle_scope text not null default 'all'
    check (cycle_scope in ('all','conversion_window')),
  add column if not exists conversion_window_days integer not null default 7
    check (conversion_window_days between 1 and 90);

create table if not exists google_ads_campaign_config_history (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  customer_id text not null, campaign_id text not null, effective_at timestamptz not null,
  budget_micros bigint, target_cpa_micros bigint, desired_cpa_micros bigint,
  desired_cpa_is_average boolean not null default false,
  desired_cpa_min_micros bigint, desired_cpa_max_micros bigint,
  desired_cpa_group_count integer, bidding_strategy_type text,
  source text not null default 'google_ads_script', is_baseline boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id,customer_id,campaign_id,effective_at)
);
create index if not exists campaign_config_history_lookup
  on google_ads_campaign_config_history(user_id,customer_id,campaign_id,effective_at desc);
alter table google_ads_campaign_config_history enable row level security;
drop policy if exists "campaign_config_history_owner_read" on google_ads_campaign_config_history;
create policy "campaign_config_history_owner_read" on google_ads_campaign_config_history
  for select using(auth.uid()=user_id);
