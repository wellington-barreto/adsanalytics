-- AdsPilot Analytics V2.2
-- Metadados de campanha, CPA desejado efetivo e geografia hierárquica.

alter table google_ads_campaign_daily
  add column if not exists campaign_start_date date,
  add column if not exists ad_group_count integer,
  add column if not exists ad_count integer,
  add column if not exists desired_cpa_micros bigint,
  add column if not exists desired_cpa_is_average boolean not null default false,
  add column if not exists desired_cpa_min_micros bigint,
  add column if not exists desired_cpa_max_micros bigint,
  add column if not exists desired_cpa_group_count integer;

alter table google_ads_sync_runs
  add column if not exists location_rows integer not null default 0;

create table if not exists google_ads_locations_daily (
  user_id uuid not null,
  customer_id text not null,
  campaign_id text not null,
  report_date date not null,
  location_level text not null check (location_level in ('country','state','city')),
  country_id text,
  country_code text,
  country_name text,
  state_id text,
  state_name text,
  city_id text,
  city_name text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  conversion_value numeric not null default 0,
  synced_at timestamptz not null default now(),
  location_key text generated always as (
    coalesce(city_id, state_id, country_id, 'unknown')
  ) stored,
  primary key (user_id, customer_id, campaign_id, report_date, location_level, location_key)
);

create index if not exists locations_campaign_lookup
  on google_ads_locations_daily(user_id, customer_id, campaign_id, report_date desc, location_level);
create index if not exists locations_hierarchy_lookup
  on google_ads_locations_daily(user_id, country_id, state_id, city_id);

alter table google_ads_locations_daily enable row level security;
drop policy if exists "locations_owner_read" on google_ads_locations_daily;
create policy "locations_owner_read" on google_ads_locations_daily
  for select using (auth.uid() = user_id);

comment on table google_ads_locations_daily is
  'Desempenho geográfico em consultas independentes por país, estado e cidade.';
