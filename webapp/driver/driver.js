/*
 * Mini App водителя.
 * Открытие:
 *   из Telegram:  бот таксопарка → «Я водитель» или /driver  →  /app/driver/?t=<slug>
 *   в браузере:   /app/driver/?t=demo&dev=1001   (тестовый вход, только при DEV_AUTH=true)
 *
 * Пока приложение открыто и водитель на линии, координаты уходят на сервер каждые 5 секунд.
 * Если приложение свернуть, Telegram перестаёт его выполнять — поэтому о новом заказе
 * бот дополнительно пишет в чат.
 */
(function () {
  'use strict';

  var API = (window.TAXI_API || '') + '/api';
  var TILE_URL = window.TAXI_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var DEFAULT_CENTER = [55.7558, 37.6173];
  var LOCATION_EVERY_MS = 5000;
  var POLL_MS = 3000;

  var tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null;
  var params = new URLSearchParams(location.search);
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    sheet: $('sheet'), offer: $('offer'), statusbar: $('statusbar'), screen: $('screen'), toast: $('toast'),
    locate: $('locate'), navPicker: $('navPicker'), navLinks: $('navLinks'),
  };

  var state = {
    tenant: null,
    token: null,
    driver: null,       // профиль, в т.ч. status: offline | online | busy
    stats: null,
    order: null,        // текущий принятый заказ
    offer: null,        // { order, expiresAt, distanceToPickupM }
    finished: null,     // только что завершённый заказ — экран «получите оплату»
    myLoc: null,
    busy: false,
    online: true,       // есть ли связь с сервером
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
    if (n == null) return '';
    var cur = state.tenant ? state.tenant.currency : 'RUB';
    return (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (CURRENCY[cur] || cur);
  }
  function km(m) {
    if (m == null) return '';
    return m < 1000 ? Math.round(m) + ' м' : (Math.round(m / 100) / 10).toLocaleString('ru-RU') + ' км';
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function distanceM(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var x = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lng - a.lng) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  var toastTimer;
  function toast(text) {
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 4000);
  }
  function haptic(kind) {
    try {
      if (tg && tg.HapticFeedback) {
        if (kind === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
        else tg.HapticFeedback.notificationOccurred(kind);
      } else if (navigator.vibrate && kind === 'heavy') navigator.vibrate([200, 100, 200]);
    } catch (e) { /* нет вибрации */ }
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return fetch(API + path, {
      method: opts.method || 'GET', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      setOnline(true);
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = data && data.message;
          if (Array.isArray(msg)) msg = msg[0];
          var err = new Error(msg || 'Ошибка сервера (' + res.status + ')');
          err.status = res.status;
          throw err;
        }
        return data;
      });
    }, function () {
      setOnline(false);
      throw new Error('Нет связи с сервером');
    });
  }

  function confirmAsk(question) {
    return new Promise(function (resolve) {
      if (tg && tg.showConfirm) tg.showConfirm(question, resolve);
      else resolve(window.confirm(question));
    });
  }

  // ------------------------------------------------------------------
  // Звук нового заказа (генерируется, файл не нужен)
  // ------------------------------------------------------------------
  var audio = null;
  function unlockAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) { audio = null; }
  }
  function chime() {
    if (!audio) return;
    try {
      var t = audio.currentTime;
      [880, 1175, 1568].forEach(function (f, i) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + i * 0.14);
        g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.14 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.32);
        o.connect(g); g.connect(audio.destination);
        o.start(t + i * 0.14); o.stop(t + i * 0.14 + 0.35);
      });
    } catch (e) { /* без звука */ }
  }

  // Экран не гаснет, пока водитель на линии (где поддерживается)
  var wakeLock = null;
  function keepAwake(on) {
    if (!('wakeLock' in navigator)) return;
    if (on && !wakeLock) {
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* не дали — не страшно */ });
    } else if (!on && wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }

  // ------------------------------------------------------------------
  // Тема
  // ------------------------------------------------------------------
  function contrastText(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#16181c';
    var n = parseInt(m[1], 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.6 ? '#16181c' : '#ffffff';
  }
  function applyTheme() {
    var root = document.documentElement;
    if (tg) {
      root.classList.add('tg');
      root.classList.toggle('dark', tg.colorScheme === 'dark');
      try { tg.setHeaderColor('bg_color'); tg.setBackgroundColor('bg_color'); } catch (e) { /* старый клиент */ }
    } else if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) root.classList.add('dark');
  }
  function applyBranding(t) {
    var b = t.branding || {};
    if (b.primaryColor && /^#[0-9a-f]{6}$/i.test(b.primaryColor)) {
      document.documentElement.style.setProperty('--brand', b.primaryColor);
      document.documentElement.style.setProperty('--on-brand', contrastText(b.primaryColor));
    }
    document.title = (b.appName || t.name) + ' — водитель';
  }

  // ------------------------------------------------------------------
  // Карта
  // ------------------------------------------------------------------
  var map, mk = { me: null, a: null, b: null }, followMe = true;
  function initMap(center) {
    map = L.map('map', { zoomControl: false }).setView(center, 15);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.on('dragstart', function () { followMe = false; });
  }
  function icon(html, size) {
    return L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }
  function setMe(loc) {
    if (!map || !loc) return;
    if (mk.me) mk.me.setLatLng([loc.lat, loc.lng]);
    else mk.me = L.marker([loc.lat, loc.lng], { icon: icon('<div class="mk-me"></div>', 22), interactive: false }).addTo(map);
    if (followMe && !state.order) map.setView([loc.lat, loc.lng], map.getZoom ? map.getZoom() : 15);
  }
  function setPoint(key, p) {
    if (mk[key]) { map.removeLayer(mk[key]); mk[key] = null; }
    if (!p) return;
    mk[key] = L.marker([p.lat, p.lng], { icon: icon('<div class="mk-point ' + key + '">' + key.toUpperCase() + '</div>', 26), interactive: false }).addTo(map);
  }
  function fitTo(points) {
    var pts = points.filter(Boolean).map(function (p) { return [p.lat, p.lng]; });
    if (pts.length === 1) map.setView(pts[0], 16);
    else if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50], maxZoom: 16 });
  }
  function syncSheetHeight() {
    var h = els.sheet.offsetHeight;
    document.documentElement.style.setProperty('--map-bottom', Math.max(0, h - 18) + 'px');
    if (map) setTimeout(function () { map.invalidateSize({ pan: false }); }, 30);
  }

  // ------------------------------------------------------------------
  // Геопозиция: следим, пока на линии; отправляем раз в 5 секунд
  // ------------------------------------------------------------------
  var watchId = null, sendTimer = null, lastSentAt = 0, locDenied = false;

  function startLocation() {
    if (watchId !== null || sendTimer) return;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(function (p) {
        locDenied = false;
        state.myLoc = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMe(state.myLoc);
        if (Date.now() - lastSentAt > LOCATION_EVERY_MS) sendLocation();
        renderStatusbar();
      }, function (err) {
        if (err.code === 1) { locDenied = true; renderStatusbar(); }
      }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 });
    }
    // регулярная отправка, даже если машина стоит и watchPosition молчит
    sendTimer = setInterval(function () {
      if (state.myLoc && Date.now() - lastSentAt >= LOCATION_EVERY_MS - 200) sendLocation();
    }, LOCATION_EVERY_MS);
  }
  function stopLocation() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearInterval(sendTimer);
    sendTimer = null;
  }
  function sendLocation() {
    if (!state.myLoc || !state.driver || state.driver.status === 'offline') return;
    lastSentAt = Date.now();
    var body = { lat: state.myLoc.lat, lng: state.myLoc.lng };
    if (socket && socket.connected) socket.emit('driver:location', body);
    else api('/driver/location', { method: 'POST', body: body }).catch(function () { /* следующая попытка через 5 сек */ });
  }
  function getLocationOnce() {
    return new Promise(function (resolve) {
      if (state.myLoc) return resolve(state.myLoc);
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        function (p) { state.myLoc = { lat: p.coords.latitude, lng: p.coords.longitude }; resolve(state.myLoc); },
        function (err) { if (err.code === 1) locDenied = true; resolve(null); },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 },
      );
    });
  }

  // ------------------------------------------------------------------
  // Связь с сервером: сокеты, а если их нет — опрос
  // ------------------------------------------------------------------
  var socket = null, pollTimer = null;

  function connect() {
    loadScript((window.TAXI_API || '') + '/socket.io/socket.io.js').then(function () {
      if (typeof window.io !== 'function' || socket) return;
      socket = window.io(window.TAXI_API || undefined, { auth: { token: state.token } });
      socket.on('connect', function () { setOnline(true); refresh(); });
      socket.on('disconnect', function () { renderStatusbar(); });
      socket.on('order:offer', function (o) { showOffer(o); });
      socket.on('order:offer_cancelled', function (d) {
        if (state.offer && state.offer.order.id === d.orderId) {
          hideOffer();
          toast(d.reason === 'timeout' ? 'Время вышло — заказ ушёл другому водителю' : 'Заказ отменён');
        }
      });
      socket.on('order:updated', onOrderUpdated);
      socket.on('driver:status', function (d) {
        if (state.driver && state.driver.status !== d.status) { state.driver.status = d.status; render(); }
      });
    }).catch(function () { /* работаем на опросе */ });

    pollTimer = setInterval(function () {
      if (!socket || !socket.connected) refresh();
    }, POLL_MS);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function setOnline(v) {
    if (state.online !== v) { state.online = v; renderStatusbar(); }
  }

  /** Полное обновление состояния с сервера */
  function refresh() {
    return Promise.all([api('/driver/me'), api('/orders/current')]).then(function (r) {
      state.driver = r[0];
      var cur = r[1];
      if (cur.order) {
        state.order = cur.order;
      } else if (state.order && ['assigned', 'arrived', 'in_progress'].indexOf(state.order.status) >= 0) {
        // заказ пропал из активных — узнаём, чем закончился
        return api('/orders/' + state.order.id).then(onOrderUpdated).catch(function () { state.order = null; render(); });
      }
      if (cur.offer && (!state.offer || state.offer.order.id !== cur.offer.order.id)) {
        showOffer({ order: cur.offer.order, expiresAt: cur.offer.expiresAt, distanceToPickupM: null });
      } else if (!cur.offer && state.offer) {
        hideOffer();
      }
      render();
    }).catch(function () { /* следующий опрос */ });
  }

  function onOrderUpdated(o) {
    if (state.offer && state.offer.order.id === o.id && o.status !== 'searching') hideOffer();
    var mine = o.driver && state.driver && o.driver.id === state.driver.id;
    if (o.status === 'completed' && state.order && state.order.id === o.id) {
      state.finished = o;
      state.order = null;
      loadStats();
    } else if (o.status === 'cancelled' && state.order && state.order.id === o.id) {
      state.order = null;
      haptic('warning');
      toast(o.cancelledBy === 'passenger' ? 'Пассажир отменил заказ' : 'Диспетчер отменил заказ' + (o.cancelReason ? ': ' + o.cancelReason : ''));
    } else if (mine && ['assigned', 'arrived', 'in_progress'].indexOf(o.status) >= 0) {
      if (!state.order || state.order.id !== o.id) { haptic('success'); followMe = false; }
      state.order = o;
    }
    render();
  }

  function loadStats() {
    return api('/driver/stats').then(function (s) { state.stats = s; render(); }).catch(function () {});
  }

  // ------------------------------------------------------------------
  // Предложение заказа
  // ------------------------------------------------------------------
  var offerTick = null, chimeTimer = null;

  function showOffer(o) {
    if (state.order) return; // уже везём — сервер такого не пришлёт, но на всякий случай
    var isNew = !state.offer || state.offer.order.id !== o.order.id;
    state.offer = {
      order: o.order,
      expiresAt: new Date(o.expiresAt).getTime(),
      distanceToPickupM: o.distanceToPickupM != null ? o.distanceToPickupM
        : (state.myLoc ? Math.round(distanceM(state.myLoc, o.order.pickup)) : null),
    };
    renderOffer();
    if (isNew) {
      haptic('heavy');
      chime();
      clearInterval(chimeTimer);
      chimeTimer = setInterval(chime, 3000);
    }
    clearInterval(offerTick);
    offerTick = setInterval(tickOffer, 100);
    tickOffer();
  }

  function hideOffer() {
    state.offer = null;
    clearInterval(offerTick);
    clearInterval(chimeTimer);
    els.offer.hidden = true;
    els.offer.innerHTML = '';
  }

  function tickOffer() {
    if (!state.offer) return;
    var o = state.offer;
    var left = Math.max(0, o.expiresAt - Date.now());
    var total = o.total || (o.total = Math.max(left, 1000));
    var bar = els.offer.querySelector('.offer-timer i');
    var secs = els.offer.querySelector('.offer-secs');
    if (bar) bar.style.transform = 'scaleX(' + (left / total).toFixed(3) + ')';
    if (secs) secs.textContent = Math.ceil(left / 1000) + ' с';
    if (left <= 0) {
      hideOffer();
      toast('Время вышло — заказ ушёл другому водителю');
    }
  }

  function renderOffer() {
    var o = state.offer.order;
    var pickupSub = state.offer.distanceToPickupM != null ? '<b>' + km(state.offer.distanceToPickupM) + ' от вас</b>' : '';
    var drop = o.dropoff
      ? '<li><div class="route-row"><span class="route-dot b"></span><span class="route-text"><span class="route-title">' +
        esc(o.dropoff.address || 'Точка на карте') + '</span>' +
        (o.distanceM ? '<span class="route-sub">Поездка ' + km(o.distanceM) + '</span>' : '') + '</span></div></li>'
      : '<li><div class="route-row"><span class="route-dot b"></span><span class="route-text"><span class="route-title empty">Куда скажет пассажир</span></span></div></li>';
    els.offer.innerHTML =
      '<div class="offer-card">' +
        '<div class="offer-timer"><i></i></div>' +
        '<div class="offer-top"><p class="offer-price" id="offerPrice">' + money(o.estimatedPrice) + '</p><span class="offer-secs"></span></div>' +
        '<p class="offer-tariff">' + esc(o.tariff.name) + (o.source === 'dispatcher' ? ', заказ от диспетчера' : '') + '</p>' +
        '<ul class="route"><li><div class="route-row"><span class="route-dot a"></span><span class="route-text"><span class="route-title">' +
          esc(o.pickup.address || 'Точка на карте') + '</span><span class="route-sub">' + pickupSub + '</span></span></div></li>' + drop + '</ul>' +
        (o.comment ? '<div class="note">' + esc(o.comment) + '</div>' : '') +
        '<div class="offer-actions">' +
          '<button type="button" class="btn secondary decline" id="declineBtn">Пропустить</button>' +
          '<button type="button" class="btn ok accept" id="acceptBtn">Принять</button>' +
        '</div>' +
      '</div>';
    els.offer.hidden = false;
    $('acceptBtn').addEventListener('click', acceptOffer);
    $('declineBtn').addEventListener('click', declineOffer);
  }

  function acceptOffer() {
    if (!state.offer || state.busy) return;
    var id = state.offer.order.id;
    state.busy = true;
    $('acceptBtn').disabled = true;
    api('/orders/' + id + '/accept', { method: 'POST', body: {} }).then(function (o) {
      state.busy = false;
      hideOffer();
      haptic('success');
      followMe = false;
      state.order = o;
      render();
      fitTo([state.myLoc, o.pickup]);
    }).catch(function (e) {
      state.busy = false;
      hideOffer();
      toast(e.message);
      refresh();
    });
  }

  function declineOffer() {
    if (!state.offer) return;
    var id = state.offer.order.id;
    hideOffer();
    api('/orders/' + id + '/decline', { method: 'POST', body: {} }).catch(function () { /* уже неактуально */ });
  }

  // ------------------------------------------------------------------
  // Действия
  // ------------------------------------------------------------------
  function goOnline() {
    unlockAudio(); // браузер разрешает звук только после нажатия
    if (state.busy) return;
    state.busy = true;
    render();
    getLocationOnce().then(function (loc) {
      return api('/driver/shift/start', { method: 'POST', body: loc ? { location: loc } : {} });
    }).then(function (d) {
      state.busy = false;
      state.driver = d;
      haptic('success');
      if (!state.myLoc) toast('Разрешите доступ к геопозиции — без неё заказы не приходят');
      afterStatusChange();
    }).catch(function (e) {
      state.busy = false;
      toast(e.message);
      render();
    });
  }

  function goOffline() {
    confirmAsk('Уйти с линии? Новые заказы перестанут приходить.').then(function (ok) {
      if (!ok) return;
      api('/driver/shift/end', { method: 'POST', body: {} }).then(function (d) {
        state.driver = d;
        hideOffer();
        afterStatusChange();
      }).catch(function (e) { toast(e.message); });
    });
  }

  function afterStatusChange() {
    var on = state.driver && state.driver.status !== 'offline';
    if (on) { startLocation(); keepAwake(true); } else { stopLocation(); keepAwake(false); }
    render();
  }

  function orderAction(action, confirmText) {
    if (!state.order || state.busy) return;
    var go = function () {
      state.busy = true;
      render();
      api('/orders/' + state.order.id + '/' + action, { method: 'POST', body: {} }).then(function (o) {
        state.busy = false;
        haptic('success');
        if (action === 'complete') {
          state.finished = o;
          state.order = null;
          loadStats();
        } else state.order = o;
        render();
      }).catch(function (e) {
        state.busy = false;
        toast(e.message);
        refresh();
      });
    };
    if (confirmText) confirmAsk(confirmText).then(function (ok) { if (ok) go(); });
    else go();
  }

  function refuseOrder() {
    if (!state.order) return;
    confirmAsk('Отказаться от заказа? Пассажиру найдут другую машину.').then(function (ok) {
      if (!ok) return;
      api('/orders/' + state.order.id + '/cancel', { method: 'POST', body: { reason: 'Водитель отказался' } }).then(function () {
        state.order = null;
        refresh();
      }).catch(function (e) { toast(e.message); });
    });
  }

  function openNavigator(p) {
    var lat = p.lat, lng = p.lng;
    var links = [
      ['Яндекс Карты', 'https://yandex.ru/maps/?rtext=~' + lat + ',' + lng + '&rtt=auto'],
      ['2ГИС', 'https://2gis.ru/routeSearch/rsType/car/to/' + lng + ',' + lat],
      ['Google Maps', 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=driving'],
    ];
    els.navLinks.innerHTML = links.map(function (l) {
      return '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener">' + esc(l[0]) + '</a>';
    }).join('');
    Array.prototype.forEach.call(els.navLinks.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function (ev) {
        if (tg && tg.openLink) { ev.preventDefault(); tg.openLink(a.href); }
        els.navPicker.hidden = true;
      });
    });
    els.navPicker.hidden = false;
  }

  // ------------------------------------------------------------------
  // Отрисовка
  // ------------------------------------------------------------------
  function renderStatusbar() {
    var d = state.driver;
    var bar = els.statusbar;
    if (!d || d.status === 'offline') { bar.hidden = true; return; }
    var cls = '', text;
    if (!state.online) { cls = 'warn'; text = 'Нет связи с сервером'; }
    else if (locDenied) { cls = 'warn'; text = 'Нет доступа к геопозиции'; }
    else if (d.status === 'busy' || state.order) { cls = 'busy'; text = 'На заказе'; }
    else text = 'На линии';
    bar.className = 'statusbar ' + cls;
    bar.innerHTML = '<span class="dot"></span><span>' + esc(text) + '</span>';
    bar.hidden = false;
  }

  function carHtml() {
    var d = state.driver;
    var car = [d.carColor, d.carModel].filter(Boolean).join(' ');
    return '<div class="driver driver-head">' +
      (d.carPlate ? '<span class="plate">' + esc(d.carPlate) + '</span>' : '') +
      '<div class="driver-info"><div class="driver-car">' + esc(d.name) + '</div>' +
      '<div class="driver-name">' + esc(car || 'Автомобиль не указан') + '</div></div></div>';
  }

  function todayHtml() {
    var t = state.stats && state.stats.today;
    if (!t) return '';
    return '<div class="today"><div><b>' + t.trips + '</b><span>' + plural(t.trips, 'поездка', 'поездки', 'поездок') + ' сегодня</span></div>' +
      '<div><b>' + money(t.earned) + '</b><span>заработано</span></div></div>';
  }

  function render() {
    var d = state.driver;
    if (!d) return;
    var html;
    if (state.finished) html = renderFinished();
    else if (state.order) html = renderOrder();
    else if (d.status === 'offline') html = renderOffline();
    else html = renderWaiting();
    els.sheet.innerHTML = html;
    bind();
    renderStatusbar();
    syncSheetHeight();
    if (!state.order) { setPoint('a', null); setPoint('b', null); }
  }

  function renderOffline() {
    return carHtml() + todayHtml() +
      '<button type="button" class="btn go" id="onlineBtn"' + (state.busy ? ' disabled' : '') + '>' +
      (state.busy ? 'Выходим на линию…' : 'Выйти на линию') + '</button>';
  }

  function renderWaiting() {
    return '<div class="waiting"><span class="radar" aria-hidden="true"></span><h1>Ждём заказ</h1></div>' +
      '<p class="sub">Держите приложение открытым — так заказы приходят быстрее.</p>' +
      todayHtml() +
      '<button type="button" class="btn secondary" id="offlineBtn">Уйти с линии</button>';
  }

  function renderOrder() {
    var o = state.order;
    setPoint('a', o.pickup);
    setPoint('b', o.dropoff);
    var phone = o.passenger && o.passenger.phone;
    var call = phone ? '<a class="btn secondary" href="tel:' + esc(phone) + '">Позвонить</a>' : '';
    var name = o.passenger && o.passenger.name ? esc(o.passenger.name) : 'Пассажир';
    var comment = o.comment ? '<div class="note">' + esc(o.comment) + '</div>' : '';
    var price = '<div class="order-price"><span>' + esc(o.tariff.name) + (o.distanceM ? ', ' + km(o.distanceM) : '') + '</span><b>' + money(o.estimatedPrice) + '</b></div>';
    var refuse = '<button type="button" class="btn danger" id="refuseBtn">Отказаться от заказа</button>';
    var busy = state.busy ? ' disabled' : '';

    if (o.status === 'assigned') {
      var dist = state.myLoc ? ', ' + km(Math.round(distanceM(state.myLoc, o.pickup) * 1.35)) : '';
      return '<p class="stage">Едем к пассажиру' + dist + '</p>' +
        '<p class="target">' + esc(o.pickup.address || 'Точка на карте') + '</p>' +
        '<p class="target-sub">' + name + '</p>' + comment +
        '<div class="actions"><button type="button" class="btn secondary" id="navBtn">Навигатор</button>' + call + '</div>' +
        '<button type="button" class="btn go" id="arrivedBtn"' + busy + '>Я на месте</button>' + refuse;
    }
    if (o.status === 'arrived') {
      return '<p class="stage">Ждём пассажира</p>' +
        '<p class="target">' + esc(o.pickup.address || 'Точка на карте') + '</p>' +
        '<p class="target-sub">' + name + ' получил уведомление, что вы на месте</p>' + comment +
        (call ? '<div class="actions">' + call + '</div>' : '') +
        '<button type="button" class="btn go" id="startBtn"' + busy + '>Пассажир сел, начать поездку</button>' + refuse;
    }
    // in_progress
    return '<p class="stage">Везём пассажира</p>' +
      '<p class="target">' + esc(o.dropoff ? (o.dropoff.address || 'Точка на карте') : 'Куда скажет пассажир') + '</p>' +
      price +
      (o.dropoff ? '<div class="actions"><button type="button" class="btn secondary" id="navBtn">Навигатор</button></div>' : '') +
      '<button type="button" class="btn go ok" id="completeBtn"' + busy + '>Завершить поездку</button>';
  }

  function renderFinished() {
    var o = state.finished;
    return '<p class="stage">Поездка завершена</p>' +
      '<p class="total">' + money(o.finalPrice != null ? o.finalPrice : o.estimatedPrice) + '</p>' +
      '<p class="sub">Получите оплату с пассажира</p>' +
      todayHtml() +
      '<button type="button" class="btn go" id="doneBtn">Готово, жду следующий заказ</button>';
  }

  function bind() {
    var on = function (id, fn) { var el = $(id); if (el) el.addEventListener('click', fn); };
    on('onlineBtn', goOnline);
    on('offlineBtn', goOffline);
    on('arrivedBtn', function () { orderAction('arrived'); });
    on('startBtn', function () { orderAction('start'); });
    on('completeBtn', function () { orderAction('complete', 'Завершить поездку? Пассажир получит итог с ценой.'); });
    on('refuseBtn', refuseOrder);
    on('navBtn', function () {
      var o = state.order;
      openNavigator(o.status === 'in_progress' && o.dropoff ? o.dropoff : o.pickup);
    });
    on('doneBtn', function () {
      state.finished = null;
      followMe = true;
      if (state.myLoc) map.setView([state.myLoc.lat, state.myLoc.lng], 15);
      render();
    });
  }

  // ------------------------------------------------------------------
  // Запуск
  // ------------------------------------------------------------------
  function fatal(title, text) {
    els.screen.innerHTML = '<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' +
      '<button type="button" class="btn secondary" onclick="location.reload()">Обновить</button>';
    els.screen.hidden = false;
  }

  function login(slug) {
    if (tg) return api('/auth/telegram', { method: 'POST', body: { tenantSlug: slug, initData: tg.initData, role: 'driver' } });
    var devId = Number(params.get('dev'));
    if (devId > 0) return api('/auth/dev/token', { method: 'POST', body: { tenantSlug: slug, role: 'driver', telegramId: devId } });
    return Promise.reject(new Error('Откройте приложение водителя через Telegram-бот таксопарка.'));
  }

  function start() {
    applyTheme();
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.disableVerticalSwipes(); tg.enableClosingConfirmation(); } catch (e) { /* старый клиент */ }
    }
    els.screen.innerHTML = '<div class="spinner" aria-label="Загрузка"></div>';
    els.screen.hidden = false;

    if (typeof window.L === 'undefined') return fatal('Не загрузилась карта', 'Проверьте интернет и откройте приложение ещё раз.');
    var slug = params.get('t') || (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param);
    if (!slug) return fatal('Таксопарк не указан', 'Откройте приложение через Telegram-бот таксопарка.');

    api('/tenants/' + encodeURIComponent(slug)).then(function (t) {
      state.tenant = t;
      applyBranding(t);
      return login(slug);
    }).then(function (auth) {
      state.token = auth.token;
      state.driver = auth.driver;
      initMap(Array.isArray(state.tenant.center) ? state.tenant.center : DEFAULT_CENTER);
      els.screen.hidden = true;
      connect();
      return Promise.all([refresh(), loadStats()]);
    }).then(function () {
      if (state.driver.status !== 'offline') afterStatusChange();
      else getLocationOnce().then(function (l) { if (l) setMe(l); });
      if (state.order) fitTo([state.myLoc, state.order.pickup, state.order.dropoff]);
    }).catch(function (e) {
      if (e.status === 404 && !state.tenant) fatal('Таксопарк не найден', 'Проверьте ссылку или откройте приложение через бот.');
      else fatal('Не удалось войти', e.message);
    });

    els.locate.addEventListener('click', function () {
      followMe = true;
      if (state.myLoc) map.setView([state.myLoc.lat, state.myLoc.lng], 16);
      else getLocationOnce().then(function (l) { if (l) { setMe(l); map.setView([l.lat, l.lng], 16); } else toast('Разрешите доступ к геопозиции'); });
    });
    $('navClose').addEventListener('click', function () { els.navPicker.hidden = true; });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || !state.token) return;
      refresh();
      if (state.driver && state.driver.status !== 'offline') keepAwake(true);
    });
  }

  start();
})();
