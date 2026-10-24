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
    ['Kartik', 1270],
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
  teams: [], spotlight: [], supportMessages: []
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
    db.chamber ||= {sessions:[],activeId:null}; db.teams ||= []; db.spotlight ||= []; db.supportMessages ||= []; db.auctionHouse ||= {cycleStart:Date.now(), auctions:[], inventory:[], enabled:true};
    for (const m of db.members) m.profile ||= {};
  }
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

async function api(req, res, url) {
  let b = {};

  if (req.method !== 'GET') {
    try {
      const chunks = [];
      let size = 0;

      for await (const c of req) {
        size += c.length;
        if (size > 100000) throw Error('Payload too large');
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


  if(route.startsWith('/api/economy/')){
    const e=economyStore(),m=memberSession(req);
    if(route==='/api/economy/state'&&req.method==='GET')return send(res,200,economyView(e,m,admin));
    if(!admin&&!m)return bad(res,'Login with your private member ID first',401);
    if(!admin&&!e.enabled)return bad(res,'Economy temporarily closed',403);
    const acc=m?e.accounts[m.id]:null;
    if(route==='/api/economy/order'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);
      if(!econMarketOpen(e))return bad(res,'Market opens daily at 12:00 PM and closes at 12:00 AM IST');
      const co=e.companies.find(x=>x.id===b.companyId&&!x.archived&&!x.frozen);
      const qty=econNum(b.quantity);
      if(!co||!qty||qty>1000||!['buy','sell'].includes(b.side))return bad(res,'Invalid trade');
      const cost=qty*co.price;if(!Number.isSafeInteger(cost))return bad(res,'Invalid cost');
      if(b.side==='buy'&&acc.cash<cost)return bad(res,'Insufficient FC');
      if(b.side==='sell'&&(acc.shares[co.id]||0)<qty)return bad(res,'Insufficient shares');
      if(b.side==='buy'&&co.supply<qty)return bad(res,'Not enough shares available');
      if(b.side==='buy'&&(acc.shares[co.id]||0)+qty+e.orders.filter(x=>x.memberId===m.id&&x.companyId===co.id&&x.side==='buy'&&x.status==='pending').reduce((n,x)=>n+x.quantity,0)>10)return bad(res,'Maximum 10 shares per company per member');
      // Reserve at request time, execute at locked price after approval.
      if(b.side==='buy')acc.cash-=cost;else acc.shares[co.id]-=qty;
      const order={id:crypto.randomUUID(),memberId:m.id,companyId:co.id,side:b.side,quantity:qty,price:co.price,cost,status:e.approvalMode?'pending':'approved',at:new Date().toISOString()};
      e.orders.push(order);
      if(!e.approvalMode){if(b.side==='buy'){acc.shares[co.id]=(acc.shares[co.id]||0)+qty;co.supply-=qty;}else{acc.cash+=cost;co.supply+=qty;}econRecord(e,'trade',m.id,b.side+' '+qty+' '+co.name+' @ '+co.price);}
      await save();return send(res,200,{ok:true,status:order.status});
    }
    if(route==='/api/economy/business-buy'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);
      const t=e.businessTypes.find(x=>x.id===b.id&&!x.archived);
      if(!t||acc.cash<t.price)return bad(res,'Unavailable or insufficient FC');
      if(e.businesses.filter(x=>x.memberId===m.id).length>=3)return bad(res,'Maximum 3 businesses per member');
      acc.cash-=t.price;e.businesses.push({id:crypto.randomUUID(),typeId:t.id,memberId:m.id,paidAt:Date.now(),level:1});econRecord(e,'business_purchase',m.id,t.name+' -'+t.price+' FC');await save();return send(res,200,{ok:true});
    }
    if(route==='/api/economy/business-upgrade'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);const owned=e.businesses.find(x=>x.id===b.id&&x.memberId===m.id);const t=e.businessTypes.find(x=>x.id===owned?.typeId);if(!owned||!t||econBusinessLevel(owned)>=5)return bad(res,'Upgrade unavailable');
      const cost=Math.round(t.price*.4*econBusinessLevel(owned));if(acc.cash<cost)return bad(res,'Insufficient FC');acc.cash-=cost;owned.level=econBusinessLevel(owned)+1;econRecord(e,'business_upgrade',m.id,t.name+' level '+owned.level+' -'+cost+' FC');await save();return send(res,200,{ok:true});
    }
    if(route==='/api/economy/business-sell'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);const i=e.businesses.findIndex(x=>x.id===b.id&&x.memberId===m.id);if(i<0)return bad(res,'Business not owned');const owned=e.businesses[i],t=e.businessTypes.find(x=>x.id===owned.typeId);if(!t)return bad(res,'Business missing');const value=Math.round(t.price*(.55+.1*(econBusinessLevel(owned)-1)));acc.cash+=value;e.businesses.splice(i,1);econRecord(e,'business_resale',m.id,t.name+' +'+value+' FC');await save();return send(res,200,{ok:true,value});
    }
    if(route==='/api/economy/mission'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);const day=new Date(Date.now()+330*60000).toISOString().slice(0,10),key=m.id+':'+day,missions=e.missions[key]||[];
      if(!['invest','portfolio','business'].includes(b.kind)||missions.includes(b.kind))return bad(res,'Mission already claimed or invalid');
      const eligible=b.kind==='invest'?e.orders.some(o=>o.memberId===m.id&&o.status==='approved'&&o.side==='buy'):b.kind==='portfolio'?Object.values(acc.shares).some(n=>n>0):e.businesses.some(x=>x.memberId===m.id);
      if(!eligible)return bad(res,'Complete the mission first');const reward=b.kind==='business'?100:50;acc.cash+=reward;e.missions[key]=[...missions,b.kind];econRecord(e,'daily_mission',m.id,b.kind+' +'+reward+' FC');await save();return send(res,200,{ok:true,reward});
    }
    if(route==='/api/economy/product-buy'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);
      const t=e.products.find(x=>x.id===b.id&&!x.archived);
      if(!t||t.stock===0||acc.cash<t.price)return bad(res,'Unavailable or insufficient FC');
      if(['analytics','prestige'].includes(t.effect)&&e.items.some(x=>x.memberId===m.id&&x.effect===t.effect))return bad(res,'Already owned');
      acc.cash-=t.price;if(t.stock>0)t.stock--;e.items.push({id:crypto.randomUUID(),productId:t.id,title:t.name,memberId:m.id,at:new Date().toISOString(),status:'owned',effect:t.effect||'',expiresAt:t.days>0?Date.now()+t.days*86400000:null});econRecord(e,'marketplace_purchase',m.id,t.name+' -'+t.price+' FC');await save();return send(res,200,{ok:true});
    }
    if(route==='/api/economy/item-activate'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);const item=e.items.find(x=>x.id===b.id&&x.memberId===m.id&&x.effect==='business_boost'&&x.status==='owned');const owned=e.businesses.find(x=>x.id===b.businessId&&x.memberId===m.id);if(!item||!owned)return bad(res,'Invalid boost or business');item.businessId=owned.id;item.status='active';item.expiresAt=Date.now()+7*86400000;econRecord(e,'item_activated',m.id,item.title);await save();return send(res,200,{ok:true});
    }
    if(route==='/api/economy/trade-offer'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);
      const to=db.members.find(x=>x.id===b.toId);const amount=econNum(b.amount);
      if(!to||to.id===m.id||amount===null||amount===0||acc.cash<amount)return bad(res,'Invalid offer');
      const pass=e.items.some(x=>x.memberId===m.id&&x.effect==='trading'&&x.expiresAt>Date.now());
      const daily=e.trades.filter(x=>x.fromId===m.id&&new Date(x.at).toDateString()===new Date().toDateString()&&!['rejected'].includes(x.status)).reduce((n,x)=>n+x.amount,0);
      if(daily+amount>(pass?10000:3000))return bad(res,'Daily FC transfer limit reached');
      acc.cash-=amount;e.trades.push({id:crypto.randomUUID(),fromId:m.id,toId:to.id,amount,status:'offered',at:new Date().toISOString()});await save();return send(res,200,{ok:true});
    }
    if(route==='/api/economy/trade-respond'&&req.method==='POST'){
      if(!m)return bad(res,'Member only',403);
      const t=e.trades.find(x=>x.id===b.id&&x.toId===m.id&&x.status==='offered');if(!t)return bad(res,'Offer not found');
      if(b.action==='reject'){e.accounts[t.fromId].cash+=t.amount;t.status='rejected';}
      else if(b.action==='accept')t.status='pending';else return bad(res,'Invalid action');
      await save();return send(res,200,{ok:true});
    }
    if(!admin)return bad(res,'God Admin only',403);
    if(route==='/api/economy/admin'&&req.method==='POST'){
      const op=b.action;
      if(op==='settings'){
        for(const key of ['enabled','marketOpen','approvalMode','autoMarket'])if(typeof b[key]==='boolean')e[key]=b[key];
      }else if(op==='cash'){
        const a=e.accounts[b.memberId],n=econNum(b.amount);if(!a||n===null||!['add','subtract'].includes(b.mode))return bad(res,'Invalid adjustment');
        if(b.mode==='subtract'&&a.cash<n)return bad(res,'Insufficient cash');a.cash+=b.mode==='add'?n:-n;econRecord(e,'admin_cash',b.memberId,b.mode+' '+n+' FC');
      }else if(op==='company'){
        const price=econNum(b.price),supply=econNum(b.supply);if(!String(b.name||'').trim()||!price||supply===null)return bad(res,'Invalid company');
        const co=b.id?e.companies.find(x=>x.id===b.id):null;
        if(co){co.name=String(b.name).slice(0,70);co.price=price;co.supply=supply;co.history.push({at:new Date().toISOString(),price});}
        else e.companies.push({id:crypto.randomUUID(),name:String(b.name).slice(0,70),price,supply,history:[{at:new Date().toISOString(),price}],frozen:false});
      }else if(op==='company-control'){
        const co=e.companies.find(x=>x.id===b.id);if(!co)return bad(res,'Company missing');
        if(b.mode==='freeze')co.frozen=true;else if(b.mode==='unfreeze')co.frozen=false;else if(b.mode==='archive')co.archived=true;else return bad(res,'Invalid mode');
      }else if(op==='schedule'){
        const co=e.companies.find(x=>x.id===b.companyId&&!x.archived),target=econNum(b.target),startAt=Date.parse(b.startAt),minutes=Number(b.minutes);
        if(!co||!target||!Number.isFinite(startAt)||startAt<Date.now()-60000||!Number.isFinite(minutes)||minutes<1||minutes>1440)return bad(res,'Invalid schedule');
        e.schedules.push({id:crypto.randomUUID(),companyId:co.id,target,startAt,durationMs:minutes*60000,status:'pending'});
      }else if(op==='cancel-schedule'){
        const sc=e.schedules.find(x=>x.id===b.id&&x.status==='pending');if(!sc)return bad(res,'Only pending schedules can be cancelled');sc.status='cancelled';
      }else if(op==='business-type'||op==='product'){
        const name=String(b.name||'').trim(),price=econNum(b.price);if(!name||price===null)return bad(res,'Invalid listing');
        if(op==='business-type'){const income=econNum(b.income),maintenance=econNum(b.maintenance);if(income===null||maintenance===null)return bad(res,'Invalid income');const existing=e.businessTypes.find(x=>x.id===b.id);if(existing)Object.assign(existing,{name:name.slice(0,70),price,income,maintenance});else e.businessTypes.push({id:crypto.randomUUID(),name:name.slice(0,70),price,income,maintenance});}
        else {const stock=econNum(b.stock);if(stock===null)return bad(res,'Invalid stock');const existing=e.products.find(x=>x.id===b.id);if(existing)Object.assign(existing,{name:name.slice(0,70),price,stock});else e.products.push({id:crypto.randomUUID(),name:name.slice(0,70),price,stock});}
      }else if(op==='archive-listing'){
        const list=b.kind==='business'?e.businessTypes:e.products;const x=list.find(x=>x.id===b.id);if(!x)return bad(res,'Not found');x.archived=true;
      }else if(op==='review-order'){
        const o=e.orders.find(x=>x.id===b.id&&x.status==='pending');if(!o)return bad(res,'Pending order not found');
        const a=e.accounts[o.memberId],co=e.companies.find(x=>x.id===o.companyId);if(!a||!co)return bad(res,'Account/company missing');
        if(b.decision==='reject'){if(o.side==='buy')a.cash+=o.cost;else a.shares[co.id]=(a.shares[co.id]||0)+o.quantity;o.status='rejected';}
        else if(b.decision==='approve'){
          if(o.side==='buy'){if(co.supply<o.quantity)return bad(res,'Not enough shares available');co.supply-=o.quantity;a.shares[co.id]=(a.shares[co.id]||0)+o.quantity;}
          else {a.cash+=o.cost;co.supply+=o.quantity;}o.status='approved';econRecord(e,'trade',o.memberId,o.side+' '+o.quantity+' '+co.name+' @ '+o.price);
        }else return bad(res,'Invalid decision');
      }else if(op==='review-trade'){
        const t=e.trades.find(x=>x.id===b.id&&x.status==='pending');if(!t)return bad(res,'Trade not found');
        if(b.decision==='approve'){e.accounts[t.toId].cash+=t.amount;t.status='approved';econRecord(e,'member_transfer',t.fromId,'To '+t.toId+': '+t.amount+' FC');}
        else if(b.decision==='reject'){e.accounts[t.fromId].cash+=t.amount;t.status='rejected';}else return bad(res,'Invalid decision');
      }else return bad(res,'Unknown admin action');
      await save();return send(res,200,{ok:true});
    }
    return bad(res,'Unknown economy endpoint',404);
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
      !['public', 'maintenance', 'private'].includes(b.siteMode)
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
      excluded: false
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


