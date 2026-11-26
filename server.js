const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const SECRET = process.env.SESSION_SECRET ||
  crypto.randomBytes(32).toString('hex');

const ADMIN_USER = process.env.ADMIN_USERNAME || 'godadmin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASS || ADMIN_PASS.length < 12) {
  console.error('Set ADMIN_PASSWORD (at least 12 characters).');
  process.exit(1);
}

const hash = s =>
  crypto.createHash('sha256').update(String(s)).digest('hex');

const secureEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const initial = {
  settings: {
    siteMode: 'public',
    resultsVisible: false
  },
  members: [
    ['Adi', 4510],
    ['Krishna', 4368],
    ['Neha', 3411],
    ['Divya', 3193],
    ['Damini', 2804],
    ['Raj', 2096],
    ['Aaradhya', 2015],
    ['Disha', 1935],
    ['Shreya', 1599],
    ['Vihan', 1459],
    ['Pratham', 1204],
    ['Viren', 1001],
    ['Batman', 597],
    ['Rathi', 500],
    ['Suhani', 296]
  ].map(([name, points]) => ({
    id: crypto.randomUUID(),
    name,
    points,
    codeHash: null,
    excluded: false
  })),
  tasks: [],
  announcements: [],
  polls: [],
  history: [],
  teams: [], spotlight: [], supportMessages: [], dailyCheckIns: {startDate:'', records:[], deductions:[]}
};

let db = initial;

const SUPABASE_URL =
  (process.env.SUPABASE_URL || '').replace(/\/$/, '');

const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY.');
  process.exit(1);
}

const endpoint = SUPABASE_URL + '/rest/v1/arena_data';

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

async function load() {
  const r = await fetch(endpoint + '?id=eq.1&select=data', {
    headers
  });

  if (!r.ok) {
    throw Error('Supabase read failed: HTTP ' + r.status);
  }

  const rows = await r.json();

  if (!rows.length) {
    throw Error('Missing arena_data row id=1');
  }

  const value = rows[0].data;

  if (!Array.isArray(value.members)) {
    throw Error('Invalid database state');
  }

  if (
    value.members.length === 0 &&
    value.tasks.length === 0 &&
    value.polls.length === 0 &&
    value.history.length === 0
  ) {
    db = initial;
    await save();
  } else {
    db = value;
    db.chamber ||= {sessions:[],activeId:null}; db.teams ||= []; db.spotlight ||= []; db.supportMessages ||= []; db.auctionHouse ||= {cycleStart:Date.now(), auctions:[], inventory:[], enabled:true}; db.dailyCheckIns ||= {startDate:'', records:[], deductions:[]}; db.confessionRoom ||= {active:null}; db.eventverse ||= {events:[],teams:[],templates:[],notifications:[],history:[]};
    for (const m of db.members) m.profile ||= {};
  }
}

// One-time eviction cleanup. Historical poll results and records are retained.
async function applyKartikEviction() {
  db.settings ||= {};
  db.settings.evictedMemberNames ||= [];
  if (db.settings.evictedMemberNames.includes('kartik')) return;
  const removed = db.members.filter(m => m.name.trim().toLowerCase() === 'kartik');
  if (!removed.length) {
    db.settings.evictedMemberNames.push('kartik');
    await save();
    return;
  }
  const ids = new Set(removed.map(m => m.id));
  db.members = db.members.filter(m => !ids.has(m.id));
  for (const t of db.teams || []) {
    t.members = (t.members || []).filter(id => !ids.has(id));
    if (ids.has(t.captainId)) t.captainId = '';
  }
  db.spotlight = (db.spotlight || []).filter(x => !ids.has(x.memberId));
  db.supportMessages = (db.supportMessages || []).filter(x => !ids.has(x.memberId));
  if (db.chamber) {
    for (const session of db.chamber.sessions || []) {
      if (session.status !== 'complete' && session.members?.some(id => ids.has(id))) {
        session.status = 'complete';
        session.reason = 'Session closed following member eviction';
        session.completedAt = Date.now();
      }
    }
    if (db.chamber.sessions?.find(x => x.id === db.chamber.activeId)?.status === 'complete') db.chamber.activeId = null;
  }
  // Keep historical votes, purchases, and records for audit integrity.
  // The removed member can no longer authenticate or participate in any module.
  db.settings.evictedMemberNames.push('kartik');
  await save();
  console.log('Eviction applied: Kartik removed from active membership and access.');
}

async function save() {
  const r = await fetch(endpoint + '?id=eq.1', {
    method: 'PATCH',
    headers: {
      ...headers,
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ data: db })
  });

  if (!r.ok) {
    throw Error('Supabase save failed: HTTP ' + r.status);
  }

  const rows = await r.json();

  if (!rows.length) {
    throw Error('Supabase update affected no rows');
  }
}

function send(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(obj));
}

function sign(v) {
  return crypto
    .createHmac('sha256', SECRET)
    .update(v)
    .digest('hex');
}

function token() {
  const value = Buffer.from(JSON.stringify({
    u: ADMIN_USER,
    exp: Date.now() + 12 * 3600000
  })).toString('base64url');

  return value + '.' + sign(value);
}

function isAdmin(req) {
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map(s => s.trim())
    .find(s => s.startsWith('arena_session='));

  if (!cookie) return false;

  const t = cookie.slice(14);
  const i = t.lastIndexOf('.');

  if (i < 0 || !secureEq(sign(t.slice(0, i)), t.slice(i + 1))) {
    return false;
  }

  try {
    const d = JSON.parse(
      Buffer.from(t.slice(0, i), 'base64url')
    );
    return d.u === ADMIN_USER && d.exp > Date.now();
  } catch {
    return false;
  }
}

function memberSession(req) {
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('arena_member='));
  if (!raw) return null;
  const t = raw.slice('arena_member='.length), i = t.lastIndexOf('.');
  if (i < 0 || !secureEq(sign('member:' + t.slice(0,i)),t.slice(i+1))) return null;
  try {
    const d = JSON.parse(Buffer.from(t.slice(0,i),'base64url'));
    if (d.exp < Date.now()) return null;
    const m = db.members.find(x => x.id === d.id);
    return m && m.codeHash && secureEq(m.codeHash,d.codeHash) ? m : null;
  } catch { return null; }
}
function safeProfile(m, detailed=false) {
  const pr=m.profile||{};
  const team=db.teams.find(t => t.members?.includes(m.id));
  const rank=ranked().find(x=>x.id===m.id)?.rank;
  return {id:m.id,name:m.name,rank,points:m.points,photo:pr.photo||'',bio:pr.bio||'',title:pr.title||'',team:team?.name||'',captain:team?.captainId===m.id,achievements:detailed?(pr.achievements||[]):(pr.achievements||[]).filter(x=>x.public),records:detailed?(pr.records||[]):(pr.records||[]).filter(x=>x.public),visibility:pr.visibility||'private'};
}
function teamView(t) {
  const ms=(t.members||[]).map(id=>db.members.find(m=>m.id===id)).filter(Boolean);
  return {id:t.id,name:t.name,captainId:t.captainId||'',captain:db.members.find(m=>m.id===t.captainId)?.name||'',members:ms.map(m=>({id:m.id,name:m.name})),memberPoints:ms.reduce((sum,m)=>sum+m.points,0),competitionPoints:t.competitionPoints||0};
}
function photoValid(v) {
  return v === '' || (typeof v==='string' && v.length<=65000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v));
}
function ranked() {
  return [...db.members]
    .sort((a, b) =>
      b.points - a.points || a.name.localeCompare(b.name)
    )
    .map((m, i) => ({
      id: m.id,
      name: m.name,
      points: m.points,
      rank: i + 1
    }));
}

function nominationSummary(p) {
  const counts = p.choices.map(c =>
    p.votes.filter(v => v.choices.includes(c)).length
  );
  const officialScores = p.officialScores || {};
  const resultCounts = p.choices.map((id, i) =>
    Number.isInteger(officialScores[id]) ? officialScores[id] : counts[i]);
  const requested = Number.isInteger(p.autoNominationCount)
    ? p.autoNominationCount : 3;
  const limit = Math.min(Math.max(requested, 0), p.choices.length);
  const sorted = [...resultCounts].sort((a, b) => b - a);
  // Zero votes do not nominate anyone automatically.
  const cutoff = limit ? sorted[limit - 1] : 0;
  const auto = p.choices.filter((c, i) => limit > 0 &&
    resultCounts[i] > 0 && resultCounts[i] >= cutoff);
  const manual = p.manualNominations || {};
  const ids = [...new Set([...auto, ...Object.keys(manual)])]
    .filter(id => p.choices.includes(id));
  return { counts, resultCounts, nominated: ids.map(id => ({
    id,
    votes: resultCounts[p.choices.indexOf(id)],
    scoreAdjusted: Object.prototype.hasOwnProperty.call(officialScores, id),
    automatic: auto.includes(id),
    manual: Object.prototype.hasOwnProperty.call(manual, id),
    reason: String(manual[id] || '')
  })).sort((a, b) => b.votes - a.votes) };
}

function indiaDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function ensureDailyCheckIns() {
  db.dailyCheckIns ||= { startDate: '', records: [], deductions: [] };
  db.dailyCheckIns.records ||= [];
  db.dailyCheckIns.deductions ||= [];
  db.dailyCheckIns.dismissed ||= [];
  if (!db.dailyCheckIns.startDate) db.dailyCheckIns.startDate = indiaDateString();
  return db.dailyCheckIns;
}
function dailyCheckInPending() {
  const data = ensureDailyCheckIns();
  const today = indiaDateString();
  const pending = [];
  const start = new Date(data.startDate + 'T00:00:00+05:30');
  const end = new Date(today + 'T00:00:00+05:30');
  for (let cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const date = indiaDateString(cursor);
    for (const member of db.members) {
      const memberStart = member.checkInStartDate || data.startDate;
      if (date < memberStart) continue;
      const checked = data.records.some(r => r.memberId === member.id && r.date === date);
      const processed = data.deductions.some(r => r.memberId === member.id && r.date === date);
      const dismissed = data.dismissed.some(r => r.memberId === member.id && r.date === date);
      if (!checked && !processed && !dismissed) pending.push({ memberId: member.id, memberName: member.name, date, points: 50 });
    }
  }
  return pending;
}

function publicData(admin) {
  const locked = db.settings.siteMode !== 'public' && !admin;

  return {
    settings: db.settings,
    locked,
    leaderboard: locked ? [] : ranked(),
    tasks: locked ? [] : db.tasks,
    announcements: locked ? [] : (db.announcements || []).filter(a => !a.hidden).sort((a,b) => Number(!!b.pinned)-Number(!!a.pinned)),
    polls: locked ? [] : db.polls
      .filter(p => p.status !== 'draft')
      .map(p => ({
        id: p.id,
        title: p.title,
        type: p.type,
        status: p.status,
        choices: p.choices,
        selectCount: p.selectCount,
        resultsVisible: p.resultsVisible,
        counts: p.resultsVisible === true &&
          (p.type !== 'nomination' || p.status === 'closed')
          ? (p.type === 'nomination' ? nominationSummary(p).resultCounts : p.choices.map(c => p.votes.filter(v => v.choices.includes(c)).length))
          : null,
        nominationResults: p.type === 'nomination' &&
          p.status === 'closed' && p.resultsVisible === true
          ? nominationSummary(p).nominated : null
      })),
    teams: locked ? [] : db.teams.map(teamView).sort((a,b)=>b.competitionPoints-a.competitionPoints),
    spotlight: locked ? [] : db.spotlight.filter(x=>!x.expires || new Date(x.expires).getTime()>Date.now()).sort((a,b)=>a.order-b.order).map(x=>({id:x.id,title:x.title,description:x.description,theme:x.theme,member:safeProfile(db.members.find(m=>m.id===x.memberId)||{id:'',name:'Former member',points:0,profile:{}},false)})),
    publicProfiles: locked ? [] : db.members.filter(m=>m.profile?.visibility==='public').map(m=>safeProfile(m,false)),
    admin
  };
}

function bad(res, msg, status = 400) {
  send(res, status, { error: msg });
}

function required(v, max = 150) {
  return typeof v === 'string' &&
    v.trim().length > 0 &&
    v.trim().length <= max;
}

function log(action, detail) {
  db.history.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    action,
    detail
  });

  db.history = db.history.slice(0, 500);
}


