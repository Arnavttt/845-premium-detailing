// Booking slot logic. Dates are "YYYY-MM-DD" strings, times are "HH:MM" 24h.
// All "what time is it now" checks use the business timezone from the
// schedule, so the server works the same whether it runs locally or on a
// cloud host set to UTC.

function parseTime(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function fmtTime(mins) {
  return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
}

function label12h(mins) {
  let h = Math.floor(mins / 60);
  const m = mins % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + String(m).padStart(2, '0') + ' ' + ampm;
}

function isDateStr(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isTimeStr(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

// Current date + minutes-since-midnight in the given IANA timezone.
function nowIn(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: get('year') + '-' + get('month') + '-' + get('day'),
    minutes: Number(get('hour')) * 60 + Number(get('minute'))
  };
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

// Epoch ms for "dateStr timeStr" read as wall-clock time in `timezone`.
// Two correction passes handle the DST offset without a timezone library.
function epochFor(dateStr, timeStr, timezone) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const want = Date.UTC(y, m - 1, d, hh, mm);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(guess));
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    guess += want - shown;
  }
  return guess;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

// The window of dates customers may book, computed in the business timezone.
function bookingWindow(schedule) {
  const now = nowIn(schedule.timezone);
  return {
    minDate: now.date,
    maxDate: addDays(now.date, schedule.maxDaysAhead),
    slotMinutes: schedule.slotMinutes
  };
}

// All slots for a date with availability flags.
//   closed: date is out of window, blocked, or a closed weekday
//   booked: an existing booking holds that time, or the time overlaps a
//           busy range from the connected Google Calendar (busyRanges is
//           [{ start, end }] in epoch ms) - so anything added straight to
//           the calendar also crosses the slot out on the site
function slotsForDate(dateStr, schedule, bookings, busyRanges) {
  busyRanges = busyRanges || [];
  const result = { date: dateStr, open: false, reason: null, slots: [] };
  if (!isDateStr(dateStr)) {
    result.reason = 'Invalid date.';
    return result;
  }
  const now = nowIn(schedule.timezone);
  if (dateStr < now.date) {
    result.reason = 'That date has already passed.';
    return result;
  }
  if (dateStr > addDays(now.date, schedule.maxDaysAhead)) {
    result.reason = 'We only take bookings up to ' + schedule.maxDaysAhead + ' days out.';
    return result;
  }
  if ((schedule.blockedDates || []).includes(dateStr)) {
    result.reason = "We're fully closed that day - please pick another date.";
    return result;
  }
  const day = (schedule.weekly || {})[String(weekdayOf(dateStr))];
  if (!day || !day.open) {
    result.reason = "We're closed that day of the week.";
    return result;
  }

  result.open = true;
  const taken = new Set(
    bookings.filter((b) => b.date === dateStr).map((b) => b.time)
  );
  const start = parseTime(day.start);
  const end = parseTime(day.end);
  for (let t = start; t + schedule.slotMinutes <= end; t += schedule.slotMinutes) {
    const time = fmtTime(t);
    const isPast = dateStr === now.date && t <= now.minutes;
    const slotStart = epochFor(dateStr, time, schedule.timezone);
    const slotEnd = slotStart + schedule.slotMinutes * 60 * 1000;
    const isBusy = busyRanges.some((r) => r.start < slotEnd && r.end > slotStart);
    const isBooked = taken.has(time) || isBusy;
    if (isPast && !isBooked) continue; // hide past empty slots entirely
    result.slots.push({
      time,
      label: label12h(t),
      available: !isBooked && !isPast,
      booked: isBooked
    });
  }
  if (result.slots.length === 0) {
    result.open = false;
    result.reason = dateStr === now.date
      ? 'No more open times today - try tomorrow.'
      : 'No open times that day.';
  }
  return result;
}

module.exports = { slotsForDate, bookingWindow, isDateStr, isTimeStr, parseTime, epochFor };
