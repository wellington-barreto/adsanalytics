-- AdsPilot Analytics V2.1
-- Preferencias, estrategia e dados manuais complementares ao Google Ads.

create table if not exists user_dashboard_preferences (
  user_id uuid primary key,
  theme text not null default 'dark' check (theme in ('dark','light')),
  display_currency text not null default 'USD' check (display_currency in ('USD','BRL','EUR')),
  visible_columns jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists campaign_strategies (
  user_id uuid not null,
  customer_id text not null,
  campaign_id text not null,
  content text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, customer_id, campaign_id)
);

create table if not exists campaign_manual_daily (
  user_id uuid not null,
  customer_id text not null,
  campaign_id text not null,
  report_date date not null,
  currency_code text not null default 'USD' check (currency_code in ('USD','BRL','EUR')),
  page_visits numeric not null default 0 check (page_visits >= 0),
  vsl_clicks numeric not null default 0 check (vsl_clicks >= 0),
  vsl_checkouts numeric not null default 0 check (vsl_checkouts >= 0),
  general_checkouts numeric not null default 0 check (general_checkouts >= 0),
  sales numeric not null default 0 check (sales >= 0),
  revenue numeric(16,2) not null default 0 check (revenue >= 0),
  refunds numeric(16,2) not null default 0 check (refunds >= 0),
  observation text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, customer_id, campaign_id, report_date)
);

alter table google_ads_campaign_daily add column if not exists final_url text;

create index if not exists manual_daily_lookup on campaign_manual_daily(user_id, campaign_id, report_date desc);
create index if not exists strategy_lookup on campaign_strategies(user_id, campaign_id);

alter table user_dashboard_preferences enable row level security;
alter table campaign_strategies enable row level security;
alter table campaign_manual_daily enable row level security;

drop policy if exists "preferences_owner_all" on user_dashboard_preferences;
create policy "preferences_owner_all" on user_dashboard_preferences for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "strategies_owner_all" on campaign_strategies;
create policy "strategies_owner_all" on campaign_strategies for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
drop policy if exists "manual_daily_owner_all" on campaign_manual_daily;
create policy "manual_daily_owner_all" on campaign_manual_daily for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
