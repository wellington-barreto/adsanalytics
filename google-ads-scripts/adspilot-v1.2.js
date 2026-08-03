/**
 * AdsPilot Analytics V1.2.1
 * Funciona em conta individual ou MCC.
 * Somente leitura: nao cria nem altera campanhas, anuncios, palavras ou lances.
 */

var CONFIG = {
  WEBHOOK_URL: "https://adsanalytics.up.railway.app/api/webhook/google-ads",
  WEBHOOK_SECRET: "COLE_AQUI_O_MESMO_GOOGLE_ADS_SCRIPT_SECRET_DO_RAILWAY",
  LOOKBACK_DAYS: 3,
  // Para carga historica, preencha as duas datas com uma janela de no maximo 7 dias.
  // Na rotina diaria, mantenha ambas vazias.
  HISTORICAL_START_DATE: "",
  HISTORICAL_END_DATE: "",
  API_VERSION: "v25",
  MCC_ACCOUNT_LIMIT: 50,
  MAX_SEARCH_TERMS: 5000,
  MAX_CHANGE_EVENTS: 5000,
  MAX_WEBHOOK_RETRIES: 4
};

function main() {
  validateConfig_(CONFIG);
  if (typeof AdsManagerApp !== "undefined") {
    Logger.log("AdsPilot: modo MCC");
    AdsManagerApp.accounts()
      .withLimit(CONFIG.MCC_ACCOUNT_LIMIT)
      .executeInParallel("processManagedAccount", "allAccountsFinished", JSON.stringify(CONFIG));
    return;
  }
  Logger.log("AdsPilot: modo conta individual");
  var result = collectAndSend_(CONFIG);
  Logger.log(JSON.stringify(result));
}

function processManagedAccount(configJson) {
  var config = JSON.parse(configJson);
  try {
    return JSON.stringify(collectAndSend_(config));
  } catch (error) {
    var customerId = AdsApp.currentAccount().getCustomerId();
    Logger.log("AdsPilot erro na conta " + customerId + ": " + error.message);
    return JSON.stringify({ status: "error", customer_id: customerId, error: error.message });
  }
}

function allAccountsFinished(results) {
  var success = 0;
  var errors = 0;
  for (var i = 0; i < results.length; i++) {
    if (results[i].getStatus() === "OK") success++;
    else errors++;
    Logger.log("Conta " + results[i].getCustomerId() + ": " + results[i].getStatus() + " " + (results[i].getError() || results[i].getReturnValue() || ""));
  }
  Logger.log("AdsPilot MCC finalizado. Sucesso: " + success + ", erros: " + errors);
}

function collectAndSend_(config) {
  var startedAt = new Date().toISOString();
  var account = AdsApp.currentAccount();
  var dates = dateRange_(account.getTimeZone(), config);
  var errors = [];
  var campaigns = safeQuery_(campaignQuery_(dates.start, dates.end), config, "campanhas", errors);
  var searchTerms = safeQuery_(searchTermsQuery_(dates.start, dates.end, config.MAX_SEARCH_TERMS), config, "termos", errors);
  var devices = safeQuery_(deviceQuery_(dates.start, dates.end), config, "dispositivos", errors);
  var ages = safeQuery_(ageQuery_(dates.start, dates.end), config, "idades", errors);
  var genders = safeQuery_(genderQuery_(dates.start, dates.end), config, "generos", errors);
  var incomes = safeQuery_(incomeQuery_(dates.start, dates.end), config, "rendas", errors);
  var locations = safeQuery_(locationQuery_(dates.start, dates.end), config, "locais", errors);
  var changes = safeQuery_(changeQuery_(dates.start, dates.end, config.MAX_CHANGE_EVENTS), config, "alteracoes", errors);

  var payload = {
    schema_version: "1.2",
    script_name: "AdsPilot Google Ads Script V1.2.1",
    started_at: startedAt,
    account: {
      customer_id: account.getCustomerId(),
      account_name: account.getName(),
      currency_code: account.getCurrencyCode(),
      timezone: account.getTimeZone()
    },
    campaign_daily: mapCampaigns_(campaigns),
    search_terms: aggregateSearchTerms_(mapSearchTerms_(searchTerms)),
    segments: mapSegments_(devices, ages, genders, incomes, locations),
    change_events: mapChanges_(changes),
    query_errors: errors
  };

  var parsed = sendWithRetry_(config, payload, account.getCustomerId());
  var body = JSON.stringify(parsed);
  Logger.log("AdsPilot sincronizado: " + body);
  return parsed;
}

