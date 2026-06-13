// 845 Premium Detailing - runs TWO sites from one process:
//
//   Main site  http://localhost:3000  (customer site + public booking API)
//   Admin site http://localhost:3001  (password-protected editor, separate site)
//
// Zero npm dependencies - built on Node's http module. Start with: node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const auth = require('./lib/auth');
const calendar = require('./lib/calendar');
const slots = require('./lib/slots');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PORT = Number(process.env.ADMIN_PORT || 3001);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ADMIN_DIR = path.join(__dirname, 'admin');

const SESSION_COOKIE = 'admin_session';

// ---------------------------------------------------------------- helpers --

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 200 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Serves a static file from the first directory that has it.
function serveStatic(res, dirs, urlPath) {
  let clean = decodeURIComponent(urlPath.split('?')[0]);
  if (clean === '/') clean = '/index.html';
  for (const dir of dirs) {
    const resolved = path.normalize(path.join(dir, clean));
    if (!resolved.startsWith(dir + path.sep) && resolved !== dir) continue; // traversal guard
    let stat;
    try {
      stat = fs.statSync(resolved);
    } catch (err) {
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = path.extname(resolved).toLowerCase();
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(resolved).pipe(res);
    return true;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
  return false;
}

function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}

function clean(value, max = 200) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

// ------------------------------------------------------- main site (3000) --

const mainServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    // The public API is CORS-open so a statically hosted copy of the site
    // (e.g. GitHub Pages) can book against this server from another origin.
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }

    if (url.pathname === '/api/content' && req.method === 'GET') {
      return sendJson(res, 200, store.read('content', {}));
    }

    if (url.pathname === '/api/booking-window' && req.method === 'GET') {
      const schedule = store.read('schedule', {});
      return sendJson(res, 200, slots.bookingWindow(schedule));
    }

    if (url.pathname === '/api/availability' && req.method === 'GET') {
      const schedule = store.read('schedule', {});
      const bookings = store.read('bookings', []);
      const date = url.searchParams.get('date') || '';
      const busy = await safeBusyRanges(date, schedule);
      return sendJson(res, 200, slots.slotsForDate(date, schedule, bookings, busy));
    }

    if (url.pathname === '/api/bookings' && req.method === 'POST') {
      return handleCreateBooking(req, res);
    }

    return serveStatic(res, [PUBLIC_DIR], url.pathname);
  } catch (err) {
    console.error('[main]', err);
    sendJson(res, 500, { error: 'Something went wrong on our end. Please try again.' });
  }
});

// Busy ranges from Google Calendar, or [] when not configured/unreachable -
// availability must keep working even if Google is down.
async function safeBusyRanges(date, schedule) {
  if (!calendar.isConfigured() || !slots.isDateStr(date)) return [];
  try {
    return await calendar.busyRangesForDate(date, schedule);
  } catch (err) {
    console.error('[calendar] free/busy failed:', err.message);
    return [];
  }
}

async function handleCreateBooking(req, res) {
  const body = await readJsonBody(req);
  const booking = {
    id: crypto.randomUUID(),
    name: clean(body.name, 100),
    phone: clean(body.phone, 40),
    vehicle: clean(body.vehicle, 120),
    service: clean(body.service, 100),
    date: clean(body.date, 10),
    time: clean(body.time, 5),
    notes: clean(body.notes, 600),
    created: new Date().toISOString(),
    calendarEventId: null,
    calendarError: null
  };

  if (!booking.name || !booking.phone || !booking.service || !booking.date || !booking.time) {
    return sendJson(res, 400, { error: 'Please fill in your name, phone, a service, a date and a time.' });
  }
  if (!slots.isDateStr(booking.date) || !slots.isTimeStr(booking.time)) {
    return sendJson(res, 400, { error: 'Invalid date or time.' });
  }
  const content = store.read('content', {});
  if (!(content.services || []).some((s) => s.name === booking.service)) {
    return sendJson(res, 400, { error: 'Please choose a service from the list.' });
  }

  const schedule = store.read('schedule', {});
  const bookings = store.read('bookings', []);
  const busy = await safeBusyRanges(booking.date, schedule);
  const day = slots.slotsForDate(booking.date, schedule, bookings, busy);
  const slot = day.slots.find((s) => s.time === booking.time);
  if (!day.open || !slot) {
    return sendJson(res, 400, { error: day.reason || 'That date is not open for bookings.' });
  }
  if (!slot.available) {
    return sendJson(res, 409, { error: 'Sorry - that time was just taken. Please pick another slot.' });
  }

  bookings.unshift(booking);
  store.write('bookings', bookings);

  // Google Calendar sync is best-effort: the booking stands even if it fails,
  // and the admin Bookings tab shows the sync state either way.
  if (calendar.isConfigured()) {
    try {
      booking.calendarEventId = await calendar.createBookingEvent(booking, schedule);
    } catch (err) {
      booking.calendarError = err.message;
      console.error('[calendar] create failed:', err.message);
    }
  } else {
    booking.calendarError = 'Google Calendar not configured';
  }
  store.write('bookings', bookings);

  sendJson(res, 201, {
    ok: true,
    calendarSynced: !!booking.calendarEventId,
    booking: { service: booking.service, date: booking.date, time: booking.time, label: slot.label }
  });
}

