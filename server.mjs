import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const root = path.resolve("dist");
const port = Number(process.env.PORT || 3000);
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const json = (res, status, data) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(data));
};

const readJsonBody = async req => {
  let raw = "";
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Payload excede o limite de 10 MB");
      error.statusCode = 413;
      throw error;
    }
    raw += chunk;
  }
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("JSON inválido");
    error.statusCode = 400;
    throw error;
  }
};

const sb = async (route, init = {}) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase não configurado");
  }
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${route}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

const secureEqual = (received, expected) => {
  const a = Buffer.from(String(received || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
};

const cleanId = value => String(value || "").replace(/\D/g, "");
const text = (value, max = 500) => value == null ? null : String(value).slice(0, max);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const integer = value => Math.trunc(number(value));
const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null;
const isoDateTime = value => Number.isNaN(Date.parse(String(value || ""))) ? null : new Date(value).toISOString();

const chunkedUpsert = async (table, conflict, rows) => {
  if (!rows.length) return 0;
  for (let index = 0; index < rows.length; index += 500) {
    await sb(`${table}?on_conflict=${conflict}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(rows.slice(index, index + 500))
    });
  }
  return rows.length;
};

const dedupeLast = (rows, keyFields) => {
  const map = new Map();
  for (const row of rows) map.set(keyFields.map(field => row[field]).join("\u001f"), row);
  return [...map.values()];
};

const aggregateDuplicates = (rows, keyFields) => {
  const metrics = ["impressions", "clicks", "cost_micros", "conversions", "conversion_value"];
  const map = new Map();
  for (const row of rows) {
    const key = keyFields.map(field => row[field]).join("\u001f");
    const current = map.get(key);
    if (!current) {
      map.set(key, { ...row });
      continue;
    }
    for (const metric of metrics) current[metric] = number(current[metric]) + number(row[metric]);
    current.synced_at = row.synced_at;
  }
  return [...map.values()];
};

const errorCode = error => crypto.createHash("sha256").update(String(error?.message || error)).digest("hex").slice(0, 12);

const validateScriptPayload = payload => {
  if (payload?.schema_version !== "1.2") {
    const error = new Error("schema_version deve ser 1.2");
    error.statusCode = 400;
    throw error;
  }
  const customerId = cleanId(payload?.account?.customer_id);
  if (customerId.length < 6 || customerId.length > 12) {
    const error = new Error("customer_id inválido");
    error.statusCode = 400;
    throw error;
  }
  for (const key of ["campaign_daily", "search_terms", "segments", "change_events"]) {
    if (payload[key] != null && !Array.isArray(payload[key])) {
      const error = new Error(`${key} deve ser uma lista`);
      error.statusCode = 400;
      throw error;
    }
  }
  return customerId;
};

async function ingestGoogleAdsScript(payload) {
  const userId = process.env.APP_USER_ID;
  if (!userId) throw new Error("APP_USER_ID não configurado");

  const customerId = validateScriptPayload(payload);
  const now = new Date().toISOString();
  const accountName = text(payload.account?.account_name, 200);
  const currencyCode = text(payload.account?.currency_code, 10);
  const startedAt = isoDateTime(payload.started_at) || now;

  const run = await sb("google_ads_sync_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      user_id: userId,
      customer_id: customerId,
      account_name: accountName,
      source: "google_ads_script",
      status: "running",
      started_at: startedAt,
      metadata: {
        schema_version: payload.schema_version,
        timezone: text(payload.account?.timezone, 100),
        script_name: text(payload.script_name, 200)
      }
    })
  });
  const runId = run?.[0]?.id;

  try {
    const campaigns = (payload.campaign_daily || []).map(row => ({
      user_id: userId,
      customer_id: customerId,
      campaign_id: cleanId(row.campaign_id),
      report_date: isoDate(row.report_date),
      campaign_name: text(row.campaign_name, 500),
      account_name: accountName,
      campaign_status: text(row.campaign_status, 50),
      currency_code: currencyCode,
      channel_type: text(row.channel_type, 100),
      bidding_strategy_type: text(row.bidding_strategy_type, 100),
      budget_micros: integer(row.budget_micros),
      target_cpa_micros: integer(row.target_cpa_micros),
      target_roas: number(row.target_roas),
      impressions: integer(row.impressions),
      clicks: integer(row.clicks),
      cost_micros: integer(row.cost_micros),
      conversions: number(row.conversions),
      conversion_value: number(row.conversion_value),
      ctr: number(row.ctr),
      average_cpc_micros: integer(row.average_cpc_micros),
      search_impression_share: number(row.search_impression_share),
      search_top_impression_share: number(row.search_top_impression_share),
      search_absolute_top_impression_share: number(row.search_absolute_top_impression_share),
      final_url: text(row.final_url, 2000),
      source: "google_ads_script",
      synced_at: now
    })).filter(row => row.campaign_id && row.report_date);

    const searchTerms = (payload.search_terms || []).map(row => ({
      user_id: userId,
      customer_id: customerId,
      campaign_id: cleanId(row.campaign_id),
      report_date: isoDate(row.report_date),
      search_term: text(row.search_term, 1000),
      impressions: integer(row.impressions),
      clicks: integer(row.clicks),
      cost_micros: integer(row.cost_micros),
      conversions: number(row.conversions),
      conversion_value: number(row.conversion_value),
      synced_at: now
    })).filter(row => row.campaign_id && row.report_date && row.search_term);

    const segments = (payload.segments || []).map(row => ({
      user_id: userId,
      customer_id: customerId,
      campaign_id: cleanId(row.campaign_id),
      report_date: isoDate(row.report_date),
      segment_type: text(row.segment_type, 50),
      segment_value: text(row.segment_value, 300),
      impressions: integer(row.impressions),
      clicks: integer(row.clicks),
      cost_micros: integer(row.cost_micros),
      conversions: number(row.conversions),
      conversion_value: number(row.conversion_value),
      synced_at: now
    })).filter(row => row.campaign_id && row.report_date && row.segment_type && row.segment_value);

    const events = (payload.change_events || []).map((row, index) => {
      const changedAt = isoDateTime(row.change_date_time);
      const campaignId = cleanId(row.campaign_id) || null;
      const fallbackKey = `${customerId}|${campaignId || "account"}|${changedAt || now}|${text(row.change_resource_type, 100)}|${text(row.operation, 50)}|${index}`;
      return {
        resource_name: text(row.resource_name, 1000) || `script:${crypto.createHash("sha256").update(fallbackKey).digest("hex")}`,
        user_id: userId,
        customer_id: customerId,
        campaign_id: campaignId,
        change_date_time: changedAt,
        change_resource_name: text(row.change_resource_name, 1000),
        change_resource_type: text(row.change_resource_type, 100),
        operation: text(row.operation, 100),
        client_type: text(row.client_type, 100),
        user_email: text(row.user_email, 320),
        changed_fields: row.changed_fields || null,
        old_resource: row.old_resource || null,
        new_resource: row.new_resource || null,
        summary: text(row.summary, 1000),
        imported_at: now
      };
    }).filter(row => row.change_date_time);

    const datasets = [
      {
        name: "campaigns",
        count: "campaignRows",
        table: "google_ads_campaign_daily",
        conflict: "user_id,customer_id,campaign_id,report_date",
        rows: dedupeLast(campaigns, ["user_id", "customer_id", "campaign_id", "report_date"])
      },
      {
        name: "search_terms",
        count: "searchTermRows",
        table: "google_ads_search_terms_daily",
        conflict: "user_id,customer_id,campaign_id,report_date,search_term",
        rows: aggregateDuplicates(searchTerms, ["user_id", "customer_id", "campaign_id", "report_date", "search_term"])
      },
      {
        name: "segments",
        count: "segmentRows",
        table: "google_ads_segments_daily",
        conflict: "user_id,customer_id,campaign_id,report_date,segment_type,segment_value",
        rows: aggregateDuplicates(segments, ["user_id", "customer_id", "campaign_id", "report_date", "segment_type", "segment_value"])
      },
      {
        name: "change_events",
        count: "changeEventRows",
        table: "google_ads_change_events",
        conflict: "resource_name",
        rows: dedupeLast(events, ["resource_name"])
      }
    ];
    const counts = { campaignRows: 0, searchTermRows: 0, segmentRows: 0, changeEventRows: 0 };
    const datasetErrors = [];
    for (const dataset of datasets) {
      try {
        counts[dataset.count] = await chunkedUpsert(dataset.table, dataset.conflict, dataset.rows);
      } catch (error) {
        const code = errorCode(error);
        console.error(`Ingest ${customerId} ${dataset.name} [${code}]`, error);
        datasetErrors.push({ dataset: dataset.name, code, message: text(error.message, 2000) });
      }
    }
    const finalStatus = datasetErrors.length === 0 ? "success" : datasetErrors.length === datasets.length ? "error" : "partial";

    if (runId) await sb(`google_ads_sync_runs?id=eq.${runId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: finalStatus,
        finished_at: new Date().toISOString(),
        campaign_rows: counts.campaignRows,
        search_term_rows: counts.searchTermRows,
        segment_rows: counts.segmentRows,
        change_event_rows: counts.changeEventRows,
        error_message: datasetErrors.length ? datasetErrors.map(item => `${item.dataset}[${item.code}]: ${item.message}`).join(" | ").slice(0, 2000) : null,
        metadata: {
          schema_version: payload.schema_version,
          timezone: text(payload.account?.timezone, 100),
          script_name: text(payload.script_name, 200),
          query_errors: Array.isArray(payload.query_errors) ? payload.query_errors.slice(0, 20) : [],
          dataset_errors: datasetErrors.map(({ dataset, code }) => ({ dataset, code }))
        }
      })
    });
    return {
      status: finalStatus === "success" ? "ok" : finalStatus,
      customer_id: customerId,
      ...counts,
      errors: datasetErrors.map(({ dataset, code }) => ({ dataset, code }))
    };
  } catch (error) {
    if (runId) {
      try {
        await sb(`google_ads_sync_runs?id=eq.${runId}`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "error",
            finished_at: new Date().toISOString(),
            error_message: text(error.message, 2000)
          })
        });
      } catch {}
    }
    throw error;
  }
}

