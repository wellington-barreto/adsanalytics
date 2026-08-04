/**
 * AdsPilot Hourly V2.3 — coleta leve por hora
 * Atualiza somente as metricas acumuladas do dia atual.
 * Funciona em conta individual ou MCC e nao altera o Google Ads.
 */

var CONFIG = {
  WEBHOOK_URL: "https://adsanalytics.up.railway.app/api/webhook/google-ads",
  WEBHOOK_SECRET: "COLE_AQUI_O_MESMO_GOOGLE_ADS_SCRIPT_SECRET_DO_RAILWAY",
  API_VERSION: "v25",
  MCC_ACCOUNT_LIMIT: 50,
  MAX_WEBHOOK_RETRIES: 4
};

function main() {
  validateConfig_(CONFIG);
  if (typeof AdsManagerApp !== "undefined") {
    Logger.log("AdsPilot Hourly: modo MCC");
    AdsManagerApp.accounts()
      .withLimit(CONFIG.MCC_ACCOUNT_LIMIT)
      .executeInParallel("processManagedAccount", "allAccountsFinished", JSON.stringify(CONFIG));
    return;
  }
  Logger.log("AdsPilot Hourly: modo conta individual");
  Logger.log(JSON.stringify(collectAndSend_(CONFIG)));
}

function processManagedAccount(configJson) {
  var config = JSON.parse(configJson);
  var customerId = AdsApp.currentAccount().getCustomerId();
  try {
    return JSON.stringify(collectAndSend_(config));
  } catch (error) {
    Logger.log("AdsPilot Hourly erro na conta " + customerId + ": " + error.message);
    return JSON.stringify({ status: "error", customer_id: customerId, error: error.message });
  }
}

function allAccountsFinished(results) {
  var success = 0;
  var partial = 0;
  var errors = 0;
  for (var i = 0; i < results.length; i++) {
    var result = results[i];
    var parsed = null;
    try { parsed = JSON.parse(result.getReturnValue() || "{}"); } catch (ignore) {}
    if (result.getStatus() !== "OK" || !parsed || parsed.status === "error") errors++;
    else if (parsed.status === "partial") partial++;
    else success++;
    Logger.log("Conta " + result.getCustomerId() + ": " + result.getStatus() + " " + (result.getError() || result.getReturnValue() || ""));
  }
  Logger.log("AdsPilot Hourly finalizado. Sucesso: " + success + ", parciais: " + partial + ", erros: " + errors);
}

function collectAndSend_(config) {
  var account = AdsApp.currentAccount();
  var customerId = account.getCustomerId();
  var today = Utilities.formatDate(new Date(), account.getTimeZone(), "yyyy-MM-dd");
  var query = "SELECT segments.date, campaign.id, campaign.name, campaign.status, " +
    "campaign.advertising_channel_type, campaign.bidding_strategy_type, " +
    "campaign_budget.amount_micros, campaign.target_cpa.target_cpa_micros, " +
    "campaign.target_roas.target_roas, campaign.maximize_conversions.target_cpa_micros, " +
    "metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.average_target_cpa_micros, " +
    "metrics.cost_micros, metrics.conversions, metrics.conversions_value, " +
    "metrics.search_impression_share, metrics.search_top_impression_share, " +
    "metrics.search_absolute_top_impression_share " +
    "FROM campaign WHERE segments.date = '" + today + "' AND metrics.impressions > 0";

  var iterator = AdsApp.search(query, { apiVersion: config.API_VERSION });
  var campaigns = [];
  while (iterator.hasNext()) campaigns.push(mapCampaign_(iterator.next()));

  var payload = {
    schema_version: "1.2",
    script_name: "AdsPilot Hourly V2.3",
    started_at: new Date().toISOString(),
    account: {
      customer_id: customerId,
      account_name: account.getName(),
      currency_code: account.getCurrencyCode(),
      timezone: account.getTimeZone()
    },
    campaign_daily: campaigns,
    search_terms: [],
    segments: [],
    change_events: [],
    query_errors: []
  };

  var response = sendWithRetry_(config, payload, customerId);
  Logger.log("AdsPilot Hourly sincronizado: " + JSON.stringify(response));
  return response;
}

