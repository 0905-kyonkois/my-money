function normalizePaceHistory(history){
 const now=Date.now(),cutoff=now-24*3600000;
 const sorted=(Array.isArray(history)?history:[]).map(p=>({at:Number(p?.at),views:Number(p?.views)})).filter(p=>Number.isFinite(p.at)&&p.at>0&&p.at<=now&&Number.isFinite(p.views)&&p.views>=0).sort((a,b)=>a.at-b.at);
 const unique=[];for(const p of sorted){if(unique.length&&unique.at(-1).at===p.at)unique[unique.length-1]=p;else unique.push(p);}
 let first=unique.findIndex(p=>p.at>=cutoff);if(first<0)return unique.slice(-1);
 const window=unique.slice(Math.max(0,first-1));
 // Keep the boundary samples and one observation per minute, plus the newest.
 return window.filter((p,i)=>i<2||i===window.length-1||Math.floor(p.at/60000)!==Math.floor(window[i-1].at/60000));
}
// MV COUNTER v1.7.1 MAIL DELIVERY DIAGNOSTICS
const CACHE_TTL = 5;

function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra}
  });
}
function validId(s){ return /^[A-Za-z0-9_-]{11}$/.test(s); }


const EMAILJS_SERVICE_ID="service_rwmvq5c";
const EMAILJS_TEMPLATE_ID="template_itozcyd";
const EMAILJS_ACHIEVEMENT_TEMPLATE_ID="template_5mlltr4";
const EMAILJS_PUBLIC_KEY="ySNXbaohlHD9j8OhT";

