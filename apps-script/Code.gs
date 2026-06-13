// 845 Premium Detailing - booking backend as a Google Apps Script web app.
//
// This makes booking on the PUBLIC site (GitHub Pages) fully live against
// your real Google Calendar - free, no servers, no Google Cloud setup.
//
// Deploy (one time, ~5 minutes):
//   1. Go to https://script.google.com -> New project.
//   2. Replace the default code with this whole file. Save.
//   3. Deploy -> New deployment -> type "Web app".
//        Execute as: Me
//        Who has access: Anyone
//   4. Authorize when asked (it needs your Calendar).
//   5. Copy the web app URL (ends in /exec) and paste it into docs/config.js:
//        window.BOOKING_API = "https://script.google.com/macros/s/.../exec";
//      then commit and push.
//
// How it stays in sync:
//   - Open slots come from the booking rules in your GitHub repo
//     (data/schedule.json - edit them in the admin's Booking times tab,
//     then push) minus EVERY event already on your calendar. Anything you
//     add to the calendar by hand crosses that slot out on the site too.
//   - Booking a slot creates the calendar event instantly, so the slot
//     shows as taken for the next visitor.

// Booking rules live in your GitHub repo and are read at request time, so
// editing them in the admin (Booking times) updates the booking page with no
// redeploy. The only delay is GitHub's own CDN on this file (typically seconds,
// occasionally a couple of minutes); the short cache below keeps that minimal.
var SCHEDULE_URL = 'https://raw.githubusercontent.com/Arnavttt/845-premium-detailing/main/data/schedule.json';
var CALENDAR_ID = ''; // '' = your main (default) calendar

var FALLBACK_SCHEDULE = {
  timezone: 'America/New_York',
  slotMinutes: 120,
  maxDaysAhead: 30,
  weekly: {
    '0': { open: false, start: '08:00', end: '18:00' },
    '1': { open: true, start: '08:00', end: '18:00' },
    '2': { open: true, start: '08:00', end: '18:00' },
    '3': { open: true, start: '08:00', end: '18:00' },
    '4': { open: true, start: '08:00', end: '18:00' },
    '5': { open: true, start: '08:00', end: '18:00' },
    '6': { open: true, start: '08:00', end: '18:00' }
  },
  blockedDates: []
};

// ---------------------------------------------------------------- routing --

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  try {
    if (action === 'availability') return json(availability(e.parameter.date || ''));
    if (action === 'window') return json(bookingWindow());
    return json({ ok: true, service: '845 Premium Detailing booking backend' });
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json(createBooking(body));
  } catch (err) {
    return json({ ok: false, error: 'Server error: ' + err.message });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ----------------------------------------------------------------- config --

function getSchedule() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('schedule');
  if (cached) return JSON.parse(cached);
  try {
    var raw = UrlFetchApp.fetch(SCHEDULE_URL, { muteHttpExceptions: true, headers: { 'Cache-Control': 'no-cache' } });
    if (raw.getResponseCode() === 200) {
      var schedule = JSON.parse(raw.getContentText());
      // Short cache (was 5 min) so admin edits to booking rules appear fast.
      cache.put('schedule', JSON.stringify(schedule), 20);
      return schedule;
    }
  } catch (err) {
    // fall through to defaults
  }
  return FALLBACK_SCHEDULE;
}

function getCalendar() {
  return CALENDAR_ID ? CalendarApp.getCalendarById(CALENDAR_ID) : CalendarApp.getDefaultCalendar();
}

// ------------------------------------------------------------- time utils --

function isDateStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function isTimeStr(s) { return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
function parseTime(t) { var p = t.split(':'); return Number(p[0]) * 60 + Number(p[1]); }
function fmtTime(mins) {
  return ('0' + Math.floor(mins / 60)).slice(-2) + ':' + ('0' + (mins % 60)).slice(-2);
}
function label12h(mins) {
  var h = Math.floor(mins / 60), m = mins % 60;
  var ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + ('0' + m).slice(-2) + ' ' + ampm;
}
function weekdayOf(dateStr) {
  var p = dateStr.split('-');
  return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]))).getUTCDay();
}
function addDays(dateStr, days) {
  var p = dateStr.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days));
  return d.toISOString().slice(0, 10);
}
// Date object for wall-clock "dateStr time" in the business timezone.
function atTz(dateStr, time, timezone) {
  return Utilities.parseDate(dateStr + ' ' + time, timezone, 'yyyy-MM-dd HH:mm');
}
function nowIn(timezone) {
  var now = new Date();
  return {
    date: Utilities.formatDate(now, timezone, 'yyyy-MM-dd'),
    minutes: parseTime(Utilities.formatDate(now, timezone, 'HH:mm'))
  };
}

// ------------------------------------------------------------ availability --

function bookingWindow() {
  var schedule = getSchedule();
  var now = nowIn(schedule.timezone);
  return { minDate: now.date, maxDate: addDays(now.date, schedule.maxDaysAhead), slotMinutes: schedule.slotMinutes };
}

