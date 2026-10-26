/*
 * Диспетчерская таксопарка: /app/dispatch/
 * Вход — логином и паролем владельца или диспетчера.
 */
(function () {
  'use strict';

  var API = (window.TAXI_API || '') + '/api';
  var TILE_URL = window.TAXI_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var DEFAULT_CENTER = [55.7558, 37.6173];
  var TOKEN_KEY = 'taxi.dispatch.token';
  var SEARCH_ALERT_SEC = 120;   // поиск дольше — подсвечиваем: нужна помощь диспетчера
  var SEARCH_TIMEOUT_SEC = 300; // столько сервер ищет машину по умолчанию
  var DRIVER_STALE_SEC = 60;
  var ACTIVE = ['searching', 'assigned', 'arrived', 'in_progress'];
  var STATUS = {
    searching: 'Поиск', assigned: 'Едет к клиенту', arrived: 'На месте', in_progress: 'В пути',
    completed: 'Выполнен', cancelled: 'Отменён', expired: 'Не нашли машину',
  };
  var DRIVER_STATUS = { online: 'Свободен', busy: 'На заказе', offline: 'Не на линии' };
  var EVENT = {
    created: 'Заказ создан', offered: 'Предложен водителю', offer_timeout: 'Водитель не ответил',
    declined: 'Водитель пропустил', accepted: 'Водитель принял', assigned_by_dispatcher: 'Назначен диспетчером',
    arrived: 'Водитель на месте', in_progress: 'Поездка началась', completed: 'Поездка завершена',
    cancelled: 'Отменён', expired: 'Машина не найдена', driver_refused: 'Водитель отказался',
  };
  var CAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 6c-.2-.6-.8-1-1.4-1H6.5c-.7 0-1.2.4-1.4 1L3 12v8c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h12v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-8l-2.1-6ZM6.5 16a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm11 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM5 11l1.5-4.5h11L19 11H5Z"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var state = {
    token: null, me: null, tenant: null,
    view: 'orders', scope: 'active',
    orders: {},        // id → заказ
    live: {},          // id → водитель на линии (с координатами)
    drivers: [],       // все водители (для раздела «Водители»)
    tariffs: [],
    selectedId: null,
    newOrder: null,    // черновик нового заказа или null
    events: {},
  };

  // ------------------------------------------------------------------
  // Утилиты
  // ------------------------------------------------------------------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var CURRENCY = { RUB: '₽', MDL: 'лей', KZT: '₸', UAH: '₴', BYN: 'Br', USD: '$', EUR: '€' };
  function money(n) {
    if (n == null) return '—';
    var cur = state.tenant ? state.tenant.currency : 'RUB';
    return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (CURRENCY[cur] || cur);
  }
  function km(m) { return m == null ? '' : m < 1000 ? Math.round(m) + ' м' : (Math.round(m / 100) / 10).toLocaleString('ru-RU') + ' км'; }
  function clock(iso) { return iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''; }
  function ago(iso) {
    var s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return s + ' с';
    if (s < 3600) return Math.floor(s / 60) + ' мин';
    return clock(iso);
  }
  function distanceM(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var x = Math.pow(Math.sin((b.lat - a.lat) * r / 2), 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.pow(Math.sin((b.lng - a.lng) * r / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function store(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* приватный режим */ }
  }
  function load(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3500);
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (res.status === 401 && state.token) { logout(); throw new Error('Сессия истекла, войдите снова'); }
          if (!res.ok) {
            var msg = data && data.message;
            if (Array.isArray(msg)) msg = msg.join('. ');
            var err = new Error(msg || 'Ошибка сервера (' + res.status + ')');
            err.status = res.status;
            throw err;
          }
          return data;
        });
      }, function () { throw new Error('Нет связи с сервером'); });
  }

  function isOwner() { return state.me && state.me.role === 'owner'; }

  // ------------------------------------------------------------------
  // Вход / выход
  // ------------------------------------------------------------------
  function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
    setTimeout(function () { $('loginForm').login.focus(); }, 0);
  }

  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    $('loginError').hidden = true;
    api('/auth/login', { method: 'POST', body: { login: f.login.value.trim(), password: f.password.value } })
      .then(function (r) {
        state.token = r.token;
        store(TOKEN_KEY, r.token);
        f.password.value = '';
        boot();
      })
      .catch(function (err) { $('loginError').textContent = err.message; $('loginError').hidden = false; });
  });

  function logout() {
    store(TOKEN_KEY, null);
    state.token = null;
    if (socket) { socket.disconnect(); socket = null; }
    showLogin();
  }
  $('logoutBtn').addEventListener('click', logout);

  // ------------------------------------------------------------------
  // Запуск
  // ------------------------------------------------------------------
  function boot() {
    api('/auth/me').then(function (me) {
      if (me.role !== 'owner' && me.role !== 'dispatcher') { logout(); return; }
      state.me = me;
      state.tenant = me.tenant;
      applyBranding();
      $('login').hidden = true;
      $('app').hidden = false;
      $('tenantName').textContent = state.tenant.name;
      var who = me.user.name || me.user.login;
      var role = me.role === 'owner' ? 'Владелец' : 'Диспетчер';
      $('userName').textContent = who === role ? who : who + ' (' + role.toLowerCase() + ')';
      if (!map) initMap();
      connectSocket();
      return Promise.all([loadOrders(), loadLive(), loadTariffs()]);
    }).then(function () {
      route();
    }).catch(function (e) {
      if (state.token) toast(e.message);
    });
  }

  function applyBranding() {
    var b = (state.tenant && state.tenant.branding) || {};
    if (b.primaryColor && /^#[0-9a-f]{6}$/i.test(b.primaryColor)) {
      document.documentElement.style.setProperty('--brand', b.primaryColor);
      var n = parseInt(b.primaryColor.slice(1), 16);
      var lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
      document.documentElement.style.setProperty('--on-brand', lum > 0.6 ? '#15171b' : '#ffffff');
    }
    document.title = 'Диспетчерская — ' + (state.tenant ? state.tenant.name : '');
  }

  // ------------------------------------------------------------------
  // Данные
  // ------------------------------------------------------------------
  function loadOrders() {
    return Promise.all([api('/orders?scope=active&limit=200'), api('/orders?scope=today&limit=200')]).then(function (r) {
      state.orders = {};
      r[0].concat(r[1]).forEach(function (o) { state.orders[o.id] = o; });
      renderFeed();
      renderOrderMarkers();
    });
  }
  function loadLive() {
    return api('/drivers/live').then(function (list) {
      state.live = {};
      list.forEach(function (d) { state.live[d.id] = d; });
      renderDriverMarkers();
      renderCounters();
    });
  }
  function loadTariffs() {
    return api('/tariffs').then(function (t) { state.tariffs = t; });
  }
  var reloadLive = debounce(loadLive, 500);

  function upsertOrder(o) {
    var isNew = !state.orders[o.id];
    state.orders[o.id] = o;
    if (isNew && o.source === 'app' && o.status === 'searching') chime();
    renderFeed();
    renderOrderMarkers();
    renderCounters();
    if (state.selectedId === o.id) {
      delete state.events[o.id];
      renderDrawer();
    }
  }

  // ------------------------------------------------------------------
  // Реалтайм
  // ------------------------------------------------------------------
  var socket = null, pollTimer = null;
  function connectSocket() {
    if (socket || pollTimer) return;
    loadScript((window.TAXI_API || '') + '/socket.io/socket.io.js').then(function () {
      if (typeof window.io !== 'function') return;
      socket = window.io(window.TAXI_API || undefined, { auth: { token: state.token } });
      socket.on('order:updated', upsertOrder);
      socket.on('driver:location', function (d) {
        var live = state.live[d.driverId];
        if (!live) { reloadLive(); return; }
        live.lastLat = d.lat; live.lastLng = d.lng; live.lastSeenAt = new Date().toISOString(); live.status = d.status;
        moveDriverMarker(live);
      });
      socket.on('driver:status', reloadLive);
      socket.on('connect', function () { loadOrders(); loadLive(); });
    }).catch(function () { /* без сокетов — опрос ниже */ });
    pollTimer = setInterval(function () {
      if (!socket || !socket.connected) { loadOrders().catch(function () {}); loadLive().catch(function () {}); }
      else renderFeedTimes();
    }, 5000);
  }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  var audio = null;
  document.addEventListener('click', function () {
    try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { audio = null; }
  }, { once: true });
  function chime() {
    if (!audio) return;
    try {
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.frequency.value = 988; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.45);
    } catch (e) { /* без звука */ }
  }

  // ------------------------------------------------------------------
  // Навигация по разделам
  // ------------------------------------------------------------------
  function route() {
    var v = (location.hash || '#orders').slice(1);
    if (['orders', 'drivers', 'tariffs', 'settings'].indexOf(v) < 0) v = 'orders';
    state.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('.tabs a'), function (a) {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (s) { s.hidden = s.dataset.view !== v; });
    if (v === 'orders') setTimeout(function () { map.invalidateSize(); }, 0);
    if (v === 'drivers') renderDriversPage();
    if (v === 'tariffs') renderTariffsPage();
    if (v === 'settings') renderSettingsPage();
  }
  window.addEventListener('hashchange', function () { if (state.token) route(); });

  function renderCounters() {
    var live = Object.keys(state.live).map(function (k) { return state.live[k]; });
    var free = live.filter(function (d) { return d.status === 'online'; }).length;
    var busy = live.filter(function (d) { return d.status === 'busy'; }).length;
    var searching = Object.keys(state.orders).filter(function (k) { return state.orders[k].status === 'searching'; }).length;
    $('counters').innerHTML =
      '<span class="counter"><i style="background:var(--st-in_progress)"></i>Свободно <b>' + free + '</b></span>' +
      '<span class="counter"><i style="background:var(--st-assigned)"></i>На заказах <b>' + busy + '</b></span>' +
      '<span class="counter"><i style="background:var(--st-searching)"></i>Ищут машину <b>' + searching + '</b></span>';
  }

  // ------------------------------------------------------------------
  // Лента заказов
  // ------------------------------------------------------------------
  function feedOrders() {
    var list = Object.keys(state.orders).map(function (k) { return state.orders[k]; });
    if (state.scope === 'active') list = list.filter(function (o) { return ACTIVE.indexOf(o.status) >= 0; });
    // сначала те, что ищут машину дольше всех, потом остальные — новые сверху
    return list.sort(function (a, b) {
      var sa = a.status === 'searching' ? 0 : 1, sb = b.status === 'searching' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (sa === 0) return new Date(a.createdAt) - new Date(b.createdAt);
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }

  function searchAgeSec(o) { return (Date.now() - new Date(o.createdAt).getTime()) / 1000; }

  function orderItemHtml(o) {
    var alert = o.status === 'searching' && searchAgeSec(o) > SEARCH_ALERT_SEC;
    var to = o.dropoff ? (o.dropoff.address || 'Точка на карте') : 'Без точки назначения';
    var plate = o.driver && o.driver.car && o.driver.car.plate ? '<span class="oi-plate">' + esc(o.driver.car.plate) + '</span>' : '';
    var who = o.passenger && (o.passenger.name || o.passenger.phone) ? esc(o.passenger.name || o.passenger.phone) : '';
    var search = '';
    if (o.status === 'searching') {
      var pct = Math.min(100, (searchAgeSec(o) / SEARCH_TIMEOUT_SEC) * 100);
      search = '<div class="oi-search"><i style="width:' + pct.toFixed(1) + '%"></i></div>';
    }
    return '<li><button type="button" class="order-item' + (alert ? ' alert' : '') + '" data-id="' + o.id + '"' +
      (state.selectedId === o.id ? ' aria-current="true"' : '') + '>' +
      '<div class="oi-top"><span class="oi-num">№' + o.number + '</span><span class="chip st-' + o.status + '">' + STATUS[o.status] + '</span>' +
      '<span class="oi-time" data-ago="' + o.createdAt + '">' + (ACTIVE.indexOf(o.status) >= 0 ? ago(o.createdAt) : clock(o.createdAt)) + '</span></div>' +
      '<div class="oi-route">' + esc(o.pickup.address || 'Точка на карте') + '</div>' +
      '<div class="oi-route">' + esc(to) + '</div>' +
      '<div class="oi-bottom">' + (alert ? '<span class="alert-text">Долго ищем, назначьте вручную</span>' : who) + plate +
      '<span class="oi-price">' + money(o.finalPrice != null ? o.finalPrice : o.estimatedPrice) + '</span></div>' +
      search + '</button></li>';
  }

  function renderFeed() {
    var list = feedOrders();
    var active = Object.keys(state.orders).filter(function (k) { return ACTIVE.indexOf(state.orders[k].status) >= 0; }).length;
    $('cntActive').textContent = active || '';
    $('feed').innerHTML = list.length ? list.map(orderItemHtml).join('')
      : '<li class="feed-empty">' + (state.scope === 'active' ? 'Активных заказов нет' : 'Сегодня заказов ещё не было') + '</li>';
  }

  function renderFeedTimes() {
    // раз в 5 секунд обновляем «сколько ищем» без полной перерисовки
    if (Object.keys(state.orders).some(function (k) { return state.orders[k].status === 'searching'; })) renderFeed();
    else Array.prototype.forEach.call(document.querySelectorAll('[data-ago]'), function (el) {
      var o = feedOrders().filter(function (x) { return x.createdAt === el.dataset.ago; })[0];
      if (o && ACTIVE.indexOf(o.status) >= 0) el.textContent = ago(o.createdAt);
    });
  }

  $('feed').addEventListener('click', function (e) {
    var b = e.target.closest('.order-item');
    if (b) selectOrder(b.dataset.id, true);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.segmented button'), function (b) {
    b.addEventListener('click', function () {
      state.scope = b.dataset.scope;
      Array.prototype.forEach.call(document.querySelectorAll('.segmented button'), function (x) {
        x.setAttribute('aria-selected', String(x === b));
      });
      renderFeed();
    });
  });

  // ------------------------------------------------------------------
  // Карта
  // ------------------------------------------------------------------
  var map, driverMarkers = {}, orderMarkers = {}, selMarkers = [];
  function initMap() {
    var center = state.tenant && state.tenant.settings && Array.isArray(state.tenant.settings.center) ? state.tenant.settings.center : DEFAULT_CENTER;
    map = L.map('map', { zoomControl: true }).setView(center, 13);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.on('click', onMapClick);
  }
  function icon(html, size) { return L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }); }

  function driverIcon(d) {
    var stale = !d.lastSeenAt || (Date.now() - new Date(d.lastSeenAt).getTime()) / 1000 > DRIVER_STALE_SEC;
    return icon('<div class="mk-driver st-' + d.status + (stale ? ' stale' : '') + '">' + CAR_SVG + '</div>', 30);
  }
  function driverTip(d) {
    return esc(d.name) + (d.carPlate ? ', ' + esc(d.carPlate) : '') + ' — ' + DRIVER_STATUS[d.status];
  }
  function renderDriverMarkers() {
    Object.keys(driverMarkers).forEach(function (id) {
      if (!state.live[id]) { map.removeLayer(driverMarkers[id]); delete driverMarkers[id]; }
    });
    Object.keys(state.live).forEach(function (id) { moveDriverMarker(state.live[id]); });
  }
  function moveDriverMarker(d) {
    if (d.lastLat == null) return;
    var m = driverMarkers[d.id];
    if (m) { m.setLatLng([d.lastLat, d.lastLng]); m.setIcon(driverIcon(d)); }
    else {
      m = driverMarkers[d.id] = L.marker([d.lastLat, d.lastLng], { icon: driverIcon(d), zIndexOffset: 500 }).addTo(map);
      if (m.bindTooltip) m.bindTooltip(driverTip(d), { direction: 'top', offset: [0, -14] });
    }
    if (m.setTooltipContent) m.setTooltipContent(driverTip(d));
  }

  function renderOrderMarkers() {
    // мигающие точки — заказы, которые ищут машину
    var searching = {};
    Object.keys(state.orders).forEach(function (id) { if (state.orders[id].status === 'searching') searching[id] = state.orders[id]; });
    Object.keys(orderMarkers).forEach(function (id) {
      if (!searching[id]) { map.removeLayer(orderMarkers[id]); delete orderMarkers[id]; }
    });
    Object.keys(searching).forEach(function (id) {
      if (orderMarkers[id]) return;
      var o = searching[id];
      var m = orderMarkers[id] = L.marker([o.pickup.lat, o.pickup.lng], { icon: icon('<div class="mk-pickup"></div>', 18) }).addTo(map);
      if (m.on) m.on('click', function () { selectOrder(id, false); });
    });
  }

  function showSelection(o) {
    selMarkers.forEach(function (m) { map.removeLayer(m); });
    selMarkers = [];
    if (!o) return;
    selMarkers.push(L.marker([o.pickup.lat, o.pickup.lng], { icon: icon('<div class="mk-point">A</div>', 24), zIndexOffset: 900 }).addTo(map));
    if (o.dropoff) selMarkers.push(L.marker([o.dropoff.lat, o.dropoff.lng], { icon: icon('<div class="mk-point b">B</div>', 24), zIndexOffset: 900 }).addTo(map));
  }

  function fit(points) {
    var pts = points.filter(Boolean).map(function (p) { return [p.lat, p.lng]; });
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 });
  }

  // ------------------------------------------------------------------
  // Карточка заказа
  // ------------------------------------------------------------------
  function selectOrder(id, pan) {
    state.newOrder = null;
    state.selectedId = id;
    renderFeed();
    renderDrawer();
    var o = state.orders[id];
    showSelection(o);
    if (pan && o) {
      var d = o.driver && state.live[o.driver.id];
      fit([o.pickup, o.dropoff, d && d.lastLat != null ? { lat: d.lastLat, lng: d.lastLng } : null]);
    }
  }

  function closeDrawer() {
    state.selectedId = null;
    state.newOrder = null;
    $('drawer').hidden = true;
    $('mapHint').hidden = true;
    showSelection(null);
    renderFeed();
    setTimeout(function () { map.invalidateSize(); }, 0);
  }

  function renderDrawer() {
    var dr = $('drawer');
    if (state.newOrder) { dr.innerHTML = newOrderHtml(); dr.hidden = false; bindNewOrder(); return; }
    var o = state.orders[state.selectedId];
    if (!o) { dr.hidden = true; return; }
    if (!state.events[o.id]) {
      state.events[o.id] = 'loading';
      api('/orders/' + o.id + '/events').then(function (ev) {
        state.events[o.id] = ev;
        if (state.selectedId === o.id && !state.newOrder) renderDrawer();
      }).catch(function () { state.events[o.id] = []; });
    }
    var active = ACTIVE.indexOf(o.status) >= 0;
    var phone = o.passenger && o.passenger.phone;
    var html =
      '<div class="drawer-head"><h2>Заказ №' + o.number + '</h2><span class="chip st-' + o.status + '">' + STATUS[o.status] + '</span>' +
      '<button type="button" class="close" data-close aria-label="Закрыть">×</button></div>' +
      '<div class="section"><ul class="route"><li><span class="dot"></span><span>' + esc(o.pickup.address || 'Точка на карте') + '</span></li>' +
      '<li><span class="dot b"></span><span>' + esc(o.dropoff ? (o.dropoff.address || 'Точка на карте') : 'Куда скажет пассажир') + '</span></li></ul></div>' +
      '<div class="section"><dl class="kv">' +
      '<dt>Стоимость</dt><dd class="big-price">' + money(o.finalPrice != null ? o.finalPrice : o.estimatedPrice) + '</dd>' +
      '<dt>Тариф</dt><dd>' + esc(o.tariff.name) + (o.distanceM ? ', ' + km(o.distanceM) : '') + '</dd>' +
      '<dt>Клиент</dt><dd>' + esc((o.passenger && o.passenger.name) || '—') + (phone ? '<br><a href="tel:' + esc(phone) + '">' + esc(phone) + '</a>' : '') + '</dd>' +
      '<dt>Источник</dt><dd>' + (o.source === 'dispatcher' ? 'Принят диспетчером' : 'Приложение') + '</dd>' +
      (o.comment ? '<dt>Комментарий</dt><dd>' + esc(o.comment) + '</dd>' : '') +
      (o.cancelReason ? '<dt>Причина отмены</dt><dd>' + esc(o.cancelReason) + '</dd>' : '') +
      '</dl></div>';

    if (o.driver) {
      var car = [o.driver.car.color, o.driver.car.model].filter(Boolean).join(' ');
      html += '<div class="section"><h3>Водитель</h3><div class="driver-card">' +
        (o.driver.car.plate ? '<span class="plate">' + esc(o.driver.car.plate) + '</span>' : '') +
        '<div><div><b>' + esc(o.driver.name) + '</b></div><div class="muted">' + esc(car) +
        (o.driver.phone ? ', <a href="tel:' + esc(o.driver.phone) + '">' + esc(o.driver.phone) + '</a>' : '') + '</div></div></div></div>';
    }
    if (o.status === 'searching') html += candidatesHtml(o);
    if (active) {
      html += '<div class="section actions"><button type="button" class="btn danger" data-cancel>Отменить заказ</button></div>';
    }
    var ev = state.events[o.id];
    if (Array.isArray(ev) && ev.length) {
      html += '<div class="section"><h3>История</h3><ul class="timeline">' + ev.map(function (e) {
        var extra = '';
        if (e.payload && e.payload.driverId && state.live[e.payload.driverId]) extra = ': ' + esc(state.live[e.payload.driverId].name);
        else if (e.payload && e.payload.reason) extra = ': ' + esc(e.payload.reason);
        return '<li><time>' + clock(e.createdAt) + '</time><span>' + esc(EVENT[e.type] || e.type) + extra + '</span></li>';
      }).join('') + '</ul></div>';
    }
    $('drawer').innerHTML = html;
    $('drawer').hidden = false;
    setTimeout(function () { map.invalidateSize(); }, 0);
  }

  /** Свободные водители, ближайшие к подаче — для ручного назначения */
  function candidatesHtml(o) {
    var free = Object.keys(state.live).map(function (k) { return state.live[k]; })
      .filter(function (d) { return d.status === 'online' && d.lastLat != null; })
      .map(function (d) { return { d: d, m: distanceM(o.pickup, { lat: d.lastLat, lng: d.lastLng }) }; })
      .sort(function (a, b) { return a.m - b.m; })
      .slice(0, 15);
    if (!free.length) return '<div class="section"><h3>Назначить вручную</h3><p class="muted">Свободных водителей на линии нет.</p></div>';
    return '<div class="section"><h3>Назначить вручную</h3><ul class="candidates">' + free.map(function (x) {
      var car = [x.d.carColor, x.d.carModel].filter(Boolean).join(' ');
      return '<li><div class="who"><div><b>' + esc(x.d.name) + '</b> ' + (x.d.carPlate ? '<span class="oi-plate">' + esc(x.d.carPlate) + '</span>' : '') +
        '</div><div>' + esc(car) + '</div></div><span class="dist">' + km(Math.round(x.m)) + '</span>' +
        '<button type="button" class="btn small" data-assign="' + x.d.id + '">Назначить</button></li>';
    }).join('') + '</ul></div>';
  }

  $('drawer').addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) return closeDrawer();
    var a = e.target.closest('[data-assign]');
    if (a) {
      a.disabled = true;
      api('/orders/' + state.selectedId + '/assign', { method: 'POST', body: { driverId: a.dataset.assign } })
        .then(function (o) { upsertOrder(o); reloadLive(); toast('Водитель назначен'); })
        .catch(function (err) { a.disabled = false; toast(err.message); });
      return;
    }
    if (e.target.closest('[data-cancel]')) {
      var reason = window.prompt('Причина отмены (её увидит клиент):', '');
      if (reason === null) return;
      api('/orders/' + state.selectedId + '/cancel', { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} })
        .then(function (o) { upsertOrder(o); reloadLive(); toast('Заказ отменён'); })
        .catch(function (err) { toast(err.message); });
    }
  });

  // ------------------------------------------------------------------
  // Новый заказ по телефону
  // ------------------------------------------------------------------
  $('newOrderBtn').addEventListener('click', function () {
    state.selectedId = null;
    showSelection(null);
    state.newOrder = { phone: '', name: '', comment: '', pickup: null, dropoff: null, tariffId: null, estimate: null, pickTarget: null };
    renderFeed();
    renderDrawer();
    setTimeout(function () { var p = $('noPhone'); if (p) p.focus(); }, 0);
  });

  function addrFieldHtml(key, label, place) {
    return '<label class="addr">' + label +
      '<input class="input" id="no_' + key + '" autocomplete="off" placeholder="Улица, дом или место" value="' + esc(place ? place.title : '') + '">' +
      '<button type="button" class="link addr-pick" data-pick="' + key + '">на карте</button>' +
      '<ul class="addr-results" id="no_' + key + '_res" hidden></ul></label>';
  }

  function newOrderHtml() {
    var n = state.newOrder;
    var est = '';
    if (n.estimate) {
      est = '<div class="estimate" role="group" aria-label="Тариф">' + n.estimate.options.map(function (o) {
        return '<button type="button" data-tariff="' + o.tariffId + '" aria-pressed="' + (o.tariffId === n.tariffId) + '"><small>' +
          esc(o.name) + '</small><b>' + money(o.price) + '</b></button>';
      }).join('') + '</div>' + (n.estimate.distanceM ? '<p class="muted" style="margin-top:-6px">' + km(n.estimate.distanceM) + ', около ' + Math.max(1, Math.round(n.estimate.durationS / 60)) + ' мин</p>' : '');
    } else if (n.pickup) {
      est = '<p class="muted">Без точки назначения — по минимальному тарифу.</p>';
    }
    return '<div class="drawer-head"><h2>Новый заказ</h2><button type="button" class="close" data-close aria-label="Закрыть">×</button></div>' +
      '<form id="newOrderForm">' +
      '<div class="row"><label>Телефон клиента<input class="input" id="noPhone" type="tel" required value="' + esc(n.phone) + '" placeholder="+7 900 000-00-00"></label>' +
      '<label>Имя<input class="input" id="noName" value="' + esc(n.name) + '"></label></div>' +
      addrFieldHtml('pickup', 'Откуда', n.pickup) + addrFieldHtml('dropoff', 'Куда', n.dropoff) + est +
      '<label>Комментарий водителю<input class="input" id="noComment" value="' + esc(n.comment) + '" placeholder="Подъезд, багаж, детское кресло"></label>' +
      '<p class="form-error" id="noError" hidden></p>' +
      '<button type="submit" class="btn primary block" id="noSubmit"' + (n.pickup ? '' : ' disabled') + '>Создать заказ и искать машину</button>' +
      '</form>';
  }

  function bindNewOrder() {
    var n = state.newOrder;
    $('noPhone').addEventListener('input', function (e) { n.phone = e.target.value; });
    $('noName').addEventListener('input', function (e) { n.name = e.target.value; });
    $('noComment').addEventListener('input', function (e) { n.comment = e.target.value; });
    ['pickup', 'dropoff'].forEach(function (key) {
      var input = $('no_' + key), res = $('no_' + key + '_res');
      var run = debounce(function () {
        var q = input.value.trim();
        if (q.length < 3) { res.hidden = true; return; }
        var c = map.getCenter();
        api('/geo/search?q=' + encodeURIComponent(q) + '&lat=' + c.lat + '&lng=' + c.lng).then(function (list) {
          if (!list.length) { res.innerHTML = '<li class="muted" style="padding:8px 12px">Ничего не нашлось — укажите точку на карте</li>'; res.hidden = false; return; }
          res.innerHTML = list.map(function (p, i) {
            return '<li><button type="button" data-i="' + i + '">' + esc(p.title) + '<small>' + esc(p.subtitle) + '</small></button></li>';
          }).join('');
          res.hidden = false;
          Array.prototype.forEach.call(res.querySelectorAll('button'), function (b) {
            b.addEventListener('click', function () { setPlace(key, list[Number(b.dataset.i)]); });
          });
        }).catch(function (err) { res.innerHTML = '<li class="muted" style="padding:8px 12px">' + esc(err.message) + '</li>'; res.hidden = false; });
      }, 400);
      input.addEventListener('input', run);
      input.addEventListener('blur', function () { setTimeout(function () { res.hidden = true; }, 200); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pick]'), function (b) {
      b.addEventListener('click', function () {
        n.pickTarget = b.dataset.pick;
        $('mapHint').textContent = 'Кликните на карте: ' + (n.pickTarget === 'pickup' ? 'место подачи' : 'куда ехать');
        $('mapHint').hidden = false;
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.estimate [data-tariff]'), function (b) {
      b.addEventListener('click', function () { n.tariffId = b.dataset.tariff; renderDrawer(); });
    });
    $('newOrderForm').addEventListener('submit', submitNewOrder);
  }

  function onMapClick(e) {
    var n = state.newOrder;
    if (!n || !n.pickTarget) return;
    var key = n.pickTarget;
    n.pickTarget = null;
    $('mapHint').hidden = true;
    var lat = e.latlng.lat, lng = e.latlng.lng;
    api('/geo/reverse?lat=' + lat + '&lng=' + lng).then(function (p) {
      setPlace(key, p ? { lat: lat, lng: lng, title: p.title, subtitle: p.subtitle } : { lat: lat, lng: lng, title: 'Точка на карте', subtitle: '' });
    }).catch(function () { setPlace(key, { lat: lat, lng: lng, title: 'Точка на карте', subtitle: '' }); });
  }

  function placeBody(p) {
    return p ? { lat: p.lat, lng: p.lng, address: p.subtitle ? p.title + ', ' + p.subtitle : p.title } : undefined;
  }

  function setPlace(key, p) {
    var n = state.newOrder;
    if (!n) return;
    n[key] = p;
    n.estimate = null;
    showNewOrderPoints();
    if (n.pickup && n.dropoff) {
      api('/orders/estimate', { method: 'POST', body: { pickup: placeBody(n.pickup), dropoff: placeBody(n.dropoff) } }).then(function (est) {
        n.estimate = est;
        if (!est.options.some(function (o) { return o.tariffId === n.tariffId; })) n.tariffId = est.options[0] && est.options[0].tariffId;
        renderDrawer();
      }).catch(function (err) { toast(err.message); });
    }
    renderDrawer();
  }

  function showNewOrderPoints() {
    var n = state.newOrder;
    showSelection(n.pickup ? { pickup: n.pickup, dropoff: n.dropoff } : null);
    fit([n.pickup, n.dropoff]);
  }

  function submitNewOrder(e) {
    e.preventDefault();
    var n = state.newOrder;
    var body = { pickup: placeBody(n.pickup), customerPhone: n.phone.trim() };
    if (n.dropoff) body.dropoff = placeBody(n.dropoff);
    if (n.tariffId) body.tariffId = n.tariffId;
    if (n.name.trim()) body.customerName = n.name.trim();
    if (n.comment.trim()) body.comment = n.comment.trim();
    $('noSubmit').disabled = true;
    api('/orders', { method: 'POST', body: body }).then(function (o) {
      state.newOrder = null;
      upsertOrder(o);
      selectOrder(o.id, true);
      toast('Заказ №' + o.number + ' создан, ищем машину');
    }).catch(function (err) {
      $('noSubmit').disabled = false;
      $('noError').textContent = err.message;
      $('noError').hidden = false;
    });
  }

  // ------------------------------------------------------------------
  // Модальные формы
  // ------------------------------------------------------------------
  function openModal(html, onSubmit) {
    var m = $('modal');
    m.innerHTML = html;
    var form = m.querySelector('form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = form.querySelector('.form-error');
      err.hidden = true;
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      Promise.resolve(onSubmit(form)).then(function () { m.close(); }).catch(function (x) {
        btn.disabled = false;
        err.textContent = x.message;
        err.hidden = false;
      });
    });
    m.querySelector('[data-cancel-modal]').addEventListener('click', function () { m.close(); });
    m.showModal();
    var first = form.querySelector('input:not([type=checkbox]), select');
    if (first) first.focus();
  }

  function val(form, name) { var v = form.elements[name].value.trim(); return v === '' ? undefined : v; }

  // ------------------------------------------------------------------
  // Раздел «Водители»
  // ------------------------------------------------------------------
  var driverFilter = '';
  function renderDriversPage() {
    var page = document.querySelector('.view[data-view="drivers"]');
    api('/drivers').then(function (list) {
      state.drivers = list;
      var f = driverFilter.toLowerCase();
      var rows = list.filter(function (d) {
        return !f || [d.name, d.phone, d.carPlate, d.carModel, String(d.telegramId || '')].join(' ').toLowerCase().indexOf(f) >= 0;
      });
      page.innerHTML = '<div class="page-inner"><div class="page-head"><h1>Водители</h1>' +
        '<input class="input search" id="driverSearch" placeholder="Поиск: имя, номер, телефон" value="' + esc(driverFilter) + '">' +
        '<button type="button" class="btn primary" id="addDriver">Добавить водителя</button></div>' +
        (list.length ? '<table class="data"><thead><tr><th>Водитель</th><th>Машина</th><th>Телефон</th><th>Telegram ID</th><th>Тарифы</th><th>Статус</th><th></th></tr></thead><tbody>' +
          rows.map(function (d) {
            return '<tr class="' + (d.isActive ? '' : 'off') + '"><td><b>' + esc(d.name) + '</b></td>' +
              '<td>' + (d.carPlate ? '<span class="plate">' + esc(d.carPlate) + '</span> ' : '') + esc([d.carColor, d.carModel].filter(Boolean).join(' ')) + '</td>' +
              '<td>' + esc(d.phone || '') + '</td><td class="num">' + esc(d.telegramId || '—') + '</td>' +
              '<td>' + esc(d.tariffCodes && d.tariffCodes.length ? d.tariffCodes.map(tariffName).join(', ') : 'Все') + '</td>' +
              '<td>' + (d.isActive ? '<span class="chip st-' + d.status + '">' + DRIVER_STATUS[d.status] + '</span>' : '<span class="muted">Отключён</span>') + '</td>' +
              '<td><button type="button" class="btn small" data-edit-driver="' + d.id + '">Изменить</button></td></tr>';
          }).join('') + '</tbody></table>'
          : '<div class="card"><h2>Водителей пока нет</h2><p class="muted">Добавьте водителя и укажите его Telegram ID — по нему водитель входит в приложение. Свой ID водитель узнает, написав боту таксопарка команду /driver.</p></div>') +
        '</div>';
      $('addDriver').addEventListener('click', function () { driverForm(null); });
      var s = $('driverSearch');
      s.addEventListener('input', debounce(function () { driverFilter = s.value; renderDriversPage(); }, 250));
      Array.prototype.forEach.call(page.querySelectorAll('[data-edit-driver]'), function (b) {
        b.addEventListener('click', function () {
          driverForm(state.drivers.filter(function (d) { return d.id === b.dataset.editDriver; })[0]);
        });
      });
      if (driverFilter) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }).catch(function (e) { toast(e.message); });
  }
  function tariffName(code) {
    var t = state.tariffs.filter(function (x) { return x.code === code; })[0];
    return t ? t.name : code;
  }

  function driverForm(d) {
    var codes = d ? d.tariffCodes || [] : [];
    var html = '<form><h2>' + (d ? 'Водитель: ' + esc(d.name) : 'Новый водитель') + '</h2>' +
      '<label>Имя и фамилия<input name="name" required value="' + esc(d ? d.name : '') + '"></label>' +
      '<div class="row"><label>Телефон<input name="phone" type="tel" value="' + esc(d && d.phone || '') + '"></label>' +
      '<label>Telegram ID<input name="telegramId" inputmode="numeric" pattern="[0-9]+" value="' + esc(d && d.telegramId || '') + '"></label></div>' +
      '<div class="row"><label>Марка и модель<input name="carModel" value="' + esc(d && d.carModel || '') + '" placeholder="Kia Rio"></label>' +
      '<label>Цвет<input name="carColor" value="' + esc(d && d.carColor || '') + '" placeholder="белый"></label></div>' +
      '<label>Госномер<input name="carPlate" value="' + esc(d && d.carPlate || '') + '" placeholder="А001АА 77"></label>' +
      '<label>Тарифы, которые может возить<span class="checks">' + state.tariffs.map(function (t) {
        return '<span class="check"><input type="checkbox" name="tariff" value="' + esc(t.code) + '"' + (codes.indexOf(t.code) >= 0 ? ' checked' : '') + '>' + esc(t.name) + '</span>';
      }).join('') + '</span><span class="muted" style="font-weight:400">Ничего не отмечено — все тарифы</span></label>' +
      (d ? '<label class="check"><input type="checkbox" name="isActive"' + (d.isActive ? ' checked' : '') + '> Может работать (снимите, чтобы отключить)</label>' : '') +
      '<p class="form-error" hidden></p><div class="modal-actions"><button type="button" class="btn" data-cancel-modal>Отмена</button>' +
      '<button type="submit" class="btn primary">' + (d ? 'Сохранить' : 'Добавить') + '</button></div></form>';
    openModal(html, function (f) {
      var body = {
        name: val(f, 'name'), phone: val(f, 'phone'), carModel: val(f, 'carModel'), carColor: val(f, 'carColor'), carPlate: val(f, 'carPlate'),
        tariffCodes: Array.prototype.filter.call(f.querySelectorAll('[name=tariff]'), function (c) { return c.checked; }).map(function (c) { return c.value; }),
      };
      var tg = val(f, 'telegramId');
      if (tg) body.telegramId = Number(tg);
      if (d) body.isActive = f.elements.isActive.checked;
      return api(d ? '/drivers/' + d.id : '/drivers', { method: d ? 'PATCH' : 'POST', body: body }).then(function () {
        toast(d ? 'Сохранено' : 'Водитель добавлен');
        renderDriversPage();
        reloadLive();
      });
    });
  }

  // ------------------------------------------------------------------
  // Раздел «Тарифы»
  // ------------------------------------------------------------------
  function renderTariffsPage() {
    var page = document.querySelector('.view[data-view="tariffs"]');
    loadTariffs().then(function () {
      var owner = isOwner();
      page.innerHTML = '<div class="page-inner"><div class="page-head"><h1>Тарифы</h1>' +
        (owner ? '<button type="button" class="btn primary" id="addTariff">Добавить тариф</button>' : '') + '</div>' +
        '<table class="data"><thead><tr><th>Название</th><th>Код</th><th class="num">Подача</th><th class="num">За км</th><th class="num">За минуту</th><th class="num">Минимум</th><th class="num">Округление</th><th class="num">5 км / 15 мин</th><th>Статус</th>' +
        (owner ? '<th></th>' : '') + '</tr></thead><tbody>' +
        state.tariffs.map(function (t) {
          return '<tr class="' + (t.isActive ? '' : 'off') + '"><td><b>' + esc(t.name) + '</b></td><td>' + esc(t.code) + '</td>' +
            '<td class="num">' + money(t.baseFare) + '</td><td class="num">' + money(t.perKm) + '</td><td class="num">' + money(t.perMin) + '</td>' +
            '<td class="num">' + money(t.minFare) + '</td><td class="num">' + money(t.roundTo) + '</td>' +
            '<td class="num"><b>' + money(examplePrice(t)) + '</b></td>' +
            '<td>' + (t.isActive ? 'Активен' : '<span class="muted">Выключен</span>') + '</td>' +
            (owner ? '<td><button type="button" class="btn small" data-edit-tariff="' + t.id + '">Изменить</button></td>' : '') + '</tr>';
        }).join('') + '</tbody></table>' +
        '<p class="muted">Цена = подача + км × цена за км + минуты × цена за минуту, но не меньше минимума, с округлением вверх.' +
        (owner ? '' : ' Менять тарифы может только владелец таксопарка.') + '</p></div>';
      if (owner) {
        $('addTariff').addEventListener('click', function () { tariffForm(null); });
        Array.prototype.forEach.call(page.querySelectorAll('[data-edit-tariff]'), function (b) {
          b.addEventListener('click', function () { tariffForm(state.tariffs.filter(function (t) { return t.id === b.dataset.editTariff; })[0]); });
        });
      }
    }).catch(function (e) { toast(e.message); });
  }

  /** Та же формула, что на сервере (pricing.ts): пример поездки 5 км, 15 минут */
  function examplePrice(t) {
    var raw = t.baseFare + t.perKm * 5 + t.perMin * 15;
    var p = Math.max(raw, t.minFare), step = t.roundTo > 0 ? t.roundTo : 0.01;
    return Math.round(Math.ceil(p / step - 1e-9) * step * 100) / 100;
  }

  function tariffForm(t) {
    var num = function (name, label, v) {
      return '<label>' + label + '<input name="' + name + '" type="number" min="0" step="0.01" required value="' + (v != null ? v : '') + '"></label>';
    };
    var html = '<form><h2>' + (t ? 'Тариф: ' + esc(t.name) : 'Новый тариф') + '</h2>' +
      '<div class="row"><label>Название<input name="name" required value="' + esc(t ? t.name : '') + '" placeholder="Комфорт"></label>' +
      '<label>Код (латиницей)<input name="code" required pattern="[a-z0-9_-]{2,30}" value="' + esc(t ? t.code : '') + '" placeholder="comfort"></label></div>' +
      '<div class="row">' + num('baseFare', 'Подача', t ? t.baseFare : 50) + num('minFare', 'Минимальная цена', t ? t.minFare : 150) + '</div>' +
      '<div class="row">' + num('perKm', 'За километр', t ? t.perKm : 15) + num('perMin', 'За минуту', t ? t.perMin : 5) + '</div>' +
      '<div class="row">' + num('roundTo', 'Округлять вверх до', t ? t.roundTo : 10) + '<label>Порядок в списке<input name="sortOrder" type="number" step="1" value="' + (t ? t.sortOrder : state.tariffs.length) + '"></label></div>' +
      (t ? '<label class="check"><input type="checkbox" name="isActive"' + (t.isActive ? ' checked' : '') + '> Тариф доступен пассажирам</label>' : '') +
      '<p class="form-error" hidden></p><div class="modal-actions"><button type="button" class="btn" data-cancel-modal>Отмена</button>' +
      '<button type="submit" class="btn primary">' + (t ? 'Сохранить' : 'Добавить') + '</button></div></form>';
    openModal(html, function (f) {
      var body = { name: val(f, 'name'), code: val(f, 'code') };
      ['baseFare', 'minFare', 'perKm', 'perMin', 'roundTo'].forEach(function (k) { body[k] = Number(f.elements[k].value); });
      body.sortOrder = Math.trunc(Number(f.elements.sortOrder.value) || 0);
      if (t) body.isActive = f.elements.isActive.checked;
      return api(t ? '/tariffs/' + t.id : '/tariffs', { method: t ? 'PATCH' : 'POST', body: body }).then(function () {
        toast('Сохранено');
        renderTariffsPage();
      });
    });
  }

  // ------------------------------------------------------------------
  // Раздел «Настройки» (владелец)
  // ------------------------------------------------------------------
  function renderSettingsPage() {
    var page = document.querySelector('.view[data-view="settings"]');
    if (!isOwner()) {
      page.innerHTML = '<div class="page-inner"><div class="page-head"><h1>Настройки</h1></div><div class="card"><p class="muted">Настройки таксопарка, Telegram-бот и диспетчеров меняет владелец.</p></div></div>';
      return;
    }
    Promise.all([api('/tenant'), api('/bot'), api('/staff')]).then(function (r) {
      var t = r[0], bot = r[1], staff = r[2];
      state.tenant.branding = t.branding;
      state.tenant.settings = t.settings;
      var b = t.branding || {}, s = t.settings || {};
      page.innerHTML = '<div class="page-inner"><div class="page-head"><h1>Настройки</h1></div><div class="grid2">' +
        // Таксопарк
        '<div class="card"><h2>Таксопарк</h2><p class="muted">Так пассажиры видят вас в приложении.</p><form id="tenantForm">' +
        '<label>Название<input name="name" required value="' + esc(t.name) + '"></label>' +
        '<label>Название в приложении<input name="appName" value="' + esc(b.appName || '') + '" placeholder="' + esc(t.name) + '"></label>' +
        '<div class="row"><label>Фирменный цвет<input name="primaryColor" type="color" value="' + esc(b.primaryColor || '#ffc72c') + '"></label>' +
        '<label>Часовой пояс<input name="timezone" value="' + esc(s.timezone || 'Europe/Moscow') + '" placeholder="Europe/Moscow"></label></div>' +
        '<label>Центр карты по умолчанию<span class="row"><input class="input" name="center" readonly value="' + esc(Array.isArray(s.center) ? s.center.join(', ') : 'не задан') + '">' +
        '<button type="button" class="btn" id="centerFromMap" style="flex:0 0 auto;margin-top:5px">Взять с карты</button></span></label>' +
        '<p class="form-error" hidden></p><button type="submit" class="btn primary">Сохранить</button></form></div>' +
        // Бот
        '<div class="card"><h2>Telegram-бот</h2>' + (bot.connected
          ? '<p>Подключён: <a href="' + esc(bot.botUrl) + '" target="_blank" rel="noopener">@' + esc(bot.botUsername) + '</a></p>' +
            '<p class="muted">Пассажиры заказывают такси через этого бота, водители открывают в нём своё приложение (кнопка «Я водитель» или команда /driver).</p>' +
            '<button type="button" class="btn danger" id="botDisconnect">Отключить бота</button>'
          : '<p class="muted">Создайте бота в @BotFather (команда /newbot) и вставьте его токен. Мы сами настроим кнопку «Такси» и приём сообщений.</p>' +
            '<form id="botForm"><label>Токен бота<input name="botToken" required autocomplete="off" placeholder="123456789:AA..."></label>' +
            '<p class="form-error" hidden></p><button type="submit" class="btn primary">Подключить</button></form>') +
        '</div>' +
        // Диспетчеры
        '<div class="card"><h2>Сотрудники</h2><table class="data" style="margin:10px 0 14px"><tbody>' + staff.map(function (u) {
          return '<tr class="' + (u.isActive ? '' : 'off') + '"><td><b>' + esc(u.name || u.login) + '</b><div class="muted">' + esc(u.login) + '</div></td>' +
            '<td>' + (u.role === 'owner' ? 'Владелец' : 'Диспетчер') + '</td><td>' +
            '<button type="button" class="btn small" data-pass-staff="' + u.id + '">Сменить пароль</button> ' +
            (u.role === 'owner' ? '' : '<button type="button" class="btn small" data-toggle-staff="' + u.id + '" data-active="' + u.isActive + '">' + (u.isActive ? 'Отключить' : 'Включить') + '</button>') +
            '</td></tr>';
        }).join('') + '</tbody></table><button type="button" class="btn" id="addStaff">Добавить диспетчера</button></div>' +
        '</div></div>';

      $('tenantForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target, err = f.querySelector('.form-error');
        err.hidden = true;
        var body = { name: val(f, 'name'), appName: f.elements.appName.value.trim(), primaryColor: f.elements.primaryColor.value, timezone: val(f, 'timezone') };
        var c = f.elements.center.value.split(',').map(Number);
        if (c.length === 2 && c.every(isFinite)) body.center = c;
        api('/tenant', { method: 'PATCH', body: body }).then(function (nt) {
          state.tenant.name = nt.name; state.tenant.branding = nt.branding; state.tenant.settings = nt.settings;
          $('tenantName').textContent = nt.name;
          applyBranding();
          toast('Сохранено');
        }).catch(function (x) { err.textContent = x.message; err.hidden = false; });
      });
      $('centerFromMap').addEventListener('click', function () {
        var c = map.getCenter();
        document.querySelector('#tenantForm [name=center]').value = c.lat.toFixed(5) + ', ' + c.lng.toFixed(5);
      });
      if (bot.connected) {
        $('botDisconnect').addEventListener('click', function () {
          if (!window.confirm('Отключить бота? Пассажиры не смогут заказывать такси через Telegram.')) return;
          api('/bot', { method: 'DELETE' }).then(function () { toast('Бот отключён'); renderSettingsPage(); }).catch(function (x) { toast(x.message); });
        });
      } else {
        $('botForm').addEventListener('submit', function (e) {
          e.preventDefault();
          var f = e.target, err = f.querySelector('.form-error'), btn = f.querySelector('button');
          err.hidden = true; btn.disabled = true;
          api('/bot', { method: 'PUT', body: { botToken: f.elements.botToken.value.trim() } }).then(function (r2) {
            toast('Бот @' + r2.botUsername + ' подключён');
            renderSettingsPage();
          }).catch(function (x) { btn.disabled = false; err.textContent = x.message; err.hidden = false; });
        });
      }
      $('addStaff').addEventListener('click', staffForm);
      Array.prototype.forEach.call(page.querySelectorAll('[data-pass-staff]'), function (b) {
        b.addEventListener('click', function () { passwordForm(staff.filter(function (u) { return u.id === b.dataset.passStaff; })[0]); });
      });
      Array.prototype.forEach.call(page.querySelectorAll('[data-toggle-staff]'), function (b) {
        b.addEventListener('click', function () {
          api('/staff/' + b.dataset.toggleStaff, { method: 'PATCH', body: { isActive: b.dataset.active !== 'true' } })
            .then(renderSettingsPage).catch(function (x) { toast(x.message); });
        });
      });
    }).catch(function (e) { toast(e.message); });
  }

  function passwordForm(u) {
    var html = '<form><h2>Новый пароль: ' + esc(u.name || u.login) + '</h2>' +
      '<label>Пароль (не короче 8 символов)<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>' +
      '<p class="form-error" hidden></p><div class="modal-actions"><button type="button" class="btn" data-cancel-modal>Отмена</button>' +
      '<button type="submit" class="btn primary">Сохранить</button></div></form>';
    openModal(html, function (f) {
      return api('/staff/' + u.id, { method: 'PATCH', body: { password: f.elements.password.value } })
        .then(function () { toast('Пароль изменён'); });
    });
  }

  function staffForm() {
    var html = '<form><h2>Новый диспетчер</h2>' +
      '<label>Имя<input name="name"></label>' +
      '<div class="row"><label>Логин<input name="login" required minlength="3" autocomplete="off"></label>' +
      '<label>Пароль<input name="password" required minlength="8" autocomplete="new-password"></label></div>' +
      '<p class="muted" style="margin-top:-4px">Передайте логин и пароль диспетчеру. Вход: эта же страница.</p>' +
      '<p class="form-error" hidden></p><div class="modal-actions"><button type="button" class="btn" data-cancel-modal>Отмена</button>' +
      '<button type="submit" class="btn primary">Добавить</button></div></form>';
    openModal(html, function (f) {
      return api('/staff', { method: 'POST', body: { name: val(f, 'name'), login: val(f, 'login'), password: f.elements.password.value } })
        .then(function () { toast('Диспетчер добавлен'); renderSettingsPage(); });
    });
  }

  // ------------------------------------------------------------------
  state.token = load(TOKEN_KEY);
  if (typeof window.L === 'undefined') {
    document.body.innerHTML = '<p style="padding:24px">Не загрузилась карта. Проверьте интернет и обновите страницу.</p>';
  } else if (state.token) boot();
  else showLogin();
})();