function sendWithRetry_(config, payload, customerId) {
  var attempts = Math.max(1, Number(config.MAX_WEBHOOK_RETRIES || 4));
  var lastError = null;
  for (var attempt = 1; attempt <= attempts; attempt++) {
    try {
      var response = UrlFetchApp.fetch(config.WEBHOOK_URL, {
        method: "post",
        contentType: "application/json",
        headers: { "x-adspilot-secret": config.WEBHOOK_SECRET },
        payload: JSON.stringify(payload),
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
      Logger.log("Conta " + customerId + ": webhook falhou na tentativa " + attempt + ". Nova tentativa em " + delay + " ms. Erro: " + lastError.message);
      Utilities.sleep(delay);
    }
  }
  throw new Error("Conta " + customerId + ": webhook falhou apos " + attempts + " tentativas. Ultimo erro: " + (lastError ? lastError.message : "desconhecido"));
}

function safeQuery_(query, config, label, errors) {
  var rows = [];
  try {
    var iterator = AdsApp.search(query, { apiVersion: config.API_VERSION });
    while (iterator.hasNext()) rows.push(iterator.next());
  } catch (error) {
    errors.push({ query: label, error: error.message });
    Logger.log("Consulta " + label + " falhou: " + error.message);
  }
  return rows;
}

function campaignQuery_(start, end) {
  return "SELECT segments.date, campaign.id, campaign.name, campaign.status, " +
    "campaign.advertising_channel_type, campaign.bidding_strategy_type, " +
    "campaign_budget.amount_micros, campaign.target_cpa.target_cpa_micros, " +
    "campaign.target_roas.target_roas, campaign.maximize_conversions.target_cpa_micros, " +
    "metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, " +
    "metrics.cost_micros, metrics.conversions, metrics.conversions_value, " +
    "metrics.search_impression_share, metrics.search_top_impression_share, " +
    "metrics.search_absolute_top_impression_share " +
    "FROM campaign WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' " +
    "AND metrics.impressions > 0";
}

function searchTermsQuery_(start, end, limit) {
  return "SELECT segments.date, campaign.id, search_term_view.search_term, " +
    "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value " +
    "FROM search_term_view WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' " +
    "AND metrics.impressions > 0 ORDER BY metrics.impressions DESC LIMIT " + limit;
}

function deviceQuery_(start, end) {
  return "SELECT segments.date, campaign.id, segments.device, metrics.impressions, metrics.clicks, " +
    "metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign " +
    "WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' AND metrics.impressions > 0";
}

function ageQuery_(start, end) {
  return "SELECT segments.date, campaign.id, ad_group_criterion.age_range.type, metrics.impressions, " +
    "metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value " +
    "FROM age_range_view WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' AND metrics.impressions > 0";
}

function genderQuery_(start, end) {
  return "SELECT segments.date, campaign.id, ad_group_criterion.gender.type, metrics.impressions, " +
    "metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value " +
    "FROM gender_view WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' AND metrics.impressions > 0";
}

function incomeQuery_(start, end) {
  return "SELECT segments.date, campaign.id, ad_group_criterion.income_range.type, metrics.impressions, " +
    "metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value " +
    "FROM income_range_view WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' AND metrics.impressions > 0";
}

function locationQuery_(start, end) {
  return "SELECT segments.date, campaign.id, geographic_view.country_criterion_id, geographic_view.location_type, " +
    "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value " +
    "FROM geographic_view WHERE segments.date BETWEEN '" + start + "' AND '" + end + "' AND metrics.impressions > 0";
}

function changeQuery_(start, end, limit) {
  var endExclusive = addDays_(end, 1);
  return "SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_name, " +
    "change_event.user_email, change_event.client_type, change_event.change_resource_type, " +
    "change_event.resource_change_operation, change_event.changed_fields " +
    "FROM change_event WHERE change_event.change_date_time >= '" + start + " 00:00:00' " +
    "AND change_event.change_date_time < '" + endExclusive + " 00:00:00' " +
    "ORDER BY change_event.change_date_time DESC LIMIT " + limit;
}

function mapCampaigns_(rows) {
  var output = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var targetCpa = value_(row.campaign.maximizeConversions && row.campaign.maximizeConversions.targetCpaMicros);
    if (!targetCpa) targetCpa = value_(row.campaign.targetCpa && row.campaign.targetCpa.targetCpaMicros);
    output.push({
      report_date: row.segments.date,
      campaign_id: String(row.campaign.id),
      campaign_name: row.campaign.name,
      campaign_status: row.campaign.status,
      channel_type: row.campaign.advertisingChannelType,
      bidding_strategy_type: row.campaign.biddingStrategyType,
      budget_micros: value_(row.campaignBudget.amountMicros),
      target_cpa_micros: targetCpa,
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
    });
  }
  return output;
}

function mapSearchTerms_(rows) {
  var output = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    output.push({
      report_date: row.segments.date,
      campaign_id: String(row.campaign.id),
      search_term: row.searchTermView.searchTerm,
      impressions: value_(row.metrics.impressions),
      clicks: value_(row.metrics.clicks),
      cost_micros: value_(row.metrics.costMicros),
      conversions: value_(row.metrics.conversions),
      conversion_value: value_(row.metrics.conversionsValue)
    });
  }
  return output;
}

