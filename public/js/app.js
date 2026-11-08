/* UC Traders — storefront logic. All data comes from the server API.
 * No localStorage orders, no demo data. Admin token lives only in
 * sessionStorage for the current browser tab.
 */
(function () {
  'use strict';

  var PAYMENT_FALLBACK = { method: 'Easypaisa', number: '03097214736', title: 'Mubeen Bibi' };
  var packs = [];
  var selectedPackId = 2; // default selected pack (Pack 2), like the design
  var payment = PAYMENT_FALLBACK;
  var revealOpen = false;
  var lastCharId = '';
  var adminToken = sessionStorage.getItem('uc-traders-admin-token') || '';
  var adminOrders = [];
  var adminFilter = 'All';
  var adminQuery = '';

  function $(id) { return document.getElementById(id); }
  function fmtRs(n) { return 'Rs. ' + Number(n).toLocaleString('en-US'); }
  function ucLabel(n) { return Number(n).toLocaleString('en-US') + ' UC'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }
  function timeLabel(iso) {
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso || ''; }
  }
  function waLink(contact) {
    var d = digitsOnly(contact);
    if (d.length === 11 && d.charAt(0) === '0') d = '92' + d.slice(1);
    if (d.length === 10) d = '92' + d;
    return 'https://wa.me/' + d;
  }

  async function api(path, options) {
    var res = await fetch(path, options || {});
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var msg = (data && data.error) || ('Request failed (' + res.status + ')');
      var err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken };
  }

  /* ---------- views ---------- */
  function showView(name) {
    var homeMain = $('homeMain'), track = $('trackSection'), pkgs = $('myPackagesSection'),
        admin = $('adminSection'), plans = $('plansPage'), home = $('homeView');
    home.hidden = false;
    if (name === 'plans') {
      home.hidden = true; plans.hidden = false;
    } else {
      plans.hidden = true;
      homeMain.hidden = (name !== 'home');
      track.hidden = (name !== 'track');
      pkgs.hidden = (name !== 'packages');
      admin.hidden = (name !== 'admin');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- packs ---------- */
  function packCardHTML(p) {
    var badge = '';
    if (p.is_free) badge = '<span class="free-badge">FREE</span>';
    else if (p.discount_pct > 0) badge = '<span class="off-badge">' + p.discount_pct + '% OFF</span>';
    var orig = '';
    if (!p.is_free && p.original_price > p.sale_price) {
      orig = '<span class="pack-original">' + fmtRs(p.original_price) + '</span>';
    }
    return '<img src="/assets/uc-coins.jpg" alt="UC coins">' +
      '<div class="pack-body">' +
      '<p class="pack-name">' + esc(p.name) + '</p>' +
      '<p class="pack-uc">' + ucLabel(p.uc_amount) + '</p>' +
      '<div class="pack-price-row"><span class="pack-price">' + fmtRs(p.sale_price) + '</span>' + orig + badge + '</div>' +
      '<p class="pack-note">Delivered on your PUBG Character ID</p>' +
      '</div>';
  }

  function renderPackGrids() {
    [['packGrid'], ['plansGrid']].forEach(function (pair) {
      var grid = $(pair[0]);
      if (!grid) return;
      grid.innerHTML = '';
      packs.forEach(function (p) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'pack-card' + (p.id === selectedPackId ? ' selected' : '');
        card.setAttribute('data-pack-id', p.id);
        card.innerHTML = packCardHTML(p);
        card.addEventListener('click', function () { selectPack(p.id, true); });
        grid.appendChild(card);
      });
    });
    renderSummary();
  }

  function selectPack(id, scrollToCheckout) {
    selectedPackId = id;
    document.querySelectorAll('.pack-card').forEach(function (card) {
      card.classList.toggle('selected', Number(card.getAttribute('data-pack-id')) === id);
    });
    renderSummary();
    if (scrollToCheckout) {
      showView('home');
      setTimeout(function () {
        var el = $('checkout');
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    }
  }

  function selectedPack() {
    for (var i = 0; i < packs.length; i++) if (packs[i].id === selectedPackId) return packs[i];
    return packs[0] || null;
  }

  function renderSummary() {
    var box = $('orderSummary');
    var p = selectedPack();
    if (!box) return;
    if (!p) { box.innerHTML = '<h3>Order Summary</h3><p class="muted">Loading packs…</p>'; return; }
    var orig = '';
    if (!p.is_free && p.original_price > p.sale_price) {
      orig = '<span class="pack-original">' + fmtRs(p.original_price) + '</span>';
    }
    var badge = p.is_free ? '<span class="free-badge">FREE</span>'
      : (p.discount_pct > 0 ? '<span class="off-badge">' + p.discount_pct + '% OFF</span>' : '');
    box.innerHTML = '<h3>Order Summary</h3>' +
      '<div class="summary-pack"><img src="/assets/uc-coins.jpg" alt="UC coins">' +
      '<p class="pack-name">' + esc(p.name) + '</p>' +
      '<p class="pack-uc">' + ucLabel(p.uc_amount) + '</p>' +
      '<div class="pack-price-row"><span class="pack-price">' + fmtRs(p.sale_price) + '</span>' + orig + badge + '</div></div>' +
      '<div class="summary-total"><span>Total</span><span>' + fmtRs(p.sale_price) + '</span></div>' +
      '<p class="muted small">Payment: Easypaisa only. No cash on delivery.</p>';
  }

  async function loadPacks() {
    try {
      var data = await api('/api/packs');
      packs = data.packs || [];
      if (packs.length && !packs.some(function (p) { return p.id === selectedPackId; })) {
        selectedPackId = packs[0].id;
      }
      renderPackGrids();
    } catch (e) {
      var grid = $('packGrid');
      if (grid) grid.innerHTML = '<p class="field-error">Could not load packs. Please refresh the page.</p>';
    }
  }

  async function loadPayment() {
    try {
      var data = await api('/api/payment');
      if (data && data.number) payment = data;
    } catch (e) { payment = PAYMENT_FALLBACK; }
    $('payNumber').textContent = payment.number;
    $('payTitle').textContent = payment.title;
  }

  /* ---------- checkout ---------- */
  function showStep(n) {
    $('idForm').hidden = (n !== 1);
    $('step2').hidden = (n !== 2);
    $('step3').hidden = (n !== 3);
    $('orderSuccess').hidden = (n !== 4);
  }

  function checkoutValues() {
    return {
      charId: $('charId').value.trim(),
      ign: $('ign').value.trim(),
      contact: $('contact').value.trim(),
      txnId: $('txnId').value.trim()
    };
  }

  function bindCheckout() {
    $('charId').addEventListener('input', function () {
      this.value = digitsOnly(this.value).slice(0, 12);
    });
    $('contact').addEventListener('input', function () {
      this.value = digitsOnly(this.value).slice(0, 16);
    });

    $('toStep2').addEventListener('click', function () {
      var v = checkoutValues();
      var ok = true;
      var charOk = /^[0-9]{5,12}$/.test(v.charId);
      $('charIdErr').hidden = charOk; if (!charOk) ok = false;
      var ignOk = v.ign.length >= 2;
      $('ignErr').hidden = ignOk; if (!ignOk) ok = false;
      var contactOk = digitsOnly(v.contact).length >= 10 && digitsOnly(v.contact).length <= 15;
      $('contactErr').hidden = contactOk; if (!contactOk) ok = false;
      if (!ok) return;
      var p = selectedPack();
      $('playerAvatar').textContent = (v.ign.charAt(0) || '?').toUpperCase();
      $('pcIgn').textContent = v.ign;
      $('pcCharId').textContent = v.charId;
      $('pcContact').textContent = v.contact;
      $('pcPack').textContent = p ? (p.name + ' — ' + ucLabel(p.uc_amount)) : '';
      $('pcPrice').textContent = p ? fmtRs(p.sale_price) : '';
      showStep(2);
    });

    $('editId').addEventListener('click', function () { showStep(1); });
    $('confirmId').addEventListener('click', function () { showStep(3); });
    $('backToStep2').addEventListener('click', function () { showStep(2); });

    $('easypaisaBtn').addEventListener('click', function () {
      revealOpen = !revealOpen;
      $('payReveal').hidden = !revealOpen;
      this.classList.toggle('open', revealOpen);
      $('payErr').hidden = true;
    });

    $('copyNumber').addEventListener('click', function () {
      var num = payment.number;
      var done = function () { this.textContent = 'Copied!'; setTimeout(function (btn) { btn.textContent = 'Copy'; }, 1500, this); }.bind(this);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(num).then(done).catch(function () { fallbackCopy(num); done(); });
      } else { fallbackCopy(num); done(); }
      function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
      }
    });

    $('submitOrder').addEventListener('click', async function () {
      var v = checkoutValues();
      var p = selectedPack();
      $('orderErr').hidden = true;
      if (!revealOpen) { $('payErr').hidden = false; return; }
      $('payErr').hidden = true;
      var txnOk = v.txnId.length >= 5;
      $('txnErr').hidden = txnOk;
      if (!txnOk || !p) return;
      var btn = this;
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        var data = await api('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            packId: p.id, characterId: v.charId, ign: v.ign,
            contact: v.contact, txnId: v.txnId
          })
        });
        lastCharId = v.charId;
        $('successOrderNo').textContent = data.order.order_number;
        showStep(4);
      } catch (e) {
        var errBox = $('orderErr');
        errBox.textContent = e.message || 'Could not place the order. Please try again.';
        errBox.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = 'Submit Order';
      }
    });

    $('successMyPackages').addEventListener('click', function () {
      $('pkgCharId').value = lastCharId;
      showView('packages');
      loadMyPackages();
    });
    $('newOrderBtn').addEventListener('click', function () {
      $('txnId').value = '';
      revealOpen = false;
      $('payReveal').hidden = true;
      $('easypaisaBtn').classList.remove('open');
      showStep(1);
    });
  }

  /* ---------- track & my packages ---------- */
  function orderRowHTML(o) {
    return '<div class="order-row">' +
      '<p><strong>' + esc(o.order_number) + '</strong> &nbsp; <span class="badge ' + (o.status === 'Successful' ? 'badge-success' : 'badge-pending') + '">' + esc(o.status) + '</span></p>' +
      '<p>' + esc(o.pack_name) + ' — ' + ucLabel(o.uc_amount) + ' · ' + fmtRs(o.sale_price) + '</p>' +
      '<p class="muted small">Character ID: ' + esc(o.character_id) + ' · ' + esc(o.ign) + ' · TXN: ' + esc(o.txn_id) + ' · ' + esc(timeLabel(o.created_at)) + '</p>' +
      '</div>';
  }

  function pkgCardHTML(o) {
    return '<div class="pkg-card">' +
      '<p><strong>' + esc(o.pack_name) + '</strong> &nbsp; <span class="badge ' + (o.status === 'Successful' ? 'badge-success' : 'badge-pending') + '">' + esc(o.status) + '</span></p>' +
      '<p class="pack-uc">' + ucLabel(o.uc_amount) + ' · ' + fmtRs(o.sale_price) + '</p>' +
      '<p>Order: <strong>' + esc(o.order_number) + '</strong></p>' +
      '<p>Character ID: ' + esc(o.character_id) + '</p>' +
      '<p>In-Game Name: ' + esc(o.ign) + '</p>' +
      '<p>Contact: ' + esc(o.contact) + '</p>' +
      '<p>Payment: ' + esc(o.payment_method) + ' · Transaction ID: ' + esc(o.txn_id) + '</p>' +
      '<p class="muted small">' + esc(timeLabel(o.created_at)) + '</p>' +
      '</div>';
  }

  async function fetchOrdersByCharId(charId) {
    var data = await api('/api/orders/track?characterId=' + encodeURIComponent(charId));
    return data.orders || [];
  }

  async function loadTrack() {
    var charId = $('trackCharId').value.trim();
    var errBox = $('trackErr'), results = $('trackResults');
    errBox.hidden = true; results.innerHTML = '';
    if (!/^[0-9]{5,12}$/.test(charId)) {
      errBox.textContent = 'Please enter a valid Character ID (5–12 digits).';
      errBox.hidden = false;
      return;
    }
    try {
      var orders = await fetchOrdersByCharId(charId);
      if (!orders.length) { results.innerHTML = '<p class="muted">No orders found for this Character ID.</p>'; return; }
      results.innerHTML = orders.map(orderRowHTML).join('');
    } catch (e) {
      errBox.textContent = e.message || 'Could not load your orders.';
      errBox.hidden = false;
    }
  }

  async function loadMyPackages() {
    var charId = $('pkgCharId').value.trim();
    var errBox = $('pkgErr'), results = $('pkgResults'), count = $('pkgCount');
    errBox.hidden = true; results.innerHTML = ''; count.textContent = '';
    if (!/^[0-9]{5,12}$/.test(charId)) {
      errBox.textContent = 'Please enter a valid Character ID (5–12 digits).';
      errBox.hidden = false;
      return;
    }
    try {
      var orders = await fetchOrdersByCharId(charId);
      if (!orders.length) { results.innerHTML = '<p class="muted">No packages found for this Character ID.</p>'; return; }
      var pending = orders.filter(function (o) { return o.status === 'Pending'; }).length;
      var successful = orders.length - pending;
      count.textContent = orders.length + ' package' + (orders.length > 1 ? 's' : '') + ' · ' + pending + ' Pending · ' + successful + ' Successful';
      results.innerHTML = orders.map(pkgCardHTML).join('');
    } catch (e) {
      errBox.textContent = e.message || 'Could not load your packages.';
      errBox.hidden = false;
    }
  }

  /* ---------- reviews slider ---------- */
  var sliderIdx = 0, sliderTimer = null;
  function perView() {
    var w = window.innerWidth;
    if (w < 640) return 1;
    if (w < 1024) return 2;
    return 3;
  }
  function sliderMaxIdx() {
    var slides = $('reviewSlider').children.length;
    return Math.max(0, slides - perView());
  }
  function sliderGo(idx) {
    var track = $('reviewSlider');
    var max = sliderMaxIdx();
    sliderIdx = Math.max(0, Math.min(idx, max));
    var slide = track.children[0];
    var step = slide ? slide.offsetWidth + 16 : 0;
    track.style.transform = 'translateX(' + (-sliderIdx * step) + 'px)';
    renderSliderDots();
  }
  function renderSliderDots() {
    var dots = $('revDots');
    var count = sliderMaxIdx() + 1;
    dots.innerHTML = '';
    for (var i = 0; i < count; i++) {
      (function (i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', 'Go to review page ' + (i + 1));
        if (i === sliderIdx) b.classList.add('active');
        b.addEventListener('click', function () { sliderGo(i); restartSliderTimer(); });
        dots.appendChild(b);
      })(i);
    }
  }
  function restartSliderTimer() {
    if (sliderTimer) clearInterval(sliderTimer);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    sliderTimer = setInterval(function () {
      sliderGo(sliderIdx >= sliderMaxIdx() ? 0 : sliderIdx + 1);
    }, 3500);
  }
  function bindSlider() {
    $('revPrev').addEventListener('click', function () {
      sliderGo(sliderIdx <= 0 ? sliderMaxIdx() : sliderIdx - 1);
      restartSliderTimer();
    });
    $('revNext').addEventListener('click', function () {
      sliderGo(sliderIdx >= sliderMaxIdx() ? 0 : sliderIdx + 1);
      restartSliderTimer();
    });
    var viewport = document.querySelector('.slider-viewport');
    viewport.addEventListener('mouseenter', function () { if (sliderTimer) clearInterval(sliderTimer); });
    viewport.addEventListener('mouseleave', restartSliderTimer);
    var startX = null;
    viewport.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    viewport.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) >= 40) {
        sliderGo(dx < 0 ? (sliderIdx >= sliderMaxIdx() ? 0 : sliderIdx + 1) : (sliderIdx <= 0 ? sliderMaxIdx() : sliderIdx - 1));
        restartSliderTimer();
      }
      startX = null;
    }, { passive: true });
    window.addEventListener('resize', function () { sliderGo(Math.min(sliderIdx, sliderMaxIdx())); });
    sliderGo(0);
    restartSliderTimer();
  }

  /* ---------- admin ---------- */
  function showAdminLogin() {
    $('adminLoginView').hidden = false;
    $('adminDashView').hidden = true;
  }
  function showAdminDash() {
    $('adminLoginView').hidden = true;
    $('adminDashView').hidden = false;
  }

  async function adminLogin() {
    var identifier = $('adminIdentifier').value.trim();
    var password = $('adminPassword').value;
    var errBox = $('adminLoginErr');
    errBox.hidden = true;
    if (!identifier || !password) {
      errBox.textContent = 'Username/email and password are required.';
      errBox.hidden = false;
      return;
    }
    try {
      var data = await api('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier, password: password })
      });
      adminToken = data.token;
      sessionStorage.setItem('uc-traders-admin-token', adminToken);
      showAdminDash();
      await loadAdmin();
    } catch (e) {
      errBox.textContent = e.message || 'Login failed.';
      errBox.hidden = false;
    }
  }

  function adminLogout() {
    adminToken = '';
    sessionStorage.removeItem('uc-traders-admin-token');
    $('adminPassword').value = '';
    showAdminLogin();
  }

  async function loadAdmin() {
    try {
      var stats = await api('/api/admin/stats', { headers: authHeaders() });
      var s = stats.stats;
      $('adminStats').innerHTML =
        '<div class="stat-card"><div class="stat-label">Total Orders</div><div class="stat-value">' + s.total_orders + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">' + s.pending_orders + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">Successful</div><div class="stat-value">' + s.successful_orders + '</div></div>' +
        '<div class="stat-card"><div class="stat-label">Successful Sales</div><div class="stat-value">' + fmtRs(s.successful_sales) + '</div></div>';
      var data = await api('/api/admin/orders', { headers: authHeaders() });
      adminOrders = data.orders || [];
      renderAdminOrders();
      renderAdminPackList();
    } catch (e) {
      if (e.status === 401) { adminLogout(); return; }
      var errBox = $('adminErr');
      errBox.textContent = e.message || 'Could not load the dashboard.';
      errBox.hidden = false;
    }
  }

  function renderAdminPackList() {
    var box = $('adminPackList');
    box.innerHTML = packs.map(function (p) {
      return '<p>' + esc(p.name) + ' — ' + ucLabel(p.uc_amount) + ' · <strong>' + fmtRs(p.sale_price) + '</strong></p>';
    }).join('');
  }

  function filteredAdminOrders() {
    var q = adminQuery.toLowerCase();
    return adminOrders.filter(function (o) {
      if (adminFilter !== 'All' && o.status !== adminFilter) return false;
      if (!q) return true;
      var hay = [o.order_number, o.character_id, o.ign, o.contact, o.txn_id, o.pack_name].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderAdminOrders() {
    var box = $('adminOrders');
    var list = filteredAdminOrders();
    if (!list.length) {
      box.innerHTML = '<p class="muted">No orders yet.</p>';
      return;
    }
    box.innerHTML = list.map(function (o) {
      var confirmBtn = o.status === 'Pending'
        ? '<button class="btn btn-small" data-act="confirm" data-id="' + o.id + '" type="button">Payment Confirm — Successful Karein</button>'
        : '<button class="btn btn-small btn-ghost" data-act="revert" data-id="' + o.id + '" type="button">Revert to Pending</button>';
      return '<div class="admin-order">' +
        '<p><strong>' + esc(o.order_number) + '</strong> &nbsp; <span class="badge ' + (o.status === 'Successful' ? 'badge-success' : 'badge-pending') + '">' + esc(o.status) + '</span></p>' +
        '<p>' + esc(o.pack_name) + ' — ' + ucLabel(o.uc_amount) + ' · ' + fmtRs(o.sale_price) + '</p>' +
        '<p>Character ID: ' + esc(o.character_id) + ' · In-Game Name: ' + esc(o.ign) + ' · Contact: ' + esc(o.contact) + '</p>' +
        '<p>Payment: ' + esc(o.payment_method) + ' · Transaction ID: ' + esc(o.txn_id) + '</p>' +
        '<p class="muted small">' + esc(timeLabel(o.created_at)) + '</p>' +
        '<div class="order-actions">' + confirmBtn +
        '<a class="btn btn-small btn-ghost" href="' + waLink(o.contact) + '" target="_blank" rel="noopener">💬 WhatsApp</a>' +
        '<button class="btn btn-small btn-ghost" data-act="copy" data-id="' + o.id + '" type="button">📋 Details Copy</button>' +
        '<button class="btn btn-small btn-ghost" data-act="delete" data-id="' + o.id + '" type="button">🗑️ Delete</button>' +
        '</div></div>';
    }).join('');
    box.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-act');
        var id = Number(btn.getAttribute('data-id'));
        if (act === 'confirm') adminSetStatus(id, 'confirm');
        else if (act === 'revert') adminSetStatus(id, 'revert');
        else if (act === 'copy') adminCopyOrder(id, btn);
        else if (act === 'delete') adminDeleteOrder(id, btn);
      });
    });
  }

  async function adminSetStatus(id, action) {
    try {
      await api('/api/admin/orders/' + id + '/' + action, { method: 'POST', headers: authHeaders() });
      await loadAdmin();
    } catch (e) {
      if (e.status === 401) { adminLogout(); return; }
      var errBox = $('adminErr');
      errBox.textContent = e.message || 'Could not update the order.';
      errBox.hidden = false;
    }
  }

  function adminCopyOrder(id, btn) {
    var o = null;
    adminOrders.forEach(function (x) { if (x.id === id) o = x; });
    if (!o) return;
    var text = 'Order: ' + o.order_number + '\nPack: ' + o.pack_name + ' — ' + ucLabel(o.uc_amount) +
      '\nPrice: ' + fmtRs(o.sale_price) + '\nCharacter ID: ' + o.character_id +
      '\nIn-Game Name: ' + o.ign + '\nContact: ' + o.contact +
      '\nPayment: ' + o.payment_method + '\nTransaction ID: ' + o.txn_id +
      '\nStatus: ' + o.status + '\nDate: ' + timeLabel(o.created_at);
    var done = function () { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = '📋 Details Copy'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else { done(); }
  }

  var deleteArmed = {};
  async function adminDeleteOrder(id, btn) {
    if (!deleteArmed[id]) {
      deleteArmed[id] = true;
      btn.textContent = 'Confirm Delete?';
      setTimeout(function () { deleteArmed[id] = false; if (btn.isConnected) btn.textContent = '🗑️ Delete'; }, 3000);
      return;
    }
    deleteArmed[id] = false;
    try {
      await api('/api/admin/orders/' + id, { method: 'DELETE', headers: authHeaders() });
      await loadAdmin();
    } catch (e) {
      if (e.status === 401) { adminLogout(); return; }
      var errBox = $('adminErr');
      errBox.textContent = e.message || 'Could not delete the order.';
      errBox.hidden = false;
    }
  }

  async function adminChangePassword() {
    var oldPassword = $('oldPass').value;
    var newPassword = $('newPass').value;
    var confirmPassword = $('confirmPass').value;
    var errBox = $('pwErr'), okBox = $('pwOk');
    errBox.hidden = true; okBox.hidden = true;
    if (!oldPassword || !newPassword || !confirmPassword) {
      errBox.textContent = 'Old, new and confirm password are all required.';
      errBox.hidden = false; return;
    }
    if (newPassword.length < 8) {
      errBox.textContent = 'New password must be at least 8 characters.';
      errBox.hidden = false; return;
    }
    if (newPassword !== confirmPassword) {
      errBox.textContent = 'New password and confirm password do not match.';
      errBox.hidden = false; return;
    }
    if (newPassword === oldPassword) {
      errBox.textContent = 'New password must be different from the old password.';
      errBox.hidden = false; return;
    }
    try {
      await api('/api/admin/change-password', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ oldPassword: oldPassword, newPassword: newPassword, confirmPassword: confirmPassword })
      });
      $('oldPass').value = ''; $('newPass').value = ''; $('confirmPass').value = '';
      okBox.hidden = false;
    } catch (e) {
      if (e.status === 401) { adminLogout(); return; }
      errBox.textContent = e.message || 'Could not change the password.';
      errBox.hidden = false;
    }
  }

  function bindAdmin() {
    $('adminLoginBtn').addEventListener('click', adminLogin);
    $('adminPassword').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') adminLogin();
    });
    $('adminLogoutBtn').addEventListener('click', adminLogout);
    $('adminSearch').addEventListener('input', function () {
      adminQuery = this.value.trim();
      renderAdminOrders();
    });
    document.querySelectorAll('.filter-chips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        adminFilter = chip.getAttribute('data-filter');
        document.querySelectorAll('.filter-chips .chip').forEach(function (c) {
          c.classList.toggle('chip-active', c === chip);
        });
        renderAdminOrders();
      });
    });
    $('changePwBtn').addEventListener('click', adminChangePassword);
    if (adminToken) { showAdminDash(); loadAdmin(); }
  }

  /* ---------- nav ---------- */
  function bindNav() {
    $('brandHome').addEventListener('click', function (e) { e.preventDefault(); showView('home'); });
    $('navPlans').addEventListener('click', function () { showView('plans'); });
    $('navPackages').addEventListener('click', function () {
      if (lastCharId) $('pkgCharId').value = lastCharId;
      showView('packages');
    });
    $('navTrack').addEventListener('click', function () {
      if (lastCharId) $('trackCharId').value = lastCharId;
      showView('track');
    });
    $('navAdmin').addEventListener('click', function () { showView('admin'); });
    $('heroBuyBtn').addEventListener('click', function () {
      var el = $('plansSection');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    });
    $('heroPackagesBtn').addEventListener('click', function () {
      if (lastCharId) $('pkgCharId').value = lastCharId;
      showView('packages');
    });
    $('trackBtn').addEventListener('click', loadTrack);
    $('trackCharId').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadTrack(); });
    $('pkgBtn').addEventListener('click', loadMyPackages);
    $('pkgCharId').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadMyPackages(); });
    $('trackBackBtn').addEventListener('click', function () { showView('home'); });
    $('pkgBackBtn').addEventListener('click', function () { showView('home'); });
    $('adminLoginBackBtn').addEventListener('click', function () { showView('home'); });
    $('adminBackBtn').addEventListener('click', function () { showView('home'); });
    $('plansBackBtn').addEventListener('click', function () { showView('home'); });
    $('plansMyPackagesBtn').addEventListener('click', function () {
      if (lastCharId) $('pkgCharId').value = lastCharId;
      showView('packages');
    });
  }

  /* ---------- init ---------- */
  loadPacks();
  loadPayment();
  bindCheckout();
  bindSlider();
  bindAdmin();
  bindNav();
  showStep(1);
})();