function validEmail(s){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||""));}
function notifyKey(id){return "notify:"+id;}
// D1 is the only runtime store. KV is accessed only by the offline migration tool.
async function requireNotificationStore(env){
  if(!env.USER_DB)throw new Error('通知用D1が未設定です');
  const ready=await env.USER_DB.prepare("SELECT data_json FROM app_state WHERE key='notifications-migration-v1'").first();
  if(!ready)throw new Error('通知データの移行が必要です。管理者は同梱の MIGRATE_D1.ps1 を実行してください。既存の通知データは保持されています。');
}
function notificationActive(x){
  const emails=(Array.isArray(x.emails)?x.emails:[x.email]).filter(Boolean);
  return x.enabled&&emails.some(e=>!(x.sent_by_email?.[String(e).toLowerCase()]?.achievement||(x.email===e&&x.sent?.achievement)))?1:0;
}
async function readNotification(env,id){
  const row=await env.USER_DB.prepare('SELECT data_json,revision FROM notifications WHERE id=?').bind(id).first();
  return row?{...JSON.parse(row.data_json),_revision:row.revision}:null;
}
async function saveNotification(env,id,data,previous){
  const now=Date.now(), encoded=JSON.stringify(data),active=notificationActive(data);
  const result=previous
    ?await env.USER_DB.prepare('UPDATE notifications SET data_json=?,active=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND lock_until<=?').bind(encoded,active,now,id,previous._revision,now).run()
    :await env.USER_DB.prepare('INSERT INTO notifications(id,data_json,active,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,encoded,active,now).run();
  if(!result.meta?.changes)throw new Error('通知の確認または変更中です。少し待って保存し直してください');
}
async function deleteNotification(env,id){
  const result=await env.USER_DB.prepare('DELETE FROM notifications WHERE id=? AND lock_until<=?').bind(id,Date.now()).run();
  if(!result.meta?.changes&&await readNotification(env,id))throw new Error('通知を送信中です。少し待って解除し直してください');
}
async function acquireJob(env,name,ttl){
  const owner=crypto.randomUUID(),now=Date.now();
  const result=await env.USER_DB.prepare('INSERT INTO job_leases(name,owner,expires_at) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,expires_at=excluded.expires_at WHERE job_leases.expires_at<=?').bind(name,owner,now+ttl,now).run();
  return result.meta?.changes?owner:null;
}
async function releaseJob(env,name,owner){
  await env.USER_DB.prepare('DELETE FROM job_leases WHERE name=? AND owner=?').bind(name,owner).run();
}

// v1.6.5 emergency guard: when KV writes are temporarily unavailable, keep a
// short-lived duplicate marker in Cloudflare Cache + isolate memory. This does
// not replace KV; it only protects mail delivery until KV becomes writable.
const emergencyMailMemory=new Map();
function emergencyMailKey(clientId,kind,email=""){return `https://mv-counter.internal/mail-guard/${encodeURIComponent(clientId)}/${encodeURIComponent(kind)}/${encodeURIComponent(String(email).toLowerCase())}`;}
async function emergencyMailAlreadySent(clientId,kind,email=""){
  const k=emergencyMailKey(clientId,kind,email), now=Date.now();
  if((emergencyMailMemory.get(k)||0)>now)return true;
  try{
    const hit=await caches.default.match(new Request(k));
    if(hit){emergencyMailMemory.set(k,now+6*60*60*1000);return true;}
  }catch(e){console.warn("[MAIL-GUARD] cache read failed:",e?.message||String(e));}
  return false;
}
async function markEmergencyMailSent(clientId,kind,email=""){
  const k=emergencyMailKey(clientId,kind,email), exp=Date.now()+6*60*60*1000;
  emergencyMailMemory.set(k,exp);
  try{
    await caches.default.put(new Request(k),new Response("sent",{headers:{"cache-control":"public, max-age=21600"}}));
    console.log("[MAIL-GUARD] duplicate guard stored:",kind);
  }catch(e){console.warn("[MAIL-GUARD] cache write failed; memory guard remains:",e?.message||String(e));}
}
function formatGoalDisplay(value){
  const n=Number(value)||0;
  if(n>=100000000){
    const oku=n/100000000;
    return (Number.isInteger(oku)?oku.toLocaleString("ja-JP"):oku.toLocaleString("ja-JP",{maximumFractionDigits:4}))+"億";
  }
  if(n>=10000){
    const man=n/10000;
    return (Number.isInteger(man)?man.toLocaleString("ja-JP"):man.toLocaleString("ja-JP",{maximumFractionDigits:4}))+"万";
  }
  return n.toLocaleString("ja-JP");
}
function maskEmail(email){
  const s=String(email||"");
  const at=s.indexOf("@");
  if(at<1)return "(invalid)";
  const local=s.slice(0,at), domain=s.slice(at+1);
  return local.slice(0,Math.min(2,local.length))+"***@"+domain;
}
async function emailJsSend(env,p,achievement=false){
  if(!env.EMAILJS_PRIVATE_KEY) throw new Error("EMAILJS_PRIVATE_KEY Secret が未設定です");
  const masked=maskEmail(p.email);
  const kind=achievement?"achievement":`threshold:${String(p.threshold)}`;
  console.log(`[MAIL] START to=${masked} kind=${kind} video=${String(p.video_id||p.client_id||"unknown")}`);
  // Build mail variables independently from the notification record.
  // This prevents a missing/overwritten property from silently turning {{threshold}} into blank.
  const rawThreshold=p.threshold;
  // EmailJS's existing template displays {{threshold}} even for a goal-achievement
  // message. Send 0 instead of an empty value so no mail is ever rendered blank.
  const thresholdValue=achievement ? "0" : String(rawThreshold ?? "").trim();
  if(!achievement && !/^\d+$/.test(thresholdValue)){
    throw new Error(`Invalid threshold before EmailJS send: ${JSON.stringify(rawThreshold)}`);
  }
  const templateParams={
    to_email:String(p.email||""),
    title:String(p.title||"MV"),
    threshold:thresholdValue,
    // Alias kept for diagnostics/future template changes.
    notify_threshold:thresholdValue,
    notification_type:achievement?"achievement":"threshold",
    headline:achievement
      ? `🎉 ${formatGoalDisplay(p.goal)}回達成！ 🎉`
      : `🔴 目標まであと ${thresholdValue} 回！ 🔴`,
    remaining:Number(p.remaining).toLocaleString("ja-JP"),
    views:Number(p.views).toLocaleString("ja-JP"),
    goal:Number(p.goal).toLocaleString("ja-JP"),
    goal_display:formatGoalDisplay(p.goal),
    subject: achievement
      ? `🎉${formatGoalDisplay(p.goal)}回達成！｜${String(p.title||"MV")}`
      : `🔴 ${formatGoalDisplay(p.goal)}回まであと ${thresholdValue} 回！｜${String(p.title||"MV")}`,
    message: achievement
      ? `🎉 ${formatGoalDisplay(p.goal)}回達成！ 🎉\n\n「${String(p.title||"MV")}」の再生回数が${formatGoalDisplay(p.goal)}回を突破しました！\n\n現在の再生回数：${Number(p.views).toLocaleString("ja-JP")}回\n目標再生回数：${Number(p.goal).toLocaleString("ja-JP")}回`
      : `🔴 目標の再生回数まであと ${thresholdValue} 回！ 🔴\n\n「${String(p.title||"MV")}」が通知ラインに到達しました。\n\n現在の再生回数：${Number(p.views).toLocaleString("ja-JP")}回\n目標再生回数：${Number(p.goal).toLocaleString("ja-JP")}回\n実際の残り回数：${Number(p.remaining).toLocaleString("ja-JP")}回`
  };
  console.log(`[MAIL] PARAMS to=${masked} kind=${kind} threshold=${JSON.stringify(templateParams.threshold)} remaining=${templateParams.remaining} views=${templateParams.views} goal=${templateParams.goal} goal_display=${templateParams.goal_display}`);
  const body={
    service_id:EMAILJS_SERVICE_ID,
    // EmailJS has separate designs for achievement and remaining-count mail.
    template_id:achievement?EMAILJS_ACHIEVEMENT_TEMPLATE_ID:EMAILJS_TEMPLATE_ID,
    user_id:EMAILJS_PUBLIC_KEY,
    accessToken:env.EMAILJS_PRIVATE_KEY,
    template_params:templateParams
  };
  let r;
  try{
    r=await fetch("https://api.emailjs.com/api/v1.0/email/send",{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
    });
  }catch(err){
    console.error(`[MAIL] NETWORK_ERROR to=${masked} kind=${kind}: ${err?.message||String(err)}`);
    throw err;
  }
  const responseText=await r.text().catch(()=>"");
  if(!r.ok){
    console.error(`[MAIL] ERROR to=${masked} kind=${kind} status=${r.status} response=${responseText.slice(0,300)}`);
    throw new Error("EmailJS HTTP "+r.status+": "+responseText);
  }
  console.log(`[MAIL] ACCEPTED to=${masked} kind=${kind} status=${r.status} response=${responseText.slice(0,120)||"(empty)"}`);
  return {ok:true,status:r.status,response:responseText};
}
// v1.6.4: YouTube quota HUD = Google Cloud Monitoring exact correction every 10 min
// + lightweight in-memory estimate between corrections. No quota-counter KV writes.
const QUOTA_LIMIT=10000;
const QUOTA_SYNC_MS=10*60*1000;
let quotaState={exact:0,estimated:0,syncedAt:0,pending:null,token:null,tokenExp:0,day:null,loadedAt:0,nextAttemptAt:0,syncError:null};

function b64url(input){
  const bytes=input instanceof Uint8Array?input:new TextEncoder().encode(input);
  let bin=""; for(const b of bytes)bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function pemToBytes(pem){
  const b64=String(pem||"").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g,"");
  const bin=atob(b64); const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i); return out;
}
async function googleAccessToken(env){
  const now=Math.floor(Date.now()/1000);
  if(quotaState.token && quotaState.tokenExp>now+120)return quotaState.token;
  if(!env.GOOGLE_SERVICE_ACCOUNT_JSON)throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON Secret が未設定です");
  let sa; try{sa=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON)}catch{throw new Error("GoogleサービスアカウントJSONを読み込めません")}
  if(!sa.client_email||!sa.private_key)throw new Error("GoogleサービスアカウントJSONが不完全です");
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const claim=b64url(JSON.stringify({iss:sa.client_email,scope:"https://www.googleapis.com/auth/monitoring.read",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600}));
  const unsigned=header+"."+claim;
  const key=await crypto.subtle.importKey("pkcs8",pemToBytes(sa.private_key),{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("RSASSA-PKCS1-v1_5",key,new TextEncoder().encode(unsigned));
  const assertion=unsigned+"."+b64url(new Uint8Array(sig));
  const body=new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(10000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||`Google OAuth ${r.status}`);
  quotaState.token=j.access_token; quotaState.tokenExp=now+Number(j.expires_in||3600); return j.access_token;
}
function pacificDay(isoOrMs){
  return new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(isoOrMs));
}
function monitoringConfig(env){
  if(!env.GOOGLE_SERVICE_ACCOUNT_JSON)throw new Error('Googleサービスアカウントが未設定です');
  let sa;try{sa=JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);}catch{throw new Error('GoogleサービスアカウントJSONを読み込めません');}
  const project=String(env.GOOGLE_CLOUD_PROJECT||sa.project_id||'').trim();
  if(!/^[a-zA-Z0-9:_-]+$/.test(project))throw new Error('実測対象のGoogle Cloudプロジェクトが未設定です');
  const metric=String(env.YOUTUBE_QUOTA_METRIC||'youtube.googleapis.com/default');
  if(!/^[a-zA-Z0-9_./-]+$/.test(metric))throw new Error('YouTubeクォータ指標名が不正です');
  return {project,metric};
}
function monitoringError(status,j){
  const reason=(j?.error?.details||[]).map(d=>d.reason||'').join(' '),raw=String(j?.error?.message||'');
  if(/billing|BILLING_DISABLED/i.test(reason+' '+raw))return new Error('Google Cloudの請求先が未有効です。プロジェクトの請求先設定を確認してください');
  if(/SERVICE_DISABLED|has not been used|is disabled/i.test(reason+' '+raw))return new Error('対象プロジェクトでCloud Monitoring APIを有効にしてください');
  if(status===403)return new Error('実測を読む権限がありません。対象プロジェクトのMonitoring Viewer権限を確認してください');
  if(status===401)return new Error('Googleの認証に失敗しました。サービスアカウントの設定を確認してください');
  return new Error('Google Cloud Monitoringの取得に失敗しました（HTTP '+status+'）');
}
async function monitoringQuotaExact(env){
  const {project,metric}=monitoringConfig(env),token=await googleAccessToken(env);
  const now=Date.now(),today=pacificDay(now),deadline=now+25000;
  async function list(type){
    const u=new URL('https://monitoring.googleapis.com/v3/projects/'+encodeURIComponent(project)+'/timeSeries');
    u.searchParams.set('filter','metric.type = "serviceruntime.googleapis.com/quota/'+type+'/net_usage" AND resource.type = "consumer_quota" AND resource.labels.service = "youtube.googleapis.com" AND metric.labels.quota_metric = "'+metric+'"');
    u.searchParams.set('interval.startTime',new Date(now-30*3600000).toISOString());u.searchParams.set('interval.endTime',new Date(now).toISOString());
    u.searchParams.set('view','FULL');u.searchParams.set('pageSize','10000');
    const result=[],seen=new Set();let page='';
    do{
      if(Date.now()>=deadline)throw new Error('実測取得がタイムアウトしました。次回再試行します');
      if(page)u.searchParams.set('pageToken',page);
      const r=await fetch(u,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-Date.now())))});
      const j=await r.json();if(!r.ok)throw monitoringError(r.status,j);
      if(j.executionErrors?.length)throw new Error('Monitoringが一部のデータを取得できませんでした。次回再試行します');
      result.push(...(j.timeSeries||[]));page=j.nextPageToken||'';
      if(page&&seen.has(page))throw new Error('Monitoringのページ情報が重複しています');if(page)seen.add(page);
    }while(page);
    return result;
  }
  const delta=await list('rate');let total=0,points=0;
  for(const ts of delta){
    if(ts.metricKind&&ts.metricKind!=='DELTA')continue;
    for(const pt of ts.points||[]){
      const t=Date.parse(pt.interval?.endTime||'');
      const value=Number(pt.value?.int64Value??pt.value?.doubleValue);
      if(!Number.isFinite(t)||pacificDay(t)!==today||!Number.isFinite(value))continue;
      total+=value;points++;
    }
  }
  if(points)return Math.max(0,Math.round(total));
  // Windowed daily usage is a GAUGE: only the newest point per series counts.
  const gauges=await list('ratev2'),latest=new Map(),limits=new Set();
  for(const ts of gauges){
    if(ts.metricKind&&ts.metricKind!=='GAUGE')continue;
    const labels=ts.metric?.labels||{},window=String(labels.window_size||'').toLowerCase();
    if(!['1d','24h','86400','86400s'].includes(window))continue;
    const windowStart=Date.parse(labels.window_start_time||'');
    if(!Number.isFinite(windowStart)||pacificDay(windowStart)!==today)continue;
    const key=JSON.stringify([ts.resource?.labels||{},labels]);
    for(const pt of ts.points||[]){
      const t=Date.parse(pt.interval?.endTime||''),value=Number(pt.value?.int64Value??pt.value?.doubleValue);
      if(!Number.isFinite(t)||pacificDay(t)!==today||!Number.isFinite(value))continue;
      limits.add(labels.limit_name||'');
      if(!latest.has(key)||latest.get(key).t<t)latest.set(key,{t,value});
    }
  }
  if(limits.size>1)throw new Error('日次クォータ指標が複数あります。対象のクォータ指標名を確認してください');
  if(latest.size)return Math.max(0,Math.round([...latest.values()].reduce((sum,p)=>sum+p.value,0)));
  throw new Error('本日の実測データがありません。APIキーのプロジェクト・指標名を確認し、反映を待ってください');
}
function resetQuotaDay(){
  const day=pacificDay(Date.now());
  if(quotaState.day!==day){quotaState.day=day;quotaState.exact=0;quotaState.estimated=0;quotaState.syncedAt=0;quotaState.nextAttemptAt=0;quotaState.loadedAt=0;}
}
async function loadQuotaCorrection(env,force=false){
  resetQuotaDay();if(!env.USER_DB)return;
  if(!force&&Date.now()-quotaState.loadedAt<60000)return;
  quotaState.loadedAt=Date.now();
  const row=await env.USER_DB.prepare("SELECT data_json FROM app_state WHERE key='quota-monitoring-v2'").first();
  if(!row)return;const x=JSON.parse(row.data_json);
  if(x.day!==quotaState.day)return;
  if(Number(x.syncedAt)>quotaState.syncedAt){quotaState.exact=Number(x.exact)||0;quotaState.estimated=Math.max(quotaState.estimated,quotaState.exact);quotaState.syncedAt=Number(x.syncedAt);}
  quotaState.nextAttemptAt=Number(x.nextAttemptAt)||0;quotaState.syncError=x.syncError||null;
}
async function syncQuota(env){
  resetQuotaDay();if(quotaState.pending)return quotaState.pending;
  if(Date.now()<quotaState.nextAttemptAt)return;
  quotaState.pending=(async()=>{
    if(!env.USER_DB)throw new Error('実測補正の保存先D1が未設定です');
    const owner=await acquireJob(env,'quota-monitoring',90000);if(!owner)return;
    try{
      await loadQuotaCorrection(env,true);
      if(Date.now()<quotaState.nextAttemptAt)return;
      const estimateBefore=quotaState.estimated;
      try{
        const exact=await monitoringQuotaExact(env);
        if(pacificDay(Date.now())!==quotaState.day){resetQuotaDay();return;}
        quotaState.exact=exact;quotaState.estimated=exact+Math.max(0,quotaState.estimated-estimateBefore);quotaState.syncedAt=Date.now();quotaState.syncError=null;
        quotaState.nextAttemptAt=Date.now()+QUOTA_SYNC_MS;
      }catch(e){quotaState.syncError=e?.message||'実測取得に失敗しました';quotaState.nextAttemptAt=Date.now()+5*60000;}
      const data={day:quotaState.day,exact:quotaState.exact,syncedAt:quotaState.syncedAt,nextAttemptAt:quotaState.nextAttemptAt,syncError:quotaState.syncError};
      await env.USER_DB.prepare("INSERT INTO app_state(key,data_json,updated_at) VALUES('quota-monitoring-v2',?,?) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at").bind(JSON.stringify(data),Date.now()).run();
    }finally{await releaseJob(env,'quota-monitoring',owner);}
  })().finally(()=>quotaState.pending=null);
  return quotaState.pending;
}
async function cronQuotaCorrection(env){
  try{await loadQuotaCorrection(env);await syncQuota(env);}catch(e){console.error('[QUOTA]',e.message);}
}
function addUsage(env,bucket,n=1){resetQuotaDay();quotaState.estimated+=Number(n)||0;}
async function quotaInfo(env){
  try{await loadQuotaCorrection(env);await syncQuota(env);}catch(e){quotaState.syncError=e.message;}
  return {mode:'estimated-with-monitoring-sync',used:Math.round(quotaState.estimated||0),exact:Math.round(quotaState.exact||0),limit:QUOTA_LIMIT,syncedAt:quotaState.syncedAt||null,nextSyncAt:quotaState.nextAttemptAt||null,exactAvailable:!!quotaState.syncedAt,syncError:quotaState.syncError||null};
}

