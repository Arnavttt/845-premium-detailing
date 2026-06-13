// 845 Premium Detailing - customer site.
// Loads content from /api/content and drives the live booking flow:
// pick a date -> fetch open slots -> reserve one -> it disappears for everyone.
// It also runs as a static site (GitHub Pages): a build step bakes content
// into window.SITE_CONTENT, and window.BOOKING_API can point at a hosted
// backend. With no backend configured, the Book page falls back to
// call/text contact options instead of live slots.
(function () {
  'use strict';

  var content = null;
  var selectedTime = null;
  var API = (typeof window.BOOKING_API === 'string' && window.BOOKING_API)
    ? window.BOOKING_API.replace(/\/+$/, '')
    : '';
  var bookingEnabled = !window.STATIC_SITE || !!API;
  // Google Apps Script web apps are a single /exec URL routed by ?action=,
  // while the Node backend uses /api/* paths. Same JSON shapes either way.
  var IS_GAS = /script\.google(usercontent)?\.com/.test(API);

  function apiUrl(action, query) {
    if (IS_GAS) return API + '?action=' + action + (query ? '&' + query : '');
    var paths = { availability: '/api/availability', window: '/api/booking-window' };
    return API + paths[action] + (query ? '?' + query : '');
  }

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  // ---------- motion (reveal-on-scroll + page transitions, reusable) ----------
  var prefersReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var revealObserver = null;

  function initMotion() {
    // Enables the reveal hidden-state in CSS; without JS, content stays visible.
    document.documentElement.classList.add('anim');
    if (prefersReduced || !('IntersectionObserver' in window)) return;
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add('in');
          revealObserver.unobserve(en.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  }

  // Mark elements as reveal targets (optional stagger, ms) and observe them.
  function reveal(els, stagger) {
    if (!els) return;
    var list = els.nodeType ? [els] : els;
    var i = 0;
    Array.prototype.forEach.call(list, function (el) {
      if (!el || el.classList.contains('reveal')) return;
      el.classList.add('reveal');
      if (stagger) el.style.setProperty('--rd', (i * stagger) + 'ms');
      i++;
      if (revealObserver) revealObserver.observe(el);
      else el.classList.add('in'); // reduced motion / no IO: show immediately
    });
  }

  // Static (in-HTML) elements that should reveal on the home + inner pages.
  function revealStatics() {
    reveal([
      document.querySelector('.hero .eyebrow'),
      document.querySelector('.hero h1'),
      document.querySelector('.hero p'),
      document.querySelector('.hero-actions')
    ], 90);
    reveal(document.querySelector('.hero-media'));
    reveal(document.querySelectorAll('.section-head'));
    reveal(document.querySelector('.cta-banner'));
    reveal(document.querySelector('.contact-cta'));
  }

  // ---------- page switching ----------
  var pages = ['home', 'book', 'gallery', 'contact'];

  function go(page) {
    pages.forEach(function (p) {
      $('page-' + p).classList.toggle('hidden', p !== page);
    });
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-go') === page);
    });
    window.scrollTo(0, 0);
    var el = $('page-' + page);
    // Reveal this page's content now that it's visible (stagger preserved via
    // each item's transition-delay) - guarantees nothing stays stuck hidden.
    el.querySelectorAll('.reveal').forEach(function (r) { r.classList.add('in'); });
    if (!prefersReduced) {
      el.classList.remove('page-anim');
      void el.offsetWidth; // reflow so the animation restarts each switch
      el.classList.add('page-anim');
    }
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-go]');
    if (el) {
      e.preventDefault();
      go(el.getAttribute('data-go'));
    }
  });

  // ---------- content ----------
  function renderContent(c) {
    content = c;
    document.querySelectorAll('[data-c]').forEach(function (el) {
      el.textContent = c[el.getAttribute('data-c')] || '';
    });

    $('services-grid').innerHTML = (c.services || []).map(function (s) {
      return '<div class="service-card">' +
        '<div class="service-name">' + esc(s.name) + '</div>' +
        '<div class="service-price-row">' +
          '<span class="service-price">' + esc(s.price) + '</span>' +
          '<span class="service-time">' + esc(s.time) + '</span>' +
        '</div>' +
        '<p class="service-desc">' + esc(s.desc) + '</p>' +
      '</div>';
    }).join('');

    $('points-grid').innerHTML = (c.points || []).map(function (p) {
      return '<div class="point">' +
        '<div class="point-title">' + esc(p.t) + '</div>' +
        '<p class="point-desc">' + esc(p.d) + '</p>' +
      '</div>';
    }).join('');

    var select = $('bk-service');
    select.innerHTML = '<option value="">Choose a service&hellip;</option>' +
      (c.services || []).map(function (s) {
        return '<option value="' + esc(s.name) + '">' + esc(s.name + ' - ' + s.price) + '</option>';
      }).join('');

    $('contact-rows').innerHTML = [
      ['Phone', c.phone, true],
      ['Email', c.email, false],
      ['Instagram', c.instagram, false],
      ['Service area', c.area, false],
      ['Hours', c.hours, false]
    ].map(function (row) {
      return '<div class="contact-row">' +
        '<div class="contact-label">' + esc(row[0]) + '</div>' +
        '<div class="contact-value' + (row[2] ? ' red' : '') + '">' + esc(row[1]) + '</div>' +
      '</div>';
    }).join('');

    // Animate the freshly-rendered cards/rows in as they scroll into view.
    reveal($('services-grid').children, 70);
    reveal($('points-grid').children, 70);
    reveal($('contact-rows').children, 50);
  }

  // ---------- gallery ----------
  function renderGallery() {
    var grid = $('gallery-grid');
    grid.innerHTML = '';
    for (var i = 1; i <= 6; i++) {
      var tile = document.createElement('div');
      tile.className = 'gallery-tile';
      var img = document.createElement('img');
      img.alt = 'Detailing work';
      img.loading = 'lazy';
      img.onerror = function () {
        this.outerHTML = '<div class="media-placeholder">Photo coming soon</div>';
      };
      img.src = 'assets/gallery/' + i + '.jpg';
      tile.appendChild(img);
      grid.appendChild(tile);
    }
    reveal(grid.children, 60);
  }

  // ---------- booking ----------
  function showError(msg) {
    var el = $('bk-error');
    el.textContent = msg || '';
    el.classList.toggle('hidden', !msg);
  }

  function loadSlots(date) {
    selectedTime = null;
    var box = $('bk-slots');
    if (!date) {
      box.innerHTML = '<div class="slot-empty">Pick a date above to see open times.</div>';
      return;
    }
    box.innerHTML = '<div class="slot-empty">Checking open times&hellip;</div>';
    fetch(apiUrl('availability', 'date=' + encodeURIComponent(date)))
      .then(function (r) { return r.json(); })
      .then(function (day) {
        if (!day.open || !day.slots.length) {
          box.innerHTML = '<div class="slot-empty">' + esc(day.reason || 'No open times that day.') + '</div>';
          return;
        }
        var grid = document.createElement('div');
        grid.className = 'slot-grid';
        day.slots.forEach(function (slot) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'slot' + (slot.booked ? ' booked' : '');
          b.textContent = slot.label;
          if (slot.booked) {
            b.disabled = true;
            b.title = 'Already booked';
          } else if (slot.available) {
            b.addEventListener('click', function () {
              selectedTime = slot.time;
              grid.querySelectorAll('.slot').forEach(function (x) { x.classList.remove('selected'); });
              b.classList.add('selected');
              showError('');
            });
          }
          grid.appendChild(b);
        });
        box.innerHTML = '';
        box.appendChild(grid);
        var note = document.createElement('div');
        note.className = 'slot-note';
        note.style.marginTop = '10px';
        note.textContent = 'Crossed-out times are already taken.';
        box.appendChild(note);
      })
      .catch(function () {
        box.innerHTML = '<div class="slot-empty">Could not load times - check your connection and try again.</div>';
      });
  }

  // Static site with no backend: swap the live booking form for contact CTAs.
  function renderBookingFallback() {
    var form = $('book-form');
    var c = content || {};
    var sub = document.querySelector('#page-book .page-sub');
    if (sub) sub.textContent = "Reach out and we'll lock in your slot - it only takes a minute.";
    form.innerHTML =
      '<div style="text-align: center; padding: 8px 0">' +
        '<div class="field-label" style="margin-bottom: 14px">Call or text to grab a slot</div>' +
        '<a href="tel:' + esc((c.phone || '').replace(/[^+\d]/g, '')) + '" style="font-family: \'Barlow Condensed\', sans-serif; font-size: 42px; font-weight: 700; color: #C8102E">' + esc(c.phone || '') + '</a>' +
        '<p style="color: #A8A8A8; font-size: 15px; line-height: 1.6; margin: 14px auto 0; max-width: 380px">Tell us your vehicle and the service you want - we\'ll confirm your time the same day. You can also DM ' + esc(c.instagram || '') + '.</p>' +
      '</div>';
  }

  // Cloudflare Turnstile (bot mitigation) - dormant until window.TURNSTILE_SITEKEY
  // is set in config.js. When unset, the booking form behaves exactly as before.
  var turnstileWidgetId = null;
  function turnstileEnabled() { return !!window.TURNSTILE_SITEKEY; }
  function resetTurnstile() {
    if (turnstileEnabled() && window.turnstile && turnstileWidgetId !== null) {
      try { window.turnstile.reset(turnstileWidgetId); } catch (e) {}
    }
  }
  function setupTurnstile() {
    if (!turnstileEnabled()) return;
    $('bk-turnstile-field').classList.remove('hidden');
    var render = function () {
      if (window.turnstile && turnstileWidgetId === null) {
        turnstileWidgetId = window.turnstile.render('#bk-turnstile', { sitekey: window.TURNSTILE_SITEKEY });
      }
    };
    if (window.turnstile) { render(); return; }
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true; s.defer = true;
    s.onload = render;
    document.head.appendChild(s);
  }

  function setupBooking() {
    if (!bookingEnabled) {
      renderBookingFallback();
      return;
    }
    setupTurnstile();
    fetch(apiUrl('window'))
      .then(function (r) { return r.json(); })
      .then(function (w) {
        var date = $('bk-date');
        date.min = w.minDate;
        date.max = w.maxDate;
      });

    $('bk-date').addEventListener('change', function () {
      loadSlots(this.value);
    });

    $('book-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var payload = {
        name: $('bk-name').value.trim(),
        phone: $('bk-phone').value.trim(),
        vehicle: $('bk-vehicle').value.trim(),
        service: $('bk-service').value,
        date: $('bk-date').value,
        time: selectedTime,
        notes: $('bk-notes').value.trim(),
        company: $('bk-company').value // honeypot - real users leave this empty
      };
      if (!payload.name || !payload.phone || !payload.service || !payload.date) {
        showError('Please fill in your name, phone, a service and a date.');
        return;
      }
      if (!payload.time) {
        showError('Please pick an open time slot.');
        return;
      }
      // Require a Turnstile token only when the widget actually rendered, so a
      // blocked or failed Turnstile script can't lock real customers out.
      if (turnstileEnabled() && turnstileWidgetId !== null) {
        payload.cfToken = window.turnstile.getResponse(turnstileWidgetId);
        if (!payload.cfToken) {
          showError('Please complete the quick verification below.');
          return;
        }
      }
      var button = e.target.querySelector('button[type=submit]');
      button.disabled = true;
      button.textContent = 'Booking…';

      // text/plain avoids a CORS preflight, which Apps Script can't answer;
      // the Node backend parses the JSON body regardless of content type.
      fetch(IS_GAS ? API : API + '/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, status: r.status, data: data }; }); })
        .then(function (res) {
          button.disabled = false;
          button.textContent = 'Book This Slot';
          resetTurnstile();
          // Apps Script always answers HTTP 200, so failures ride in the body
          // as ok:false + code; the Node backend uses real status codes.
          if (!res.ok || res.data.ok === false) {
            showError(res.data.error || 'Something went wrong - please try again.');
            if (res.status === 409 || res.data.code === 409) loadSlots(payload.date); // slot got taken - refresh
            return;
          }
          var b = res.data.booking;
          $('book-success-text').innerHTML = 'See you on <span class="success-slot">' +
            esc(prettyDate(b.date)) + ' at ' + esc(b.label) + '</span> for your ' +
            esc(b.service) + '. We\'ll text you if anything comes up.';
          $('book-form').classList.add('hidden');
          $('book-success').classList.remove('hidden');
          window.scrollTo(0, 0);
        })
        .catch(function () {
          button.disabled = false;
          button.textContent = 'Book This Slot';
          resetTurnstile();
          showError('Could not reach the server - please try again.');
        });
    });

    $('book-again').addEventListener('click', function () {
      $('book-form').classList.remove('hidden');
      $('book-success').classList.add('hidden');
      $('bk-date').value = '';
      $('bk-notes').value = '';
      loadSlots('');
    });
  }

  function prettyDate(iso) {
    var parts = iso.split('-');
    var d = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }

  // ---------- boot ----------
  initMotion();
  if (window.SITE_CONTENT) {
    renderContent(window.SITE_CONTENT);
    renderGallery();
    setupBooking();
  } else {
    fetch(API + '/api/content')
      .then(function (r) { return r.json(); })
      .then(renderContent)
      .catch(function () { /* static shell still renders */ });
    renderGallery();
    setupBooking();
  }
  revealStatics();
})();