// ------------------------------------------------------ admin site (3001) --

// Login rate limit: max 8 attempts per 10 minutes per IP.
const loginAttempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.reset < now) {
    loginAttempts.set(ip, { count: 1, reset: now + 10 * 60 * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= 8;
}

const adminServer = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = parseCookies(req)[SESSION_COOKIE];
    const authed = auth.validSession(token);

    // ---- auth endpoints (no session required) ----
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || 'unknown';
      if (!loginAllowed(ip)) {
        return sendJson(res, 429, { error: 'Too many attempts. Wait 10 minutes and try again.' });
      }
      const body = await readJsonBody(req);
      if (!auth.verifyPassword(String(body.password || ''))) {
        return sendJson(res, 401, { error: 'Wrong password.' });
      }
      const session = auth.createSession();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(auth.SESSION_TTL_MS / 1000)}`
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      auth.destroySession(token);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (url.pathname === '/api/me' && req.method === 'GET') {
      return sendJson(res, 200, { authed });
    }

    // ---- everything else under /api requires a session ----
    if (url.pathname.startsWith('/api/')) {
      if (!authed) return sendJson(res, 401, { error: 'Not logged in.' });
      return handleAdminApi(req, res, url);
    }

    // ---- pages: the dashboard requires login ----
    if ((url.pathname === '/' || url.pathname === '/index.html') && !authed) {
      return redirect(res, '/login.html');
    }
    if (url.pathname === '/login.html' && authed) {
      return redirect(res, '/');
    }
    // /assets/* (logo + fonts) falls through to the public dir.
    return serveStatic(res, [ADMIN_DIR, PUBLIC_DIR], url.pathname);
  } catch (err) {
    console.error('[admin]', err);
    sendJson(res, 500, { error: 'Server error.' });
  }
});

async function handleAdminApi(req, res, url) {
  // GET /api/overview - everything the dashboard needs in one call
  if (url.pathname === '/api/overview' && req.method === 'GET') {
    return sendJson(res, 200, {
      content: store.read('content', {}),
      schedule: store.read('schedule', {}),
      settings: store.read('settings', {}),
      bookings: store.read('bookings', []),
      calendar: calendar.status()
    });
  }

  // PUT /api/content - replace site content
  if (url.pathname === '/api/content' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return sendJson(res, 400, { error: 'Content must be an object.' });
    }
    const current = store.read('content', {});
    const next = {
      heroEyebrow: clean(body.heroEyebrow ?? current.heroEyebrow, 120),
      heroTitle: clean(body.heroTitle ?? current.heroTitle, 160),
      heroSub: clean(body.heroSub ?? current.heroSub, 500),
      ctaTitle: clean(body.ctaTitle ?? current.ctaTitle, 160),
      ctaSub: clean(body.ctaSub ?? current.ctaSub, 300),
      services: sanitizeServices(body.services ?? current.services),
      points: sanitizePoints(body.points ?? current.points),
      phone: clean(body.phone ?? current.phone, 60),
      email: clean(body.email ?? current.email, 120),
      instagram: clean(body.instagram ?? current.instagram, 120),
      area: clean(body.area ?? current.area, 160),
      hours: clean(body.hours ?? current.hours, 120)
    };
    store.write('content', next);
    return sendJson(res, 200, { ok: true, content: next });
  }

  // PUT /api/schedule - booking times
  if (url.pathname === '/api/schedule' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const error = validateSchedule(body);
    if (error) return sendJson(res, 400, { error });
    const next = {
      timezone: body.timezone,
      slotMinutes: Number(body.slotMinutes),
      maxDaysAhead: Number(body.maxDaysAhead),
      weekly: {},
      blockedDates: [...new Set(body.blockedDates)].sort()
    };
    for (let d = 0; d <= 6; d++) {
      const day = body.weekly[String(d)];
      next.weekly[String(d)] = { open: !!day.open, start: day.start, end: day.end };
    }
    store.write('schedule', next);
    return sendJson(res, 200, { ok: true, schedule: next });
  }

  // PUT /api/settings - calendar ID
  if (url.pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const settings = store.read('settings', {});
    settings.calendarId = clean(body.calendarId, 200);
    store.write('settings', settings);
    return sendJson(res, 200, { ok: true, settings, calendar: calendar.status() });
  }

  // DELETE /api/bookings/:id - remove a booking (and its calendar event)
  const bookingMatch = url.pathname.match(/^\/api\/bookings\/([0-9a-f-]+)$/);
  if (bookingMatch && req.method === 'DELETE') {
    const bookings = store.read('bookings', []);
    const booking = bookings.find((b) => b.id === bookingMatch[1]);
    if (!booking) return sendJson(res, 404, { error: 'Booking not found.' });
    let calendarRemoved = false;
    if (booking.calendarEventId && calendar.isConfigured()) {
      try {
        await calendar.deleteBookingEvent(booking.calendarEventId);
        calendarRemoved = true;
      } catch (err) {
        console.error('[calendar] delete failed:', err.message);
      }
    }
    store.write('bookings', bookings.filter((b) => b.id !== booking.id));
    return sendJson(res, 200, { ok: true, calendarRemoved });
  }

  // POST /api/password - change the admin password
  if (url.pathname === '/api/password' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!auth.verifyPassword(String(body.current || ''))) {
      return sendJson(res, 400, { error: 'Current password is wrong.' });
    }
    const next = String(body.next || '');
    if (next.length < 8) {
      return sendJson(res, 400, { error: 'New password must be at least 8 characters.' });
    }
    auth.setPassword(next);
    return sendJson(res, 200, { ok: true });
  }

  // POST /api/calendar/test - verify the Google Calendar connection
  if (url.pathname === '/api/calendar/test' && req.method === 'POST') {
    try {
      const result = await calendar.testConnection();
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  sendJson(res, 404, { error: 'Unknown endpoint.' });
}

function sanitizeServices(services) {
  if (!Array.isArray(services)) return [];
  return services.slice(0, 20).map((s) => ({
    name: clean(s && s.name, 80),
    price: clean(s && s.price, 40),
    time: clean(s && s.time, 40),
    desc: clean(s && s.desc, 300)
  })).filter((s) => s.name);
}

function sanitizePoints(points) {
  if (!Array.isArray(points)) return [];
  return points.slice(0, 8).map((p) => ({
    t: clean(p && p.t, 80),
    d: clean(p && p.d, 300)
  })).filter((p) => p.t || p.d);
}

function validateSchedule(body) {
  if (typeof body !== 'object' || body === null) return 'Schedule must be an object.';
  try {
    new Intl.DateTimeFormat('en', { timeZone: body.timezone });
  } catch (err) {
    return 'Unknown timezone: ' + body.timezone;
  }
  const slotMinutes = Number(body.slotMinutes);
  if (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 480) {
    return 'Slot length must be between 15 and 480 minutes.';
  }
  const maxDaysAhead = Number(body.maxDaysAhead);
  if (!Number.isInteger(maxDaysAhead) || maxDaysAhead < 1 || maxDaysAhead > 365) {
    return 'Booking window must be between 1 and 365 days.';
  }
  if (typeof body.weekly !== 'object' || body.weekly === null) return 'Missing weekly hours.';
  for (let d = 0; d <= 6; d++) {
    const day = body.weekly[String(d)];
    if (!day) return 'Missing weekday ' + d + '.';
    if (!slots.isTimeStr(day.start) || !slots.isTimeStr(day.end)) {
      return 'Hours must be HH:MM times.';
    }
    if (day.open && slots.parseTime(day.start) + slotMinutes > slots.parseTime(day.end)) {
      return 'On open days, closing time must allow at least one full slot.';
    }
  }
  if (!Array.isArray(body.blockedDates) || body.blockedDates.some((d) => !slots.isDateStr(d))) {
    return 'Blocked dates must be a list of YYYY-MM-DD dates.';
  }
  return null;
}

// -------------------------------------------------------------------- boot --

// First boot: seed the admin password from ADMIN_PASSWORD, or generate a
// random one and print it once. Never hardcode a password here - this repo
// is public.
let generatedPassword = null;
if (!store.exists('auth')) {
  generatedPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  auth.ensurePassword(generatedPassword);
}

mainServer.listen(PORT, () => {
  console.log('Main site:  http://localhost:' + PORT);
});
adminServer.listen(ADMIN_PORT, () => {
  console.log('Admin site: http://localhost:' + ADMIN_PORT);
  if (generatedPassword && !process.env.ADMIN_PASSWORD) {
    console.log('');
    console.log('  First boot - your admin password is:  ' + generatedPassword);
    console.log('  (write it down; change it any time in Settings or with: npm run set-password -- "new-password")');
    console.log('');
  }
  const cal = calendar.status();
  console.log(cal.configured
    ? '[calendar] Connected as ' + cal.serviceAccountEmail + ' -> ' + cal.calendarId
    : '[calendar] Not configured yet - bookings will still work, see README.md to connect Google Calendar.');
});
