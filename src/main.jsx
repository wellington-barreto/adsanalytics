import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const SESSION_KEY = "adspilot_session_v2";
const fmtDate = date => {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const periodDates = period => {
  const end = new Date();
  const start = new Date();
  if (period === "D−1") { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  else if (period !== "D0") start.setDate(start.getDate() - (Number(period.replace("D", "")) - 1));
  return { from: fmtDate(start), to: fmtDate(end) };
};
const money = (value, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(value || 0));
const integer = value => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(Number(value || 0));
const percent = value => `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
const dateBr = value => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "—";
const dateTimeBr = value => value ? new Date(value).toLocaleString("pt-BR") : "—";
const getSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } };

let publicConfig;
async function getPublicConfig() {
  if (publicConfig) return publicConfig;
  const response = await fetch("/api/public-config");
  if (!response.ok) throw new Error("A autenticação ainda não foi configurada no Railway.");
  publicConfig = await response.json();
  return publicConfig;
}

async function refreshSession(session) {
  const config = await getPublicConfig();
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.supabaseAnonKey, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!response.ok) throw new Error("Sessão expirada");
  const next = await response.json();
  localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  return next;
}

async function api(path, init = {}, retry = true) {
  let session = getSession();
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}`, ...init.headers }
  });
  if (response.status === 401 && retry && session?.refresh_token) {
    session = await refreshSession(session);
    return api(path, init, false);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação");
  return data;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const config = await getPublicConfig();
      const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: config.supabaseAnonKey, "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error_description || session.msg || "E-mail ou senha inválidos");
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      onLogin(session);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  return <main className="loginPage"><section className="loginCard">
    <div className="brand big"><b>A</b><div><strong>AdsPilot</strong><small>Google Ads Intelligence</small></div></div>
    <div><label className="eyebrow">ACESSO SEGURO</label><h1>Entre no seu painel</h1><p>Use o usuário criado no Supabase Auth.</p></div>
    <form onSubmit={submit}><label>E-mail<input type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label><label>Senha<input type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div className="alert error">{error}</div>}<button className="primary wide" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button></form>
  </section></main>;
}

function Header({ session, back, logout }) {
  return <header><div className="brand"><b>A</b><div><strong>AdsPilot</strong><small>Google Ads Intelligence · V2</small></div></div><div className="headerActions">{back && <button onClick={back}>← Dashboard</button>}<span>{session?.user?.email}</span><button onClick={logout}>Sair</button></div></header>;
}

const aggregate = rows => rows.reduce((a, c) => ({ cost: a.cost + c.cost, revenue: a.revenue + c.revenue, conversions: a.conversions + c.conversions, clicks: a.clicks + c.clicks, impressions: a.impressions + c.impressions }), { cost: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 });

