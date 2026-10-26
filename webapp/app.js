/*
 * Mini App пассажира — заказ такси внутри Telegram.
 * Без сборки и фреймворков: файл отдаётся сервером как есть (PUBLIC_URL/app/).
 *
 * Открытие:
 *   из Telegram:   бот таксопарка открывает  /app/?t=<slug таксопарка>
 *   в браузере:    /app/?t=demo&dev=7001   (тестовый вход, только при DEV_AUTH=true)
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Настройки
  // ------------------------------------------------------------------
  var API = (window.TAXI_API || '') + '/api';
  var TILE_URL = window.TAXI_TILES || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  var TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
  var DEFAULT_CENTER = [55.7558, 37.6173];
  var POLL_MS = 4000;
  var CITY_SPEED_KMH = 25;

  var tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData ? window.Telegram.WebApp : null;
  var params = new URLSearchParams(location.search);

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    sheet: $('sheet'), pin: $('pin'), locate: $('locate'), screen: $('screen'), toast: $('toast'),
    search: $('search'), searchInput: $('searchInput'), searchResults: $('searchResults'),
    searchBack: $('searchBack'), searchOnMap: $('searchOnMap'),
  };

  // ------------------------------------------------------------------
  // Состояние
  // ------------------------------------------------------------------
  var state = {
    tenant: null,
    token: null,
    me: null,
    mode: 'pickup',        // pickup | dropoff-map | confirm | order
    pickup: null,          // {lat, lng, title, subtitle}
    dropoff: null,
    estimate: null,
    tariffId: null,
    comment: '',
    order: null,
    busy: false,
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
    var s = (Math.round(n * 100) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
    var cur = state.tenant ? state.tenant.currency : 'RUB';
    return s + ' ' + (CURRENCY[cur] || cur);
  }

  function minutes(sec) {
    var m = Math.max(1, Math.round(sec / 60));
    return m + ' мин';
  }

  function km(m) {
    return m < 1000 ? m + ' м' : (Math.round(m / 100) / 10).toLocaleString('ru-RU') + ' км';
  }

  function distanceM(a, b) {
    var R = 6371000, toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  var toastTimer;
  function toast(text) {
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.hidden = true; }, 3500);
  }

  function haptic(kind) {
    try {
      if (!tg || !tg.HapticFeedback) return;
      if (kind === 'select') tg.HapticFeedback.selectionChanged();
      else tg.HapticFeedback.notificationOccurred(kind);
    } catch (e) { /* старый клиент Telegram */ }
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
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
      throw new Error('Нет связи с сервером. Проверьте интернет.');
    });
  }

  function showScreen(html) {
    els.screen.innerHTML = html;
    els.screen.hidden = false;
  }
  function hideScreen() { els.screen.hidden = true; }

  // ------------------------------------------------------------------
  // Тема и брендинг
  // ------------------------------------------------------------------
  function contrastText(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#16181c';
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.6 ? '#16181c' : '#ffffff';
  }

  function applyBranding(tenant) {
    var b = tenant.branding || {};
    var root = document.documentElement;
    if (b.primaryColor && /^#[0-9a-f]{6}$/i.test(b.primaryColor)) {
      root.style.setProperty('--brand', b.primaryColor);
      root.style.setProperty('--on-brand', contrastText(b.primaryColor));
    }
    document.title = b.appName || tenant.name;
  }

  function applyTelegramTheme() {
    if (!tg) {
      if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.classList.add('dark');
      return;
    }
    document.documentElement.classList.add('tg');
    document.documentElement.classList.toggle('dark', tg.colorScheme === 'dark');
    try {
      tg.setHeaderColor('bg_color');
      tg.setBackgroundColor('bg_color');
    } catch (e) { /* старый клиент */ }
  }

  // ------------------------------------------------------------------
  // Карта
  // ------------------------------------------------------------------
  var map, markers = { a: null, b: null, car: null }, routeLine = null;
  var CAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.9 6c-.2-.6-.8-1-1.4-1H6.5c-.7 0-1.2.4-1.4 1L3 12v8c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-1h12v1c0 .6.4 1 1 1h1c.6 0 1-.4 1-1v-8l-2.1-6ZM6.5 16a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm11 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3ZM5 11l1.5-4.5h11L19 11H5Z"/></svg>';

  function initMap(center) {
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView(center, 16);
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: TILE_ATTRIBUTION }).addTo(map);
    map.on('movestart', function () { els.pin.classList.add('lifted'); });
    map.on('moveend', function () {
      els.pin.classList.remove('lifted');
      onMapMoved();
    });
  }

  function divIcon(html, size) {
    return L.divIcon({ html: html, className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  }

  function setPointMarker(key, place) {
    if (markers[key]) { map.removeLayer(markers[key]); markers[key] = null; }
    if (!place) return;
    var html = '<div class="mk-point ' + key + '">' + key.toUpperCase() + '</div>';
    markers[key] = L.marker([place.lat, place.lng], { icon: divIcon(html, 26), keyboard: false, interactive: false }).addTo(map);
  }

  function setCarMarker(loc) {
    if (!loc) {
      if (markers.car) { map.removeLayer(markers.car); markers.car = null; }
      return;
    }
    if (markers.car) markers.car.setLatLng([loc.lat, loc.lng]);
    else markers.car = L.marker([loc.lat, loc.lng], { icon: divIcon('<div class="mk-car">' + CAR_SVG + '</div>', 34), interactive: false }).addTo(map);
  }

  function setRouteLine(a, b) {
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (!a || !b) return;
    var color = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#16181c';
    routeLine = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color: color, weight: 3, opacity: 0.55, dashArray: '2 7' }).addTo(map);
  }

  /** Высота шторки → сколько места оставить карте */
  function syncSheetHeight() {
    var h = els.sheet.hidden ? 0 : els.sheet.offsetHeight;
    document.documentElement.style.setProperty('--map-bottom', Math.max(0, h - 18) + 'px');
    if (map) setTimeout(function () { map.invalidateSize({ pan: false }); }, 30);
  }

  function fitPoints(points) {
    var pts = points.filter(Boolean).map(function (p) { return [p.lat, p.lng]; });
    if (!pts.length) return;
    if (pts.length === 1) { map.setView(pts[0], 16); return; }
    map.fitBounds(pts, { padding: [60, 60], maxZoom: 16 });
  }

  // ------------------------------------------------------------------
  // Геолокация
  // ------------------------------------------------------------------
  function getLocation() {
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v); } };
      setTimeout(function () { finish(null); }, 8000);

      // Telegram LocationManager (Bot API 8.0+), иначе — браузерная геолокация
      var lm = tg && tg.LocationManager;
      if (lm && typeof lm.init === 'function') {
        try {
          lm.init(function () {
            if (!lm.isLocationAvailable) return browserGeo(finish);
            lm.getLocation(function (loc) {
              if (loc) finish({ lat: loc.latitude, lng: loc.longitude });
              else browserGeo(finish);
            });
          });
          return;
        } catch (e) { /* падаем на браузерную */ }
      }
      browserGeo(finish);
    });
  }

  function browserGeo(cb) {
    if (!navigator.geolocation) return cb(null);
    navigator.geolocation.getCurrentPosition(
      function (p) { cb({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      function () { cb(null); },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 },
    );
  }

  // ------------------------------------------------------------------
  // Выбор точек
  // ------------------------------------------------------------------
  var reverseSeq = 0;
  var reverseLookup = debounce(function (target, lat, lng) {
    var seq = ++reverseSeq;
    api('/geo/reverse?lat=' + lat + '&lng=' + lng).then(function (place) {
      if (seq !== reverseSeq) return;
      var p = place || { lat: lat, lng: lng, title: 'Точка на карте', subtitle: '' };
      p.lat = lat; p.lng = lng;
      state[target] = p;
      render();
    }).catch(function () {
      if (seq !== reverseSeq) return;
      state[target] = { lat: lat, lng: lng, title: 'Точка на карте', subtitle: lat.toFixed(5) + ', ' + lng.toFixed(5) };
      render();
    });
  }, 450);

  function onMapMoved() {
    if (state.mode !== 'pickup' && state.mode !== 'dropoff-map') return;
    var c = map.getCenter();
    var target = state.mode === 'pickup' ? 'pickup' : 'dropoff';
    // пока адрес ищется — показываем координаты, кнопки не блокируем
    state[target] = { lat: c.lat, lng: c.lng, title: '…', subtitle: '', pending: true };
    render();
    reverseLookup(target, c.lat, c.lng);
  }

  // ------------------------------------------------------------------
  // Поиск адреса
  // ------------------------------------------------------------------
  var searchTarget = 'dropoff';
  var searchSeq = 0;

  function openSearch(target) {
    searchTarget = target;
    els.search.hidden = false;
    els.searchInput.value = '';
    els.searchInput.placeholder = target === 'pickup' ? 'Откуда вас забрать?' : 'Куда поедем?';
    els.searchResults.innerHTML = '';
    setTimeout(function () { els.searchInput.focus(); }, 50);
    if (tg && tg.BackButton) tg.BackButton.show();
  }

  function closeSearch() {
    els.search.hidden = true;
    els.searchInput.blur();
    updateBackButton();
  }

  var runSearch = debounce(function () {
    var q = els.searchInput.value.trim();
    if (q.length < 3) { els.searchResults.innerHTML = ''; return; }
    var seq = ++searchSeq;
    var near = state.pickup || (map && { lat: map.getCenter().lat, lng: map.getCenter().lng });
    var qs = '?q=' + encodeURIComponent(q) + (near ? '&lat=' + near.lat + '&lng=' + near.lng : '');
    els.searchResults.innerHTML = '<li class="muted">Ищем…</li>';
    api('/geo/search' + qs).then(function (list) {
      if (seq !== searchSeq) return;
      if (!list.length) {
        els.searchResults.innerHTML = '<li class="muted">Ничего не нашлось. Уточните адрес или укажите точку на карте.</li>';
        return;
      }
      els.searchResults.innerHTML = list.map(function (p, i) {
        return '<li><button type="button" data-i="' + i + '"><span class="route-title">' + esc(p.title) +
          '</span><span class="route-sub">' + esc(p.subtitle) + '</span></button></li>';
      }).join('');
      Array.prototype.forEach.call(els.searchResults.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { pickPlace(list[Number(b.dataset.i)]); });
      });
    }).catch(function (e) {
      if (seq !== searchSeq) return;
      els.searchResults.innerHTML = '<li class="muted">' + esc(e.message) + '</li>';
    });
  }, 400);

  function pickPlace(place) {
    haptic('select');
    closeSearch();
    if (searchTarget === 'pickup') {
      state.pickup = place;
      state.mode = state.dropoff ? 'confirm' : 'pickup';
      if (state.mode === 'pickup') map.setView([place.lat, place.lng], 17);
    } else {
      state.dropoff = place;
      state.mode = 'confirm';
    }
    if (state.mode === 'confirm') loadEstimate();
    render();
  }

  // ------------------------------------------------------------------
  // Расчёт цены и заказ
  // ------------------------------------------------------------------
  function loadEstimate() {
    state.estimate = null;
    var body = { pickup: place(state.pickup), dropoff: place(state.dropoff) };
    api('/orders/estimate', { method: 'POST', body: body }).then(function (est) {
      state.estimate = est;
      var ids = est.options.map(function (o) { return o.tariffId; });
      if (ids.indexOf(state.tariffId) < 0) state.tariffId = ids[0] || null;
      render();
    }).catch(function (e) { toast(e.message); });
  }

  function place(p) {
    if (!p) return undefined;
    return { lat: p.lat, lng: p.lng, address: p.subtitle ? p.title + ', ' + p.subtitle : p.title };
  }

  function createOrder() {
    if (state.busy || !state.pickup || !state.dropoff) return;
    state.busy = true;
    render();
    var body = { pickup: place(state.pickup), dropoff: place(state.dropoff), tariffId: state.tariffId };
    if (state.comment.trim()) body.comment = state.comment.trim();
    api('/orders', { method: 'POST', body: body }).then(function (order) {
      haptic('success');
      state.busy = false;
      setOrder(order);
    }).catch(function (e) {
      state.busy = false;
      haptic('error');
      toast(e.message);
      if (e.status === 409) refreshCurrent();
      render();
    });
  }

  function cancelOrder() {
    if (!state.order || state.busy) return;
    var go = function () {
      state.busy = true;
      render();
      api('/orders/' + state.order.id + '/cancel', { method: 'POST', body: {} }).then(function (o) {
        state.busy = false;
        setOrder(o);
      }).catch(function (e) {
        state.busy = false;
        toast(e.message);
        refreshCurrent();
      });
    };
    var question = state.order.status === 'searching' ? 'Отменить поиск машины?' : 'Отменить заказ? Водитель уже едет к вам.';
    if (tg && tg.showConfirm) tg.showConfirm(question, function (ok) { if (ok) go(); });
    else if (window.confirm(question)) go();
  }

  function newOrder() {
    state.order = null;
    state.dropoff = null;
    state.estimate = null;
    state.comment = '';
    state.mode = 'pickup';
    setCarMarker(null);
    setPointMarker('b', null);
    setPointMarker('a', null);
    setRouteLine(null);
    if (state.pickup) map.setView([state.pickup.lat, state.pickup.lng], 16);
    render();
  }

  // ------------------------------------------------------------------
  // Активный заказ: сокеты + опрос как запасной вариант
  // ------------------------------------------------------------------
  var ACTIVE = ['searching', 'assigned', 'arrived', 'in_progress'];
  var socket = null, pollTimer = null;

  function setOrder(order) {
    var prev = state.order && state.order.status;
    state.order = order;
    state.mode = 'order';
    if (order.pickup) state.pickup = state.pickup && state.pickup.lat === order.pickup.lat ? state.pickup : fromOrderPlace(order.pickup);
    if (order.dropoff) state.dropoff = state.dropoff && state.dropoff.lat === order.dropoff.lat ? state.dropoff : fromOrderPlace(order.dropoff);
    if (prev && prev !== order.status) {
      haptic(order.status === 'cancelled' || order.status === 'expired' ? 'warning' : 'success');
    }
    setCarMarker(order.driver && ACTIVE.indexOf(order.status) >= 0 && order.status !== 'searching' ? order.driver.location : null);
    render();
    if (ACTIVE.indexOf(order.status) >= 0) startTracking(); else stopTracking();
  }

  function fromOrderPlace(p) {
    var parts = String(p.address || '').split(', ');
    return { lat: p.lat, lng: p.lng, title: parts[0] || 'Точка на карте', subtitle: parts.slice(1).join(', ') };
  }

  function refreshCurrent() {
    return api('/orders/current').then(function (r) {
      if (r.order) setOrder(r.order);
      else if (state.order && ACTIVE.indexOf(state.order.status) >= 0) {
        // заказ завершился, пока нас не было — покажем его итог
        return api('/orders/' + state.order.id).then(setOrder);
      }
    }).catch(function () { /* следующий опрос попробует снова */ });
  }

  function startTracking() {
    connectSocket();
    if (!pollTimer) pollTimer = setInterval(function () {
      if (!socket || !socket.connected) refreshCurrent();
    }, POLL_MS);
  }

  function stopTracking() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function connectSocket() {
    if (socket) return;
    loadScript((window.TAXI_API || '') + '/socket.io/socket.io.js').then(function () {
      if (typeof window.io !== 'function' || socket) return;
      socket = window.io(window.TAXI_API || undefined, { auth: { token: state.token } });
      socket.on('order:updated', function (o) {
        if (!state.order || o.id === state.order.id) setOrder(o);
      });
      socket.on('driver:location', function (d) {
        if (!state.order || d.orderId !== state.order.id) return;
        if (state.order.driver) state.order.driver.location = { lat: d.lat, lng: d.lng };
        setCarMarker({ lat: d.lat, lng: d.lng });
        renderEtaOnly();
      });
      socket.on('connect', function () { refreshCurrent(); });
    }).catch(function () { /* без сокетов работает опрос */ });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // ------------------------------------------------------------------
  // Отрисовка шторки
  // ------------------------------------------------------------------
  function routeHtml(editable) {
    var a = state.pickup, b = state.dropoff;
    var row = function (key, p, placeholder) {
      var title = p ? (p.pending ? 'Определяем адрес…' : p.title) : placeholder;
      var cls = p && !p.pending ? 'route-title' : 'route-title empty';
      var inner = '<span class="route-dot ' + key + '"></span><span class="route-text"><span class="' + cls + '">' +
        esc(title) + '</span>' + (p && p.subtitle ? '<span class="route-sub">' + esc(p.subtitle) + '</span>' : '') + '</span>';
      return editable
        ? '<li><button type="button" class="route-row" data-edit="' + key + '">' + inner + '</button></li>'
        : '<li><div class="route-row">' + inner + '</div></li>';
    };
    return '<ul class="route">' + row('a', a, 'Откуда') + row('b', b, 'Куда поедем?') + '</ul>';
  }

  function render() {
    var html = '';
    var m = state.mode;
    els.pin.hidden = !(m === 'pickup' || m === 'dropoff-map');
    els.pin.querySelector('.pin-label').textContent = m === 'dropoff-map' ? 'B' : 'A';
    els.locate.hidden = m !== 'pickup';

    if (m === 'pickup') {
      setPointMarker('a', null);
      setPointMarker('b', null);
      setRouteLine(null);
      html = '<h1>Куда едем?</h1>' + routeHtml(true) +
        '<button type="button" class="btn" id="toDropoff"' + (state.pickup ? '' : ' disabled') + '>Указать, куда ехать</button>';
    } else if (m === 'dropoff-map') {
      setPointMarker('a', state.pickup);
      html = '<h1>Точка назначения</h1><p class="sub">Передвиньте карту, чтобы пин встал на место</p>' + routeHtml(false) +
        '<button type="button" class="btn" id="confirmDropoff"' + (state.dropoff && !state.dropoff.pending ? '' : ' disabled') + '>Готово</button>' +
        '<button type="button" class="btn secondary" id="backToPickup">Назад</button>';
    } else if (m === 'confirm') {
      html = renderConfirm();
    } else if (m === 'order') {
      html = renderOrder();
    }
    els.sheet.innerHTML = html;
    bindSheet();
    syncSheetHeight();
    updateBackButton();
  }

  function renderConfirm() {
    setPointMarker('a', state.pickup);
    setPointMarker('b', state.dropoff);
    setRouteLine(state.pickup, state.dropoff);
    var est = state.estimate;
    var tariffs, meta = '', selected = null;
    if (!est) {
      tariffs = '<div class="tariffs"><div class="tariff"><span class="tariff-name">Считаем цену…</span><span class="tariff-price">&nbsp;</span></div></div>';
    } else {
      tariffs = '<div class="tariffs" role="group" aria-label="Тариф">' + est.options.map(function (o) {
        if (o.tariffId === state.tariffId) selected = o;
        return '<button type="button" class="tariff" data-tariff="' + o.tariffId + '" aria-pressed="' + (o.tariffId === state.tariffId) + '">' +
          '<span class="tariff-name">' + esc(o.name) + '</span><span class="tariff-price">' + money(o.price) + '</span></button>';
      }).join('') + '</div>';
      if (est.distanceM) meta = '<p class="trip-meta">' + km(est.distanceM) + ', около ' + minutes(est.durationS) + ' в пути</p>';
    }
    return routeHtml(true) + tariffs + meta +
      '<input class="field" id="comment" maxlength="300" placeholder="Комментарий водителю" value="' + esc(state.comment) + '">' +
      '<button type="button" class="btn" id="orderBtn"' + (selected && !state.busy ? '' : ' disabled') + '>' +
      (state.busy ? 'Заказываем…' : 'Заказать' + (selected ? ' <span class="price">' + money(selected.price) + '</span>' : '')) +
      '</button>';
  }

  function etaText(o) {
    if (!o.driver || !o.driver.location || o.status !== 'assigned') return '';
    var m = distanceM(o.driver.location, o.pickup) * 1.35;
    return 'Приедет примерно через ' + minutes((m / 1000 / CITY_SPEED_KMH) * 3600);
  }

  function driverHtml(o) {
    if (!o.driver) return '';
    var car = [o.driver.car.color, o.driver.car.model].filter(Boolean).join(' ');
    var call = o.driver.phone
      ? '<a class="call" href="tel:' + esc(o.driver.phone) + '" aria-label="Позвонить водителю"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"/></svg></a>'
      : '';
    return '<div class="driver">' +
      (o.driver.car.plate ? '<span class="plate">' + esc(o.driver.car.plate) + '</span>' : '') +
      '<div class="driver-info"><div class="driver-car">' + esc(car || 'Автомобиль') + '</div>' +
      '<div class="driver-name">' + esc(o.driver.name) + '</div></div>' + call + '</div>';
  }

  function renderOrder() {
    var o = state.order;
    setPointMarker('a', o.pickup);
    setPointMarker('b', o.dropoff);
    setRouteLine(o.dropoff ? o.pickup : null, o.dropoff);
    var cancel = '<button type="button" class="btn danger" id="cancelBtn"' + (state.busy ? ' disabled' : '') + '>Отменить заказ</button>';
    var again = '<button type="button" class="btn" id="newOrderBtn">Заказать ещё</button>';
    var price = o.finalPrice != null ? o.finalPrice : o.estimatedPrice;

    switch (o.status) {
      case 'searching':
        return '<h1>Ищем машину</h1><p class="sub">' + esc(o.tariff.name) + ', ' + money(price) + '</p>' +
          '<div class="searching-strip" role="progressbar" aria-label="Поиск машины"></div>' + routeHtml(false) + cancel;
      case 'assigned':
        return '<h1>Водитель едет к вам</h1><p class="sub" id="eta">' + (etaText(o) || 'Скоро будет') + '</p>' +
          driverHtml(o) + routeHtml(false) + cancel;
      case 'arrived':
        return '<h1>Водитель на месте</h1><p class="sub">Выходите, вас ждут</p>' + driverHtml(o) + routeHtml(false) + cancel;
      case 'in_progress':
        return '<h1>В пути</h1><p class="sub">' + (o.dropoff && o.dropoff.address ? 'Едем: ' + esc(o.dropoff.address) : 'Хорошей поездки') + '</p>' +
          driverHtml(o) + '<div class="summary"><div class="summary-row"><span>К оплате</span><span>' + money(price) + '</span></div></div>';
      case 'completed':
        return '<h1>Поездка завершена</h1><p class="total">' + money(price) + '</p><p class="sub">' + esc(o.tariff.name) +
          (o.distanceM ? ', ' + km(o.distanceM) : '') + '</p>' + routeHtml(false) + again;
      case 'expired':
        return '<h1>Машина не найдена</h1><p class="sub">Все водители сейчас заняты. Попробуйте заказать ещё раз через пару минут.</p>' +
          routeHtml(false) + '<button type="button" class="btn" id="retryBtn">Искать снова</button>' +
          '<button type="button" class="btn secondary" id="newOrderBtn">Другой маршрут</button>';
      case 'cancelled':
        return '<h1>Заказ отменён</h1><p class="sub">' +
          esc(o.cancelledBy === 'passenger' ? 'Вы отменили заказ' : (o.cancelReason || 'Заказ отменил таксопарк')) + '</p>' + again;
    }
    return '';
  }

  function renderEtaOnly() {
    var el = document.getElementById('eta');
    if (el && state.order) el.textContent = etaText(state.order) || 'Скоро будет';
  }

  function bindSheet() {
    var on = function (id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); };

    Array.prototype.forEach.call(els.sheet.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.edit === 'a') {
          if (state.mode === 'pickup') openSearch('pickup');
          else { state.mode = 'pickup'; if (state.pickup) map.setView([state.pickup.lat, state.pickup.lng], 17); render(); }
        } else openSearch('dropoff');
      });
    });
    Array.prototype.forEach.call(els.sheet.querySelectorAll('[data-tariff]'), function (b) {
      b.addEventListener('click', function () {
        state.tariffId = b.dataset.tariff;
        haptic('select');
        render();
      });
    });
    var comment = document.getElementById('comment');
    if (comment) comment.addEventListener('input', function () { state.comment = comment.value; });

    on('toDropoff', function () {
      if (state.dropoff) { state.mode = 'confirm'; loadEstimate(); render(); } else openSearch('dropoff');
    });
    on('confirmDropoff', function () { state.mode = 'confirm'; loadEstimate(); render(); fitPoints([state.pickup, state.dropoff]); });
    on('backToPickup', backToPickup);
    on('orderBtn', createOrder);
    on('cancelBtn', cancelOrder);
    on('newOrderBtn', newOrder);
    on('retryBtn', function () {
      state.mode = 'confirm';
      state.order = null;
      loadEstimate();
      render();
    });

    if (state.mode === 'confirm' && !bindSheet.fitted) {
      bindSheet.fitted = true;
      fitPoints([state.pickup, state.dropoff]);
    }
    if (state.mode !== 'confirm') bindSheet.fitted = false;
  }

  function backToPickup() {
    state.mode = 'pickup';
    state.dropoff = null;
    if (state.pickup) map.setView([state.pickup.lat, state.pickup.lng], 16);
    render();
  }

  /** Кнопка «Назад» в шапке Telegram */
  function updateBackButton() {
    if (!tg || !tg.BackButton) return;
    var show = !els.search.hidden || state.mode === 'dropoff-map' || state.mode === 'confirm';
    if (show) tg.BackButton.show(); else tg.BackButton.hide();
  }

  function onBack() {
    if (!els.search.hidden) return closeSearch();
    if (state.mode === 'dropoff-map') return backToPickup();
    if (state.mode === 'confirm') { state.mode = 'pickup'; render(); if (state.pickup) map.setView([state.pickup.lat, state.pickup.lng], 16); }
  }

  // ------------------------------------------------------------------
  // Запуск
  // ------------------------------------------------------------------
  function slugFromLaunch() {
    if (params.get('t')) return params.get('t');
    var sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
    return sp || null;
  }

  function login(slug) {
    if (tg) {
      return api('/auth/telegram', { method: 'POST', body: { tenantSlug: slug, initData: tg.initData, role: 'passenger' } });
    }
    var devId = Number(params.get('dev'));
    if (devId > 0) {
      return api('/auth/dev/token', { method: 'POST', body: { tenantSlug: slug, role: 'passenger', telegramId: devId, name: 'Тестовый пассажир' } });
    }
    var err = new Error('Откройте приложение через Telegram-бот таксопарка.');
    err.fatal = true;
    return Promise.reject(err);
  }

  function fatal(title, text) {
    showScreen('<h1>' + esc(title) + '</h1><p>' + esc(text) + '</p>' +
      '<button type="button" class="btn secondary" onclick="location.reload()">Обновить</button>');
  }

  function start() {
    applyTelegramTheme();
    if (tg) {
      tg.ready();
      tg.expand();
      try { tg.disableVerticalSwipes(); } catch (e) { /* старый клиент */ }
      if (tg.BackButton) tg.BackButton.onClick(onBack);
    }
    showScreen('<div class="spinner" aria-label="Загрузка"></div>');

    if (typeof window.L === 'undefined') {
      fatal('Не загрузилась карта', 'Проверьте интернет и откройте приложение ещё раз.');
      return;
    }
    var slug = slugFromLaunch();
    if (!slug) {
      fatal('Таксопарк не указан', 'Откройте приложение через Telegram-бот таксопарка.');
      return;
    }

    api('/tenants/' + encodeURIComponent(slug)).then(function (tenant) {
      state.tenant = tenant;
      applyBranding(tenant);
      return login(slug);
    }).then(function (auth) {
      state.token = auth.token;
      state.me = auth.passenger;
      var center = Array.isArray(state.tenant.center) ? state.tenant.center : DEFAULT_CENTER;
      initMap(center);
      hideScreen();
      render();
      return refreshCurrent().then(function () {
        if (state.order) return;
        return getLocation().then(function (loc) {
          if (loc && !state.order && state.mode === 'pickup') map.setView([loc.lat, loc.lng], 17);
          else onMapMoved();
        });
      });
    }).catch(function (e) {
      if (e.status === 404) fatal('Таксопарк не найден', 'Проверьте ссылку или откройте приложение через бот.');
      else fatal('Не удалось войти', e.message);
    });

    els.locate.addEventListener('click', function () {
      getLocation().then(function (loc) {
        if (loc) map.setView([loc.lat, loc.lng], 17);
        else toast('Не удалось определить местоположение. Разрешите доступ к геопозиции.');
      });
    });
    els.searchBack.addEventListener('click', closeSearch);
    els.searchInput.addEventListener('input', runSearch);
    els.searchOnMap.addEventListener('click', function () {
      closeSearch();
      if (searchTarget === 'pickup') {
        state.mode = 'pickup';
      } else {
        state.mode = 'dropoff-map';
        var base = state.dropoff || state.pickup;
        if (base) map.setView([base.lat, base.lng], 16);
        onMapMoved();
      }
      render();
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && state.token) refreshCurrent();
    });
  }

  start();
})();