// Decision Chamber: server-authoritative timers and nomination records.
function chamberStore(){db.chamber ||= {sessions:[],activeId:null};return db.chamber;}
function chamberActive(){const c=chamberStore();return c.sessions.find(s=>s.id===c.activeId)||null;}
function chamberName(id){return db.members.find(m=>m.id===id)?.name||'Member';}
function chamberNominate(s,ids,reason){
  s.nominated=[...new Set(ids)];s.reason=reason;s.status='complete';s.completedAt=Date.now();
  s.selections={};
  const p=db.polls.find(p=>p.id===s.pollId&&p.type==='nomination');
  if(p){p.manualNominations ||= {};for(const id of s.nominated){if(!p.choices.includes(id))p.choices.push(id);p.manualNominations[id]='Decision Chamber: '+reason;}}
  log('Chamber nomination',s.nominated.map(chamberName).join(', ')+' — '+reason);
}
function chamberTick(s){
  if(!s||s.status==='complete'||s.status==='cancelled')return false;
  const now=Date.now();
  if(s.status==='discussion'){for(const id of s.members){if(s.online[id]&&s.lastSeen?.[id]&&now-s.lastSeen[id]>15000){s.online[id]=false;delete s.selections[id];}}}
  if(s.status==='scheduled'&&now>=s.entryDeadline){
    const absent=s.members.filter(id=>!s.joined[id]);
    if(absent.length){chamberNominate(s,absent,'Missed scheduled reporting deadline');return true;}
    s.status='discussion';s.decisionEndsAt=now+300000;return true;
  }
  if(s.status==='discussion'&&now>=s.decisionEndsAt){
    const missing=s.members.filter(id=>!s.online[id]);
    chamberNominate(s,missing.length?missing:s.members,missing.length?'Did not return before countdown':'No mutual decision');return true;
  }
  return false;
}
function chamberView(s,admin,member){
  if(!s)return null;
  const eligible=!!member&&s.members.includes(member.id);
  const visible=admin||eligible||s.namesVisible!==false;
  const base={id:s.id,status:s.status,namesVisible:s.namesVisible!==false,members:s.members.map((id,i)=>({id:visible?id:null,name:visible?chamberName(id):'Hidden Participant '+(i+1),joined:visible?!!s.joined[id]:false,online:visible?!!s.online[id]:false})),reportAt:s.reportAt,entryDeadline:s.entryDeadline,decisionEndsAt:s.decisionEndsAt||null,completedAt:s.completedAt||null,revealed:!!s.revealed};
  if(admin||eligible){base.messages=s.messages;base.selections=admin?s.selections:{mine:s.selections[member.id]||null};base.nominated=s.status==='complete'&&(admin||s.revealed)?s.nominated:[];base.reason=admin||s.revealed?s.reason:null;}
  if(s.revealed){base.nominated=s.nominated;base.reason=s.reason;}
  return base;
}

