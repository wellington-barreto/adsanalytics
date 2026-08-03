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

    const counts = {
      campaignRows: await chunkedUpsert("google_ads_campaign_daily", "user_id,customer_id,campaign_id,report_date", campaigns),
      searchTermRows: await chunkedUpsert("google_ads_search_terms_daily", "user_id,customer_id,campaign_id,report_date,search_term", searchTerms),
      segmentRows: await chunkedUpsert("google_ads_segments_daily", "user_id,customer_id,campaign_id,report_date,segment_type,segment_value", segments),
      changeEventRows: await chunkedUpsert("google_ads_change_events", "resource_name", events)
    };

    if (runId) await sb(`google_ads_sync_runs?id=eq.${runId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "success",
        finished_at: new Date().toISOString(),
        campaign_rows: counts.campaignRows,
        search_term_rows: counts.searchTermRows,
        segment_rows: counts.segmentRows,
        change_event_rows: counts.changeEventRows
      })
    });
    return { status: "ok", customer_id: customerId, ...counts };
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
    serviceRoleKey: configured("SUPABASE_SERVICE_ROLE_KEY"),
    appUserId: configured("APP_USER_ID")
  },
  sync: { secret: configured("SYNC_SECRET") }
});

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
      return json(res, 200, { status: "ok", app: "AdsPilot Analytics", version: "1.2", mode: process.env.SUPABASE_URL ? "configured" : "demo" });
    }
    if (url.pathname === "/api/config/status" && req.method === "GET") {
      return json(res, 200, configStatus());
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
    if (url.pathname === "/api/notes" && req.method === "POST") {
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
}).listen(port, "0.0.0.0", () => console.log(`AdsPilot v1.2 on ${port}`));