function Dashboard({ session, logout, openCampaign }) {
  const [period, setPeriod] = useState("30D");
  const [currency, setCurrency] = useState("");
  const [data, setData] = useState(null);
  const [account, setAccount] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dates = periodDates(period);
  async function load(silent = false) {
    if (!silent) setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ ...dates, ...(currency ? { currency } : {}) });
      const next = await api(`/api/v2/dashboard?${params}`);
      setData(next); if (!currency && next.currency) setCurrency(next.currency);
    } catch (err) { if (err.message === "Sessão expirada") logout(); else setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [period, currency]);
  useEffect(() => { const id = setInterval(() => load(true), 5 * 60 * 1000); return () => clearInterval(id); }, [period, currency]);
  const rows = useMemo(() => (data?.campaigns || []).filter(c => (!account || c.account_name === account) && (!status || c.status === status) && c.campaign_name.toLowerCase().includes(query.toLowerCase())), [data, account, status, query]);
  const total = aggregate(rows); const profit = total.revenue - total.cost;
  const statuses = [...new Set((data?.campaigns || []).map(c => c.status).filter(Boolean))];
  return <main><Header session={session} logout={logout}/><section className="head"><div><label className="eyebrow">VISÃO CONSOLIDADA</label><h1>Performance das campanhas</h1><p>Dados reais sincronizados pelo Google Ads Scripts.</p></div><nav>{["D0", "D−1", "7D", "15D", "30D", "90D"].map(x => <button key={x} className={period === x ? "active" : ""} onClick={() => setPeriod(x)}>{x}</button>)}</nav></section>
    <div className="filters"><select value={account} onChange={e => setAccount(e.target.value)}><option value="">Todas as contas</option>{(data?.accounts || []).map(x => <option key={x}>{x}</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos os status</option>{statuses.map(x => <option key={x}>{x}</option>)}</select><input placeholder="Buscar campanha…" value={query} onChange={e => setQuery(e.target.value)}/><select className="currency" value={currency} onChange={e => setCurrency(e.target.value)}>{(data?.currencies || [currency]).filter(Boolean).map(x => <option key={x}>{x}</option>)}</select><button onClick={() => load()}>↻</button></div>
    {error && <div className="alert error">{error}</div>}{loading && !data ? <div className="loading">Carregando dados reais…</div> : <>
    <section className="hero"><div><span>Resultado do período</span><strong className={profit >= 0 ? "green" : "red"}>{money(profit, currency)}</strong><p><em>{money(total.revenue, currency)}</em> de receita atribuída − <b>{money(total.cost, currency)}</b> em anúncios</p><div className="ratio"><i style={{ width: `${Math.min(100, total.revenue ? total.cost / total.revenue * 100 : 100)}%` }}/></div></div><aside><strong>{percent(total.cost ? profit / total.cost * 100 : 0)}</strong><span>ROI</span></aside><aside><strong>{percent(total.revenue ? profit / total.revenue * 100 : 0)}</strong><span>Margem</span></aside></section>
    <section className="cards">{[["RECEITA", "Receita atribuída", money(total.revenue, currency), "cyan"], ["CUSTO", "Custo de anúncios", money(total.cost, currency), "orange"], ["CONVERSÕES", "Vendas atribuídas", integer(total.conversions), "green"], ["CLIQUES", "Cliques Google", integer(total.clicks), "purple"], ["CPA", "Custo por conversão", total.conversions ? money(total.cost / total.conversions, currency) : "—", "red"], ["RPC", "Receita por clique", total.clicks ? money(total.revenue / total.clicks, currency) : "—", "cyan"], ["LUCRO", "Lucro atribuído", money(profit, currency), profit >= 0 ? "green" : "red"], ["CAMPANHAS", "Campanhas exibidas", rows.length, "blue"]].map(x => <article key={x[0]}><label className={x[3]}>{x[0]}</label><span>{x[1]}</span><strong className={x[3]}>{x[2]}</strong></article>)}</section>
    <section className="panel"><div className="panelhead"><div><h2>Campanhas</h2><p>Última sincronização: {dateTimeBr(data?.last_sync?.finished_at)}</p></div><span className="pill">{rows.length} campanhas</span></div><div className="table"><table><thead><tr><th>Campanha</th><th>Status</th><th>Custo</th><th>Receita</th><th>Lucro</th><th>ROI</th><th>CPA</th><th>Vendas</th><th>Teste</th></tr></thead><tbody>{rows.map(c => <tr key={`${c.customer_id}:${c.campaign_id}`} onClick={() => openCampaign({ ...c, period: dates })}><td><strong>{c.campaign_name}</strong><small>{c.account_name} · #{c.campaign_id}</small></td><td><u className={c.status === "ENABLED" ? "on" : "off"}>{c.status}</u></td><td>{money(c.cost, currency)}</td><td className="cyan">{money(c.revenue, currency)}</td><td className={c.profit >= 0 ? "green" : "red"}>{money(c.profit, currency)}</td><td>{percent(c.roi)}</td><td>{c.cpa == null ? "—" : money(c.cpa, currency)}</td><td>{integer(c.conversions)}</td><td>{c.test?.consumed_percent != null ? <div className="testCell"><b>{percent(c.test.consumed_percent)}</b><i><span style={{ width: `${Math.min(100, c.test.consumed_percent)}%` }}/></i></div> : <span className="muted">Configurar</span>}</td></tr>)}</tbody></table></div></section></>}</main>;
}

function Detail({ campaign, session, logout, back }) {
  const [tab, setTab] = useState("Visão geral"); const [data, setData] = useState(null); const [error, setError] = useState(""); const [loading, setLoading] = useState(true); const [note, setNote] = useState("");
  const [form, setForm] = useState({ campaign_type: "main", commission_value: "", test_limit_percent: 75, test_start_date: campaign.period.from, active: true });
  const currency = campaign.currency_code || "USD";
  async function load() { setLoading(true); setError(""); try { const params = new URLSearchParams({ customer_id: campaign.customer_id, campaign_id: campaign.campaign_id, ...campaign.period }); const next = await api(`/api/v2/campaign?${params}`); setData(next); if (next.setting) setForm(next.setting); } catch (err) { setError(err.message); } finally { setLoading(false); } }
  useEffect(() => { load(); }, []);
  async function saveSetting(event) { event.preventDefault(); setError(""); try { await api("/api/v2/campaign-settings", { method: "PUT", body: JSON.stringify({ ...form, customer_id: campaign.customer_id, campaign_id: campaign.campaign_id, currency_code: currency }) }); await load(); } catch (err) { setError(err.message); } }
  async function saveNote() { if (!note.trim()) return; try { await api("/api/v2/notes", { method: "POST", body: JSON.stringify({ customer_id: campaign.customer_id, campaign_id: campaign.campaign_id, content: note }) }); setNote(""); await load(); } catch (err) { setError(err.message); } }
  const metrics = sumRowsClient(data?.daily || []); const profit = metrics.revenue - metrics.cost;
  const testCost = data?.test_metrics?.cost ?? sumRowsClient((data?.daily || []).filter(row => !form.test_start_date || row.report_date >= form.test_start_date)).cost;
  const testConsumed = Number(form.commission_value) > 0 ? testCost / Number(form.commission_value) * 100 : 0;
  const segmentGroups = useMemo(() => Object.groupBy ? Object.groupBy(data?.segments || [], row => row.segment_type) : (data?.segments || []).reduce((a, row) => ((a[row.segment_type] ||= []).push(row), a), {}), [data]);
  return <main><Header session={session} back={back} logout={logout}/><section className="campaignhead"><div><h1>{campaign.campaign_name}</h1><p>{campaign.account_name} · #{campaign.campaign_id} · {campaign.channel_type}</p></div><span className="pill">{campaign.status}</span></section><nav className="tabs">{["Visão geral", "Termos de pesquisa", "Segmentos", "Alterações e notas", "Configuração do teste"].map(x => <button key={x} className={tab === x ? "active" : ""} onClick={() => setTab(x)}>{x}</button>)}</nav>{error && <div className="alert error">{error}</div>}{loading && !data ? <div className="loading">Carregando campanha…</div> : <>
    {tab === "Visão geral" && <><section className="detailcards">{[["Receita atribuída", money(metrics.revenue, currency), "cyan"], ["Custo Ads", money(metrics.cost, currency), "orange"], ["Lucro atribuído", money(profit, currency), profit >= 0 ? "green" : "red"], ["ROI", percent(metrics.cost ? profit / metrics.cost * 100 : 0), ""], ["CPA", metrics.conversions ? money(metrics.cost / metrics.conversions, currency) : "—", ""]].map(x => <article key={x[0]}><span>{x[0]}</span><strong className={x[2]}>{x[1]}</strong></article>)}</section><section className="panel"><div className="panelhead"><div><h2>Histórico diário</h2><p>Valores reais do Google Ads.</p></div></div><div className="table"><table><thead><tr><th>Data</th><th>Impressões</th><th>Cliques</th><th>Custo</th><th>Conversões</th><th>Receita</th><th>Lucro</th></tr></thead><tbody>{(data?.daily || []).map(row => { const cost = Number(row.cost_micros) / 1e6; const revenue = Number(row.conversion_value); return <tr key={row.report_date}><td>{dateBr(row.report_date)}</td><td>{integer(row.impressions)}</td><td>{integer(row.clicks)}</td><td>{money(cost, currency)}</td><td>{integer(row.conversions)}</td><td>{money(revenue, currency)}</td><td className={revenue - cost >= 0 ? "green" : "red"}>{money(revenue - cost, currency)}</td></tr>; })}</tbody></table></div></section></>}
    {tab === "Termos de pesquisa" && <DataTable rows={data?.search_terms || []} currency={currency} name="Termo" value={r => r.search_term}/>} 
    {tab === "Segmentos" && <section className="segmentGrid">{Object.entries(segmentGroups).map(([type, rows]) => <article className="panel" key={type}><div className="panelhead"><h2>{type}</h2></div><DataTable rows={rows} currency={currency} name="Segmento" value={r => r.segment_value}/></article>)}</section>}
    {tab === "Alterações e notas" && <section className="notes"><article className="panel form"><h2>Adicionar nota</h2><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Registre uma decisão ou alteração manual…"/><button className="primary" onClick={saveNote}>Salvar nota</button></article><article className="panel timeline"><div className="panelhead"><h2>Linha do tempo</h2></div>{[...(data?.changes || []).map(x => ({ date: x.change_date_time, title: x.change_resource_type, content: x.summary, kind: "Alteração" })), ...(data?.notes || []).map(x => ({ date: x.created_at, title: x.title || "Nota manual", content: x.content, kind: "Nota" }))].sort((a, b) => new Date(b.date) - new Date(a.date)).map((x, i) => <div className="event" key={`${x.date}:${i}`}><b>{x.kind === "Nota" ? "✎" : "↻"}</b><div><strong>{x.title}</strong><small>{dateTimeBr(x.date)}</small><p>{x.content}</p></div></div>)}</article></section>}
    {tab === "Configuração do teste" && <section className="settingsGrid"><form className="panel settingsForm" onSubmit={saveSetting}><h2>Parâmetros da campanha</h2><label>Tipo<select value={form.campaign_type || "main"} onChange={e => setForm({ ...form, campaign_type: e.target.value })}><option value="main">Principal</option><option value="test">Teste</option></select></label><label>Comissão por venda ({currency})<input type="number" step="0.01" min="0.01" value={form.commission_value ?? ""} onChange={e => setForm({ ...form, commission_value: e.target.value })}/></label><label>Limite do teste (%)<input type="number" step="0.1" min="1" max="500" value={form.test_limit_percent ?? 75} onChange={e => setForm({ ...form, test_limit_percent: e.target.value })}/></label><label>Início do teste<input type="date" value={form.test_start_date || ""} onChange={e => setForm({ ...form, test_start_date: e.target.value })}/></label><button className="primary">Salvar configuração</button></form><article className="panel testSummary"><h2>Consumo da comissão</h2>{form.commission_value ? <><strong>{percent(testConsumed)}</strong><p>Custo desde o início: {money(testCost, currency)}</p><p>Comissão: {money(form.commission_value, currency)}</p><p>Limite: {percent(form.test_limit_percent)}</p></> : <p>Informe a comissão para ativar o acompanhamento.</p>}</article></section>}
  </>}</main>;
}

function sumRowsClient(rows) { return rows.reduce((a, r) => ({ cost: a.cost + Number(r.cost_micros || 0) / 1e6, revenue: a.revenue + Number(r.conversion_value || 0), conversions: a.conversions + Number(r.conversions || 0), clicks: a.clicks + Number(r.clicks || 0), impressions: a.impressions + Number(r.impressions || 0) }), { cost: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 }); }
function DataTable({ rows, currency, name, value }) { return <div className="table"><table><thead><tr><th>{name}</th><th>Data</th><th>Impressões</th><th>Cliques</th><th>Custo</th><th>Conversões</th></tr></thead><tbody>{rows.map((r, i) => <tr key={`${value(r)}:${r.report_date}:${i}`}><td><strong>{value(r)}</strong></td><td>{dateBr(r.report_date)}</td><td>{integer(r.impressions)}</td><td>{integer(r.clicks)}</td><td>{money(Number(r.cost_micros) / 1e6, currency)}</td><td>{integer(r.conversions)}</td></tr>)}</tbody></table></div>; }

function App() {
  const [session, setSession] = useState(getSession()); const [campaign, setCampaign] = useState(null);
  function logout() { localStorage.removeItem(SESSION_KEY); setSession(null); setCampaign(null); }
  if (!session) return <Login onLogin={setSession}/>;
  return campaign ? <Detail campaign={campaign} session={session} logout={logout} back={() => setCampaign(null)}/> : <Dashboard session={session} logout={logout} openCampaign={setCampaign}/>;
}

createRoot(document.getElementById("root")).render(<App/>);