function aggregateSearchTerms_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = [row.report_date, row.campaign_id, row.search_term].join("|");
    if (!map[key]) map[key] = row;
    else {
      map[key].impressions += row.impressions;
      map[key].clicks += row.clicks;
      map[key].cost_micros += row.cost_micros;
      map[key].conversions += row.conversions;
      map[key].conversion_value += row.conversion_value;
    }
  }
  var output = [];
  for (var key in map) if (map.hasOwnProperty(key)) output.push(map[key]);
  return output;
}

function mapSegments_(devices, ages, genders, incomes, locations) {
  var output = [];
  appendSegmentRows_(output, devices, "device", function(row) { return row.segments.device; });
  appendSegmentRows_(output, ages, "age", function(row) { return row.adGroupCriterion.ageRange.type; });
  appendSegmentRows_(output, genders, "gender", function(row) { return row.adGroupCriterion.gender.type; });
  appendSegmentRows_(output, incomes, "income", function(row) { return row.adGroupCriterion.incomeRange.type; });
  appendSegmentRows_(output, locations, "country", function(row) { return String(row.geographicView.countryCriterionId); });
  return aggregateSegments_(output);
}

function appendSegmentRows_(target, rows, type, getValue) {
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    target.push({
      report_date: row.segments.date,
      campaign_id: String(row.campaign.id),
      segment_type: type,
      segment_value: getValue(row),
      impressions: value_(row.metrics.impressions),
      clicks: value_(row.metrics.clicks),
      cost_micros: value_(row.metrics.costMicros),
      conversions: value_(row.metrics.conversions),
      conversion_value: value_(row.metrics.conversionsValue)
    });
  }
}