function mapCampaign_(row) {
  var targetCpa = value_(row.campaign.maximizeConversions && row.campaign.maximizeConversions.targetCpaMicros);
  if (!targetCpa) targetCpa = value_(row.campaign.targetCpa && row.campaign.targetCpa.targetCpaMicros);
  var desiredCpa = value_(row.metrics.averageTargetCpaMicros) || targetCpa;
  return {
    report_date: row.segments.date,
    campaign_id: String(row.campaign.id),
    campaign_name: row.campaign.name,
    campaign_status: row.campaign.status,
    channel_type: row.campaign.advertisingChannelType,
    bidding_strategy_type: row.campaign.biddingStrategyType,
    budget_micros: value_(row.campaignBudget.amountMicros),
    target_cpa_micros: targetCpa,
    desired_cpa_micros: desiredCpa,
    desired_cpa_is_average: false,
    desired_cpa_min_micros: desiredCpa,
    desired_cpa_max_micros: desiredCpa,
    desired_cpa_group_count: 0,
    target_roas: value_(row.campaign.targetRoas && row.campaign.targetRoas.targetRoas),
    impressions: value_(row.metrics.impressions),
    clicks: value_(row.metrics.clicks),
    ctr: value_(row.metrics.ctr),
    average_cpc_micros: value_(row.metrics.averageCpc),
    cost_micros: value_(row.metrics.costMicros),
    conversions: value_(row.metrics.conversions),
    conversion_value: value_(row.metrics.conversionsValue),
    search_impression_share: value_(row.metrics.searchImpressionShare),
    search_top_impression_share: value_(row.metrics.searchTopImpressionShare),
    search_absolute_top_impression_share: value_(row.metrics.searchAbsoluteTopImpressionShare)
  };
}

function sendWithRetry_(config, payload, customerId) {
  var attempts = Math.max(1, Number(config.MAX_WEBHOOK_RETRIES || 4));
  var lastError = null;
  var serialized = JSON.stringify(payload);
  for (var attempt = 1; attempt <= attempts; attempt++) {
    try {
      var response = UrlFetchApp.fetch(config.WEBHOOK_URL, {
        method: "post",
        contentType: "application/json",
        headers: { "x-adspilot-secret": config.WEBHOOK_SECRET },
        payload: serialized,
        muteHttpExceptions: true
      });
      var code = response.getResponseCode();
      var body = response.getContentText();
      if (code >= 200 && code < 300) return JSON.parse(body);
      lastError = new Error("Webhook HTTP " + code + ": " + body.slice(0, 1000));
      if (code !== 429 && code < 500) throw lastError;
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      var delay = Math.min(15000, Math.pow(2, attempt - 1) * 1500) + Math.floor(Math.random() * 2000);
      Logger.log("Conta " + customerId + ": tentativa " + attempt + " falhou; repetindo em " + delay + " ms. " + lastError.message);
      Utilities.sleep(delay);
    }
  }
  throw new Error("Conta " + customerId + ": webhook falhou apos " + attempts + " tentativas. " + (lastError ? lastError.message : "Erro desconhecido"));
}

function value_(value) {
  var number = Number(value || 0);
  return isFinite(number) ? number : 0;
}

function validateConfig_(config) {
  if (!/^https:\/\//.test(config.WEBHOOK_URL)) throw new Error("WEBHOOK_URL deve usar HTTPS");
  if (!config.WEBHOOK_SECRET || config.WEBHOOK_SECRET.indexOf("COLE_AQUI") !== -1 || config.WEBHOOK_SECRET.length < 24) {
    throw new Error("Configure WEBHOOK_SECRET com a mesma chave do Railway");
  }
}
