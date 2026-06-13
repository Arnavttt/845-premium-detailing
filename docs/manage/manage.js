// 845 Admin - the GitHub-hosted backend.
//
// This page runs as a static file on GitHub Pages. Instead of talking to a
// Node server, it reads and writes the site's data by committing to the
// GitHub repo through the GitHub REST API, authenticated with a personal
// access token the owner pastes once (kept only in this browser).
//
//   data/content.json   -> all site text, services, points, contact info
//   data/schedule.json  -> booking times (slots, hours, blocked dates, tz)
//   docs/config.js       -> the live booking backend URL
//
// A GitHub Action rebuilds the public site whenever these change, so saving
// here updates the live site automatically.
(function () {
  'use strict';

  var REPO = 'Arnavttt/845-premium-detailing';
  var BRANCH = 'main';
  var SITE_URL = 'https://arnavttt.github.io/845-premium-detailing/';
  var TOKEN_KEY = 'p845_ghpat';
  var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  var token = localStorage.getItem(TOKEN_KEY) || '';
  var state = { content: null, schedule: null };
  var sha = {}; // path -> blob sha, needed to commit updates

  function $(id) { return document.getElementById(id); }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function toast(msg, isError) {
    var el = $('toast');
    el.textContent = msg;
    el.className = isError ? 'show error' : 'show';
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.className = ''; }, 3000);
  }

  // ---------- GitHub REST helpers ----------
  function gh(method, path, body) {
    // No trailing slash when path is empty (the repo root) - GitHub 404s on it.
    return fetch('https://api.github.com/repos/' + REPO + (path ? '/' + path : ''), {
      method: method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; },
        function () { return { ok: r.ok, status: r.status, data: {} }; });
    });
  }

  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) { return decodeURIComponent(escape(atob(String(b64).replace(/\s/g, '')))); }

  function readFile(path) {
    return gh('GET', 'contents/' + path + '?ref=' + BRANCH).then(function (res) {
      if (!res.ok) throw new Error(res.status === 404 ? path + ' not found in repo' : (res.data.message || 'Could not read ' + path));
      sha[path] = res.data.sha;
      return b64decode(res.data.content);
    });
  }

  function writeFile(path, text, message) {
    return gh('PUT', 'contents/' + path, {
      message: message, content: b64encode(text), sha: sha[path], branch: BRANCH
    }).then(function (res) {
      if (!res.ok) throw new Error(res.data.message || ('Save failed (' + res.status + ')'));
      sha[path] = res.data.content.sha;
      return res.data;
    });
  }

  // ---------- auth ----------
  function showLogin(msg) {
    $('app-view').classList.add('hidden');
    $('login-view').classList.remove('hidden');
    if (msg) { $('login-error').textContent = msg; $('login-error').classList.remove('hidden'); }
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    // Strip ALL whitespace - pasted tokens often arrive with line breaks or
    // spaces, which would make an invalid HTTP header and throw on fetch.
    var entered = $('token').value.replace(/\s+/g, '');
    $('login-error').classList.add('hidden');
    if (!entered) return;
    token = entered;
    var btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Signing in...';

    // Always reset the button and show a reason - never leave it spinning.
    function fail(msg) {
      token = '';
      btn.disabled = false;
      btn.textContent = 'Sign In';
      showLogin(msg);
    }

    var p;
    try {
      // Verify the token can read the repo before we commit to it.
      p = gh('GET', '');
    } catch (err) {
      return fail('Could not start sign-in: ' + (err && err.message ? err.message : 'check the token for stray characters') + '.');
    }
    p.then(function (res) {
      if (!res.ok) {
        return fail(res.status === 401
          ? 'That token was rejected. Make sure it is a fine-grained token for this repo with Contents: Read and write (and not expired or revoked).'
          : (res.data && res.data.message ? res.data.message : 'Sign-in failed (HTTP ' + res.status + ').'));
      }
      if (res.data.permissions && !res.data.permissions.push) {
        return fail('That token is read-only. It needs Contents: Read and write on this repo.');
      }
      btn.disabled = false;
      btn.textContent = 'Sign In';
      localStorage.setItem(TOKEN_KEY, token);
      boot();
    }).catch(function (err) {
      fail('Could not reach GitHub: ' + (err && err.message ? err.message : 'network error') + '. Check your connection, then try again.');
    });
  });

  function signOut() {
    localStorage.removeItem(TOKEN_KEY);
    token = '';
    $('token').value = '';
    showLogin('');
  }
  $('logout').addEventListener('click', signOut);
  $('logout2').addEventListener('click', signOut);

  // ---------- tabs ----------
  var TITLES = {
    content: 'Site content', services: 'Services & pricing', schedule: 'Booking times',
    bookings: 'Bookings', contact: 'Contact info', settings: 'Settings'
  };
  document.querySelectorAll('.tab-link[data-tab]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      document.querySelectorAll('.tab-link[data-tab]').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.add('hidden'); });
      $('pane-' + tab).classList.remove('hidden');
      $('tab-title').textContent = TITLES[tab];
    });
  });

  // ---------- content + contact ----------
  var CONTENT_KEYS = ['heroEyebrow', 'heroTitle', 'heroSub', 'ctaTitle', 'ctaSub', 'phone', 'email', 'instagram', 'area', 'hours'];

  function renderContent() {
    var c = state.content;
    CONTENT_KEYS.forEach(function (k) { var el = $('c-' + k); if (el) el.value = c[k] || ''; });
    renderPoints();
    renderServices();
  }

  function renderPoints() {
    var box = $('points-list');
    box.innerHTML = '';
    (state.content.points || []).forEach(function (p, i) {
      var card = document.createElement('div');
      card.className = 'row-card';
      card.style.display = 'grid'; card.style.gap = '10px';
      card.innerHTML =
        '<input value="' + esc(p.t) + '" placeholder="Point title" data-pt="' + i + '" style="font-weight:600">' +
        '<input value="' + esc(p.d) + '" placeholder="Point description" data-pd="' + i + '" style="color:#B8B8B8">';
      box.appendChild(card);
    });
    box.querySelectorAll('[data-pt]').forEach(function (el) {
      el.addEventListener('input', function () { state.content.points[+el.getAttribute('data-pt')].t = el.value; });
    });
    box.querySelectorAll('[data-pd]').forEach(function (el) {
      el.addEventListener('input', function () { state.content.points[+el.getAttribute('data-pd')].d = el.value; });
    });
  }

  function renderServices() {
    var list = $('services-list');
    list.innerHTML = '';
    (state.content.services || []).forEach(function (s, i) {
      var card = document.createElement('div');
      card.className = 'row-card';
      card.innerHTML =
        '<div class="grid-cols">' +
          '<input class="svc-name" value="' + esc(s.name) + '" placeholder="Service name" data-sf="name">' +
          '<input class="svc-price" value="' + esc(s.price) + '" placeholder="$0" data-sf="price">' +
          '<input value="' + esc(s.time) + '" placeholder="~2 hrs" data-sf="time" style="color:#B8B8B8">' +
          '<button class="btn-remove" type="button">Remove</button>' +
        '</div>' +
        '<input value="' + esc(s.desc) + '" placeholder="What\'s included..." data-sf="desc" style="color:#B8B8B8;margin-top:10px">';
      card.querySelectorAll('[data-sf]').forEach(function (el) {
        el.addEventListener('input', function () { state.content.services[i][el.getAttribute('data-sf')] = el.value; });
      });
      card.querySelector('.btn-remove').addEventListener('click', function () {
        state.content.services.splice(i, 1); renderServices();
      });
      list.appendChild(card);
    });
  }

  $('add-service').addEventListener('click', function () {
    if (!state.content.services) state.content.services = [];
    state.content.services.push({ name: 'New service', price: '$0', time: '', desc: '' });
    renderServices();
  });

  function collectContent() {
    CONTENT_KEYS.forEach(function (k) { var el = $('c-' + k); if (el) state.content[k] = el.value; });
    return state.content;
  }

  // ---------- schedule ----------
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
          day.open = this.checked; row.classList.toggle('closed', !day.open);
        });
        row.querySelectorAll('input[type=time]').forEach(function (el) {
          el.addEventListener('input', function () { day[el.getAttribute('data-k')] = el.value; });
        });
        list.appendChild(row);
      })(d);
    }
    renderBlocked();
  }

  function renderBlocked() {
    var box = $('blocked-list');
    box.innerHTML = '';
    if (!state.schedule.blockedDates.length) {
      box.innerHTML = '<span style="color:#6A6A6A;font-size:13px">No blocked dates - every open weekday is bookable.</span>';
      return;
    }
    state.schedule.blockedDates.forEach(function (date, i) {
      var chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = esc(date) + '<button type="button" title="Unblock">&times;</button>';
      chip.querySelector('button').addEventListener('click', function () {
        state.schedule.blockedDates.splice(i, 1); renderBlocked();
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
    renderBlocked();
  });

  function collectSchedule() {
    var s = state.schedule;
    s.slotMinutes = Number($('s-slotMinutes').value);
    s.maxDaysAhead = Number($('s-maxDaysAhead').value);
    s.timezone = $('s-timezone').value.trim();
    return s;
  }

  // Mirror the server's validation so a bad edit can't break booking.
  function isTimeStr(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function parseTime(t) { var p = String(t).split(':'); return +p[0] * 60 + +p[1]; }
  function validateSchedule(s) {
    try { new Intl.DateTimeFormat('en', { timeZone: s.timezone }); } catch (e) { return 'Unknown timezone: ' + s.timezone; }
    if (!Number.isInteger(s.slotMinutes) || s.slotMinutes < 15 || s.slotMinutes > 480) return 'Slot length looks wrong.';
    if (!Number.isInteger(s.maxDaysAhead) || s.maxDaysAhead < 1 || s.maxDaysAhead > 365) return 'Booking window must be 1-365 days.';
    for (var d = 0; d <= 6; d++) {
      var day = s.weekly[String(d)];
      if (!isTimeStr(day.start) || !isTimeStr(day.end)) return WEEKDAYS[d] + ' hours must be valid times.';
      if (day.open && parseTime(day.start) + s.slotMinutes > parseTime(day.end)) {
        return 'On ' + WEEKDAYS[d] + ', closing time must allow at least one full slot.';
      }
    }
    return null;
  }

  // ---------- saving ----------
  function setBusy(busy) { document.querySelectorAll('[data-save],#save-bookingApi').forEach(function (b) { b.disabled = busy; }); }

  document.querySelectorAll('[data-save]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('data-save') === 'content') {
        setBusy(true);
        writeFile('data/content.json', JSON.stringify(collectContent(), null, 2) + '\n', 'Update site content via admin')
          .then(function () { renderContent(); toast('Saved - site updates in about a minute'); })
          .catch(function (err) { toast(err.message, true); })
          .then(function () { setBusy(false); });
      } else {
        var s = collectSchedule();
        var err = validateSchedule(s);
        if (err) return toast(err, true);
        setBusy(true);
        writeFile('data/schedule.json', JSON.stringify(s, null, 2) + '\n', 'Update booking times via admin')
          .then(function () { renderSchedule(); toast('Booking times saved'); })
          .catch(function (e2) { toast(e2.message, true); })
          .then(function () { setBusy(false); });
      }
    });
  });

  // ---------- settings: booking backend URL (docs/config.js) ----------
  function configText(url, sitekey) {
    return [
      '// Set this to your booking backend to enable live slot booking on the',
      '// public site. Easiest: deploy apps-script/Code.gs as a web app (see',
      '// README) and paste its URL here, e.g.',
      '//   window.BOOKING_API = "https://script.google.com/macros/s/XXXX/exec";',
      '// A hosted copy of server.js works too. Leave empty to show call/text',
      '// contact options on the Book page instead.',
      'window.BOOKING_API = "' + url + '";',
      '',
      '// Optional Cloudflare Turnstile site key (bot protection on the booking',
      '// form). Pair it with a TURNSTILE_SECRET Script Property in the Apps',
      '// Script project. Leave empty to keep booking open.',
      'window.TURNSTILE_SITEKEY = "' + (sitekey || '') + '";',
      ''
    ].join('\n');
  }

  $('save-bookingApi').addEventListener('click', function () {
    var url = $('set-bookingApi').value.trim().replace(/"/g, '');
    setBusy(true);
    // Need the current sha for docs/config.js before overwriting it, and
    // preserve any existing Turnstile site key so saving the URL won't wipe it.
    readFile('docs/config.js').then(function (text) {
      var m = text.match(/^window\.TURNSTILE_SITEKEY\s*=\s*"([^"]*)"/m);
      return writeFile('docs/config.js', configText(url, m ? m[1] : ''), 'Set booking backend URL via admin');
    }).then(function () {
      toast(url ? 'Backend URL saved - live booking is on' : 'Backend URL cleared');
    }).catch(function (err) {
      toast(err.message, true);
    }).then(function () { setBusy(false); });
  });

  // ---------- boot ----------
  function boot() {
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    $('repo-pill').textContent = REPO;
    $('view-site').href = SITE_URL;

    Promise.all([readFile('data/content.json'), readFile('data/schedule.json')])
      .then(function (texts) {
        state.content = JSON.parse(texts[0]);
        state.schedule = JSON.parse(texts[1]);
        if (!state.content.points) state.content.points = [];
        if (!state.content.services) state.content.services = [];
        if (!state.schedule.blockedDates) state.schedule.blockedDates = [];
        renderContent();
        renderSchedule();
      })
      .catch(function (err) {
        if (/401/.test(err.message)) return signOut();
        toast(err.message, true);
      });

    // Current booking backend URL (best-effort). Anchor to the real
    // assignment line so the example URL in the comments is ignored.
    readFile('docs/config.js').then(function (text) {
      var m = text.match(/^window\.BOOKING_API\s*=\s*"([^"]*)"/m);
      $('set-bookingApi').value = m ? m[1] : '';
    }).catch(function () {});

    // Who am I (for the Settings tab).
    fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) {
        $('account-status').innerHTML =
          '<div class="status-row"><span class="status-label">Signed in as</span><span class="status-value">' +
          esc(u ? u.login : 'GitHub') + '</span></div>' +
          '<div class="status-row"><span class="status-label">Repository</span><span class="status-value">' + esc(REPO) + '</span></div>';
      }).catch(function () {});
  }

  if (token) boot(); else showLogin('');
})();
