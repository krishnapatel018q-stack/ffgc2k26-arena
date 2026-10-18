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
  history: []
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

function publicData(admin) {
  const locked = db.settings.siteMode !== 'public' && !admin;

  return {
    settings: db.settings,
    locked,
    leaderboard: locked ? [] : ranked(),
    tasks: locked ? [] : db.tasks,
    announcements: locked ? [] : db.announcements,
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
        counts: (
          p.status === 'closed' || p.resultsVisible
        )
          ? p.choices.map(c =>
              p.votes.filter(v => v.choices.includes(c)).length
            )
          : null
      })),
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
      !required(b.body, 2000)
    ) {
      return bad(res, 'Enter title and message');
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
      resultsVisible: !!b.resultsVisible,
      votes: []
    };

    db.polls.unshift(p);

    log('Poll created', p.title);
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

  if (!['index.html', 'app.js', 'style.css'].includes(file)) {
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
