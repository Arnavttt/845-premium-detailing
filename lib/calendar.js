// Google Calendar integration via a service account - no npm dependencies.
// Auth: signs a JWT with the service account's private key (RS256), exchanges
// it for an access token, then calls the Calendar v3 REST API directly.
//
// Setup (see README.md for the full walkthrough):
//   1. Create a Google Cloud service account and download its JSON key to
//      ./google-service-account.json (or set GOOGLE_SERVICE_ACCOUNT_FILE).
//   2. Share your Google Calendar with the service account's email address
//      ("Make changes to events" permission).
//   3. Put the calendar's ID in the admin Settings tab (or GOOGLE_CALENDAR_ID).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const API = 'https://www.googleapis.com/calendar/v3';

let cachedToken = null; // { token, expires }

function keyFilePaths() {
  const paths = [];
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) paths.push(process.env.GOOGLE_SERVICE_ACCOUNT_FILE);
  paths.push(path.join(__dirname, '..', 'google-service-account.json'));
  return paths;
}

function loadKey() {
  for (const p of keyFilePaths()) {
    try {
      const key = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (key.client_email && key.private_key) return key;
    } catch (err) {
      // missing or unreadable - try the next location
    }
  }
  return null;
}

function calendarId() {
  return process.env.GOOGLE_CALENDAR_ID || store.read('settings', {}).calendarId || '';
}

function isConfigured() {
  return !!(loadKey() && calendarId());
}

function status() {
  const key = loadKey();
  return {
    keyFileFound: !!key,
    serviceAccountEmail: key ? key.client_email : null,
    calendarId: calendarId(),
    configured: !!(key && calendarId())
  };
}

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60 * 1000) return cachedToken.token;
  const key = loadKey();
  if (!key) throw new Error('No service account key file found');

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claims);
  const signature = signer.sign(key.private_key).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: header + '.' + claims + '.' + signature
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error('Google token request failed: ' + (data.error_description || data.error || res.status));
  }
  cachedToken = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

async function api(method, url, body) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && data.error && data.error.message ? data.error.message : 'request failed';
    throw new Error('Calendar API ' + res.status + ': ' + message);
  }
  return data;
}

// "HH:MM" + minutes -> "HH:MM" (booking slots never cross midnight)
function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
}

async function testConnection() {
  const id = calendarId();
  if (!id) throw new Error('No calendar ID set');
  const cal = await api('GET', API + '/calendars/' + encodeURIComponent(id));
  return { ok: true, summary: cal.summary, timeZone: cal.timeZone };
}

// Creates the event for a booking and returns the Google event ID.
async function createBookingEvent(booking, schedule) {
  const id = calendarId();
  const end = addMinutes(booking.time, schedule.slotMinutes);
  const event = {
    summary: booking.service + ' - ' + booking.name,
    description: [
      'Phone: ' + booking.phone,
      booking.vehicle ? 'Vehicle: ' + booking.vehicle : null,
      booking.notes ? 'Notes: ' + booking.notes : null,
      'Booked online via 845 Premium Detailing'
    ].filter(Boolean).join('\n'),
    start: { dateTime: booking.date + 'T' + booking.time + ':00', timeZone: schedule.timezone },
    end: { dateTime: booking.date + 'T' + end + ':00', timeZone: schedule.timezone }
  };
  const created = await api('POST', API + '/calendars/' + encodeURIComponent(id) + '/events', event);
  return created.id;
}

async function deleteBookingEvent(eventId) {
  const id = calendarId();
  await api('DELETE', API + '/calendars/' + encodeURIComponent(id) + '/events/' + encodeURIComponent(eventId));
}

module.exports = { isConfigured, status, testConnection, createBookingEvent, deleteBookingEvent };