async function fetchBatchStats(env,ids){
  const api=new URL("https://www.googleapis.com/youtube/v3/videos:batchGetStats");
  api.searchParams.set("part","statistics");api.searchParams.set("id",ids.join(","));api.searchParams.set("key",env.YOUTUBE_API_KEY);
  await addUsage(env,"batch",1);
  const r=await fetch(api.toString(),{headers:{accept:"application/json"},signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j?.error?.message||`batchGetStats ${r.status}`);
  return j.items||[];
}
async function fetchListStats(env,ids){
  const api=new URL("https://www.googleapis.com/youtube/v3/videos");
  api.searchParams.set("part","id,statistics");api.searchParams.set("id",ids.join(","));api.searchParams.set("key",env.YOUTUBE_API_KEY);
  await addUsage(env,"general",1);
  const r=await fetch(api.toString(),{headers:{accept:"application/json"},signal:AbortSignal.timeout(15000)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(j?.error?.message||`videos.list ${r.status}`);
  return j.items||[];
}
async function resilientStats(env,ids){
  try{return {items:await fetchBatchStats(env,ids),source:"batchGetStats"};}
  catch(err){
    console.warn("[STATS] batchGetStats failed; using videos.list reserve:",err?.message||err);
    return {items:await fetchListStats(env,ids),source:"videos.list-reserve"};
  }
}
async function youtubeStats(env,ids){
  const out=await resilientStats(env,ids);
  return new Map((out.items||[]).map(x=>[x.id,Number(x.statistics?.viewCount||0)]));
}

async function runNotifications(env){
  if(!env.YOUTUBE_API_KEY)return;
  try{await requireNotificationStore(env);}catch(e){console.error('[NOTIFY]',e.message);return;}
  // One short scan at a time; per-record locks also protect against user edits.
  const owner=await acquireJob(env,'notifications',120000);if(!owner)return;
  const deadline=Date.now()+45000;
  const cursorRow=await env.USER_DB.prepare("SELECT data_json FROM app_state WHERE key='notifications-cursor'").first();
  let after=cursorRow?JSON.parse(cursorRow.data_json).after||'':'';let complete=false;
  try{
    while(Date.now()<deadline){
      const page=await env.USER_DB.prepare('SELECT id,data_json,revision FROM notifications WHERE active=1 AND id>? ORDER BY id LIMIT 50').bind(after).all();
      const rows=page.results||[];if(!rows.length){complete=true;break;}
      const stats=await youtubeStats(env,[...new Set(rows.map(r=>JSON.parse(r.data_json).video_id))]);
      for(const row of rows){
        if(Date.now()>=deadline)break;
        after=row.id;
        const x=JSON.parse(row.data_json),views=stats.get(x.video_id);if(!Number.isFinite(views))continue;
        const remaining=Math.max(0,Number(x.goal)-views);
        const thresholds=(x.thresholds||[500,100]).map(Number).sort((a,b)=>b-a);
        const emails=[...new Set((Array.isArray(x.emails)?x.emails:[x.email]).map(v=>String(v||'').trim().toLowerCase()).filter(validEmail))];
        x.sent_by_email=x.sent_by_email||{};
        if(x.email&&!x.sent_by_email[String(x.email).toLowerCase()])x.sent_by_email[String(x.email).toLowerCase()]={...(x.sent||{})};
        const jobs=[];
        for(const email of emails){
          const sent=x.sent_by_email[email]||{};
          if(views>=Number(x.goal)){if(!sent.achievement)jobs.push({email,kind:'achievement',achievement:true});}
          else for(const threshold of thresholds)if(remaining<=threshold&&remaining>0&&!sent[String(threshold)])jobs.push({email,kind:String(threshold),threshold});
        }
        if(!jobs.length)continue;
        const lock=await env.USER_DB.prepare('UPDATE notifications SET lock_owner=?,lock_until=? WHERE id=? AND revision=? AND lock_until<=?').bind(owner,Date.now()+120000,row.id,row.revision,Date.now()).run();
        if(!lock.meta?.changes)continue;
        try{
          for(const job of jobs){
            if(Date.now()>=deadline)break;
            const guardKind=job.achievement?'achievement':'threshold-'+job.threshold;
            const guardId=row.id+':'+row.revision;
            if(!await emergencyMailAlreadySent(guardId,guardKind,job.email)){
              await emailJsSend(env,{...x,email:job.email,remaining,views,threshold:job.threshold},!!job.achievement);
              await markEmergencyMailSent(guardId,guardKind,job.email);
            }
            const sent=x.sent_by_email[job.email]||(x.sent_by_email[job.email]={});
            sent[job.kind]=new Date().toISOString();
            if(job.achievement)for(const t of thresholds)sent[String(t)]=sent[String(t)]||'covered-by-achievement';
            const saved=await env.USER_DB.prepare('UPDATE notifications SET data_json=?,active=?,updated_at=? WHERE id=? AND revision=? AND lock_owner=?').bind(JSON.stringify(x),notificationActive(x),Date.now(),row.id,row.revision,owner).run();
            if(!saved.meta?.changes)throw new Error('通知状態の保存競合');
            await new Promise(r=>setTimeout(r,1100));
          }
        }catch(e){console.error('[NOTIFY] send/save failed:',e.message);}
        finally{await env.USER_DB.prepare('UPDATE notifications SET lock_owner=NULL,lock_until=0 WHERE id=? AND lock_owner=?').bind(row.id,owner).run();}
      }
      if(rows.length<50&&after===rows.at(-1).id){complete=true;break;}
    }
  }finally{
    const next=complete?'':after;
    if(next||(cursorRow&&JSON.parse(cursorRow.data_json).after))await env.USER_DB.prepare("INSERT INTO app_state(key,data_json,updated_at) VALUES('notifications-cursor',?,?) ON CONFLICT(key) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at").bind(JSON.stringify({after:next}),Date.now()).run();
    await releaseJob(env,'notifications',owner);
  }
}

// ===== v1.8.0 ACCOUNT + DEVICE SYNC (Cloudflare D1) =====
const SESSION_DAYS=30, OTP_MINUTES=30;
function b64u(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function randToken(n=32){const a=new Uint8Array(n);crypto.getRandomValues(a);return b64u(a);}
async function sha256(s){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");}
function cookieMap(req){const out={};for(const x of (req.headers.get("cookie")||"").split(";")){const i=x.indexOf("=");if(i>0)out[x.slice(0,i).trim()]=decodeURIComponent(x.slice(i+1).trim());}return out;}
function sessionCookie(token,maxAge=SESSION_DAYS*86400){return `mvc_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
async function currentUser(req,env){
  if(!env.USER_DB)return null; const t=cookieMap(req).mvc_session;if(!t)return null;const h=await sha256(t);
  const row=await env.USER_DB.prepare(`SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(h,Date.now()).first();
  return row||null;
}
function syncItemVersion(x){return Math.max(0,Number(x?.configChangedAt||x?.lastChangedAt||x?.updatedAt||0));}
function mergeSyncItem(a,b){const config=syncItemVersion(b)>=syncItemVersion(a)?b:a,measured=Number(b?.updatedAt||0)>=Number(a?.updatedAt||0)?b:a;return {...config,views:Number(measured.views||0),updatedAt:Number(measured.updatedAt||0),lastMeasuredAt:Number(measured.lastMeasuredAt||0),rateSamples:Number(measured.rateSamples||0),estimateRate:Number(measured.estimateRate||0)};}
function mergeSyncData(previous,incoming){
  const old=previous&&typeof previous==='object'?previous:{},next=incoming&&typeof incoming==='object'?incoming:{};
  const deletes={};
  for(const source of [old.deleted_items,next.deleted_items])for(const [id,at] of Object.entries(source&&typeof source==='object'?source:{})){
    if(typeof id==='string'&&id.length<=200&&Number.isFinite(Number(at)))deletes[id]=Math.max(Number(deletes[id]||0),Number(at));
  }
  const rows=new Map();
  for(const source of [old.items,next.items])for(const item of (Array.isArray(source)?source:[])){
    if(!item||typeof item!=='object'||typeof item.uid!=='string'||!item.uid||item.uid.length>200)continue;
    const prior=rows.get(item.uid);rows.set(item.uid,prior?mergeSyncItem(prior,item):item);
  }
  const items=[...rows.values()].filter(item=>Number(deletes[item.uid]||0)<syncItemVersion(item));
  const paceStats={};
  for(const source of [old,next]){
    if(Number(source?.pace_version)!==2)continue;
    for(const [id,stat] of Object.entries(source.pace_stats&&typeof source.pace_stats==='object'?source.pace_stats:{})){
      if(typeof id!=='string'||id.length>200||!stat||typeof stat!=='object')continue;
      const history=normalizePaceHistory(stat.history);
      const candidate={estimateRate:Math.max(0,Number(stat.estimateRate)||0),rateSamples:Math.max(0,Math.floor(Number(stat.rateSamples)||0)),views:Math.max(0,Number(stat.views)||0),updatedAt:Math.max(0,Number(stat.updatedAt)||0),lastMeasuredAt:Math.max(0,Number(stat.lastMeasuredAt)||0),history};
      const prior=paceStats[id];if(!prior||candidate.updatedAt>=prior.updatedAt)paceStats[id]=candidate;
    }
  }
  return {version:4,items,deleted_items:deletes,pace_version:2,pace_stats:paceStats,settings:next.settings&&typeof next.settings==='object'?next.settings:(old.settings||{})};
}
async function mergeAndSaveUserSync(env,userId,incoming){
  for(let attempt=0;attempt<4;attempt++){
    const previous=await env.USER_DB.prepare(`SELECT data_json,updated_at FROM user_sync WHERE user_id=?`).bind(userId).first();let prior=null;
    try{prior=previous?JSON.parse(previous.data_json):null}catch(_){prior=null}
    const merged=mergeSyncData(prior,incoming),s=JSON.stringify(merged);if(s.length>1000000)throw new Error('同期データが大きすぎます');
    const now=Date.now();
    const result=previous
      ?await env.USER_DB.prepare(`UPDATE user_sync SET data_json=?,updated_at=? WHERE user_id=? AND updated_at=?`).bind(s,now,userId,previous.updated_at).run()
      :await env.USER_DB.prepare(`INSERT INTO user_sync(user_id,data_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO NOTHING`).bind(userId,s,now).run();
    if(result.meta?.changes)return {updatedAt:now,data:merged};
  }
  throw new Error('同期データが競合しました。もう一度同期してください');
}
async function sendLoginCode(env,email,code){
  if(!env.EMAILJS_PRIVATE_KEY)throw new Error("EMAILJS_PRIVATE_KEY Secret が未設定です");
  const masked=maskEmail(email);
  const subject=`【MV COUNTER】認証コード：${code}`;
  const message=`MV COUNTERへのログイン認証コードです。\n\n認証コード：${code}\n\nこのコードの有効期限は ${OTP_MINUTES} 分です。\n心当たりがない場合は、このメールを無視してください。`;
  const body={service_id:EMAILJS_SERVICE_ID,template_id:EMAILJS_TEMPLATE_ID,user_id:EMAILJS_PUBLIC_KEY,accessToken:env.EMAILJS_PRIVATE_KEY,template_params:{
    to_email:email,subject,message,code,expires_minutes:String(OTP_MINUTES),
    // v1.8.3: reuse the existing notification design for login mail only.
    // Keep OTP values as strings: Number/toLocaleString would lose leading zeros.
    title:subject+' / '+OTP_MINUTES+'分以内にログイン画面へ入力してください（再生回数の通知ではありません）',
    threshold:code,notify_threshold:code,remaining:code,views:code,
    goal:code,goal_display:code
  }};
  console.log(`[AUTH-MAIL] START to=${masked}`);
  const r=await fetch("https://api.emailjs.com/api/v1.0/email/send",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const txt=await r.text();
  if(!r.ok){console.error(`[AUTH-MAIL] ERROR to=${masked} status=${r.status} response=${txt.slice(0,300)}`);throw new Error(`EmailJS ${r.status}: ${txt.slice(0,300)}`);}
  console.log(`[AUTH-MAIL] ACCEPTED to=${masked} status=${r.status}`);
}
async function authRoute(request,env,url){
  if(!env.USER_DB)return json({message:"ユーザーDBが未設定です"},503);
  if(url.pathname==="/api/auth/request-code"&&request.method==="POST"){
    let b;try{b=await request.json()}catch{return json({message:"JSONが不正です"},400)}
    const email=String(b.email||"").trim().toLowerCase();if(!validEmail(email))return json({message:"メールアドレスを確認してください"},400);
    const recent=await env.USER_DB.prepare(`SELECT created_at FROM login_codes WHERE email=? ORDER BY created_at DESC LIMIT 1`).bind(email).first();
    if(recent&&Date.now()-Number(recent.created_at)<60000)return json({message:"再送信は60秒後にできます"},429);
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,"0"), salt=randToken(12), hash=await sha256(email+":"+code+":"+salt), now=Date.now();
    await env.USER_DB.prepare(`DELETE FROM login_codes WHERE email=? OR expires_at<?`).bind(email,now).run();
    await env.USER_DB.prepare(`INSERT INTO login_codes(email,code_hash,salt,expires_at,attempts,created_at) VALUES(?,?,?,?,0,?)`).bind(email,hash,salt,now+OTP_MINUTES*60000,now).run();
    try{await sendLoginCode(env,email,code)}catch(e){console.error("[AUTH] mail error",e?.message||e);return json({message:"認証メールを送れませんでした。EmailJS設定を確認してください"},503)}
    return json({ok:true});
  }
  if(url.pathname==="/api/auth/verify"&&request.method==="POST"){
    let b;try{b=await request.json()}catch{return json({message:"JSONが不正です"},400)}
    const email=String(b.email||"").trim().toLowerCase(),code=String(b.code||"").trim();if(!validEmail(email)||!/^\d{6}$/.test(code))return json({message:"認証コードを確認してください"},400);
    const row=await env.USER_DB.prepare(`SELECT id,code_hash,salt,expires_at,attempts FROM login_codes WHERE email=? ORDER BY created_at DESC LIMIT 1`).bind(email).first();
    if(!row||Number(row.expires_at)<Date.now())return json({message:"認証コードの有効期限が切れています"},400);
    if(Number(row.attempts)>=5)return json({message:"入力回数の上限です。コードを再送してください"},429);
    const h=await sha256(email+":"+code+":"+row.salt);if(h!==row.code_hash){await env.USER_DB.prepare(`UPDATE login_codes SET attempts=attempts+1 WHERE id=?`).bind(row.id).run();return json({message:"認証コードが違います"},400)}
    let u=await env.USER_DB.prepare(`SELECT id,email FROM users WHERE email=?`).bind(email).first();if(!u){const id=crypto.randomUUID();await env.USER_DB.prepare(`INSERT INTO users(id,email,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(email) DO NOTHING`).bind(id,email,Date.now(),Date.now()).run();u=await env.USER_DB.prepare(`SELECT id,email FROM users WHERE email=?`).bind(email).first();}
    // Keep the code until expiry or reissue so other devices can authenticate.
    const token=randToken(32),th=await sha256(token);await env.USER_DB.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)`).bind(th,u.id,Date.now()+SESSION_DAYS*86400000,Date.now()).run();
    return json({ok:true,email:u.email},200,{"set-cookie":sessionCookie(token)});
  }
  if(url.pathname==="/api/auth/me"&&request.method==="GET"){const u=await currentUser(request,env);return json(u?{logged_in:true,email:u.email}:{logged_in:false});}
  if(url.pathname==="/api/auth/logout"&&request.method==="POST"){const t=cookieMap(request).mvc_session;if(t)await env.USER_DB.prepare(`DELETE FROM sessions WHERE token_hash=?`).bind(await sha256(t)).run();return json({ok:true},200,{"set-cookie":sessionCookie("",0)});}
  if(url.pathname==="/api/sync"&&request.method==="GET"){
    const u=await currentUser(request,env);if(!u)return json({message:"ログインが必要です"},401);const r=await env.USER_DB.prepare(`SELECT data_json,updated_at FROM user_sync WHERE user_id=?`).bind(u.id).first();return json({data:r?JSON.parse(r.data_json):null,updated_at:r?.updated_at||null});
  }
  if(url.pathname==="/api/sync"&&request.method==="PUT"){
    const u=await currentUser(request,env);if(!u)return json({message:"ログインが必要です"},401);let b;try{b=await request.json()}catch{return json({message:"JSONが不正です"},400)}
    const data=b?.data;if(!data||typeof data!=="object")return json({message:"同期データが不正です"},400);
    try{const saved=await mergeAndSaveUserSync(env,u.id,data);return json({ok:true,updated_at:saved.updatedAt,data:saved.data});}
    catch(e){return json({message:e?.message||'同期できませんでした'},e?.message==='同期データが大きすぎます'?413:409);}
  }
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if(url.pathname.startsWith("/api/auth/")||url.pathname==="/api/sync"){const ar=await authRoute(request,env,url);if(ar)return ar;}

    if (url.pathname === "/api/stats") {
      if (!env.YOUTUBE_API_KEY) return json({message:"サーバーAPIキーが未設定です"},500);
      const ids = [...new Set((url.searchParams.get("id")||"").split(",").map(x=>x.trim()).filter(validId))].slice(0,50);
      if (!ids.length) return json({message:"動画IDがありません"},400);

      const cacheUrl = new URL(request.url);
      cacheUrl.searchParams.delete("_");
      const cacheKey = new Request(cacheUrl.toString(), {method:"GET"});
      const cache = caches.default;
      const hit = await cache.match(cacheKey);
      if (hit) return hit;

      let stats;
      try{ stats=await resilientStats(env,ids); }
      catch(err){ return json({message:err?.message||"YouTube APIエラー"},503); }
      const body=JSON.stringify({kind:"youtube#videoListResponse",items:stats.items||[],source:stats.source});
      const out = new Response(body,{status:200,headers:{
        "content-type":"application/json; charset=utf-8",
        "cache-control":`public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`
      }});
      await cache.put(cacheKey,out.clone());
      return out;
    }

    if (url.pathname === "/quota") {
      return json(await quotaInfo(env));
    }

    if (url.pathname === "/api/meta") {
      if (!env.YOUTUBE_API_KEY) return json({message:"サーバーAPIキーが未設定です"},500);
      const id=(url.searchParams.get("id")||"").trim();
      if(!validId(id)) return json({message:"動画IDが不正です"},400);

      const api=new URL("https://www.googleapis.com/youtube/v3/videos");
      api.searchParams.set("part","snippet");
      api.searchParams.set("fields","items(id,snippet(title,channelTitle))");
      api.searchParams.set("id",id);
      api.searchParams.set("key",env.YOUTUBE_API_KEY);

      await addUsage(env,"general",1);
      const r=await fetch(api.toString(),{headers:{"accept":"application/json"}});
      const body=await r.json().catch(()=>({}));
      if(!r.ok) return json({message:body?.error?.message||"動画情報を取得できませんでした"},r.status);
      const item=body?.items?.[0];
      if(!item) return json({message:"動画情報が見つかりませんでした"},404);

      return json({
        title:item.snippet?.title||"タイトル不明",
        author_name:item.snippet?.channelTitle||""
      },200,{"cache-control":"public, max-age=3600"});
    }


    if (url.pathname === "/api/notify-health") {
      if(request.method!=="GET")return json({message:"Method not allowed"},405);
      try{await requireNotificationStore(env);return json({emergency:false,storage:'D1',available:true});}
      catch(e){return json({emergency:false,storage:'D1',available:false,message:e.message},503);}
    }

    if (url.pathname === "/api/account-notifications") {
      const user=await currentUser(request,env);if(!user)return json({message:"ログインが必要です"},401);
      try{await requireNotificationStore(env);}catch(e){return json({message:e.message},503);}
      const email=String(user.email).toLowerCase(),videoId=(url.searchParams.get('video_id')||'').trim();
      if(request.method==="DELETE"){
        if(url.searchParams.get('record')==='1'){
          const id=(url.searchParams.get('id')||'').trim();if(!id)return json({message:'通知IDが必要です'},400);
          const previous=await readNotification(env,id);if(!previous)return json({message:'通知設定が見つかりません'},404);
          const recipients=(Array.isArray(previous.emails)?previous.emails:(previous.email?[previous.email]:[])).map(v=>String(v).toLowerCase());
          if(!recipients.includes(email))return json({message:'自分宛ての通知がある設定だけ解除できます'},403);
          await deleteNotification(env,id);return json({ok:true,deleted:true});
        }
        if(url.searchParams.get('all')==='1'){
          if(!validId(videoId))return json({message:'動画IDが不正です'},400);
          const rows=await env.USER_DB.prepare("SELECT id,data_json FROM notifications WHERE json_extract(data_json,'$.video_id')=?").bind(videoId).all();
          const records=rows.results||[];
          const hasOwn=records.some(row=>{const x=JSON.parse(row.data_json),emails=(Array.isArray(x.emails)?x.emails:(x.email?[x.email]:[])).map(v=>String(v).toLowerCase());return emails.includes(email);});
          if(!hasOwn)return json({message:'自分宛ての通知があるMVだけ、すべて解除できます'},403);
          let removed=0;
          for(const row of records){await deleteNotification(env,row.id);removed++;}
          return json({ok:true,deleted:true,removed});
        }
        const id=(url.searchParams.get('id')||'').trim();if(!id)return json({message:'通知IDが必要です'},400);
        const previous=await readNotification(env,id);if(!previous)return json({message:'通知設定が見つかりません'},404);
        const recipients=(Array.isArray(previous.emails)?previous.emails:(previous.email?[previous.email]:[])).map(v=>String(v).toLowerCase());
        if(!recipients.includes(email))return json({message:'この通知を解除する権限がありません'},403);
        const emails=recipients.filter(v=>v!==email),sentBy={...(previous.sent_by_email||{})};delete sentBy[email];
        if(!emails.length){await deleteNotification(env,id);return json({ok:true,deleted:true});}
        const data={...previous,emails,sent_by_email:sentBy,updated_at:new Date().toISOString()};if(String(data.email||'').toLowerCase()===email)data.email=emails[0]||'';delete data._revision;
        try{await saveNotification(env,id,data,previous);return json({ok:true,deleted:false});}
        catch(e){return json({message:e.message||'通知設定を解除できませんでした'},409);}
      }
      if(request.method!=="GET")return json({message:"Method not allowed"},405);
      const rows=await env.USER_DB.prepare(`SELECT id,data_json,active FROM notifications
        WHERE lower(COALESCE(json_extract(data_json,'$.email'),''))=?
           OR EXISTS (SELECT 1 FROM json_each(data_json,'$.emails') WHERE lower(value)=?)
        ORDER BY updated_at DESC LIMIT 100`).bind(email,email).all();
      const notifications=(rows.results||[]).map(row=>{
        const x=JSON.parse(row.data_json),by=x.sent_by_email?.[email]||{};
        const legacy=String(x.email||'').toLowerCase()===email?(x.sent||{}):{};
        const sent={...legacy,...by};
        return {id:String(row.id),title:String(x.title||'MV'),video_id:String(x.video_id||''),goal:Number(x.goal||0),thresholds:(Array.isArray(x.thresholds)?x.thresholds:[]).map(Number).filter(Number.isFinite),enabled:!!x.enabled,achievement_sent:!!sent.achievement,thresholds_sent:Object.keys(sent).filter(k=>/^\d+$/.test(k)).map(Number)};
      }).filter(x=>!videoId||x.video_id===videoId);
      return json({email,notifications});
    }

    if (url.pathname === "/api/notify") {
      try{await requireNotificationStore(env);}catch(e){return json({message:e.message},503);}
      const clientId=(url.searchParams.get("client_id")||"").trim();
      if(request.method==="GET"){
        if(!clientId)return json({message:"client_idが必要です"},400);
        const x=await readNotification(env,clientId);
        return json(x?{enabled:true,emails:(Array.isArray(x.emails)?x.emails:(x.email?[x.email]:[])),thresholds:x.thresholds}:{enabled:false});
      }
      if(request.method==="DELETE"){
        if(!clientId)return json({message:"client_idが必要です"},400);
        try{await deleteNotification(env,clientId);return json({ok:true});}catch(e){return json({message:e.message},409);}
      }
      if(request.method==="POST"){
        let b;try{b=await request.json()}catch{return json({message:"JSONが不正です"},400)}
        const cid=String(b.client_id||"").trim(),vid=String(b.video_id||"").trim();
        const goal=Math.floor(Number(b.goal));
        const rawEmails=Array.isArray(b.emails)?b.emails:(b.email?[b.email]:[]);
        const emails=[...new Set(rawEmails.map(v=>String(v||"").trim().toLowerCase()).filter(Boolean))].slice(0,5);
        const thresholds=[...new Set((Array.isArray(b.thresholds)?b.thresholds:[])
          .map(x=>Math.floor(Number(x)))
          .filter(x=>Number.isFinite(x)&&x>=1&&x<=1000000000))]
          .sort((a,b)=>b-a).slice(0,2);
        if(!cid||!validId(vid)||!Number.isFinite(goal)||goal<=0||!emails.length||emails.some(e=>!validEmail(e))||!thresholds.length)
          return json({message:"通知設定を確認してください"},400);
        if(thresholds.length===2 && thresholds[0]===thresholds[1])
          return json({message:"1回目と2回目は違う回数にしてください"},400);
        const prev=await readNotification(env,cid);
        const reset=!prev||prev.video_id!==vid||Number(prev.goal)!==goal;
        const oldBy=reset?{}:{...(prev?.sent_by_email||{})};
        if(!reset && prev?.email && !oldBy[String(prev.email).toLowerCase()]) oldBy[String(prev.email).toLowerCase()]={...(prev.sent||{})};
        const sentBy={};
        for(const e of emails) sentBy[e]={...(oldBy[e]||{})};
        const data={enabled:true,client_id:cid,video_id:vid,title:String(b.title||"MV"),goal,emails,thresholds,
          sent:reset?{}:(prev?.sent||{}),sent_by_email:sentBy,created_at:prev?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};
        // Newly enabled thresholds are independently eligible for every recipient.
        if(prev?.thresholds)for(const e of emails)for(const t of thresholds)if(!prev.thresholds.includes(t))delete data.sent_by_email[e][String(t)];
        try{await saveNotification(env,cid,data,prev);return json({ok:true,emergency:false});}
        catch(err){return json({message:err.message||'通知設定を保存できませんでした',emergency:false},503);}
      }
      return json({message:"Method not allowed"},405);
    }

    return env.ASSETS.fetch(request);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.all([runNotifications(env),cronQuotaCorrection(env)]));
  }
};