async function accessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_ADS_CLIENT_ID || "",
    client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET || "",
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN || "",
    grant_type: "refresh_token"
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).access_token;
}

async function gaql(customerId, query, token) {
  const version = process.env.GOOGLE_ADS_API_VERSION || "v25";
  const response = await fetch(`https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "",
      "login-customer-id": cleanId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID),
      "content-type": "application/json"
    },
    body: JSON.stringify({ query })
  });
  if (!response.ok) throw new Error(await response.text());
  return (await response.json()).flatMap(item => item.results || []);
}

const day = offset => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

async function syncApi() {
  const token = await accessToken();
  const userId = process.env.APP_USER_ID;
  const customers = String(process.env.GOOGLE_ADS_CUSTOMER_IDS || "").split(",").map(cleanId).filter(Boolean);
  if (!userId || !customers.length) throw new Error("APP_USER_ID/GOOGLE_ADS_CUSTOMER_IDS ausente");
  const results = [];
  for (const customerId of customers) {
    try {
      const rows = await gaql(customerId, `SELECT segments.date, customer.id, customer.descriptive_name, customer.currency_code, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc FROM campaign WHERE segments.date BETWEEN '${day(-14)}' AND '${day(0)}'`, token);
      const data = rows.map(row => ({
        user_id: userId,
        customer_id: String(row.customer?.id || customerId),
        campaign_id: String(row.campaign?.id),
        report_date: row.segments?.date,
        campaign_name: row.campaign?.name,
        account_name: row.customer?.descriptiveName,
        campaign_status: row.campaign?.status,
        currency_code: row.customer?.currencyCode,
        channel_type: row.campaign?.advertisingChannelType,
        bidding_strategy_type: row.campaign?.biddingStrategyType,
        budget_micros: number(row.campaignBudget?.amountMicros),
        impressions: number(row.metrics?.impressions),
        clicks: number(row.metrics?.clicks),
        cost_micros: number(row.metrics?.costMicros),
        conversions: number(row.metrics?.conversions),
        conversion_value: number(row.metrics?.conversionsValue),
        ctr: number(row.metrics?.ctr),
        average_cpc_micros: number(row.metrics?.averageCpc),
        source: "google_ads_api",
        synced_at: new Date().toISOString()
      }));
      await chunkedUpsert("google_ads_campaign_daily", "user_id,customer_id,campaign_id,report_date", data);
      results.push({ customerId, campaignRows: data.length, status: "ok" });
    } catch (error) {
      results.push({ customerId, status: "error", error: error.message });
    }
  }
  return { period: { start: day(-14), end: day(0) }, results };
}

const configured = name => Boolean(String(process.env[name] || "").trim());
const configStatus = () => ({
  status: "ok",
  googleAdsApi: {
    developerToken: configured("GOOGLE_ADS_DEVELOPER_TOKEN"),
    clientId: configured("GOOGLE_ADS_CLIENT_ID"),
    clientSecret: configured("GOOGLE_ADS_CLIENT_SECRET"),
    refreshToken: configured("GOOGLE_ADS_REFRESH_TOKEN"),
    loginCustomerId: configured("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    customerIds: configured("GOOGLE_ADS_CUSTOMER_IDS")
  },
  googleAdsScript: { secret: configured("GOOGLE_ADS_SCRIPT_SECRET") },
  supabase: {
    url: configured("SUPABASE_URL"),
    anonKey: configured("SUPABASE_ANON_KEY"),
    serviceRoleKey: configured("SUPABASE_SERVICE_ROLE_KEY"),
    appUserId: configured("APP_USER_ID")
  },
  sync: { secret: configured("SYNC_SECRET") }
});

const apiError = (message, statusCode) => Object.assign(new Error(message), { statusCode });
const enc = value => encodeURIComponent(String(value));

async function authenticate(req) {
  const token = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw apiError("Sessão não informada", 401);
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) throw apiError("SUPABASE_ANON_KEY não configurada", 500);
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` }
  });
  if (!response.ok) throw apiError("Sessão inválida ou expirada", 401);
  const user = await response.json();
  if (!user?.id || user.id !== process.env.APP_USER_ID) throw apiError("Usuário sem acesso ao AdsPilot", 403);
  return user;
}

