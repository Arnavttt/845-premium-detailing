// 845 Admin dashboard. Talks to the admin API on this same origin; every
// endpoint except /api/login requires the session cookie, and any 401
// bounces back to the login page.
(function () {
  'use strict';

  var state = { content: null, schedule: null, settings: null, bookings: [], calendar: null };
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg;
    el.className = isError ? 'show error' : 'show';
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.className = ''; }, 2600);
  }

  function api(method, path, body) {
    return fetch(path, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      if (r.status === 401) {
        location.href = '/login.html';
        throw new Error('Not logged in');
      }
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Request failed');
        return data;
      });
    });
  }

  // ---------- tabs ----------
  var TITLES = {
    content: 'Site content', services: 'Services & pricing', schedule: 'Booking times',
    bookings: 'Bookings', contact: 'Contact info', settings: 'Settings'
  };

  document.querySelectorAll('.tab-link').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-link').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      $('pane-' + tab).classList.remove('hidden');
      $('tab-title').textContent = TITLES[tab];
    });
  });

  // ---------- content tab ----------
  var CONTENT_KEYS = ['heroEyebrow', 'heroTitle', 'heroSub', 'ctaTitle', 'ctaSub', 'phone', 'email', 'instagram', 'area', 'hours'];

  function renderContent() {
    var c = state.content;
    CONTENT_KEYS.forEach(function (k) {
      var el = $('c-' + k);
      if (el) el.value = c[k] || '';
    });
    renderPoints();
    renderServices();
  }

  function renderPoints() {
    $('points-list').innerHTML = '';
    state.content.points.forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'row-card';
      card.style.display = 'grid';
      card.style.gap = '10px';
      card.innerHTML =
        '<input value="' + esc(p.t) + '" placeholder="Point title" data-pt="' + i + '" style="font-weight:600">' +
        '<input value="' + esc(p.d) + '" placeholder="Point description" data-pd="' + i + '" style="color:#B8B8B8">';
      $('points-list').appendChild(card);
    });
    $('points-list').querySelectorAll('[data-pt]').forEach(function (input) {
      input.addEventListener('input', function () { state.content.points[+input.getAttribute('data-pt')].t = input.value; });
    });
    $('points-list').querySelectorAll('[data-pd]').forEach(function (input) {
      input.addEventListener('input', function () { state.content.points[+input.getAttribute('data-pd')].d = input.value; });
    });
  }

  // ---------- services tab ----------
  function renderServices() {
    var list = $('services-list');
    list.innerHTML = '';
    state.content.services.forEach(function (s, i) {
      var card = document.createElement('div');
      card.className = 'row-card';
      card.innerHTML =
        '<div class="grid-cols">' +
          '<input class="svc-name" value="' + esc(s.name) + '" placeholder="Service name" data-sf="name">' +
          '<input class="svc-price" value="' + esc(s.price) + '" placeholder="$0" data-sf="price">' +
          '<input value="' + esc(s.time) + '" placeholder="~2 hrs" data-sf="time" style="color:#B8B8B8">' +
          '<button class="btn-remove" type="button">Remove</button>' +
        '</div>' +
        '<input value="' + esc(s.desc) + '" placeholder="What’s included…" data-sf="desc" style="color:#B8B8B8; margin-top:10px">';
      card.querySelectorAll('[data-sf]').forEach(function (input) {
        input.addEventListener('input', function () {
          state.content.services[i][input.getAttribute('data-sf')] = input.value;
        });
      });
      card.querySelector('.btn-remove').addEventListener('click', function () {
        state.content.services.splice(i, 1);
        renderServices();
      });
      list.appendChild(card);
    });
  }

  $('add-service').addEventListener('click', function () {
    state.content.services.push({ name: 'New service', price: '$0', time: '', desc: '' });
    renderServices();
  });

  function collectContent() {
    var c = state.content;
    CONTENT_KEYS.forEach(function (k) {
      var el = $('c-' + k);
      if (el) c[k] = el.value;
    });
    return c;
  }

  // ---------- schedule tab ----------
  function renderSchedule() {
    var s = state.schedule;
    $('s-slotMinutes').value = String(s.slotMinutes);
    $('s-maxDaysAhead').value = s.maxDaysAhead;
    $('s-timezone').value = s.timezone;

    var list = $('weekly-list');
    list.innerHTML = '';
    for (var d = 0; d <= 6; d++) {
      (function (d) {
        var day = s.weekly[String(d)];
        var row = document.createElement('div');
        row.className = 'weekday-row' + (day.open ? '' : ' closed');
        row.innerHTML =
          '<label class="weekday-name"><input type="checkbox"' + (day.open ? ' checked' : '') + '> ' + WEEKDAYS[d] + '</label>' +
          '<span class="to">from</span>' +
          '<input type="time" value="' + esc(day.start) + '" data-k="start">' +
          '<span class="to">to</span>' +
          '<input type="time" value="' + esc(day.end) + '" data-k="end">';
        row.querySelector('input[type=checkbox]').addEventListener('change', function () {
          day.open = this.checked;
          row.classList.toggle('closed', !day.open);
        });
        row.querySelectorAll('input[type=time]').forEach(function (input) {
          input.addEventListener('input', function () { day[input.getAttribute('data-k')] = input.value; });
        });
        list.appendChild(row);
      })(d);
    }
    renderBlockedDates();
  }

  function renderBlockedDates() {
    var box = $('blocked-list');
    box.innerHTML = '';
    if (!state.schedule.blockedDates.length) {
      box.innerHTML = '<span style="color:#6A6A6A; font-size:13px">No blocked dates - every open weekday is bookable.</span>';
      return;
    }
    state.schedule.blockedDates.forEach(function (date, i) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = esc(date) + '<button type="button" title="Unblock">&times;</button>';
      chip.querySelector('button').addEventListener('click', function () {
        state.schedule.blockedDates.splice(i, 1);
        renderBlockedDates();
      });
      box.appendChild(chip);
    });
  }

  $('add-block').addEventListener('click', function () {
    var date = $('block-date').value;
    if (!date) return toast('Pick a date to block first', true);
    if (state.schedule.blockedDates.indexOf(date) === -1) {
      state.schedule.blockedDates.push(date);
      state.schedule.blockedDates.sort();
    }
    $('block-date').value = '';
    renderBlockedDates();
  });

  function collectSchedule() {
    var s = state.schedule;
    s.slotMinutes = Number($('s-slotMinutes').value);
    s.maxDaysAhead = Number($('s-maxDaysAhead').value);
    s.timezone = $('s-timezone').value.trim();
    return s;
  }

  // ---------- bookings tab ----------
  function renderBookings() {
    var list = $('bookings-list');
    if (!state.bookings.length) {
      list.innerHTML = '<div class="empty-box">No bookings yet. When a customer books a slot on the main site, it shows up here and on Google Calendar.</div>';
      return;
    }
    list.innerHTML = '';
    state.bookings.forEach(function (b) {
      var card = document.createElement('div');
      card.className = 'booking-card';
      var badge = b.calendarEventId
        ? '<span class="badge badge-ok">&#10003; On Google Calendar</span>'
        : '<span class="badge badge-warn" title="' + esc(b.calendarError || '') + '">Not on calendar</span>';
      card.innerHTML =
        '<div class="booking-top">' +
          '<div class="booking-who">' +
            '<span class="booking-name">' + esc(b.name) + '</span>' +
            '<span class="booking-service">' + esc(b.service) + '</span>' +
            '<span class="booking-when">' + esc(prettyDate(b.date)) + ' &middot; ' + esc(prettyTime(b.time)) + '</span>' +
          '</div>' +
          '<button class="btn-delete" type="button">Delete</button>' +
        '</div>' +
        '<div class="booking-meta">' +
          '<span>' + esc(b.phone) + '</span>' +
          '<span>' + esc(b.vehicle || '-') + '</span>' +
        '</div>' +
        (b.notes ? '<div class="booking-notes">&ldquo;' + esc(b.notes) + '&rdquo;</div>' : '') +
        '<div class="booking-footer">' +
          '<span class="booking-created">Received ' + esc(new Date(b.created).toLocaleString()) + '</span>' +
          badge +
        '</div>';
      card.querySelector('.btn-delete').addEventListener('click', function () {
        if (!confirm('Delete this booking? The time slot opens back up and the Google Calendar event is removed.')) return;
        api('DELETE', '/api/bookings/' + b.id)
          .then(function () {
            state.bookings = state.bookings.filter(function (x) { return x.id !== b.id; });
            renderBookings();
            toast('Booking deleted - slot is open again');
          })
          .catch(function (err) { toast(err.message, true); });
      });
      list.appendChild(card);
    });
  }

  function prettyDate(iso) {
    var p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]))
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function prettyTime(t) {
    var parts = t.split(':');
    var h = +parts[0];
    var ampm = h >= 12 ? 'PM' : 'AM';
    return (h % 12 || 12) + ':' + parts[1] + ' ' + ampm;
  }

  // ---------- settings tab ----------
  function renderSettings() {
    $('set-calendarId').value = state.settings.calendarId || '';
    var cal = state.calendar;
    $('cal-status').innerHTML =
      '<div class="status-row"><span class="status-label">Key file</span>' +
        '<span class="status-value ' + (cal.keyFileFound ? 'ok">Found' : 'bad">Missing - add google-service-account.json') + '</span></div>' +
      '<div class="status-row"><span class="status-label">Service account</span>' +
        '<span class="status-value">' + esc(cal.serviceAccountEmail || '-') + '</span></div>' +
      '<div class="status-row"><span class="status-label">Status</span>' +
        '<span class="status-value ' + (cal.configured ? 'ok">Ready - new bookings sync automatically' : 'bad">Not connected yet') + '</span></div>';
  }

  $('save-settings').addEventListener('click', function () {
    api('PUT', '/api/settings', { calendarId: $('set-calendarId').value.trim() })
      .then(function (res) {
        state.settings = res.settings;
        state.calendar = res.calendar;
        renderSettings();
        toast('Calendar ID saved');
      })
      .catch(function (err) { toast(err.message, true); });
  });

  $('test-calendar').addEventListener('click', function () {
    var out = $('cal-test-result');
    out.innerHTML = '<span style="color:#8A8A8A; font-size:14px">Testing&hellip;</span>';
    api('POST', '/api/calendar/test')
      .then(function (res) {
        out.innerHTML = '<span class="form-ok">&#10003; Connected to "' + esc(res.summary) + '" (' + esc(res.timeZone) + ')</span>';
      })
      .catch(function (err) {
        out.innerHTML = '<span class="form-error">' + esc(err.message) + '</span>';
      });
  });

  $('change-password').addEventListener('click', function () {
    var errorEl = $('pw-error');
    errorEl.classList.add('hidden');
    var current = $('pw-current').value;
    var next = $('pw-next').value;
    if (next.length < 8) {
      errorEl.textContent = 'New password must be at least 8 characters.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (next !== $('pw-confirm').value) {
      errorEl.textContent = 'New passwords do not match.';
      errorEl.classList.remove('hidden');
      return;
    }
    api('POST', '/api/password', { current: current, next: next })
      .then(function () {
        $('pw-current').value = $('pw-next').value = $('pw-confirm').value = '';
        toast('Password changed');
      })
      .catch(function (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      });
  });

  // ---------- save buttons ----------
  document.querySelectorAll('[data-save]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var what = btn.getAttribute('data-save');
      if (what === 'content') {
        api('PUT', '/api/content', collectContent())
          .then(function (res) {
            state.content = res.content;
            renderContent();
            toast('Saved - live on the main site');
          })
          .catch(function (err) { toast(err.message, true); });
      } else if (what === 'schedule') {
        api('PUT', '/api/schedule', collectSchedule())
          .then(function (res) {
            state.schedule = res.schedule;
            renderSchedule();
            toast('Booking times saved');
          })
          .catch(function (err) { toast(err.message, true); });
      }
    });
  });

  // ---------- logout ----------
  $('logout').addEventListener('click', function () {
    api('POST', '/api/logout').then(function () { location.href = '/login.html'; });
  });

  // ---------- boot ----------
  api('GET', '/api/overview')
    .then(function (data) {
      state.content = data.content;
      state.schedule = data.schedule;
      state.settings = data.settings;
      state.bookings = data.bookings;
      state.calendar = data.calendar;
      renderContent();
      renderSchedule();
      renderBookings();
      renderSettings();
    })
    .catch(function () { /* 401 already redirected */ });
})();
