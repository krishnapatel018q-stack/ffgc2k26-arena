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
  const base={id:s.id,status:s.status,members:s.members.map(id=>({id,name:chamberName(id),joined:!!s.joined[id],online:!!s.online[id]})),reportAt:s.reportAt,entryDeadline:s.entryDeadline,decisionEndsAt:s.decisionEndsAt||null,completedAt:s.completedAt||null,revealed:!!s.revealed};
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
        const x={id:crypto.randomUUID(),members,pollId:poll.id,reportAt,entryDeadline:reportAt+120000,decisionEndsAt:null,status:'scheduled',joined:{},online:{},selections:{},messages:[],nominated:[],revealed:false,reason:null,createdAt:Date.now()};
        c.sessions.push(x);c.sessions=c.sessions.slice(-100);c.activeId=x.id;log('Chamber scheduled',members.map(chamberName).join(' vs '));await save();return send(res,200,{ok:true});
      }
      if(!s)return bad(res,'No active session');
      if(b.action==='cancel'){if(s.status==='complete')return bad(res,'Completed results cannot be cancelled');s.status='cancelled';log('Chamber cancelled',s.id);}
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
    const settle=()=>{let changed=false;for(const a of house.auctions){if(!a.closed&&a.endAt<=now){a.closed=true;const win=bidsOf(a).at(-1);if(win){a.winnerId=win.memberId;a.winningBid=win.amount;house.inventory.push({id:crypto.randomUUID(),memberId:win.memberId,auctionId:a.id,title:a.title,description:a.description,wonAt:new Date().toISOString(),expiresAt:new Date(now+30*86400000).toISOString(),used:false});}changed=true;}}return changed;};
    if(settle()) await save();
    if(route==='/api/auction/state'&&req.method==='GET') return send(res,200,{enabled:house.enabled,cycle,cycleEndsAt:new Date(house.cycleStart+(cycle+1)*cycleMs).toISOString(),wallet:member?{memberId:member.id,balance:balance(member.id),locked:locked(member.id),spent:spent(member.id)}:null,inventory:member?owned(member.id):[],auctions:house.auctions.map(a=>({id:a.id,title:a.title,description:a.description,rarity:a.rarity,startAt:a.startAt,endAt:a.endAt,startingBid:a.startingBid,minIncrement:a.minIncrement,cycle:a.cycle,closed:a.closed,winnerId:a.closed?a.winnerId:null,winningBid:a.closed?a.winningBid:null,highestBid:bidsOf(a).at(-1)?.amount||0,bids:bidsOf(a).map(x=>({memberName:db.members.find(m=>m.id===x.memberId)?.name||'Member',amount:x.amount,at:x.at}))}))});
    if(route==='/api/auction/bid'&&req.method==='POST'){
      if(!member)return bad(res,'Member login required',401);
      if(!house.enabled)return bad(res,'Auction House disabled',403);
      const a=house.auctions.find(x=>x.id===b.id);if(!a||a.closed||a.cycle!==cycle||now<a.startAt||now>=a.endAt)return bad(res,'Auction is not active');
      const top=bidsOf(a).at(-1), amount=Number(b.amount), min=top?top.amount+a.minIncrement:a.startingBid;
      if(!Number.isSafeInteger(amount)||amount<min||amount>1000)return bad(res,'Invalid bid amount');
      if(top?.memberId===member.id)return bad(res,'You already have the highest bid');
      if(amount>balance(member.id))return bad(res,'Insufficient available coins');
      a.bids.push({memberId:member.id,amount,at:new Date(now).toISOString()});
      if(a.endAt-now<=120000)a.endAt=now+120000;
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
      }else if(b.action==='delete'){
        const a=house.auctions.find(x=>x.id===b.id);if(!a||a.bids.length||a.closed)return bad(res,'Only auctions without bids can be deleted');house.auctions=house.auctions.filter(x=>x.id!==b.id);
      }else if(b.action==='enabled'){house.enabled=Boolean(b.enabled);
      }else if(b.action==='useReward'){
        const item=house.inventory.find(x=>x.id===b.id);if(!item||item.used||Date.parse(item.expiresAt)<=now)return bad(res,'Invalid or expired reward');item.used=true;item.usedAt=new Date().toISOString();
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
      if (!db.members.some(m=>m.id===b.memberId) || !required(b.title,100) || typeof b.description!=='string' || b.description.length>300 || !['gold','purple','red','blue'].includes(b.theme)) return bad(res,'Invalid spotlight');
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

  if (!['index.html', 'app.js', 'style.css', 'auction.js', 'auction.css', 'arena4.css', 'chamber.js', 'chamber.css'].includes(file)) {
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

// START SERVER AFTER DATABASE CONNECTION
load()
  .then(() =>
    server.listen(PORT, () =>
      console.log(`FFGC2K26 running on port ${PORT}`)
    )
  )
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