async function sbAll(route) {
  const output = [];
  for (let offset = 0; ; offset += 1000) {
    const rows = await sb(route, { headers: { Range: `${offset}-${offset + 999}` } });
    output.push(...(rows || []));
    if (!rows || rows.length < 1000) break;
  }
  return output;
}

const validDateOr = (value, fallback) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : fallback;
const campaignKey = row => `${row.customer_id}:${row.campaign_id}`;
const sumRows = rows => rows.reduce((total, row) => ({
  impressions: total.impressions + number(row.impressions),
  clicks: total.clicks + number(row.clicks),
  cost: total.cost + number(row.cost_micros) / 1e6,
  conversions: total.conversions + number(row.conversions),
  revenue: total.revenue + number(row.conversion_value)
}), { impressions: 0, clicks: 0, cost: 0, conversions: 0, revenue: 0 });

const manualMetrics = rows => rows.reduce((total, row) => ({
  page_visits: total.page_visits + number(row.page_visits),
  vsl_clicks: total.vsl_clicks + number(row.vsl_clicks),
  vsl_checkouts: total.vsl_checkouts + number(row.vsl_checkouts),
  general_checkouts: total.general_checkouts + number(row.general_checkouts),
  sales: total.sales + number(row.sales),
  revenue: total.revenue + number(row.revenue),
  refunds: total.refunds + number(row.refunds)
}), { page_visits: 0, vsl_clicks: 0, vsl_checkouts: 0, general_checkouts: 0, sales: 0, revenue: 0, refunds: 0 });

