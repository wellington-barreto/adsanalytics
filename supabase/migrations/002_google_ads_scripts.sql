-- AdsPilot Analytics V1.2
-- Ingestao temporaria por Google Ads Scripts enquanto o acesso basico da API
-- estiver pendente. Seguro para executar mais de uma vez.

alter table google_ads_campaign_daily
  add column if not exists account_name text,
  add column if not exists channel_type text,
  add column if not exists bidding_strategy_type text,
  add column if not exists target_cpa_micros bigint,
  add column if not exists target_roas numeric,
  add column if not exists search_impression_share numeric,
  add column if not exists search_top_impression_share numeric,
  add column if not exists search_absolute_top_impression_share numeric,
  add column if not exists source text not null default 'google_ads_api';

create table if not exists google_ads_search_terms_daily (
  user_id uuid not null,
  customer_id text not null,
  campaign_id text not null,
  report_date date not null,
  search_term text not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  conversion_value numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (user_id, customer_id, campaign_id, report_date, search_term)
);

create table if not exists google_ads_segments_daily (
  user_id uuid not null,
  customer_id text not null,
  campaign_id text not null,
  report_date date not null,
  segment_type text not null,
  segment_value text not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  conversion_value numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (user_id, customer_id, campaign_id, report_date, segment_type, segment_value)
);

create table if not exists google_ads_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  customer_id text not null,
  account_name text,
  source text not null default 'google_ads_script',
  status text not null check (status in ('running', 'success', 'partial', 'error')),
  started_at timestamptz not null,
  finished_at timestamptz,
  campaign_rows integer not null default 0,
  search_term_rows integer not null default 0,
  segment_rows integer not null default 0,
  change_event_rows integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists search_terms_lookup
  on google_ads_search_terms_daily(user_id, campaign_id, report_date desc);
create index if not exists segments_lookup
  on google_ads_segments_daily(user_id, campaign_id, segment_type, report_date desc);
create index if not exists sync_runs_lookup
  on google_ads_sync_runs(user_id, customer_id, started_at desc);

alter table google_ads_search_terms_daily enable row level security;
alter table google_ads_segments_daily enable row level security;
alter table google_ads_sync_runs enable row level security;

drop policy if exists "search_terms_owner_read" on google_ads_search_terms_daily;
create policy "search_terms_owner_read" on google_ads_search_terms_daily
  for select using (auth.uid() = user_id);

drop policy if exists "segments_owner_read" on google_ads_segments_daily;
create policy "segments_owner_read" on google_ads_segments_daily
  for select using (auth.uid() = user_id);

drop policy if exists "sync_runs_owner_read" on google_ads_sync_runs;
create policy "sync_runs_owner_read" on google_ads_sync_runs
  for select using (auth.uid() = user_id);