function availability(dateStr) {
  var schedule = getSchedule();
  var result = { date: dateStr, open: false, reason: null, slots: [] };
  if (!isDateStr(dateStr)) { result.reason = 'Invalid date.'; return result; }

  var now = nowIn(schedule.timezone);
  if (dateStr < now.date) { result.reason = 'That date has already passed.'; return result; }
  if (dateStr > addDays(now.date, schedule.maxDaysAhead)) {
    result.reason = 'We only take bookings up to ' + schedule.maxDaysAhead + ' days out.';
    return result;
  }
  if ((schedule.blockedDates || []).indexOf(dateStr) !== -1) {
    result.reason = "We're fully closed that day - please pick another date.";
    return result;
  }
  var day = (schedule.weekly || {})[String(weekdayOf(dateStr))];
  if (!day || !day.open) { result.reason = "We're closed that day of the week."; return result; }

  // Every event on the calendar that day blocks overlapping slots.
  var tz = schedule.timezone;
  var events = getCalendar().getEvents(atTz(dateStr, '00:00', tz), atTz(addDays(dateStr, 1), '00:00', tz));
  var busy = events.map(function (ev) {
    return { start: ev.getStartTime().getTime(), end: ev.getEndTime().getTime() };
  });

  result.open = true;
  var start = parseTime(day.start), end = parseTime(day.end);
  for (var t = start; t + schedule.slotMinutes <= end; t += schedule.slotMinutes) {
    var time = fmtTime(t);
    var slotStart = atTz(dateStr, time, tz).getTime();
    var slotEnd = slotStart + schedule.slotMinutes * 60 * 1000;
    var isPast = dateStr === now.date && t <= now.minutes;
    var isBooked = busy.some(function (r) { return r.start < slotEnd && r.end > slotStart; });
    if (isPast && !isBooked) continue;
    result.slots.push({ time: time, label: label12h(t), available: !isBooked && !isPast, booked: isBooked });
  }
  if (!result.slots.length) {
    result.open = false;
    result.reason = dateStr === now.date ? 'No more open times today - try tomorrow.' : 'No open times that day.';
  }
  return result;
}

// ---------------------------------------------------------------- booking --

// Verify a Cloudflare Turnstile token server-side against the secret.
function verifyTurnstile(secret, token) {
  if (!token) return false;
  try {
    var res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'post',
      muteHttpExceptions: true,
      payload: { secret: secret, response: token }
    });
    return JSON.parse(res.getContentText()).success === true;
  } catch (err) {
    return false;
  }
}

function createBooking(body) {
  var clean = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); };
  var booking = {
    name: clean(body.name, 100),
    phone: clean(body.phone, 40),
    vehicle: clean(body.vehicle, 120),
    service: clean(body.service, 100),
    date: clean(body.date, 10),
    time: clean(body.time, 5),
    notes: clean(body.notes, 600)
  };
  // Honeypot: real users never fill "company"; bots that do are rejected.
  if (clean(body.company, 100)) {
    return { ok: false, code: 400, error: 'Booking could not be completed.' };
  }
  // Bot mitigation: if a TURNSTILE_SECRET Script Property is set, require a
  // valid Cloudflare Turnstile token. Without it, this check is skipped.
  var tsSecret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (tsSecret && !verifyTurnstile(tsSecret, body.cfToken)) {
    return { ok: false, code: 400, error: 'Verification failed - please try the booking again.' };
  }
  if (!booking.name || !booking.phone || !booking.service || !booking.date || !booking.time) {
    return { ok: false, code: 400, error: 'Please fill in your name, phone, a service, a date and a time.' };
  }
  if (!isDateStr(booking.date) || !isTimeStr(booking.time)) {
    return { ok: false, code: 400, error: 'Invalid date or time.' };
  }

  // Serialize bookings so two people can't grab the same slot at once.
  var lock = LockService.getScriptLock();
  lock.waitLock(20 * 1000);
  try {
    var day = availability(booking.date);
    var slot = null;
    for (var i = 0; i < day.slots.length; i++) {
      if (day.slots[i].time === booking.time) slot = day.slots[i];
    }
    if (!day.open || !slot) {
      return { ok: false, code: 400, error: day.reason || 'That date is not open for bookings.' };
    }
    if (!slot.available) {
      return { ok: false, code: 409, error: 'Sorry - that time was just taken. Please pick another slot.' };
    }

    var schedule = getSchedule();
    var tz = schedule.timezone;
    var start = atTz(booking.date, booking.time, tz);
    var end = new Date(start.getTime() + schedule.slotMinutes * 60 * 1000);
    getCalendar().createEvent(
      booking.service + ' - ' + booking.name,
      start,
      end,
      {
        description: [
          'Phone: ' + booking.phone,
          booking.vehicle ? 'Vehicle: ' + booking.vehicle : null,
          booking.notes ? 'Notes: ' + booking.notes : null,
          'Booked online via 845 Premium Detailing'
        ].filter(Boolean).join('\n')
      }
    );

    return {
      ok: true,
      calendarSynced: true,
      booking: { service: booking.service, date: booking.date, time: booking.time, label: slot.label }
    };
  } finally {
    lock.releaseLock();
  }
}