const mergeDaily = (googleRows, manualRows) => {
  const manual = new Map(manualRows.map(row => [row.report_date, row]));
  const dates = [...new Set([...googleRows.map(row => row.report_date), ...manualRows.map(row => row.report_date)])].sort().reverse();
  return dates.map(reportDate => {
    const google = googleRows.find(row => row.report_date === reportDate) || { report_date: reportDate };
    const extra = manual.get(reportDate);
    return {
      ...google,
      manual: extra || null,
      page_visits: number(extra?.page_visits), vsl_clicks: number(extra?.vsl_clicks),
      vsl_checkouts: number(extra?.vsl_checkouts), general_checkouts: number(extra?.general_checkouts),
      refunds: number(extra?.refunds),
      conversions: extra ? number(extra.sales) : number(google.conversions),
      conversion_value: extra ? number(extra.revenue) - number(extra.refunds) : number(google.conversion_value),
      data_origin: extra ? (google.campaign_id ? "manual+script" : "manual") : "script"
    };
  });
};

async function getDashboard(url) {
  const userId = process.env.APP_USER_ID;
  const to = validDateOr(url.searchParams.get("to"), day(0));
  const from = validDateOr(url.searchParams.get("from"), day(-29));
  const settings = await sbAll(`campaign_settings?user_id=eq.${enc(userId)}&select=*`);
  const starts = settings.map(item => item.test_start_date).filter(Boolean).sort();
  const fetchFrom = starts.length && starts[0] < from ? starts[0] : from;
  const [rows, manualRows] = await Promise.all([
    sbAll(`google_ads_campaign_daily?user_id=eq.${enc(userId)}&report_date=gte.${fetchFrom}&report_date=lte.${to}&order=report_date.asc&select=*`),
    sbAll(`campaign_manual_daily?user_id=eq.${enc(userId)}&report_date=gte.${fetchFrom}&report_date=lte.${to}&select=*`)
  ]);
  const periodRows = rows.filter(row => row.report_date >= from && row.report_date <= to);
  const currencies = [...new Set(periodRows.map(row => row.currency_code).filter(Boolean))].sort();
  const requestedCurrency = url.searchParams.get("currency");
  const currency = currencies.includes(requestedCurrency) ? requestedCurrency : currencies[0] || "USD";
  const currencyRows = periodRows.filter(row => (row.currency_code || "USD") === currency);
  const settingsMap = new Map(settings.map(item => [`${item.customer_id}:${item.campaign_id}`, item]));
  const groups = new Map();
  for (const row of currencyRows) {
    const key = campaignKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const campaigns = [...groups.entries()].map(([key, campaignRows]) => {
    const latest = [...campaignRows].sort((a, b) => b.report_date.localeCompare(a.report_date))[0];
    const metrics = sumRows(campaignRows);
    const manual = manualMetrics(manualRows.filter(row => campaignKey(row) === key && row.report_date >= from));
    if (manual.sales || manual.revenue || manual.refunds) { metrics.conversions = manual.sales; metrics.revenue = manual.revenue - manual.refunds; }
    const setting = settingsMap.get(key) || null;
    const testRows = setting?.test_start_date
      ? rows.filter(row => campaignKey(row) === key && row.report_date >= setting.test_start_date && row.report_date <= to)
      : campaignRows;
    const testCost = sumRows(testRows).cost;
    const commission = number(setting?.commission_value);
    const consumedPercent = commission > 0 ? testCost / commission * 100 : null;
    const limitAmount = commission > 0 ? commission * number(setting?.test_limit_percent || 75) / 100 : null;
    return {
      customer_id: latest.customer_id,
      campaign_id: latest.campaign_id,
      account_name: latest.account_name,
      campaign_name: latest.campaign_name,
      status: latest.campaign_status,
      channel_type: latest.channel_type,
      currency_code: latest.currency_code,
      ...metrics,
      ctr: metrics.impressions ? metrics.clicks / metrics.impressions : 0,
      cpc: metrics.clicks ? metrics.cost / metrics.clicks : 0,
      cpa: metrics.conversions ? metrics.cost / metrics.conversions : null,
      profit: metrics.revenue - metrics.cost,
      roi: metrics.cost ? (metrics.revenue - metrics.cost) / metrics.cost * 100 : 0,
      setting,
      test: setting ? {
        cost: testCost,
        commission,
        consumed_percent: consumedPercent,
        limit_amount: limitAmount,
        remaining_to_limit: limitAmount == null ? null : limitAmount - testCost
      } : null
    };
  }).sort((a, b) => b.cost - a.cost);
  const syncRuns = await sbAll(`google_ads_sync_runs?user_id=eq.${enc(userId)}&status=in.(success,partial)&order=finished_at.desc&limit=1&select=finished_at,status,source,metadata`);
  const daily = [...new Set(currencyRows.map(row => row.report_date))].sort().map(report_date => ({ report_date, ...sumRows(currencyRows.filter(row => row.report_date === report_date)) }));
  return {
    period: { from, to },
    currency,
    currencies,
    accounts: [...new Set(campaigns.map(item => item.account_name).filter(Boolean))].sort(),
    campaigns,
    daily,
    summary: sumRows(currencyRows),
    last_sync: syncRuns[0] || null
  };
}

async function getCampaignDetail(url) {
  const userId = process.env.APP_USER_ID;
  const customerId = cleanId(url.searchParams.get("customer_id"));
  const campaignId = cleanId(url.searchParams.get("campaign_id"));
  if (!customerId || !campaignId) throw apiError("Conta e campanha são obrigatórias", 400);
  const to = validDateOr(url.searchParams.get("to"), day(0));
  const from = validDateOr(url.searchParams.get("from"), day(-29));
  const base = `user_id=eq.${enc(userId)}&customer_id=eq.${enc(customerId)}&campaign_id=eq.${enc(campaignId)}`;
  const settings = await sbAll(`campaign_settings?${base}&select=*`);
  const setting = settings[0] || null;
  const [googleDaily, manualDaily, searchTerms, segments, changes, notes, strategies] = await Promise.all([
    sbAll(`google_ads_campaign_daily?${base}&report_date=gte.${from}&report_date=lte.${to}&order=report_date.asc&select=*`),
    sbAll(`campaign_manual_daily?${base}&report_date=gte.${from}&report_date=lte.${to}&order=report_date.desc&select=*`),
    sbAll(`google_ads_search_terms_daily?${base}&report_date=gte.${from}&report_date=lte.${to}&order=cost_micros.desc&select=*`),
    sbAll(`google_ads_segments_daily?${base}&report_date=gte.${from}&report_date=lte.${to}&order=cost_micros.desc&select=*`),
    sbAll(`google_ads_change_events?${base}&change_date_time=gte.${from}T00%3A00%3A00Z&change_date_time=lte.${to}T23%3A59%3A59Z&order=change_date_time.desc&select=*`),
    sbAll(`campaign_notes?${base}&order=note_date.desc,created_at.desc&select=*`),
    sbAll(`campaign_strategies?${base}&select=*`)
  ]);
  const daily = mergeDaily(googleDaily, manualDaily);
  const testDaily = setting?.test_start_date && setting.test_start_date < from
    ? await sbAll(`google_ads_campaign_daily?${base}&report_date=gte.${setting.test_start_date}&report_date=lte.${to}&select=cost_micros,conversions,conversion_value`)
    : daily.filter(row => !setting?.test_start_date || row.report_date >= setting.test_start_date);
  return { customer_id: customerId, campaign_id: campaignId, period: { from, to }, daily, search_terms: searchTerms, segments, changes, notes, setting, strategy: strategies[0] || null, test_metrics: sumRows(testDaily) };
}

async function saveCampaignSetting(data) {
  const customerId = cleanId(data.customer_id);
  const campaignId = cleanId(data.campaign_id);
  const commission = data.commission_value === "" || data.commission_value == null ? null : number(data.commission_value);
  const limit = number(data.test_limit_percent || 75);
  if (!customerId || !campaignId) throw apiError("Conta e campanha são obrigatórias", 400);
  if (commission != null && commission <= 0) throw apiError("A comissão deve ser maior que zero", 400);
  if (limit <= 0 || limit > 500) throw apiError("O limite deve ficar entre 0 e 500%", 400);
  const row = {
    user_id: process.env.APP_USER_ID,
    customer_id: customerId,
    campaign_id: campaignId,
    campaign_type: data.campaign_type === "test" ? "test" : "main",
    commission_value: commission,
    test_limit_percent: limit,
    test_start_date: isoDate(data.test_start_date),
    currency_code: text(data.currency_code, 10),
    active: data.active !== false,
    updated_at: new Date().toISOString()
  };
  const result = await sb("campaign_settings?on_conflict=user_id,customer_id,campaign_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row)
  });
  return result?.[0] || row;
}