// CONFESSION ROOM — isolated from Decision Chamber; only God Admin controls sessions.
function confessionStore(){db.confessionRoom ||= {active:null};return db.confessionRoom;}
function confessionSafe(s,admin,member){
  if(!s)return null;
  const invited=s.invited.includes(member?.id);
  const canRead=admin||(invited&&s.verified?.[member.id]);
  const participants=s.invited.map(id=>({id:admin?id:undefined,isMe:!!member&&id===member.id,removed:s.removed.includes(id),name:db.members.find(m=>m.id===id)?.name||'Member',muted:!!s.muted[id],mediaAllowed:!!s.mediaAllowed[id],verified:!!s.verified[id]}));
  const out={id:s.id,status:s.status,participants,createdAt:s.createdAt,canEnter:!!(invited&&!s.removed.includes(member?.id)),verified:!!(invited&&s.verified?.[member?.id]),removed:!!member&&s.removed.includes(member.id),messages:canRead?s.messages.map(m=>({id:m.id,name:m.name,text:m.text||'',media:m.media?{type:m.media.type,name:m.media.name}:null,at:m.at})):[]};
  if(admin)out.admin={invited:s.invited,muted:s.muted,mediaAllowed:s.mediaAllowed,removed:s.removed};
  return out;
}
async function confessionDeleteMedia(s){
  const bucket='ffgc2k26-confession';
  const paths=(s.messages||[]).filter(m=>m.media?.path).map(m=>m.media.path);
  if(!paths.length)return;
  const r=await fetch(SUPABASE_URL+'/storage/v1/object/'+bucket,{method:'DELETE',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json'},body:JSON.stringify({prefixes:paths})});
  if(!r.ok)throw Error('Confession media cleanup failed: '+(await r.text()).slice(0,180));
}
async function confessionEnsureBucket(){
  const bucket='ffgc2k26-confession',h={apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json'};
  let r=await fetch(SUPABASE_URL+'/storage/v1/bucket',{method:'POST',headers:h,body:JSON.stringify({id:bucket,name:bucket,public:false,file_size_limit:8*1024*1024,allowed_mime_types:['image/jpeg','image/png','image/webp','image/gif']})});
  if(r.ok||r.status===409)return;
  const detail=await r.text().catch(()=> '');
  if(!/already exists|duplicate|409/i.test(detail))throw Error('Confession storage bucket setup failed: '+detail.slice(0,160));
}

async function api(req, res, url) {
  let b = {};

  if (req.method !== 'GET') {
    try {
      const chunks = [];
      let size = 0;

      for await (const c of req) {
        size += c.length;
        if (size > (url.pathname === '/api/voice/admin' ? 64 * 1024 * 1024 : url.pathname.startsWith('/api/confession/media') ? 11 * 1024 * 1024 : url.pathname.startsWith('/api/eventverse/') ? 220000 : 100000)) throw Error('Payload too large');
        chunks.push(c);
      }

      b = JSON.parse(
        Buffer.concat(chunks).toString() || '{}'
      );
    } catch {
      return bad(res, 'Invalid request body');
    }
  }

  const route = url.pathname;
  const admin = isAdmin(req);
  // God Admin-only hard shutdown: all member API routes are denied server-side.
  if (db.settings.siteMode === 'shutdown' && !admin) {
    if (route === '/api/public' && req.method === 'GET') return send(res,200,{settings:{siteMode:'shutdown'},locked:true,leaderboard:[],tasks:[],announcements:[],polls:[],teams:[],spotlight:[],publicProfiles:[],admin:false});
    if (route === '/api/login' && req.method === 'POST') { /* permit God Admin login below */ }
    else return bad(res,'Arena temporarily closed by God Admin',503);
  }



  // VOICE CENTER: isolated metadata + private Supabase Storage bucket.
  if (route.startsWith('/api/voice/')) {
    const member = memberSession(req);
    const bucket = 'ffgc2k26-voice';
    db.voiceBroadcasts ||= [];
    const storageHeaders = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
    const ensureBucket = async () => {
      const config = { public: false, file_size_limit: 45000000,
        allowed_mime_types: ['audio/mpeg','audio/mp4','audio/x-m4a','audio/wav','audio/ogg','audio/webm'] };
      const r = await fetch(SUPABASE_URL + '/storage/v1/bucket', {
        method: 'POST', headers: { ...storageHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bucket, name: bucket, ...config })
      });
      if (r.ok) return;
      const detail = await r.text().catch(() => '');
      let parsed = {};
      try { parsed = JSON.parse(detail); } catch {}
      const alreadyExists = r.status === 409 || parsed.statusCode === '409' || parsed.code === 'BucketAlreadyExists';
      if (!alreadyExists) throw Error('Voice Storage bucket setup failed: HTTP ' + r.status + ' ' + detail.slice(0,180));
      const update = await fetch(SUPABASE_URL + '/storage/v1/bucket/' + bucket, {
        method: 'PUT', headers: { ...storageHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!update.ok) {
        const updateDetail = await update.text().catch(() => '');
        throw Error('Voice Storage bucket update failed: HTTP ' + update.status + ' ' + updateDetail.slice(0,180));
      }
    };
    const safeBroadcast = x => ({ id:x.id, title:x.title, note:x.note, mime:x.mime, size:x.size, createdAt:x.createdAt, createdBy:x.createdBy });

    if (route === '/api/voice/state' && req.method === 'GET') {
      if (!member && !admin) return bad(res, 'Login with your private member ID first', 401);
      return send(res, 200, { admin, member: member ? { id:member.id, name:member.name } : null,
        broadcasts: db.voiceBroadcasts.filter(x => !x.deleted).map(safeBroadcast) });
    }
    if (route === '/api/voice/audio' && req.method === 'GET') {
      if (!member && !admin) return bad(res, 'Login required', 401);
      const item = db.voiceBroadcasts.find(x => x.id === url.searchParams.get('id') && !x.deleted);
      if (!item) return bad(res, 'Audio not found', 404);
      const r = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + item.path, { headers: storageHeaders });
      if (!r.ok) return bad(res, 'Audio could not be loaded', 502);
      res.writeHead(200, { 'Content-Type': item.mime, 'Content-Length': item.size, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Content-Disposition':'inline' });
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (route === '/api/voice/admin' && req.method === 'POST') {
      if (!admin) return bad(res, 'God Admin authentication required', 403);
      if (b.action === 'publish') {
        if (typeof b.title !== 'string' || !b.title.trim() || b.title.length > 90) return bad(res, 'Enter a title (maximum 90 characters)');
        if (typeof b.audio !== 'string' || !/^data:audio\/(mpeg|mp4|x-m4a|wav|ogg|webm);base64,[A-Za-z0-9+/=]+$/.test(b.audio)) return bad(res, 'Choose a supported audio file');
        const match = b.audio.match(/^data:(audio\/[a-z0-9.+-]+);base64,(.*)$/s);
        const data = Buffer.from(match[2], 'base64');
        if (!data.length || data.length > 45000000) return bad(res, 'Audio must be 45 MB or smaller');
        const ext = ({'audio/mpeg':'mp3','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/wav':'wav','audio/ogg':'ogg','audio/webm':'webm'})[match[1]];
        if (!ext) return bad(res, 'Unsupported audio format');
        await ensureBucket();
        const id = crypto.randomUUID();
        const objectPath = new Date().toISOString().slice(0,10) + '/' + id + '.' + ext;
        const upload = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket + '/' + objectPath, {
          method:'POST', headers:{...storageHeaders,'Content-Type':match[1],'x-upsert':'false'}, body:data
        });
        if (!upload.ok) { const detail=await upload.text().catch(()=> ''); throw Error('Voice upload failed: HTTP '+upload.status+' '+detail.slice(0,180)); }
        const item = { id, title:b.title.trim(), note:typeof b.note==='string'?b.note.trim().slice(0,240):'', mime:match[1], size:data.length, path:objectPath, createdAt:new Date().toISOString(), createdBy:ADMIN_USER };
        db.voiceBroadcasts.unshift(item);
        await save();
        return send(res, 200, { ok:true, broadcast:safeBroadcast(item) });
      }
      if (b.action === 'delete') {
        const item = db.voiceBroadcasts.find(x => x.id === b.id && !x.deleted);
        if (!item) return bad(res, 'Broadcast not found', 404);
        const remove = await fetch(SUPABASE_URL + '/storage/v1/object/' + bucket, { method:'DELETE', headers:{...storageHeaders,'Content-Type':'application/json'}, body:JSON.stringify({prefixes:[item.path]}) });
        if (!remove.ok && remove.status !== 404) return bad(res, 'Could not delete audio from storage', 502);
        item.deleted = true;
        await save();
        return send(res, 200, {ok:true});
      }
      return bad(res, 'Unknown Voice Center action');
    }
    return bad(res, 'Not found', 404);
  }

  // ELIMINATION ARENA: independent from existing polls and nominations.
  // Stored inside the same Supabase JSON row; no migration or reset required.
  if (route.startsWith('/api/elimination/')) {
    db.eliminationPolls ||= [];
    const member = memberSession(req);
    const now = Date.now();
    const statusOf = p => p.closed ? 'closed' : p.paused ? 'paused' : now < Date.parse(p.startAt) ? 'scheduled' : now >= Date.parse(p.endAt) ? 'closed' : 'active';
    const publicPoll = p => {
      const status=statusOf(p), show=!!p.revealed && status==='closed';
      const data={id:p.id,title:p.title,mode:p.mode,startAt:p.startAt,endAt:p.endAt,status,
        candidates:p.candidateIds.map(id=>({id,name:db.members.find(m=>m.id===id)?.name||'Unknown'})),
        voted:member?!!p.votes.find(v=>v.memberId===member.id):false,
        totalVotes:show?p.votes.length:null,revealed:show};
      if(show) {
        data.counts=Object.fromEntries(p.candidateIds.map(id=>[id,p.votes.filter(v=>v.candidateId===id).length]));
        const counts=Object.values(data.counts), target=p.mode==='save'?Math.min(...counts):Math.max(...counts);
        data.atRisk=p.candidateIds.filter(id=>data.counts[id]===target);
        data.tie=data.atRisk.length>1;
      }
      return data;
    };
    if(route==='/api/elimination/state'&&req.method==='GET'){
      return send(res,200,{polls:db.eliminationPolls.map(p=>admin?{
        ...publicPoll(p),paused:!!p.paused,closed:!!p.closed,revealed:!!p.revealed,
        votes:p.votes.map(v=>({memberId:v.memberId,candidateId:v.candidateId,at:v.at})),
        counts:Object.fromEntries(p.candidateIds.map(id=>[id,p.votes.filter(v=>v.candidateId===id).length]))
      }:publicPoll(p)),members:admin?db.members.map(m=>({id:m.id,name:m.name})):undefined,
      authenticated:!!member});
    }
    if(route==='/api/elimination/vote'&&req.method==='POST'){
      if(db.settings.siteMode!=='public')return bad(res,'Website voting is closed',403);
      const p=db.eliminationPolls.find(x=>x.id===b.pollId);
      if(!p||statusOf(p)!=='active')return bad(res,'Elimination poll is not open',403);
      if(!required(b.code,100))return bad(res,'Enter your private ID');
      const voter=db.members.find(m=>m.codeHash&&secureEq(m.codeHash,hash(String(b.code).trim().toUpperCase())));
      if(!voter)return bad(res,'Incorrect private ID',403);
      if(p.votes.some(v=>v.memberId===voter.id))return bad(res,'This private ID has already voted',409);
      if(!p.candidateIds.includes(b.candidateId))return bad(res,'Choose a valid elimination candidate');
      if(voter.id===b.candidateId)return bad(res,'You cannot vote for yourself',403);
      // Re-check deadline immediately before accepting a vote.
      if(statusOf(p)!=='active')return bad(res,'Voting has closed',403);
      p.votes.push({memberId:voter.id,candidateId:b.candidateId,at:new Date().toISOString()});
      await save();return send(res,200,{ok:true});
    }
    if(route==='/api/elimination/admin'&&req.method==='POST'){
      if(!admin)return bad(res,'God Admin only',403);
      if(b.action==='create'){
        const ids=Array.isArray(b.candidateIds)?b.candidateIds:[];
        if(!required(b.title,140)||!['save','evict'].includes(b.mode))return bad(res,'Invalid poll title or mode');
        if(ids.length<2||new Set(ids).size!==ids.length||!ids.every(id=>db.members.some(m=>m.id===id)))return bad(res,'Select at least two different registered candidates');
        const start=Date.parse(b.startAt),end=Date.parse(b.endAt);
        if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>90*86400000)return bad(res,'Choose valid start/end times (max 90 days)');
        db.eliminationPolls.push({id:crypto.randomUUID(),title:b.title.trim(),mode:b.mode,candidateIds:ids,startAt:new Date(start).toISOString(),endAt:new Date(end).toISOString(),paused:false,closed:false,revealed:false,votes:[]});
        log('Elimination poll created',b.title.trim());await save();return send(res,200,{ok:true});
      }
      const p=db.eliminationPolls.find(x=>x.id===b.pollId);
      if(!p)return bad(res,'Poll not found',404);
      if(b.action==='delete'){
        db.eliminationPolls=db.eliminationPolls.filter(x=>x.id!==p.id);
      } else if(b.action==='pause'){
        if(statusOf(p)!=='active')return bad(res,'Only an active poll can be paused');p.paused=true;
      } else if(b.action==='resume'){
        if(!p.paused||p.closed||Date.now()>=Date.parse(p.endAt))return bad(res,'Cannot resume this poll');p.paused=false;
      } else if(b.action==='close'){
        p.closed=true;p.paused=false;
      } else if(b.action==='reveal'){
        if(statusOf(p)!=='closed')return bad(res,'Close the poll before revealing results');p.revealed=!!b.revealed;
      } else if(b.action==='schedule'){
        if(p.votes.length||p.closed||Date.now()>=Date.parse(p.startAt))return bad(res,'Schedule can only be edited before voting starts');
        const start=Date.parse(b.startAt),end=Date.parse(b.endAt);
        if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>90*86400000)return bad(res,'Invalid schedule');
        p.startAt=new Date(start).toISOString();p.endAt=new Date(end).toISOString();
      } else return bad(res,'Unknown action');
      log('Elimination poll '+b.action,p.title);await save();return send(res,200,{ok:true});
    }
    return bad(res,'Unknown elimination request',404);
  }

  // CONFESSION ROOM — private multi-member live chat. God Admin identity is always FFGC.
  if(route.startsWith('/api/confession/')){
    const store=confessionStore(),room=store.active,member=memberSession(req);
    if(route==='/api/confession/state'&&req.method==='GET')return send(res,200,{admin,memberId:member?.id||null,room:confessionSafe(room,admin,member),members:admin?db.members.map(m=>({id:m.id,name:m.name})):undefined});
    if(route==='/api/confession/admin'&&req.method==='POST'){
      if(!admin)return bad(res,'God Admin required',403);
      if(b.action==='create'){
        if(room&&room.status==='active')return bad(res,'Close the current Confession Room first');
        const ids=Array.isArray(b.memberIds)?[...new Set(b.memberIds)]:[];
        if(!ids.length||ids.length>30||ids.some(id=>!db.members.some(m=>m.id===id)))return bad(res,'Select between 1 and 30 valid members');
        store.active={id:crypto.randomUUID(),status:'active',invited:ids,verified:{},muted:Object.fromEntries(ids.map(id=>[id,false])),mediaAllowed:Object.fromEntries(ids.map(id=>[id,false])),removed:[],messages:[],createdAt:Date.now()};
        log('Confession Room opened',ids.map(chamberName).join(', '));await save();return send(res,200,{ok:true});
      }
      if(!room||room.status!=='active')return bad(res,'No active Confession Room');
      if(b.action==='mute'||b.action==='media'){
        if(!room.invited.includes(b.memberId)||room.removed.includes(b.memberId))return bad(res,'Participant not found');
        if(b.action==='mute')room.muted[b.memberId]=!!b.value;else room.mediaAllowed[b.memberId]=!!b.value;
      }else if(b.action==='remove'){
        const ids=Array.isArray(b.memberIds)?b.memberIds:[b.memberId];
        for(const id of ids)if(room.invited.includes(id)&&!room.removed.includes(id)){room.removed.push(id);delete room.verified[id];}
      }else if(b.action==='close'){
        await confessionDeleteMedia(room);room.messages=[];room.status='closed';room.closedAt=Date.now();store.active=null;log('Confession Room closed','Session and chat/media cleanup requested');await save();return send(res,200,{ok:true});
      }else return bad(res,'Unknown Confession Room action');
      await save();return send(res,200,{ok:true});
    }
    if(route==='/api/confession/enter'&&req.method==='POST'){
      if(!member)return bad(res,'Member login required',401);
      if(!room||room.status!=='active'||!room.invited.includes(member.id)||room.removed.includes(member.id))return bad(res,'You are not invited to this room',403);
      if(!required(b.privateId,100))return bad(res,'Enter your Private ID');
      const verified=db.members.find(m=>m.id===member.id&&m.codeHash&&secureEq(m.codeHash,hash(String(b.privateId).trim().toUpperCase())));
      if(!verified)return bad(res,'Private ID does not match your logged-in account',403);
      room.verified[member.id]=true;await save();return send(res,200,{ok:true});
    }
    if(route==='/api/confession/message'&&req.method==='POST'){
      if(!member||!room||room.status!=='active'||!room.invited.includes(member.id)||room.removed.includes(member.id)||!room.verified[member.id])return bad(res,'Confession Room access denied',403);
      if(room.muted[member.id])return bad(res,'You are muted by FFGC');
      if(!required(b.text,1500))return bad(res,'Enter a message');
      if(room.messages.length>=500)return bad(res,'Session message limit reached');
      room.messages.push({id:crypto.randomUUID(),memberId:member.id,name:member.name,text:b.text.trim(),at:Date.now()});await save();return send(res,200,{ok:true});
    }
    if(route==='/api/confession/media'&&req.method==='GET'){
      const msg=room?.messages.find(x=>x.id===url.searchParams.get('id')&&x.media?.path);
      if(!room||room.status!=='active'||!msg||(!admin&&(!member||!room.invited.includes(member.id)||room.removed.includes(member.id)||!room.verified[member.id])))return bad(res,'Media access denied',403);
      const file=await fetch(SUPABASE_URL+'/storage/v1/object/ffgc2k26-confession/'+msg.media.path,{headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY}});
      if(!file.ok)return bad(res,'Media unavailable',404);
      const bytes=Buffer.from(await file.arrayBuffer());res.writeHead(200,{'Content-Type':msg.media.type,'Content-Length':bytes.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
    }
    if(route==='/api/confession/media'&&req.method==='POST'){
      if(!room||room.status!=='active')return bad(res,'No active Confession Room');
      if(!admin&&(!member||!room.invited.includes(member.id)||room.removed.includes(member.id)||!room.verified[member.id]))return bad(res,'Confession Room access denied',403);
      if(!admin&&room.muted[member.id])return bad(res,'You are muted by FFGC');
      if(!admin&&!room.mediaAllowed[member.id])return bad(res,'Media sharing is disabled by FFGC');
      if(typeof b.data!=='string'||!/^data:image\/(jpeg|png|webp|gif);base64,/.test(b.data)||b.data.length>10*1024*1024)return bad(res,'Only images up to 7 MB are allowed');
      const match=b.data.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);if(!match)return bad(res,'Invalid image');
      const bytes=Buffer.from(match[2],'base64');if(bytes.length>7*1024*1024)return bad(res,'Image exceeds 7 MB');
      await confessionEnsureBucket();const ext=match[1].split('/')[1].replace('jpeg','jpg'),objectPath=room.id+'/'+crypto.randomUUID()+'.'+ext;
      const up=await fetch(SUPABASE_URL+'/storage/v1/object/ffgc2k26-confession/'+objectPath,{method:'POST',headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':match[1],'x-upsert':'false'},body:bytes});
      if(!up.ok)throw Error('Image upload failed: '+(await up.text()).slice(0,160));
      room.messages.push({id:crypto.randomUUID(),memberId:admin?null:member.id,name:admin?'FFGC':member.name,text:'',media:{path:objectPath,type:match[1],name:String(b.name||'Image').slice(0,100)},at:Date.now()});await save();return send(res,200,{ok:true});
    }
    if(route==='/api/confession/admin-message'&&req.method==='POST'){
      if(!admin)return bad(res,'God Admin required',403);if(!room||room.status!=='active'||!required(b.text,1500))return bad(res,'No active room or empty message');
      room.messages.push({id:crypto.randomUUID(),memberId:null,name:'FFGC',text:b.text.trim(),at:Date.now()});await save();return send(res,200,{ok:true});
    }
    return bad(res,'Not found',404);
  }

  // DECISION CHAMBER — member/admin authentication is enforced on every route.
  if(route.startsWith('/api/chamber/')){
    const c=chamberStore(),member=memberSession(req),s=chamberActive();
    if(s&&chamberTick(s))await save();
    if(route==='/api/chamber/state'&&req.method==='GET'){
      const history=admin?c.sessions.slice(-30).reverse().map(x=>chamberView(x,true,null)):[];
      return send(res,200,{active:chamberView(s,admin,member),history,admin,memberId:member?.id||null,polls:admin?db.polls.filter(p=>p.type==='nomination').map(p=>({id:p.id,title:p.title,status:p.status})):undefined,members:admin?db.members.map(m=>({id:m.id,name:m.name})):undefined});
    }
    if(!admin&&!member)return bad(res,'Member login required',401);
    if(route==='/api/chamber/admin'&&req.method==='POST'){
      if(!admin)return bad(res,'Admin required',403);
      if(b.action==='schedule'){
        if(s&&['scheduled','discussion'].includes(s.status))return bad(res,'Finish or cancel current session first');
        const members=Array.isArray(b.members)?b.members:[];
        if(members.length!==2||members[0]===members[1]||members.some(id=>!db.members.some(m=>m.id===id)))return bad(res,'Select two distinct members');
        const poll=db.polls.find(p=>p.id===b.pollId&&p.type==='nomination'&&p.status==='draft');
        if(!poll)return bad(res,'Select a draft nomination poll (before voting begins)');
        const reportAt=Date.parse(b.reportAt);
        if(!Number.isFinite(reportAt)||reportAt<Date.now()-60000||reportAt>Date.now()+90*86400000)return bad(res,'Choose a valid future reporting time');
        const x={id:crypto.randomUUID(),members,pollId:poll.id,reportAt,entryDeadline:reportAt+120000,decisionEndsAt:null,status:'scheduled',joined:{},online:{},selections:{},messages:[],nominated:[],revealed:false,namesVisible:b.namesVisible!==false,reason:null,createdAt:Date.now()};
        c.sessions.push(x);c.sessions=c.sessions.slice(-100);c.activeId=x.id;log('Chamber scheduled',members.map(chamberName).join(' vs '));await save();return send(res,200,{ok:true});
      }
      if(!s)return bad(res,'No active session');
      if(b.action==='visibility'){s.namesVisible=!!b.visible;log('Chamber visibility',s.namesVisible?'Shown':'Hidden');}
      else if(b.action==='reschedule'){if(s.status!=='scheduled')return bad(res,'Only scheduled sessions can be rescheduled');const at=Date.parse(b.reportAt);if(!Number.isFinite(at)||at<Date.now()-60000||at>Date.now()+90*86400000)return bad(res,'Choose a valid future reporting time');s.reportAt=at;s.entryDeadline=at+120000;log('Chamber rescheduled',s.id);}
      else if(b.action==='cancel'){if(s.status==='complete')return bad(res,'Completed results cannot be cancelled');s.status='cancelled';log('Chamber cancelled',s.id);}
      else if(b.action==='close'){if(s.status!=='complete'&&s.status!=='cancelled')return bad(res,'Finish or cancel session first');c.activeId=null;}
      else if(b.action==='reveal'){if(s.status!=='complete')return bad(res,'Result not ready');s.revealed=true;log('Chamber result revealed',s.id);}
      else if(b.action==='reveal-all'){for(const x of c.sessions)if(x.status==='complete')x.revealed=true;log('Chamber grand reveal','All completed results');}
      else return bad(res,'Unknown action');
      await save();return send(res,200,{ok:true});
    }
    if(!s||!member||!s.members.includes(member.id))return bad(res,'Chamber access restricted',403);
    if(route==='/api/chamber/join'&&req.method==='POST'){
      if(s.status!=='scheduled'&&s.status!=='discussion')return bad(res,'Session not open');
      if(Date.now()<s.reportAt)return bad(res,'Please wait until your scheduled reporting time');
      if(s.status==='scheduled'&&Date.now()>s.entryDeadline)return bad(res,'Entry deadline passed');
      s.joined[member.id]=true;s.online[member.id]=true;s.lastSeen ||= {};s.lastSeen[member.id]=Date.now();
      if(s.status==='scheduled'&&s.members.every(id=>s.joined[id])){s.status='discussion';s.decisionEndsAt=Date.now()+300000;}
      await save();return send(res,200,{ok:true});
    }
    if(route==='/api/chamber/heartbeat'&&req.method==='POST'){
      if(!s.joined[member.id]||s.status!=='discussion')return bad(res,'Not in discussion');
      // A deliberate exit remains offline until explicit rejoin.
      if(!s.online[member.id])return bad(res,'Rejoin to resume');
      s.lastSeen ||= {};s.lastSeen[member.id]=Date.now();return send(res,200,{ok:true});
    }
    if(route==='/api/chamber/exit'&&req.method==='POST'){
      if(s.status!=='discussion')return bad(res,'No active discussion');s.online[member.id]=false;delete s.selections[member.id];await save();return send(res,200,{ok:true});
    }
    if(route==='/api/chamber/rejoin'&&req.method==='POST'){
      if(s.status!=='discussion'||!s.joined[member.id]||Date.now()>=s.decisionEndsAt)return bad(res,'Rejoin window closed');s.online[member.id]=true;s.lastSeen ||= {};s.lastSeen[member.id]=Date.now();await save();return send(res,200,{ok:true});
    }
    if(route==='/api/chamber/message'&&req.method==='POST'){
      if(s.status!=='discussion'||!s.online[member.id]||!required(b.text,500))return bad(res,'Cannot send message');
      if(s.messages.length>=200)return bad(res,'Chat limit reached');
      s.messages.push({id:crypto.randomUUID(),memberId:member.id,name:member.name,text:b.text.trim(),at:Date.now()});await save();return send(res,200,{ok:true});
    }
    if(route==='/api/chamber/select'&&req.method==='POST'){
      if(s.status!=='discussion'||!s.online[member.id]||!s.members.includes(b.nomineeId))return bad(res,'Invalid nomination choice');
      s.selections[member.id]=b.nomineeId;
      if(s.members.every(id=>s.selections[id]===b.nomineeId))chamberNominate(s,[b.nomineeId],'Mutual agreement');
      await save();return send(res,200,{ok:true});
    }
    return bad(res,'Not found',404);
  }

  if (route.startsWith('/api/auction/')) {
    db.auctionHouse ||= {cycleStart:Date.now(), auctions:[], inventory:[], enabled:true};
    const house=db.auctionHouse, now=Date.now(), member=memberSession(req);
    if(!Number.isFinite(house.cycleStart)||house.cycleStart<=0||house.cycleStart>now) house.cycleStart=now;
    house.auctions ||= []; house.inventory ||= [];
    const cycleMs=10*24*60*60*1000;
    const cycle=Math.max(0,Math.floor((now-house.cycleStart)/cycleMs));
    const bidsOf=(a)=>a.bids||[];
    const owned=(id)=>house.inventory.filter(x=>x.memberId===id);
    const spent=(id)=>house.auctions.filter(a=>a.cycle===cycle&&a.closed&&a.winnerId===id).reduce((n,a)=>n+a.winningBid,0);
    const locked=(id)=>house.auctions.filter(a=>a.cycle===cycle&&!a.closed&&a.endAt>now).reduce((n,a)=>{const top=bidsOf(a).at(-1);return n+(top?.memberId===id?top.amount:0)},0);
    const balance=(id)=>Math.max(0,1000-spent(id)-locked(id));
    if(settleAuctions()) await save();
    if(route==='/api/auction/state'&&req.method==='GET') return send(res,200,{enabled:house.enabled,cycle,cycleEndsAt:new Date(house.cycleStart+(cycle+1)*cycleMs).toISOString(),wallet:member?{memberId:member.id,balance:balance(member.id),locked:locked(member.id),spent:spent(member.id)}:null,inventory:member?owned(member.id):[],auctions:house.auctions.map(a=>({id:a.id,archived:!!a.archived,title:a.title,description:a.description,rarity:a.rarity,startAt:a.startAt,endAt:a.endAt,startingBid:a.startingBid,minIncrement:a.minIncrement,cycle:a.cycle,closed:a.closed,winnerId:a.closed?a.winnerId:null,winningBid:a.closed?a.winningBid:null,highestBid:bidsOf(a).at(-1)?.amount||0,bids:bidsOf(a).map(x=>({memberName:db.members.find(m=>m.id===x.memberId)?.name||'Member',amount:x.amount,at:x.at}))}))});
    if(route==='/api/auction/bid'&&req.method==='POST'){
      if(!member)return bad(res,'Member login required',401);
      if(!house.enabled)return bad(res,'Auction House disabled',403);
      const a=house.auctions.find(x=>x.id===b.id);if(!a||a.archived||a.closed||a.cycle!==cycle||now<a.startAt||now>=a.endAt)return bad(res,'Auction is not active');
      const top=bidsOf(a).at(-1), amount=Number(b.amount), min=top?top.amount+a.minIncrement:a.startingBid;
      if(!Number.isSafeInteger(amount)||amount<min||amount>1000)return bad(res,'Invalid bid amount');
      if(top?.memberId===member.id)return bad(res,'You already have the highest bid');
      if(amount>balance(member.id))return bad(res,'Insufficient available coins');
      a.bids.push({memberId:member.id,amount,at:new Date(now).toISOString()});
      if(a.endAt-now<=120000)a.endAt=now+120000;
      await save();return send(res,200,{ok:true});
    }
    house.rewardRequests ||= [];
    if(route==='/api/auction/requests'&&req.method==='GET'){
      if(!member&&!admin)return bad(res,'Login required',401);
      const requests=admin?house.rewardRequests.map(r=>({...r,memberName:db.members.find(m=>m.id===r.memberId)?.name||'Member'})):house.rewardRequests.filter(r=>r.memberId===member.id);
      return send(res,200,{requests});
    }
    if(route==='/api/auction/request'&&req.method==='POST'){
      if(!member)return bad(res,'Member login required',401);
      const item=house.inventory.find(x=>x.id===b.rewardId&&x.memberId===member.id);
      if(!item||item.used||Date.parse(item.expiresAt)<=now)return bad(res,'Reward unavailable or expired');
      if(house.rewardRequests.some(r=>r.rewardId===item.id&&r.status==='pending'))return bad(res,'Request already pending');
      const targetMemberId=String(b.targetMemberId||'');
      if(targetMemberId&&!db.members.some(m=>m.id===targetMemberId))return bad(res,'Invalid target member');
      const note=String(b.note||'').trim().slice(0,500);
      if(!note)return bad(res,'Describe how you want to use the reward');
      house.rewardRequests.push({id:crypto.randomUUID(),rewardId:item.id,memberId:member.id,targetMemberId,note,status:'pending',createdAt:new Date(now).toISOString()});
      await save();return send(res,200,{ok:true});
    }
    if(route==='/api/auction/request-admin'&&req.method==='POST'){
      if(!admin)return bad(res,'Admin only',403);
      const r=house.rewardRequests.find(x=>x.id===b.id);
      if(!r||r.status!=='pending')return bad(res,'Request not pending');
      if(!['approve','reject'].includes(b.action))return bad(res,'Invalid action');
      const item=house.inventory.find(x=>x.id===r.rewardId);
      if(!item)return bad(res,'Reward not found');
      if(b.action==='approve'){
        if(item.used||Date.parse(item.expiresAt)<=now)return bad(res,'Reward used or expired');
        // Approval records redemption; admin applies game effects separately.
        item.used=true;item.usedAt=new Date(now).toISOString();r.status='approved';
      }else{r.status='rejected';r.reason=String(b.reason||'').slice(0,500)}
      r.reviewedAt=new Date(now).toISOString();
      await save();return send(res,200,{ok:true});
    }
    if(route==='/api/auction/suggestions'&&req.method==='GET'){
      if(!admin)return bad(res,'Admin only',403);
      const templates=[
        ['Double Spotlight','One extra spotlight feature; no nomination protection.','common'],
        ['Challenge Bonus','A one-time bonus challenge opportunity, subject to admin approval.','rare'],
        ['Profile Crown','A special crown badge on your member profile for 30 days.','epic'],
        ['Nomination Shield','One-time nomination protection; cannot stack with another shield.','legendary'],
        ['Team Spotlight','Feature your team on the arena homepage.','rare']
      ];
      const suggested=templates.map((t,i)=>({id:'suggest-'+cycle+'-'+i,title:t[0],description:t[1],rarity:t[2],startingBid:100+i*40,minIncrement:10}));
      return send(res,200,{cycle,suggestions:suggested,slotsRemaining:Math.max(0,5-house.auctions.filter(a=>a.cycle===cycle).length)});
    }
    if(route==='/api/auction/admin'&&req.method==='POST'){
      if(!admin)return bad(res,'Admin only',403);
      if(b.action==='create'){
        const title=String(b.title||'').trim(),description=String(b.description||'').trim(),startAt=Date.parse(b.startAt),endAt=Date.parse(b.endAt),startingBid=Number(b.startingBid),minIncrement=Number(b.minIncrement||10);
        if(!title||title.length>100||description.length>500||!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt||endAt<=now||startAt>=house.cycleStart+(cycle+1)*cycleMs||endAt>house.cycleStart+(cycle+1)*cycleMs||!Number.isSafeInteger(startingBid)||startingBid<1||startingBid>1000||!Number.isSafeInteger(minIncrement)||minIncrement<1||minIncrement>1000)return bad(res,'Invalid auction details');
        if(house.auctions.filter(x=>x.cycle===cycle).length>=5)return bad(res,'Maximum 5 auctions per cycle');
        house.auctions.push({id:crypto.randomUUID(),title,description,rarity:['common','rare','epic','legendary'].includes(b.rarity)?b.rarity:'rare',startAt,endAt,startingBid,minIncrement,cycle,bids:[],closed:false});
      }else if(b.action==='edit'){
        const a=house.auctions.find(x=>x.id===b.id);
        if(!a)return bad(res,'Auction not found',404);
        if(a.closed||a.bids.length)return bad(res,'Auctions with bids or closed auctions cannot be edited');
        const title=String(b.title||'').trim(),description=String(b.description||'').trim();
        const startAt=Date.parse(b.startAt),endAt=Date.parse(b.endAt);
        const startingBid=Number(b.startingBid),minIncrement=Number(b.minIncrement);
        if(!title||title.length>100||description.length>500||!Number.isFinite(startAt)||!Number.isFinite(endAt)||endAt<=startAt||endAt<=now||endAt>house.cycleStart+(a.cycle+1)*cycleMs||!Number.isSafeInteger(startingBid)||startingBid<1||startingBid>1000||!Number.isSafeInteger(minIncrement)||minIncrement<1||minIncrement>1000)return bad(res,'Invalid auction details');
        Object.assign(a,{title,description,startAt,endAt,startingBid,minIncrement,rarity:['common','rare','epic','legendary'].includes(b.rarity)?b.rarity:'rare'});
      }else if(b.action==='archive' || b.action==='restore'){
        const a=house.auctions.find(x=>x.id===b.id);
        if(!a)return bad(res,'Auction not found',404);
        a.archived=b.action==='archive';
      }else if(b.action==='delete'){
        const a=house.auctions.find(x=>x.id===b.id);
        if(!a)return bad(res,'Auction not found',404);
        if(a.bids.length||a.winnerId||house.inventory.some(x=>x.auctionId===a.id))return bad(res,'Auction has bids or awarded rewards; cannot permanently delete');
        house.auctions=house.auctions.filter(x=>x.id!==b.id);
        db.spotlight=db.spotlight.filter(x=>x.auctionId!==b.id);
      }else if(b.action==='enabled'){house.enabled=Boolean(b.enabled);

      }else return bad(res,'Unknown action');
      await save();return send(res,200,{ok:true});
    }
    return bad(res,'Not found',404);
  }


  // ADMIN LOGIN
  if (route === '/api/login' && req.method === 'POST') {
    if (
      b.username === ADMIN_USER &&
      typeof b.password === 'string' &&
      secureEq(hash(b.password), hash(ADMIN_PASS))
    ) {
      res.setHeader(
        'Set-Cookie',
        `arena_session=${token()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${
          process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''
        }`
      );

      return send(res, 200, { ok: true });
    }

    return bad(res, 'Invalid credentials', 401);
  }

  // LOGOUT
  if (route === '/api/logout' && req.method === 'POST') {
    res.setHeader(
      'Set-Cookie',
      'arena_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    );

    return send(res, 200, { ok: true });
  }

  // PUBLIC WEBSITE
  if (route === '/api/public' && req.method === 'GET') {
    return send(res, 200, publicData(admin));
  }

  // MEMBER LOGIN: existing private voting code, never returned to browser.
  if (route === '/api/member/login' && req.method === 'POST') {
    if (!required(b.code,100)) return bad(res,'Enter private member ID');
    const m=db.members.find(x=>x.codeHash && secureEq(x.codeHash,hash(b.code.trim().toUpperCase())));
    if (!m) return bad(res,'Invalid private member ID',403);
    const v=Buffer.from(JSON.stringify({id:m.id,codeHash:m.codeHash,exp:Date.now()+7*86400000})).toString('base64url');
    res.setHeader('Set-Cookie',`arena_member=${v}.${sign('member:'+v)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE==='true'?'; Secure':''}`);
    return send(res,200,{ok:true});
  }
  if (route === '/api/member/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie','arena_member=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return send(res,200,{ok:true});
  }
  if (route === '/api/member/me' && req.method === 'GET') {
    const m=memberSession(req);
    return m ? send(res,200,{profile:safeProfile(m,true)}) : bad(res,'Member login required',401);
  }
  // FFGC EVENTVERSE — permanent events, personal/team tasks, submissions and evaluation.
  if (route.startsWith('/api/eventverse/')) {
    const ev = db.eventverse ||= {events:[],teams:[],templates:[],notifications:[],history:[]};
    ev.events ||= []; ev.teams ||= []; ev.templates ||= []; ev.notifications ||= []; ev.history ||= [];
    const member = memberSession(req);
    const stamp = () => new Date().toISOString();
    const audit = (action, detail) => { ev.history.unshift({id:crypto.randomUUID(),at:stamp(),action,detail}); ev.history=ev.history.filter(x=>Date.now()-new Date(x.at).getTime()<=7*86400000).slice(0,1000); };
    const notify = (memberId,title,body,eventId='') => ev.notifications.unshift({id:crypto.randomUUID(),memberId,title,body,eventId,at:stamp(),read:false});
    const eventView = (e,viewerAdmin=false,viewerId='') => { const totals=new Map(); for(const t of (e.tasks||[])) for(const sub of (t.submissions||[])) if(sub.evaluation?.status==='evaluated'){const key=t.type==='team'?(ev.teams.find(tm=>tm.id===t.teamId)?.id||sub.memberId):sub.memberId;totals.set(key,(totals.get(key)||0)+(Number(sub.evaluation.score)||0));} const leaderboard=[...totals.entries()].map(([id,points])=>({id,name:ev.teams.find(tm=>tm.id===id)?.name||db.members.find(m=>m.id===id)?.name||'Member',points,kind:ev.teams.some(tm=>tm.id===id)?'team':'member'})).sort((a,b)=>b.points-a.points); return {...e,leaderboard,participants:(e.participants||[]).map(id=>({id,name:db.members.find(m=>m.id===id)?.name||'Former member'})),certificates:viewerAdmin?(e.certificates||[]):(e.certificates||[]).filter(c=>c.memberId===viewerId),feedback:viewerAdmin?(e.feedback||[]):[],tasks:(e.tasks||[]).map(t=>({...t,submissions:(t.submissions||[]).filter(x=>viewerAdmin||x.memberId===viewerId||(t.type==='team'&&ev.teams.some(tm=>tm.id===t.teamId&&(tm.memberIds||[]).includes(viewerId)))).map(x=>({...x,memberName:db.members.find(m=>m.id===x.memberId)?.name||'Former member'}))}))}; };
    const taskFor = id => { for (const e of ev.events) { const t=(e.tasks||[]).find(x=>x.id===id); if(t)return {event:e,task:t}; } return null; };
    if (route==='/api/eventverse/state' && req.method==='GET') {
      if(!member&&!admin)return bad(res,'Login with your private member ID first',401);
      let scheduledChanged=false; for(const e of ev.events){if(e.status==='upcoming'&&e.startAt&&new Date(e.startAt).getTime()<=Date.now()){e.status='active';scheduledChanged=true;for(const id of (e.participants||[]))notify(id,'Event is live',e.title+' has started.',e.id);} if(e.status==='active'&&e.endAt&&new Date(e.endAt).getTime()<=Date.now()){e.status='completed';e.completedAt=stamp();scheduledChanged=true;} for(const t of (e.tasks||[])){if(t.status==='scheduled'&&t.publishAt&&new Date(t.publishAt).getTime()<=Date.now()){t.status='open';for(const id of (e.participants||[]))notify(id,'New task available',t.title,e.id);scheduledChanged=true;} if(t.status==='open'&&t.dueAt&&new Date(t.dueAt).getTime()<=Date.now()){t.status='closed';scheduledChanged=true;}}} if(scheduledChanged)await save();
      const mine=member?ev.events.filter(e=>(e.participants||[]).includes(member.id)).map(e=>eventView(e,false,member.id)):[];
      const publicEvents=ev.events.filter(e=>e.status!=='draft' || admin).map(e=>eventView(e,admin,member?.id||''));
      const myTeams=member?ev.teams.filter(t=>(t.memberIds||[]).includes(member.id)).map(t=>({...t,members:(t.memberIds||[]).map(id=>({id,name:db.members.find(m=>m.id===id)?.name||'Former member'}))})):[];
      const notifications=member?ev.notifications.filter(n=>n.memberId===member.id).slice(0,60):[];
      const history=admin?ev.history.filter(x=>Date.now()-new Date(x.at).getTime()<=7*86400000):undefined;
      const allEvents=admin?ev.events.map(e=>eventView(e,true,'')):publicEvents;
      return send(res,200,{admin,member:member?{id:member.id,name:member.name}:null,events:allEvents,myEvents:mine,teams:myTeams,allTeams:admin?ev.teams:undefined,templates:admin?ev.templates:undefined,notifications,history,members:admin?db.members.map(m=>({id:m.id,name:m.name})):undefined});
    }
    if(route==='/api/eventverse/admin'&&req.method==='POST'){
      if(!admin)return bad(res,'God Admin authentication required',403);
      const action=b.action;
      if(action==='create_event'||action==='edit_event'){
        if(!required(b.title,100)||!required(b.description||'Event details',2000))return bad(res,'Enter event title and description');
        let e=action==='edit_event'?ev.events.find(x=>x.id===b.id):null;if(action==='edit_event'&&!e)return bad(res,'Event not found',404);
        if(!e){e={id:crypto.randomUUID(),createdAt:stamp(),participants:[],tasks:[],leaderboard:[],feedback:[]};ev.events.unshift(e);}
        Object.assign(e,{title:b.title.trim(),description:String(b.description||'').trim(),format:['competition','team_battle','weekly_challenge','tournament','nomination','voting','mystery','special','custom'].includes(b.format)?b.format:'custom',startAt:b.startAt||'',endAt:b.endAt||'',registrationOpen:b.registrationOpen!=='false',maxParticipants:Math.max(0,Number(b.maxParticipants)||0),visibility:b.visibility==='invite'?'invite':'public',inviteIds:Array.isArray(b.inviteIds)?b.inviteIds.filter(id=>db.members.some(m=>m.id===id)):[],rules:String(b.rules||'').slice(0,5000),status:['draft','upcoming','active','completed','archived','paused'].includes(b.status)?b.status:'draft',coverImage:b.coverImage===undefined?(e.coverImage||''):(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(b.coverImage||''))&&String(b.coverImage).length<=180000?b.coverImage:''),updatedAt:stamp()});
        audit(action==='create_event'?'Event created':'Event updated',e.title);await save();return send(res,200,{ok:true,id:e.id});
      }
      if(action==='event_status') {const e=ev.events.find(x=>x.id===b.id);if(!e)return bad(res,'Event not found',404);if(!['draft','upcoming','active','paused','completed','archived'].includes(b.status))return bad(res,'Invalid status');e.status=b.status;e.updatedAt=stamp();if(b.status==='completed'||b.status==='archived')e.completedAt=stamp();audit('Event status changed',e.title+' → '+b.status);await save();return send(res,200,{ok:true});}
      if(action==='delete_event'){const e=ev.events.find(x=>x.id===b.id);if(!e)return bad(res,'Event not found',404);ev.events=ev.events.filter(x=>x.id!==b.id);audit('Event deleted',e.title);await save();return send(res,200,{ok:true});}
      if(action==='create_task'||action==='edit_task'){
        if(b.status==='scheduled'&&!b.publishAt)return bad(res,'Set a publish time for a scheduled task');
        const e=ev.events.find(x=>x.id===b.eventId);if(!e)return bad(res,'Event not found',404);e.tasks||=[];
        if(!required(b.title,120)||!required(b.description,4000))return bad(res,'Enter task title and instructions');if(b.type==='team'&&!ev.teams.some(tm=>tm.id===b.teamId))return bad(res,'Choose a valid team for this team task');
        let t=action==='edit_task'?e.tasks.find(x=>x.id===b.id):null;if(action==='edit_task'&&!t)return bad(res,'Task not found',404);
        if(!t){t={id:crypto.randomUUID(),submissions:[],comments:[],evaluations:[],history:[]};e.tasks.unshift(t);}
        if(t.title)t.history.unshift({at:stamp(),title:t.title,description:t.description});t.history=(t.history||[]).filter(x=>Date.now()-new Date(x.at).getTime()<=7*86400000);
        Object.assign(t,{title:b.title.trim(),description:b.description.trim(),image:b.image===undefined?(t.image||''):(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(b.image||''))&&String(b.image).length<=180000?b.image:''),type:b.type==='team'?'team':'personal',teamId:b.teamId||'',assigneeIds:Array.isArray(b.assigneeIds)?b.assigneeIds.filter(id=>db.members.some(m=>m.id===id)):[],maxPoints:Math.max(0,Number(b.maxPoints)||0),priority:['normal','important','urgent'].includes(b.priority)?b.priority:'normal',dueAt:b.dueAt||'',publishAt:b.publishAt||'',status:['draft','scheduled','open','closed'].includes(b.status)?b.status:'open',rubric:Array.isArray(b.rubric)?b.rubric.slice(0,8).map(x=>({name:String(x.name||'Criterion').slice(0,60),points:Math.max(0,Number(x.points)||0)})):[],updatedAt:stamp()});
        audit('Task '+(action==='create_task'?'created':'updated'),e.title+' / '+t.title);await save();return send(res,200,{ok:true,id:t.id});
      }
      if(action==='delete_task'){const found=taskFor(b.id);if(!found)return bad(res,'Task not found',404);found.event.tasks=found.event.tasks.filter(x=>x.id!==b.id);audit('Task deleted',found.task.title);await save();return send(res,200,{ok:true});}
      if(action==='evaluate'){
        const found=taskFor(b.taskId);if(!found)return bad(res,'Task not found',404);const sub=found.task.submissions.find(x=>x.id===b.submissionId);if(!sub)return bad(res,'Submission not found',404);
        const score=Math.max(0,Math.min(found.task.maxPoints,Number(b.score)||0));const before=sub.evaluation?{...sub.evaluation}:null;
        found.task.evaluations||=[];found.task.evaluations.unshift({at:stamp(),submissionId:sub.id,memberId:sub.memberId,previous:before,score,remarks:String(b.remarks||'').slice(0,1000),status:b.status==='revision'?'revision':'evaluated'});
        sub.evaluation={score,remarks:String(b.remarks||'').slice(0,1000),status:b.status==='revision'?'revision':'evaluated',at:stamp()};
        if(sub.memberId)notify(sub.memberId,'Task evaluated',found.task.title+' · '+sub.evaluation.status+' · '+score+' points',found.event.id);
        audit('Submission evaluated',found.task.title+' · '+score+' points');await save();return send(res,200,{ok:true});
      }
      if(action==='create_team'){
        if(!required(b.name,60)||!Array.isArray(b.memberIds)||!b.memberIds.length)return bad(res,'Enter team name and members');
        const ids=[...new Set(b.memberIds.filter(id=>db.members.some(m=>m.id===id)))];if(!ids.length)return bad(res,'Select valid members');
        const team={id:crypto.randomUUID(),name:b.name.trim(),memberIds:ids,leaderId:ids.includes(b.leaderId)?b.leaderId:ids[0],createdAt:stamp()};ev.teams.push(team);audit('Team created',team.name);await save();return send(res,200,{ok:true,id:team.id});
      }
      if(action==='template_apply'){const template=ev.templates.find(x=>x.id===b.templateId);if(!template)return bad(res,'Template not found',404);if(!required(b.title||template.name,100))return bad(res,'Enter event title');const e={id:crypto.randomUUID(),title:String(b.title||template.name).trim(),description:String(b.description||'Created from saved event template').slice(0,2000),format:template.format||'custom',rules:template.rules||'',status:'upcoming',startAt:b.startAt||'',endAt:b.endAt||'',registrationOpen:true,maxParticipants:0,visibility:'public',inviteIds:[],participants:[],leaderboard:[],feedback:[],certificates:[],tasks:(template.tasks||[]).map(t=>({...t,id:crypto.randomUUID(),submissions:[],comments:[],evaluations:[],history:[],status:'open',dueAt:'',publishAt:''})),createdAt:stamp(),updatedAt:stamp()};ev.events.unshift(e);audit('Event created from template',e.title);await save();return send(res,200,{ok:true,id:e.id});}
      if(action==='template_save'){
        const e=ev.events.find(x=>x.id===b.eventId);if(!e)return bad(res,'Event not found',404);ev.templates.unshift({id:crypto.randomUUID(),name:String(b.name||e.title).slice(0,100),format:e.format,rules:e.rules,tasks:(e.tasks||[]).map(t=>({title:t.title,description:t.description,type:t.type,maxPoints:t.maxPoints,priority:t.priority,rubric:t.rubric})),createdAt:stamp()});await save();return send(res,200,{ok:true});
      }
      if(action==='publish_notice'){
        if(!required(b.title,120)||!required(b.body,1500))return bad(res,'Enter announcement title and message');const ids=Array.isArray(b.memberIds)?b.memberIds:db.members.map(m=>m.id);ids.forEach(id=>notify(id,b.title.trim(),b.body.trim(),b.eventId||''));audit('Eventverse announcement',b.title);await save();return send(res,200,{ok:true});
      }
      if(action==='comment'){const found=taskFor(b.taskId);if(!found)return bad(res,'Task not found',404);if(!required(b.body,1000))return bad(res,'Write a message');found.task.comments||=[];found.task.comments.push({id:crypto.randomUUID(),memberId:'admin',name:'FFGC',body:b.body.trim(),at:stamp()});for(const id of (found.event.participants||[]))notify(id,'Task discussion update',found.task.title+' has a new FFGC reply.',found.event.id);await save();return send(res,200,{ok:true});}
      if(action==='publish_certificate'){
        const e=ev.events.find(x=>x.id===b.eventId);if(!e)return bad(res,'Event not found',404);const id=b.memberId;if(!db.members.some(m=>m.id===id))return bad(res,'Member not found');e.certificates||=[];if(!e.certificates.some(c=>c.memberId===id))e.certificates.push({memberId:id,code:'FFGC-'+crypto.randomBytes(4).toString('hex').toUpperCase(),at:stamp()});notify(id,'Certificate available','Your certificate for '+e.title+' is ready.',e.id);await save();return send(res,200,{ok:true});
      }
      return bad(res,'Unknown Eventverse admin action');
    }
    if(route==='/api/eventverse/member'&&req.method==='POST'){
      if(!member)return bad(res,'Login with your private member ID first',401);
      if(b.action==='register'){
        const e=ev.events.find(x=>x.id===b.eventId);if(!e)return bad(res,'Event not found',404);if(!e.registrationOpen||!['upcoming','active'].includes(e.status))return bad(res,'Registration is closed');if(e.visibility==='invite'&&!(e.inviteIds||[]).includes(member.id))return bad(res,'This event is invitation-only');e.participants||=[];if(!e.participants.includes(member.id)){if(e.maxParticipants&&e.participants.length>=e.maxParticipants)return bad(res,'Event is full');e.participants.push(member.id);notify(member.id,'Registration confirmed','You joined '+e.title+'.',e.id);audit('Member registered',member.name+' → '+e.title);}await save();return send(res,200,{ok:true});
      }
      if(b.action==='submit'){
        const found=taskFor(b.taskId);if(!found)return bad(res,'Task not found',404);const {event:e,task:t}=found;if(!(e.participants||[]).includes(member.id))return bad(res,'Join this event before submitting',403);if(['completed','archived'].includes(e.status))return bad(res,'This event is closed');if(t.dueAt&&new Date(t.dueAt).getTime()<=Date.now())return bad(res,'Submission deadline has passed');if(t.status!=='open')return bad(res,'Task is not accepting submissions');if(t.type==='personal'&&t.assigneeIds?.length&&!t.assigneeIds.includes(member.id))return bad(res,'This task is assigned to another member',403);if(t.type==='team'&&!ev.teams.some(team=>team.id===t.teamId&&(team.memberIds||[]).includes(member.id)))return bad(res,'You are not in the assigned team',403);
        const textBody=String(b.text||'').slice(0,5000),imageData=String(b.image||'');if(!textBody&&!imageData)return bad(res,'Add an answer or image');if(imageData&&(!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(imageData)||imageData.length>180000))return bad(res,'Image must be JPG, PNG or WebP and under 130 KB after compression');
        const old=t.submissions.find(x=>x.memberId===member.id);if(old&&old.evaluation?.status!=='revision')return bad(res,'A submission already exists and is not open for revision');
        const sub={id:old?.id||crypto.randomUUID(),memberId:member.id,text:textBody,image:imageData,submittedAt:stamp(),revision:(old?.revision||0)+1,evaluation:null};if(old)t.submissions[t.submissions.indexOf(old)]=sub;else t.submissions.unshift(sub);notify(member.id,'Submission received',t.title+' has been submitted.',e.id);audit('Task submitted',member.name+' → '+t.title);await save();return send(res,200,{ok:true});
      }
      if(b.action==='comment'){
        const found=taskFor(b.taskId);if(!found)return bad(res,'Task not found',404);if(!(found.event.participants||[]).includes(member.id))return bad(res,'Join this event to use its discussion',403);if(!required(b.body,1000))return bad(res,'Write a message');found.task.comments||=[];found.task.comments.push({id:crypto.randomUUID(),memberId:member.id,name:member.name,body:b.body.trim(),at:stamp()});await save();return send(res,200,{ok:true});
      }
      if(b.action==='feedback'){
        const e=ev.events.find(x=>x.id===b.eventId);if(!e||(e.participants||[]).indexOf(member.id)<0)return bad(res,'Event not found or not joined',404);e.feedback||=[];e.feedback.push({memberId:member.id,rating:Math.max(1,Math.min(5,Number(b.rating)||5)),body:String(b.body||'').slice(0,1000),at:stamp()});await save();return send(res,200,{ok:true});
      }
      if(b.action==='read_notification'){const n=ev.notifications.find(x=>x.id===b.id&&x.memberId===member.id);if(n)n.read=true;await save();return send(res,200,{ok:true});}
      return bad(res,'Unknown Eventverse member action');
    }
    return bad(res,'Unknown Eventverse endpoint',404);
  }

  // DAILY CHECK-IN — only an authenticated private-ID member can check in.
  if (route === '/api/checkin/member' && req.method === 'GET') {
    const m = memberSession(req);
    if (!m) return bad(res, 'Login with your private member ID first', 401);
    const data = ensureDailyCheckIns();
    const today = indiaDateString();
    const checkedIn = data.records.some(r => r.memberId === m.id && r.date === today);
    await save();
    return send(res, 200, { date: today, checkedIn, notice: 'If you miss a daily check-in, the admin may manually deduct 50 points from the following day.' });
  }
  if (route === '/api/checkin/member' && req.method === 'POST') {
    const m = memberSession(req);
    if (!m) return bad(res, 'Login with your private member ID first', 401);
    const data = ensureDailyCheckIns();
    const today = indiaDateString();
    if (data.records.some(r => r.memberId === m.id && r.date === today)) return bad(res, 'You have already checked in today', 409);
    data.records.push({ memberId: m.id, date: today, at: new Date().toISOString() });
    log('Daily check-in', m.name + ' · ' + today);
    await save();
    return send(res, 200, { ok: true, date: today, checkedIn: true });
  }
  if (route === '/api/checkin/admin' && req.method === 'GET') {
    if (!admin) return bad(res, 'Admin authentication required', 401);
    const data = ensureDailyCheckIns();
    await save();
    return send(res, 200, { pending: dailyCheckInPending(), deductions: data.deductions.slice(-100).reverse(), startDate: data.startDate });
  }
  if (route === '/api/checkin/admin' && req.method === 'POST') {
    if (!admin) return bad(res, 'Admin authentication required', 401);
    const data = ensureDailyCheckIns();
    if (b.action === 'clear_all') {
      const pendingNow = dailyCheckInPending();
      const existing = new Set(data.dismissed.map(r => `${r.memberId}|${r.date}`));
      for (const item of pendingNow) {
        const key = `${item.memberId}|${item.date}`;
        if (!existing.has(key)) data.dismissed.push({ memberId: item.memberId, date: item.date, at: new Date().toISOString(), by: ADMIN_USER });
      }
      log('Daily check-in list cleared', `${pendingNow.length} pending entries dismissed; no points deducted`);
      await save();
      return send(res, 200, { ok: true, cleared: pendingNow.length, pending: [] });
    }
    const member = db.members.find(m => m.id === b.memberId);
    if (!member || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))) return bad(res, 'Invalid member or missed date');
    const pending = dailyCheckInPending().some(x => x.memberId === b.memberId && x.date === b.date);
    if (!pending) return bad(res, 'This missed check-in is already completed or is not pending', 409);
    member.points = Number(member.points || 0) - 50;
    const record = { memberId: member.id, memberName: member.name, date: b.date, points: 50, at: new Date().toISOString(), by: ADMIN_USER };
    data.deductions.push(record);
    log('Daily check-in penalty', member.name + ' · -50 points · missed ' + b.date);
    await save();
    return send(res, 200, { ok: true, deduction: record, points: member.points });
  }

  if (route === '/api/member/profile' && req.method === 'POST') {
    const m=memberSession(req);
    if (!m) return bad(res,'Member login required',401);
    if (!required(b.bio||' ',500) || !photoValid(b.photo)) return bad(res,'Invalid bio or photo');
    m.profile ||= {};
    m.profile.bio=String(b.bio||'').trim();
    m.profile.photo=b.photo;
    log('Member profile edited',m.name);
    await save();
    return send(res,200,{ok:true});
  }
  if (route === '/api/profile/public' && req.method === 'GET') {
    const m=db.members.find(x=>x.id===url.searchParams.get('id'));
    if (!m || m.profile?.visibility!=='public' || db.settings.siteMode!=='public') return bad(res,'Profile is private',403);
    return send(res,200,{profile:safeProfile(m,false)});
  }

  // PRIVATE SUPPORT: server-enforced per-message 24-hour retention.
  if (route.startsWith('/api/support/')) {
    const member = memberSession(req);
    if (!admin && !member) return bad(res,'Login required',401);
    const now=Date.now(), ttl=86400000;
    db.supportMessages ||= [];
    const active=()=>db.supportMessages.filter(x=>now-new Date(x.at).getTime()<ttl);
    if (route==='/api/support/messages' && req.method==='GET') {
      const memberId=admin?url.searchParams.get('memberId'):member.id;
      if (!memberId || (admin&&!db.members.some(x=>x.id===memberId))) return bad(res,'Select member');
      return send(res,200,{messages:active().filter(x=>x.memberId===memberId).map(x=>({id:x.id,from:x.from,text:x.text,at:x.at}))});
    }
    if (route==='/api/support/inbox' && req.method==='GET') {
      if (!admin) return bad(res,'Admin only',403);
      return send(res,200,{inbox:db.members.map(m=>({id:m.id,name:m.name,messages:active().filter(x=>x.memberId===m.id).length,last:active().filter(x=>x.memberId===m.id).at(-1)?.at||null})).filter(x=>x.messages).sort((a,b)=>new Date(b.last)-new Date(a.last))});
    }
    if (route==='/api/support/send' && req.method==='POST') {
      if (typeof b.text!=='string'||!b.text.trim()||b.text.length>1500) return bad(res,'Message must be 1–1500 characters');
      const memberId=admin?b.memberId:member.id;
      if (!db.members.some(x=>x.id===memberId)) return bad(res,'Invalid member');
      const old=active(); const first=!admin&&!old.some(x=>x.memberId===memberId&&x.from==='member');
      db.supportMessages=old;
      db.supportMessages.push({id:crypto.randomUUID(),memberId,from:admin?'support':'member',text:b.text.trim(),at:new Date(now).toISOString()});
      if (first) db.supportMessages.push({id:crypto.randomUUID(),memberId,from:'support',text:'🛡️ Welcome to FFGC2K26 SUPPORT! Your message has been received. Our support team will reply when available. Each message expires 24 hours after being sent.',at:new Date(now).toISOString(),automated:true});
      await save();
      return send(res,200,{ok:true});
    }
    return bad(res,'Unknown support request',404);
  }

  // VOTING
  if (route === '/api/vote' && req.method === 'POST') {
    if (db.settings.siteMode !== 'public') {
      return bad(res, 'Voting is unavailable');
    }

    const p = db.polls.find(x => x.id === b.pollId);

    if (!p || p.status !== 'active') {
      return bad(res, 'Poll is not active');
    }

    if (!required(b.code, 100)) {
      return bad(res, 'Enter your voting code');
    }

    const m = db.members.find(x =>
      x.codeHash &&
      secureEq(
        x.codeHash,
        hash(b.code.trim().toUpperCase())
      )
    );

    if (!m) {
      return bad(res, 'Invalid voting code', 403);
    }

    if (p.votes.some(v => v.memberId === m.id)) {
      return bad(res, 'You have already voted in this poll');
    }

    if (p.type === 'nomination' && m.excluded) {
      return bad(res, 'You are not eligible to vote');
    }

    if (
      !Array.isArray(b.choices) ||
      b.choices.length !== p.selectCount ||
      new Set(b.choices).size !== b.choices.length ||
      !b.choices.every(x => p.choices.includes(x))
    ) {
      return bad(res, 'Select valid choices');
    }

    if (
      p.type === 'nomination' &&
      b.choices.includes(m.id)
    ) {
      return bad(res, 'You cannot nominate yourself');
    }

    p.votes.push({
      memberId: m.id,
      choices: b.choices,
      at: new Date().toISOString()
    });

    await save();

    return send(res, 200, { ok: true });
  }

  // PROTECTED ADMIN ROUTES
  if (!admin) {
    return bad(res, 'Admin authentication required', 401);
  }

  // ADMIN DASHBOARD
  if (route === '/api/admin' && req.method === 'GET') {
    return send(res, 200, {
      ...db,
      leaderboard: ranked(),
      members: db.members.map(m => ({
        ...m,
        codeHash: undefined,
        hasCode: !!m.codeHash
      }))
    });
  }

  // ADMIN PROFILE RECORDS AND VISIBILITY
  if (route === '/api/profile/admin' && req.method === 'POST') {
    const m=db.members.find(x=>x.id===b.memberId);
    if (!m) return bad(res,'Member not found');
    m.profile ||= {};
    if (b.action==='settings') {
      if (!['public','private'].includes(b.visibility) || typeof b.title!=='string' || b.title.length>100) return bad(res,'Invalid profile settings');
      m.profile.visibility=b.visibility; m.profile.title=b.title.trim();
    } else if (b.action==='add-record') {
      if (!['achievements','records'].includes(b.kind) || !required(b.title,120) || typeof b.description!=='string' || b.description.length>500) return bad(res,'Invalid record');
      m.profile[b.kind] ||= [];
      m.profile[b.kind].unshift({id:crypto.randomUUID(),title:b.title.trim(),description:b.description.trim(),public:!!b.public,at:new Date().toISOString()});
    } else if (b.action==='delete-record') {
      if (!['achievements','records'].includes(b.kind)) return bad(res,'Invalid record type');
      m.profile[b.kind]=(m.profile[b.kind]||[]).filter(x=>x.id!==b.recordId);
    } else return bad(res,'Invalid action');
    log('Profile admin edit',m.name); await save(); return send(res,200,{ok:true});
  }
  // ADMIN TEAMS
  if (route === '/api/team/admin' && req.method === 'POST') {
    if (b.action==='create') {
      if (!required(b.name,70) || db.teams.some(t=>t.name.toLowerCase()===b.name.trim().toLowerCase())) return bad(res,'Invalid or duplicate team name');
      db.teams.push({id:crypto.randomUUID(),name:b.name.trim(),members:[],captainId:'',competitionPoints:0});
    } else {
      const t=db.teams.find(x=>x.id===b.teamId);
      if (!t) return bad(res,'Team not found');
      if (b.action==='assign') {
        if (!db.members.some(m=>m.id===b.memberId)) return bad(res,'Member not found');
        for (const other of db.teams) {other.members=(other.members||[]).filter(x=>x!==b.memberId);if(other.captainId===b.memberId)other.captainId='';}
        t.members.push(b.memberId);
      } else if (b.action==='remove') {
        t.members=t.members.filter(x=>x!==b.memberId); if(t.captainId===b.memberId)t.captainId='';
      } else if (b.action==='captain') {
        if (b.memberId && !t.members.includes(b.memberId)) return bad(res,'Captain must belong to team');
        t.captainId=b.memberId||'';
      } else if (b.action==='points') {
        if (!Number.isSafeInteger(b.points) || Math.abs(b.points)>10000000) return bad(res,'Invalid team points');
        t.competitionPoints=b.points;
      } else if (b.action==='delete') {
        db.teams=db.teams.filter(x=>x.id!==t.id);
      } else return bad(res,'Invalid team action');
    }
    log('Team management',b.action);await save();return send(res,200,{ok:true});
  }
  // ADMIN SPOTLIGHT
  if (route === '/api/spotlight/admin' && req.method === 'POST') {
    if (b.action==='remove') db.spotlight=db.spotlight.filter(x=>x.id!==b.id);
    else if (b.action==='add') {
      if (!db.members.some(m=>m.id===b.memberId) || !required(b.title,100) || typeof b.description!=='string' || b.description.length>10000 || !['gold','purple','red','blue'].includes(b.theme)) return bad(res,'Invalid spotlight');
      if (b.expires && (!/^\d{4}-\d{2}-\d{2}$/.test(b.expires) || !Number.isFinite(Date.parse(b.expires)))) return bad(res,'Invalid expiry');
      db.spotlight.push({id:crypto.randomUUID(),memberId:b.memberId,title:b.title.trim(),description:b.description.trim(),theme:b.theme,expires:b.expires||'',order:db.spotlight.length});
    } else return bad(res,'Invalid spotlight action');
    log('Spotlight management',b.action);await save();return send(res,200,{ok:true});
  }

  // WEBSITE SETTINGS
  if (route === '/api/settings' && req.method === 'POST') {
    if (
      !['public', 'maintenance', 'private', 'shutdown'].includes(b.siteMode)
    ) {
      return bad(res, 'Invalid mode');
    }

    db.settings.siteMode = b.siteMode;

    log('Website mode', b.siteMode);
    await save();

    return send(res, 200, { ok: true });
  }

  // ADD MEMBER
  if (route === '/api/members' && req.method === 'POST') {
    if (!required(b.name, 60)) {
      return bad(res, 'Invalid member name');
    }

    if (
      db.members.some(m =>
        m.name.toLowerCase() === b.name.trim().toLowerCase()
      )
    ) {
      return bad(res, 'Member already exists');
    }

    const points = Number(b.points || 0);

    if (!Number.isSafeInteger(points) || points < 0) {
      return bad(res, 'Invalid points');
    }

    const m = {
      id: crypto.randomUUID(),
      name: b.name.trim(),
      points,
      codeHash: null,
      excluded: false,
      checkInStartDate: indiaDateString()
    };

    db.members.push(m);

    log('Member added', m.name);
    await save();

    return send(res, 200, { ok: true });
  }

  // UPDATE MEMBER
  if (
    route === '/api/member/update' &&
    req.method === 'POST'
  ) {
    const m = db.members.find(x => x.id === b.id);

    if (!m) return bad(res, 'Member not found');

    if (b.name !== undefined) {
      if (
        !required(b.name, 60) ||
        db.members.some(x =>
          x.id !== m.id &&
          x.name.toLowerCase() === b.name.trim().toLowerCase()
        )
      ) {
        return bad(res, 'Invalid or duplicate name');
      }

      m.name = b.name.trim();
    }

    if (b.excluded !== undefined) {
      m.excluded = !!b.excluded;
    }

    log('Member updated', m.name);
    await save();

    return send(res, 200, { ok: true });
  }

  // ADD / MINUS POINTS
  if (route === '/api/points' && req.method === 'POST') {
    const m = db.members.find(x => x.id === b.id);
    const delta = Number(b.delta);

    if (
      !m ||
      !Number.isSafeInteger(delta) ||
      Math.abs(delta) > 1000000 ||
      m.points + delta < 0
    ) {
      return bad(res, 'Invalid point adjustment');
    }

    m.points += delta;

    log(
      'Points adjusted',
      `${m.name}: ${delta > 0 ? '+' : ''}${delta} (${m.points} total)`
    );

    await save();

    return send(res, 200, { ok: true });
  }

  // GENERATE VOTING CODE
  if (route === '/api/code' && req.method === 'POST') {
    const m = db.members.find(x => x.id === b.id);

    if (!m) return bad(res, 'Member not found');

    const code =
      'FF-' + crypto.randomBytes(9).toString('hex').toUpperCase();

    m.codeHash = hash(code);

    log('Voting code regenerated', m.name);
    await save();

    return send(res, 200, { code });
  }

  // TASK DELETE — admin-only, separate action so accidental form submits cannot remove tasks.
  if (route === '/api/task/delete' && req.method === 'POST') {
    if (!admin) return bad(res, 'Admin authentication required', 401);
    const task = db.tasks.find(x => x.id === b.id);
    if (!task) return bad(res, 'Task not found', 404);
    db.tasks = db.tasks.filter(x => x.id !== b.id);
    log('Task deleted', task.title);
    await save();
    return send(res, 200, { ok: true });
  }

  // TASK MANAGER
  if (route === '/api/task' && req.method === 'POST') {
    if (
      !required(b.title, 120) ||
      !required(b.description, 2000)
    ) {
      return bad(res, 'Enter task title and description');
    }

    let t = b.id
      ? db.tasks.find(x => x.id === b.id)
      : null;

    if (b.id && !t) {
      return bad(res, 'Task not found');
    }

    if (!t) {
      t = { id: crypto.randomUUID() };
      db.tasks.unshift(t);
    }

    Object.assign(t, {
      title: b.title.trim(),
      description: b.description.trim(),
      reward: String(b.reward || ''),
      deadline: String(b.deadline || ''),
      status: ['active', 'closed', 'upcoming'].includes(b.status)
        ? b.status
        : 'active'
    });

    log('Task saved', t.title);
    await save();

    return send(res, 200, { ok: true });
  }

  // ANNOUNCEMENTS
  if (
    route === '/api/announcement' &&
    req.method === 'POST'
  ) {
    if (
      !required(b.title, 120) ||
      !required(b.body, 20000)
    ) {
      return bad(res, 'Headline is required (max 120 characters); announcement must be 1–20,000 characters.');
    }

    db.announcements.unshift({
      id: crypto.randomUUID(),
      title: b.title.trim(),
      body: b.body.trim(),
      at: new Date().toISOString()
    });

    log('Announcement published', b.title);
    await save();

    return send(res, 200, { ok: true });
  }

  // ANNOUNCEMENT MANAGEMENT — admin only, preserves existing records.
  if (route === '/api/announcement/manage' && req.method === 'POST') {
    const list = db.announcements || (db.announcements = []);
    const index = list.findIndex(a => a.id === b.id);
    if (index < 0) return bad(res, 'Announcement not found', 404);
    const a = list[index];
    if (b.action === 'delete') {
      list.splice(index, 1);
      log('Announcement deleted', a.title);
    } else if (b.action === 'edit') {
      if (!required(b.title, 120) || !required(b.body, 20000))
        return bad(res, 'Headline required (max 120); message must be 1–20,000 characters');
      a.title = b.title.trim(); a.body = b.body.trim();
      a.updatedAt = new Date().toISOString();
      log('Announcement edited', a.title);
    } else if (b.action === 'pin' || b.action === 'hide') {
      if (b.action === 'pin') a.pinned = !!b.value;
      else a.hidden = !!b.value;
      log('Announcement '+b.action, a.title);
    } else return bad(res, 'Unknown announcement action');
    await save();
    return send(res, 200, {ok:true});
  }

  // CREATE POLL
  if (route === '/api/poll' && req.method === 'POST') {
    if (
      !required(b.title, 150) ||
      !['normal', 'nomination'].includes(b.type)
    ) {
      return bad(res, 'Invalid poll');
    }

    const choices = b.type === 'nomination'
      ? db.members
          .filter(m => !m.excluded)
          .map(m => m.id)
      : Array.isArray(b.choices)
        ? b.choices.map(x => String(x).trim()).filter(Boolean)
        : [];

    if (
      choices.length < 2 ||
      choices.length > 100 ||
      new Set(choices).size !== choices.length
    ) {
      return bad(res, 'Provide 2–100 unique options');
    }

    const selectCount = Number(b.selectCount || 1);

    if (
      !Number.isInteger(selectCount) ||
      selectCount < 1 ||
      selectCount > choices.length
    ) {
      return bad(res, 'Invalid number of selections');
    }

    const p = {
      id: crypto.randomUUID(),
      title: b.title.trim(),
      type: b.type,
      choices,
      selectCount,
      status: 'draft',
      resultsVisible: b.type === 'nomination' ? false : !!b.resultsVisible,
      votes: [],
      autoNominationCount: 3,
      manualNominations: {}
    };

    db.polls.unshift(p);

    log('Poll created', p.title);
    await save();

    return send(res, 200, { ok: true });
  }

  // ADMIN: EDIT POLL (preserve existing ballots and poll state)
  if (route === '/api/poll/edit' && req.method === 'POST') {
    const p = db.polls.find(x => x.id === b.id);
    if (!p) return bad(res, 'Poll not found', 404);
    if (!required(b.title, 150)) return bad(res, 'Enter a valid poll title');
    const selectCount = Number(b.selectCount);
    if (!Number.isInteger(selectCount) || selectCount < 1 || selectCount > p.choices.length) {
      return bad(res, 'Invalid number of selections');
    }
    // Never change ballot structure after voting starts: existing votes remain valid.
    if (selectCount !== p.selectCount && (p.votes.length || p.status !== 'draft')) {
      return bad(res, 'Selections can only change on an unused draft poll');
    }
    if (p.type === 'normal' && b.choices !== undefined) {
      const choices = Array.isArray(b.choices) ? b.choices.map(x => String(x).trim()).filter(Boolean) : [];
      if (choices.length < 2 || choices.length > 100 || new Set(choices).size !== choices.length) {
        return bad(res, 'Provide 2–100 unique options');
      }
      if (JSON.stringify(choices) !== JSON.stringify(p.choices)) {
        if (p.votes.length || p.status !== 'draft') return bad(res, 'Options can only change on an unused draft poll');
        if (selectCount > choices.length) return bad(res, 'Too many selections for options');
        p.choices = choices;
      }
    }
    p.title = b.title.trim();
    p.selectCount = selectCount;
    log('Poll edited', p.title);
    await save();
    return send(res, 200, { ok: true });
  }

  // ADMIN: DELETE POLL (explicit confirmation in UI)
  if (route === '/api/poll/delete' && req.method === 'POST') {
    const index = db.polls.findIndex(x => x.id === b.id);
    if (index < 0) return bad(res, 'Poll not found', 404);
    const [removed] = db.polls.splice(index, 1);
    log('Poll deleted', `${removed.title} (${removed.votes.length} ballots)`);
    await save();
    return send(res, 200, { ok: true });
  }

  // GOD ADMIN: NOMINATION CONTROL (server-enforced)
  if (route === '/api/nomination/control' && req.method === 'POST') {
    const p = db.polls.find(x => x.id === b.id && x.type === 'nomination');
    if (!p) return bad(res, 'Nomination poll not found');
    if (p.status !== 'closed') {
      return bad(res, 'Close the nomination poll before finalizing nominations');
    }
    if (b.action === 'score') {
      if (!p.choices.includes(b.memberId) || !Number.isSafeInteger(b.score) || b.score < 0 || b.score > 1000000) {
        return bad(res, 'Choose a valid member and score (0–1000000)');
      }
      p.officialScores ||= {};
      p.officialScores[b.memberId] = b.score;
      log('Official nomination score set', `${p.title}: ${b.memberId} = ${b.score}`);
    } else if (b.action === 'score-reset') {
      if (!p.choices.includes(b.memberId)) return bad(res, 'Invalid member');
      p.officialScores ||= {};
      delete p.officialScores[b.memberId];
      log('Official nomination score reset', `${p.title}: ${b.memberId}`);
    } else if (b.action === 'count') {
      if (!Number.isInteger(b.count) || b.count < 0 || b.count > p.choices.length) {
        return bad(res, 'Invalid nomination count');
      }
      p.autoNominationCount = b.count;
      log('Nomination count', `${p.title}: top ${b.count}`);
    } else if (b.action === 'manual-add') {
      if (!p.choices.includes(b.memberId) || !required(b.reason, 300)) {
        return bad(res, 'Choose an eligible member and enter a reason (max 300 characters)');
      }
      p.manualNominations ||= {};
      p.manualNominations[b.memberId] = b.reason.trim();
      log('Manual nomination', `${p.title}: ${db.members.find(m => m.id === b.memberId)?.name}`);
    } else if (b.action === 'manual-remove') {
      p.manualNominations ||= {};
      delete p.manualNominations[b.memberId];
      log('Manual nomination removed', p.title);
    } else {
      return bad(res, 'Invalid nomination action');
    }
    await save();
    return send(res, 200, { ok: true });
  }

  // START / PAUSE / CLOSE POLL
  if (
    route === '/api/poll/status' &&
    req.method === 'POST'
  ) {
    const p = db.polls.find(x => x.id === b.id);

    if (
      !p ||
      !['draft', 'active', 'paused', 'closed'].includes(b.status)
    ) {
      return bad(res, 'Invalid poll or status');
    }

    if (p.status === 'closed' && b.status !== 'closed') {
      return bad(res, 'Closed polls cannot be reopened');
    }

    if (p.type === 'nomination' && b.resultsVisible === true &&
        b.status !== 'closed') {
      return bad(res, 'Close nominations before revealing results');
    }
    p.status = b.status;

    if (typeof b.resultsVisible === 'boolean') {
      p.resultsVisible = b.resultsVisible;
    }

    log('Poll status', `${p.title}: ${p.status}`);
    await save();

    return send(res, 200, { ok: true });
  }

  return bad(res, 'Unknown endpoint', 404);
}

// Close auctions independently of visits to the Auction House page.
// Repair previously closed auctions missing inventory or spotlight entries.
function settleAuctions() {
  const house = db.auctionHouse;
  if (!house || !Array.isArray(house.auctions)) return false;
  house.inventory ||= [];
  db.spotlight ||= [];
  const now = Date.now(), cycleMs = 10 * 86400000;
  let changed = false;
  for (const a of house.auctions) {
    const endAt = Number(a.endAt);
    if (!a.closed && Number.isFinite(endAt) && endAt <= now) {
      a.closed = true;
      const top = (a.bids || []).at(-1);
      if (top) { a.winnerId = top.memberId; a.winningBid = top.amount; }
      changed = true;
    }
    if (!a.closed || !a.winnerId) continue;
    const winner = db.members.find(m => m.id === a.winnerId);
    if (!winner) continue;
    const wonTime = Number.isFinite(endAt) ? endAt : now;
    if (!house.inventory.some(x => x.auctionId === a.id && x.memberId === a.winnerId)) {
      house.inventory.push({id:crypto.randomUUID(),memberId:a.winnerId,auctionId:a.id,
        title:a.title,description:a.description,wonAt:new Date(wonTime).toISOString(),
        expiresAt:new Date(wonTime + 30 * 86400000).toISOString(),used:false});
      changed = true;
    }
    const cycleEnd = Number(house.cycleStart) + (Number(a.cycle) + 1) * cycleMs;
    if (Number.isFinite(cycleEnd) && cycleEnd > now && !db.spotlight.some(x => x.auctionId === a.id)) {
      db.spotlight.push({id:crypto.randomUUID(),auctionId:a.id,memberId:a.winnerId,
        title:'🏆 Auction Winner — ' + winner.name,
        description:winner.name + ' won ' + a.title + ' for ' + a.winningBid + ' auction coins.',
        theme:'gold',expires:new Date(cycleEnd).toISOString(),order:db.spotlight.length});
      changed = true;
    }
  }
  return changed;
}


// STATIC WEBSITE FILES
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

const allowedFiles = new Set([
  'index.html',
  'voice-center.html',
  'app.js',
  'style.css',

  // Existing Arena
  'arena4.css',
  'royale.css',
  'royale.js',

  // Royale Arena 6
  'member5.js',
  'member5.css',
  'royale6.css',
  'obsidian.css',

  // Auction House
  'auction.js',
  'auction.css',

  // Decision Chamber
  'chamber.js',
  'chamber.css',
  'confession.js',
  'confession.css',

  // FFGC Eventverse
  'eventverse.js',
  'eventverse.css',

  // Elimination Arena
  'elimination.js',
  'elimination.css'
]);

let requestQueue = Promise.resolve();

const server = http.createServer((req, res) => {
  let u;

  try {
    u = new URL(req.url, 'http://localhost');
  } catch {
    return bad(res, 'Invalid URL');
  }

  // API ROUTES
  if (u.pathname.startsWith('/api/')) {
    const run = () =>
      api(req, res, u).catch(error => {
        console.error(error);

        if (!res.headersSent) {
          bad(res, 'Server error', 500);
        }
      });

    requestQueue = requestQueue.then(run, run);
    return;
  }

  // GOD ADMIN ACCESS
  if (u.pathname === '/god-access') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    return res.end(
      fs.readFileSync(
        path.join(ROOT, 'public', 'god-access.html')
      )
    );
  }

  // WEBSITE SHUTDOWN
  if (
    db.settings.siteMode === 'shutdown' &&
    !isAdmin(req)
  ) {
    res.writeHead(503, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });

    return res.end(
      fs.readFileSync(
        path.join(ROOT, 'public', 'shutdown.html')
      )
    );
  }

  // REQUESTED FILE
  const file = u.pathname === '/'
    ? 'index.html'
    : u.pathname.slice(1);

  // ALLOWED WEBSITE FILES
  if (!allowedFiles.has(file)) {
    return bad(res, 'Not found', 404);
  }

  // SERVE FILE
  fs.readFile(
    path.join(ROOT, 'public', file),
    (err, data) => {
      if (err) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store'
        });

        return res.end('Not found');
      }

      res.writeHead(200, {
        'Content-Type':
          types[path.extname(file)] ||
          'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });

      res.end(data);
    }
  );
});

// BACKGROUND AUCTION SETTLEMENT
setInterval(() => {
  const run = async () => {
    const auctionChanged = settleAuctions();
    if (auctionChanged) await save();
  };

  requestQueue = requestQueue
    .then(run, run)
    .catch(error => {
      console.error('Auction settlement:', error);
    });
}, 10000);

// START SERVER AFTER DATABASE CONNECTION
load()
  .then(async () => {
    await applyKartikEviction();

    if (db.economy) { delete db.economy; await save(); }
    db.eventverse ||= {events:[],teams:[],templates:[],notifications:[],history:[]};
  })
  .then(() =>
    server.listen(PORT, () => {
      console.log(
        `FFGC2K26 running on port ${PORT}`
      );
    })
  )
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
