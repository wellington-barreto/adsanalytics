import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const root=path.resolve("dist"); const port=Number(process.env.PORT||3000);
const json=(res,status,data)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8"});res.end(JSON.stringify(data))};
const body=async req=>{let s="";for await(const c of req)s+=c;return s?JSON.parse(s):{}};
const sb=async(route,init={})=>{const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${route}`,{...init,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,"content-type":"application/json",...init.headers}});if(!r.ok)throw new Error(await r.text());return r.status===204?null:r.json()};
async function accessToken(){const b=new URLSearchParams({client_id:process.env.GOOGLE_ADS_CLIENT_ID||"",client_secret:process.env.GOOGLE_ADS_CLIENT_SECRET||"",refresh_token:process.env.GOOGLE_ADS_REFRESH_TOKEN||"",grant_type:"refresh_token"});const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:b});if(!r.ok)throw new Error(await r.text());return (await r.json()).access_token}
async function gaql(cid,query,token){const v=process.env.GOOGLE_ADS_API_VERSION||"v25";const r=await fetch(`https://googleads.googleapis.com/${v}/customers/${cid}/googleAds:searchStream`,{method:"POST",headers:{authorization:`Bearer ${token}`,"developer-token":process.env.GOOGLE_ADS_DEVELOPER_TOKEN||"","login-customer-id":String(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID||"").replace(/\D/g,""),"content-type":"application/json"},body:JSON.stringify({query})});if(!r.ok)throw new Error(await r.text());return(await r.json()).flatMap(x=>x.results||[])}
const day=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
async function sync(){const token=await accessToken(),uid=process.env.APP_USER_ID,customers=String(process.env.GOOGLE_ADS_CUSTOMER_IDS||"").split(",").map(x=>x.replace(/\D/g,"")).filter(Boolean),out=[];if(!uid||!customers.length)throw new Error("APP_USER_ID/GOOGLE_ADS_CUSTOMER_IDS ausente");for(const cid of customers){try{const rows=await gaql(cid,`SELECT segments.date, customer.id, customer.currency_code, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc FROM campaign WHERE segments.date BETWEEN '${day(-14)}' AND '${day(0)}'`,token);const data=rows.map(r=>({user_id:uid,customer_id:String(r.customer?.id||cid),campaign_id:String(r.campaign?.id),report_date:r.segments?.date,campaign_name:r.campaign?.name,campaign_status:r.campaign?.status,currency_code:r.customer?.currencyCode,budget_micros:Number(r.campaignBudget?.amountMicros||0),impressions:Number(r.metrics?.impressions||0),clicks:Number(r.metrics?.clicks||0),cost_micros:Number(r.metrics?.costMicros||0),conversions:Number(r.metrics?.conversions||0),conversion_value:Number(r.metrics?.conversionsValue||0),ctr:Number(r.metrics?.ctr||0),average_cpc_micros:Number(r.metrics?.averageCpc||0),synced_at:new Date().toISOString()}));if(data.length)await sb("google_ads_campaign_daily?on_conflict=user_id,customer_id,campaign_id,report_date",{method:"POST",headers:{Prefer:"resolution=merge-duplicates"},body:JSON.stringify(data)});const events=await gaql(cid,`SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_name, change_event.user_email, change_event.client_type, change_event.change_resource_type, change_event.old_resource, change_event.new_resource, change_event.resource_change_operation, change_event.changed_fields FROM change_event WHERE change_event.change_date_time >= '${day(-2)} 00:00:00' AND change_event.change_date_time < '${day(1)} 00:00:00' ORDER BY change_event.change_date_time DESC LIMIT 10000`,token);const ev=events.map(r=>{const e=r.changeEvent||{};return{resource_name:e.resourceName,user_id:uid,customer_id:cid,campaign_id:e.changeResourceName?.match(/campaigns\/(\d+)/)?.[1]||null,change_date_time:e.changeDateTime,change_resource_name:e.changeResourceName,change_resource_type:e.changeResourceType,operation:e.resourceChangeOperation,client_type:e.clientType,user_email:e.userEmail,changed_fields:e.changedFields||null,old_resource:e.oldResource||null,new_resource:e.newResource||null,summary:`${e.changeResourceType||"Recurso"}: ${String(e.resourceChangeOperation||"alterado").toLowerCase()}.`}});if(ev.length)await sb("google_ads_change_events?on_conflict=resource_name",{method:"POST",headers:{Prefer:"resolution=merge-duplicates"},body:JSON.stringify(ev)});out.push({customerId:cid,campaignRows:data.length,changeEvents:ev.length,status:"ok"})}catch(e){out.push({customerId:cid,status:"error",error:e.message})}}return{period:{start:day(-14),end:day(0)},results:out}}
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".json":"application/json"};
const configured=name=>Boolean(String(process.env[name]||"").trim());
const configStatus=()=>({
  status:"ok",
  googleAds:{
    developerToken:configured("GOOGLE_ADS_DEVELOPER_TOKEN"),
    clientId:configured("GOOGLE_ADS_CLIENT_ID"),
    clientSecret:configured("GOOGLE_ADS_CLIENT_SECRET"),
    refreshToken:configured("GOOGLE_ADS_REFRESH_TOKEN"),
    loginCustomerId:configured("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    customerIds:configured("GOOGLE_ADS_CUSTOMER_IDS")
  },
  supabase:{
    url:configured("SUPABASE_URL"),
    serviceRoleKey:configured("SUPABASE_SERVICE_ROLE_KEY"),
    appUserId:configured("APP_USER_ID")
  },
  sync:{secret:configured("SYNC_SECRET")}
});

http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,"http://x");
  if(u.pathname==="/api/health")return json(res,200,{status:"ok",app:"AdsPilot Analytics",mode:process.env.SUPABASE_URL?"configured":"demo"});
  if(u.pathname==="/api/config/status"&&req.method==="GET")return json(res,200,configStatus());
  if(u.pathname==="/api/sync/google-ads"&&req.method==="POST"){
    if(!process.env.SYNC_SECRET||req.headers["x-sync-secret"]!==process.env.SYNC_SECRET)return json(res,401,{error:"Não autorizado"});
    return json(res,200,await sync());
  }
  if(u.pathname==="/api/notes"&&req.method==="POST"){
    const data=await body(req);
    if(!data.content||!data.campaign_id)return json(res,400,{error:"Dados ausentes"});
    return json(res,201,await sb("campaign_notes",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({...data,user_id:process.env.APP_USER_ID})}));
  }
  if(u.pathname.startsWith("/api/"))return json(res,404,{error:"Rota de API não encontrada"});
  let file=path.join(root,u.pathname==="/"?"index.html":u.pathname);
  try{const stat=await fs.stat(file);if(stat.isDirectory())file=path.join(file,"index.html")}catch{file=path.join(root,"index.html")}
  const data=await fs.readFile(file);
  res.writeHead(200,{"content-type":mime[path.extname(file)]||"application/octet-stream"});
  res.end(data);
}catch(e){json(res,500,{error:e.message})}}).listen(port,"0.0.0.0",()=>console.log(`AdsPilot on ${port}`));