async function savePreference(data) {
  const row = { user_id: process.env.APP_USER_ID, theme: data.theme === "light" ? "light" : "dark", display_currency: ["USD","BRL","EUR"].includes(data.display_currency) ? data.display_currency : "USD", visible_columns: data.visible_columns && typeof data.visible_columns === "object" ? data.visible_columns : {}, updated_at: new Date().toISOString() };
  const result = await sb("user_dashboard_preferences?on_conflict=user_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
  return result?.[0] || row;
}

async function saveStrategy(data) {
  const customerId = cleanId(data.customer_id), campaignId = cleanId(data.campaign_id);
  if (!customerId || !campaignId) throw apiError("Conta e campanha são obrigatórias", 400);
  const row = { user_id: process.env.APP_USER_ID, customer_id: customerId, campaign_id: campaignId, content: text(data.content || "", 20000), updated_at: new Date().toISOString() };
  const result = await sb("campaign_strategies?on_conflict=user_id,customer_id,campaign_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
  return result?.[0] || row;
}

async function saveManualDaily(data) {
  const customerId = cleanId(data.customer_id), campaignId = cleanId(data.campaign_id), reportDate = isoDate(data.report_date);
  if (!customerId || !campaignId || !reportDate) throw apiError("Conta, campanha e data são obrigatórias", 400);
  const fields = ["page_visits","vsl_clicks","vsl_checkouts","general_checkouts","sales","revenue","refunds"];
  for (const field of fields) if (number(data[field]) < 0) throw apiError("Os valores não podem ser negativos", 400);
  const row = { user_id: process.env.APP_USER_ID, customer_id: customerId, campaign_id: campaignId, report_date: reportDate, currency_code: ["USD","BRL","EUR"].includes(data.currency_code) ? data.currency_code : "USD", ...Object.fromEntries(fields.map(field => [field, number(data[field])])), observation: text(data.observation, 3000), source: "manual", updated_at: new Date().toISOString() };
  const result = await sb("campaign_manual_daily?on_conflict=user_id,customer_id,campaign_id,report_date", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(row) });
  await sb("campaign_notes", { method: "POST", body: JSON.stringify({ user_id: process.env.APP_USER_ID, customer_id: customerId, campaign_id: campaignId, note_date: reportDate, category: "quick_entry", title: "Lançamento rápido", content: `Dados manuais atualizados: ${number(data.sales)} venda(s), receita ${number(data.revenue)} ${row.currency_code}.` }) });
  return result?.[0] || row;
}

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json"
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json(res, 200, { status: "ok", app: "AdsPilot Analytics", version: "2.1.0", mode: process.env.SUPABASE_URL ? "configured" : "demo" });
    }
    if (url.pathname === "/api/config/status" && req.method === "GET") {
      return json(res, 200, configStatus());
    }
    if (url.pathname === "/api/public-config" && req.method === "GET") {
      if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) throw apiError("Autenticação não configurada", 503);
      return json(res, 200, { supabaseUrl: process.env.SUPABASE_URL, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
    }
    if (url.pathname === "/api/webhook/google-ads" && req.method === "POST") {
      if (!secureEqual(req.headers["x-adspilot-secret"], process.env.GOOGLE_ADS_SCRIPT_SECRET)) {
        return json(res, 401, { error: "Não autorizado" });
      }
      return json(res, 200, await ingestGoogleAdsScript(await readJsonBody(req)));
    }
    if (url.pathname === "/api/sync/google-ads" && req.method === "POST") {
      if (!secureEqual(req.headers["x-sync-secret"], process.env.SYNC_SECRET)) {
        return json(res, 401, { error: "Não autorizado" });
      }
      return json(res, 200, await syncApi());
    }
    if (url.pathname === "/api/v2/dashboard" && req.method === "GET") {
      await authenticate(req);
      return json(res, 200, await getDashboard(url));
    }
    if (url.pathname === "/api/v2/preferences" && req.method === "GET") {
      await authenticate(req);
      const rows = await sbAll(`user_dashboard_preferences?user_id=eq.${enc(process.env.APP_USER_ID)}&select=*`);
      return json(res, 200, rows[0] || { theme: "dark", display_currency: "USD", visible_columns: {} });
    }
    if (url.pathname === "/api/v2/preferences" && (req.method === "PUT" || req.method === "POST")) {
      await authenticate(req); return json(res, 200, await savePreference(await readJsonBody(req)));
    }
    if (url.pathname === "/api/v2/campaign" && req.method === "GET") {
      await authenticate(req);
      return json(res, 200, await getCampaignDetail(url));
    }
    if (url.pathname === "/api/v2/campaign-settings" && (req.method === "PUT" || req.method === "POST")) {
      await authenticate(req);
      return json(res, 200, await saveCampaignSetting(await readJsonBody(req)));
    }
    if (url.pathname === "/api/v2/strategy" && (req.method === "PUT" || req.method === "POST")) {
      await authenticate(req); return json(res, 200, await saveStrategy(await readJsonBody(req)));
    }
    if (url.pathname === "/api/v2/manual-daily" && (req.method === "PUT" || req.method === "POST")) {
      await authenticate(req); return json(res, 200, await saveManualDaily(await readJsonBody(req)));
    }
    if (url.pathname === "/api/v2/notes" && req.method === "POST") {
      await authenticate(req);
      const data = await readJsonBody(req);
      if (!data.content || !cleanId(data.campaign_id) || !cleanId(data.customer_id)) throw apiError("Dados da nota incompletos", 400);
      const result = await sb("campaign_notes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          user_id: process.env.APP_USER_ID,
          customer_id: cleanId(data.customer_id),
          campaign_id: cleanId(data.campaign_id),
          note_date: isoDate(data.note_date) || day(0),
          category: text(data.category || "observation", 50),
          title: text(data.title, 200),
          content: text(data.content, 5000)
        })
      });
      return json(res, 201, result?.[0] || result);
    }
    if (url.pathname === "/api/notes" && req.method === "POST") {
      await authenticate(req);
      const data = await readJsonBody(req);
      if (!data.content || !data.campaign_id) return json(res, 400, { error: "Dados ausentes" });
      return json(res, 201, await sb("campaign_notes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...data, user_id: process.env.APP_USER_ID })
      }));
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Rota de API não encontrada" });

    let file = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
    try {
      const stat = await fs.stat(file);
      if (stat.isDirectory()) file = path.join(file, "index.html");
    } catch {
      file = path.join(root, "index.html");
    }
    const data = await fs.readFile(file);
    res.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    console.error(error);
    json(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Erro interno" });
  }
}).listen(port, "0.0.0.0", () => console.log(`AdsPilot v2.1.0 on ${port}`));