function aggregateSegments_(rows) {
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = [row.report_date, row.campaign_id, row.segment_type, row.segment_value].join("|");
    if (!map[key]) map[key] = row;
    else {
      map[key].impressions += row.impressions;
      map[key].clicks += row.clicks;
      map[key].cost_micros += row.cost_micros;
      map[key].conversions += row.conversions;
      map[key].conversion_value += row.conversion_value;
    }
  }
  var output = [];
  for (var key in map) if (map.hasOwnProperty(key)) output.push(map[key]);
  return output;
}

function mapChanges_(rows) {
  var output = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var event = row.changeEvent;
    var resource = event.changeResourceName || "";
    var match = resource.match(/campaigns\/(\d+)/);
    var fields = event.changedFields && event.changedFields.paths ? event.changedFields.paths : [];
    output.push({
      resource_name: event.resourceName,
      campaign_id: match ? match[1] : null,
      change_date_time: normalizeDateTime_(event.changeDateTime),
      change_resource_name: resource,
      change_resource_type: event.changeResourceType,
      operation: event.resourceChangeOperation,
      client_type: event.clientType,
      user_email: event.userEmail,
      changed_fields: fields,
      summary: (event.changeResourceType || "Recurso") + ": " + (event.resourceChangeOperation || "alterado")
    });
  }
  return output;
}

function dateRange_(timezone, config) {
  if (config.HISTORICAL_START_DATE && config.HISTORICAL_END_DATE) {
    return { start: config.HISTORICAL_START_DATE, end: config.HISTORICAL_END_DATE };
  }
  var end = new Date();
  var start = new Date(end.getTime());
  start.setDate(start.getDate() - Math.max(0, Number(config.LOOKBACK_DAYS || 3) - 1));
  return {
    start: Utilities.formatDate(start, timezone, "yyyy-MM-dd"),
    end: Utilities.formatDate(end, timezone, "yyyy-MM-dd")
  };
}

function addDays_(dateText, days) {
  var parts = dateText.split("-");
  var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  date.setUTCDate(date.getUTCDate() + days);
  return Utilities.formatDate(date, "UTC", "yyyy-MM-dd");
}

function normalizeDateTime_(value) {
  if (!value) return null;
  return String(value).replace(" ", "T").replace(/([+-]\d\d):(\d\d)$/, "$1:$2");
}

function value_(value) {
  var number = Number(value || 0);
  return isFinite(number) ? number : 0;
}

function validateConfig_(config) {
  if (!/^https:\/\//.test(config.WEBHOOK_URL)) throw new Error("WEBHOOK_URL deve usar HTTPS");
  if (!config.WEBHOOK_SECRET || config.WEBHOOK_SECRET.indexOf("COLE_AQUI") !== -1 || config.WEBHOOK_SECRET.length < 24) {
    throw new Error("Configure WEBHOOK_SECRET com a mesma chave do Railway (mínimo 24 caracteres)");
  }
  if (Number(config.LOOKBACK_DAYS) < 1 || Number(config.LOOKBACK_DAYS) > 30) {
    throw new Error("LOOKBACK_DAYS deve ficar entre 1 e 30");
  }
  var hasStart = Boolean(config.HISTORICAL_START_DATE);
  var hasEnd = Boolean(config.HISTORICAL_END_DATE);
  if (hasStart !== hasEnd) throw new Error("Preencha HISTORICAL_START_DATE e HISTORICAL_END_DATE juntas");
  if (hasStart) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(config.HISTORICAL_START_DATE) || !/^\d{4}-\d{2}-\d{2}$/.test(config.HISTORICAL_END_DATE)) {
      throw new Error("Datas historicas devem usar o formato YYYY-MM-DD");
    }
    var start = new Date(config.HISTORICAL_START_DATE + "T00:00:00Z");
    var end = new Date(config.HISTORICAL_END_DATE + "T00:00:00Z");
    var days = Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    if (days < 1 || days > 7) throw new Error("Cada janela historica deve ter entre 1 e 7 dias");
  }
}