// ECONOMIC EMPIRE: independent virtual economy (never touches ranking points/auction coins).
function economyStore(){
  if(!db.economy)db.economy={enabled:true,marketOpen:true,approvalMode:false,initialCash:2000,accounts:{},companies:[],businessTypes:[],businesses:[],products:[],items:[],trades:[],orders:[],schedules:[],history:[],lastTick:Date.now()};
  const e=db.economy;
  // One-time seed: never overwrite or reset existing accounts, listings or purchases.
  e.seedVersion ||= 0;
  e.autoMarket ??= true; e.marketEvents ||= []; e.notifications ||= []; e.missions ||= {}; e.lastAutoTick ||= Date.now();
  if(e.seedVersion<1){
    const companySeeds=[['Royal Crown Industries',500,100],['Diamond Empire Ltd.',450,120],['Thunderbolt Energy',320,150],['NovaTech Solutions',280,180],['Imperial Banking Corp.',250,200],['Phoenix Motors',220,220],['CyberCore Technologies',180,250],['Skyline Real Estate',150,300],['MegaMart Retail',120,350],['GreenFuture Energy',100,400],['PixelVerse Gaming',75,500],['StarLink Entertainment',50,600]];
    for(const [name,price,supply] of companySeeds)if(!e.companies.some(x=>x.name.toLowerCase()===name.toLowerCase()))e.companies.push({id:crypto.randomUUID(),name,price,supply,history:[{at:new Date().toISOString(),price}],frozen:false});
    const businessSeeds=[['Royal Café',8000,400],['Gaming Lounge',12000,650],['Premium Restaurant',18000,950],['Shopping Complex',25000,1300],['Luxury Hotel',40000,2100],['Finance Corporation',60000,3200],['Industrial Factory',85000,4500],['Diamond Corporation',120000,6500],['Royal Business Empire',200000,11000]];
    for(const [name,price,income] of businessSeeds)if(!e.businessTypes.some(x=>x.name.toLowerCase()===name.toLowerCase()))e.businessTypes.push({id:crypto.randomUUID(),name,price,income,maintenance:Math.round(income*.2)});
    const productSeeds=[['FC Bonus Pack',1500,'bonus',1],['Trading Pass',2500,'trading',7],['Banking Plus',4000,'analytics',0],['Business Booster',6000,'business_boost',7],['VIP Investor Badge',10000,'vip_badge',30],['Empire Prestige',25000,'prestige',0]];
    for(const [name,price,effect,days] of productSeeds)if(!e.products.some(x=>x.name.toLowerCase()===name.toLowerCase()))e.products.push({id:crypto.randomUUID(),name,price,stock:-1,effect,days});
    e.seedVersion=1;
  }
  if(e.seedVersion<2){for(const t of e.businessTypes)if(!t.maintenance)t.maintenance=Math.round(t.income*.2);e.seedVersion=2;}
  for(const k of ['companies','businessTypes','businesses','products','items','trades','orders','schedules','history'])e[k] ||= [];
  e.accounts ||= {};
  for(const m of db.members) if(!e.accounts[m.id])e.accounts[m.id]={cash:e.initialCash??2000,shares:{}};
  return e;
}
function econMarketOpen(e){const d=new Date();const ist=new Date(d.getTime()+330*60000);const hour=ist.getUTCHours();return e.marketOpen!==false&&hour>=12&&hour<24;}
function econRecord(e,action,memberId,detail){e.history.unshift({id:crypto.randomUUID(),at:new Date().toISOString(),action,memberId,detail});if(e.history.length>2500)e.history.length=2500;}
function econNum(x){const n=Number(x);return Number.isSafeInteger(n)&&n>=0&&n<=100000000?n:null;}
function econNotify(e,memberId,message){e.notifications.unshift({id:crypto.randomUUID(),memberId,message,at:Date.now()});if(e.notifications.length>1500)e.notifications.length=1500;}
function econBusinessLevel(owned){return Math.max(1,Math.min(5,owned.level||1));}
function econMaintenance(t,owned){return Math.round(t.maintenance*(1+.25*(econBusinessLevel(owned)-1)));}
function econIncome(t,owned){return Math.round(t.income*(1+.3*(econBusinessLevel(owned)-1)));}
function econAutoMarket(e,now){
 if(!econMarketOpen(e)||e.autoMarket===false)return false;
 const tick=10000, steps=Math.min(360,Math.floor((now-e.lastAutoTick)/tick));if(steps<=0)return false;
 // Server-side movement persists across redeploys; only completed market-open ticks are applied.
 e.lastAutoTick=now;let changed=false;
 const hourKey=Math.floor((now+330*60000)/3600000);
 if(e.lastEventHour!==hourKey){
   e.lastEventHour=hourKey;
   const categories=['Technology Boost','Retail Momentum','Energy Slowdown','Market Stability'];
   const eventName=categories[hourKey%categories.length];
   e.marketEvents.unshift({at:now,title:eventName});e.marketEvents=e.marketEvents.slice(0,30);
   econRecord(e,'market_event',null,eventName);changed=true;
 }

 for(const co of e.companies){if(co.archived||co.frozen||e.schedules.some(sc=>sc.companyId===co.id&&sc.status==='running'))continue;
  const old=co.price;const seed=crypto.createHash('sha256').update(co.id+':'+Math.floor(now/tick)).digest().readUInt32BE(0)/4294967295;
  const drift=(seed-.5)*.008;const next=Math.max(1,Math.round(co.price*(1+drift)));
  if(next!==old){co.price=next;co.history ||= [];co.history.push({at:new Date(now).toISOString(),price:next});if(co.history.length>2000)co.history.splice(0,co.history.length-2000);changed=true;}
 }
 return changed;
}
function econSettle(){
  if(!db.economy)return false;
  const e=economyStore(),now=Date.now();let changed=econAutoMarket(e,now);
  for(const sc of e.schedules){
    if(sc.status==='cancelled'||sc.status==='done')continue;
    const co=e.companies.find(x=>x.id===sc.companyId);
    if(!co||co.archived){sc.status='cancelled';changed=true;continue;}
    if(now<sc.startAt)continue;
    if(sc.status==='pending'){sc.status='running';sc.from=co.price;changed=true;}
    const progress=Math.min(1,Math.max(0,(now-sc.startAt)/Math.max(1000,sc.durationMs)));
    const next=Math.max(1,Math.round(sc.from+(sc.target-sc.from)*progress));
    if(next!==co.price){co.price=next;co.history ||= [];co.history.push({at:new Date(now).toISOString(),price:next});if(co.history.length>2000)co.history.shift();changed=true;}
    if(progress===1){sc.status='done';econRecord(e,'scheduled_price',null,co.name+' reached '+co.price+' FC');changed=true;}
  }
  // One payout per due cycle, only after available FC pays maintenance first.
  for(const owned of e.businesses){const type=e.businessTypes.find(x=>x.id===owned.typeId);if(!type||type.archived)continue;
    const acc=e.accounts[owned.memberId];if(!acc)continue;
    owned.paidAt ||= owned.purchasedAt||now;
    if(now-owned.paidAt>=6*86400000 && !owned.remindedAt){econNotify(e,owned.memberId,type.name+' maintenance due soon: '+econMaintenance(type,owned)+' FC');owned.remindedAt=now;changed=true;}
    let cycles=0;
    while(now-owned.paidAt>=7*86400000&&cycles++<12){
      const fee=econMaintenance(type,owned);if(acc.cash<fee){if(!owned.locked){owned.locked=true;econNotify(e,owned.memberId,type.name+' income locked: maintenance '+fee+' FC required');changed=true;}break;}
      acc.cash-=fee;let income=econIncome(type,owned);
      const bonus=e.items.find(x=>x.memberId===owned.memberId&&x.effect==='bonus'&&x.status==='owned');if(bonus){income=Math.round(income*1.1);bonus.status='used';}
      const boost=e.items.some(x=>x.memberId===owned.memberId&&x.effect==='business_boost'&&x.businessId===owned.id&&x.expiresAt>now);if(boost)income=Math.round(income*1.2);
      acc.cash+=income;owned.paidAt+=7*86400000;owned.locked=false;owned.remindedAt=null;
      econRecord(e,'business_income',owned.memberId,type.name+': maintenance -'+fee+' FC; income +'+income+' FC');econNotify(e,owned.memberId,type.name+' weekly income +'+income+' FC (maintenance -'+fee+' FC)');changed=true;
    }
  }
  return changed;
}
function economyView(e,member,admin){
 const companies=e.companies.filter(x=>!x.archived).map(x=>({id:x.id,name:x.name,price:x.price,supply:x.supply,history:x.history||[],frozen:!!x.frozen}));
 const account=member?e.accounts[member.id]:null;
 const memberBusinesses=e.businesses.filter(x=>member&&x.memberId===member.id);
 const networth=account?account.cash+companies.reduce((sum,c)=>sum+(account.shares[c.id]||0)*c.price,0)+memberBusinesses.reduce((sum,b)=>sum+(e.businessTypes.find(t=>t.id===b.typeId)?.price||0),0):0;
 const ranks=db.members.map(m=>{const a=e.accounts[m.id]||{cash:0,shares:{}};const items=e.items.filter(x=>x.memberId===m.id);const badges=[items.some(x=>x.effect==='vip_badge'&&x.expiresAt>Date.now())?'👑 VIP':'',items.some(x=>x.effect==='prestige')?'💎 Prestige':''].filter(Boolean).join(' ');return {name:m.name,badges,netWorth:a.cash+companies.reduce((sum,c)=>sum+(a.shares[c.id]||0)*c.price,0)+e.businesses.filter(b=>b.memberId===m.id).reduce((sum,b)=>sum+(e.businessTypes.find(t=>t.id===b.typeId)?.price||0),0)}}).sort((a,b)=>b.netWorth-a.netWorth);
 return {enabled:e.enabled,marketOpen:econMarketOpen(e),approvalMode:e.approvalMode,member:member?{id:member.id,name:member.name,account,netWorth:networth,businesses:memberBusinesses,notifications:e.notifications.filter(x=>x.memberId===member.id).slice(0,30),missions:e.missions[member.id+':'+new Date(Date.now()+330*60000).toISOString().slice(0,10)]||[],items:e.items.filter(x=>x.memberId===member.id),orders:e.orders.filter(x=>x.memberId===member.id),trades:e.trades.filter(x=>x.fromId===member.id||x.toId===member.id),history:e.history.filter(x=>x.memberId===member.id).slice(0,60),achievements:[...(e.orders.some(x=>x.memberId===member.id&&x.side==='buy'&&x.status==='approved')?['🏅 First Investor']:[]),...(memberBusinesses.length?['🏢 Business Tycoon']:[]),...(networth>=100000?['💎 Millionaire Club']:[]),...(e.orders.filter(x=>x.memberId===member.id&&x.status==='approved').length>=50?['📈 Market Legend']:[])]}:null,companies,businessTypes:e.businessTypes.filter(x=>!x.archived),autoMarket:e.autoMarket,marketEvents:e.marketEvents.slice(0,12),products:e.products.filter(x=>!x.archived),rankings:ranks.slice(0,30),tradeMembers:member?db.members.filter(x=>x.id!==member.id).map(x=>({id:x.id,name:x.name})):[],activity:e.orders.filter(x=>x.status==='approved').slice(-20).reverse().map(x=>({company:e.companies.find(c=>c.id===x.companyId)?.name||'Company',side:x.side,quantity:x.quantity,at:x.at})),members:admin?db.members.map(m=>({id:m.id,name:m.name,cash:e.accounts[m.id]?.cash||0})):undefined,admin:admin?{schedules:e.schedules,orders:e.orders,trades:e.trades,history:e.history.slice(0,200),businesses:e.businesses,holdings:db.members.map(m=>({name:m.name,id:m.id,shares:e.accounts[m.id]?.shares||{},orders:e.orders.filter(o=>o.memberId===m.id).slice(-50)})),items:e.items,settings:{initialCash:e.initialCash,autoMarket:e.autoMarket,fcCirculation:Object.values(e.accounts).reduce((n,a)=>n+a.cash,0),lockedBusinesses:e.businesses.filter(b=>b.locked).length}}:undefined};
}

// STATIC WEBSITE FILES
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

let requestQueue = Promise.resolve();

const server = http.createServer((req, res) => {
  let u;

  try {
    u = new URL(req.url, 'http://localhost');
  } catch {
    return bad(res, 'Invalid URL');
  }

  if (u.pathname.startsWith('/api/')) {
    const run = () =>
      api(req, res, u).catch(e => {
        console.error(e);
        if (!res.headersSent) {
          bad(res, 'Server error', 500);
        }
      });

    requestQueue = requestQueue.then(run, run);
    return;
  }

  const file = u.pathname === '/'
    ? 'index.html'
    : u.pathname.slice(1);

  if (!['index.html', 'app.js', 'style.css', 'auction.js', 'auction.css', 'arena4.css', 'chamber.js', 'chamber.css', 'economy.html', 'economy-admin.html', 'economy.css', 'economy.js'].includes(file)) {
    return bad(res, 'Not found', 404);
  }

  fs.readFile(
    path.join(ROOT, 'public', file),
    (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }

      res.writeHead(200, {
        'Content-Type': types[path.extname(file)],
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      });

      res.end(data);
    }
  );
});

// Serialize scheduled settlement with API writes.
setInterval(() => {
  const run = async () => { const auctionChanged=settleAuctions(); const econChanged=econSettle(); if (auctionChanged||econChanged) await save(); };
  requestQueue = requestQueue.then(run, run).catch(e => console.error('Auction settlement:', e));
}, 10000);

// START SERVER AFTER DATABASE CONNECTION
load()
  .then(async () => {const previous=db.economy?.seedVersion||0;economyStore();if(previous<1)await save();})
  .then(() =>
    server.listen(PORT, () =>
      console.log(`FFGC2K26 running on port ${PORT}`)
    )
  )
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
