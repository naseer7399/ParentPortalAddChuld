/* ===================================================================
   Ikhlas Parent Portal — application logic
   Read-only. All data comes live from Firestore — see README.md for
   the Firestore collections this app reads and the security rules
   that scope a parent to only their own child's record.
   =================================================================== */

const SESSION_KEY = 'ikhlas_parent_session_v1';
const SEEN_KEY = 'ikhlas_parent_seen_v1';
const CLEARED_KEY = 'ikhlas_parent_cleared_v1';
const POPUP_KEY = 'ikhlas_parent_popup_v1';

const ICONS = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-3.6 3.4-6.5 7.5-6.5s7.5 2.9 7.5 6.5"/></svg>',
  fees: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13l3 3v13H4z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 4.5 1.5 6 1.5 6h-15S6 12.5 6 8Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h11"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a2 2 0 0 0 2 2h1l3.5 4.5V6.5L6 11H5a2 2 0 0 0-2 2Z"/><path d="M9.5 6.5 19 3v16l-9.5-3.5"/><path d="M19 9.5a3 3 0 0 1 0 5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  reminder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13l3 3v13H4z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>'
};

let db = null;
let RECORD = null;            // the parent_portal doc for this student
let SCHOOL = null;            // parent_portal_meta/school doc
let NOTIFS = [];              // relevant, sorted notifications
let notifUnsub = null;
let activeTab = 'overview';

/* ---------------------------------------------------------------
   Boot
   --------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  if (typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG.apiKey) {
    show('setupScreen');
    return;
  }
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
  } catch (e) {
    console.error('Firebase init failed', e);
    show('setupScreen');
    return;
  }
  wireLogin();
  const saved = loadSession();
  if (saved && saved.docId) {
    show('loadingScreen');
    loadRecord(saved.docId).then((ok) => { if (!ok) { clearSession(); show('loginScreen'); } });
  } else {
    show('loginScreen');
  }
});

function show(id) {
  ['setupScreen', 'loginScreen', 'loadingScreen', 'app'].forEach((s) => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

/* ---------------------------------------------------------------
   Session
   --------------------------------------------------------------- */
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function saveSession(docId) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ docId }));
}
function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/* ---------------------------------------------------------------
   Login
   --------------------------------------------------------------- */
function wireLogin() {
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const adm = document.getElementById('admInput').value.trim();
    const dob = document.getElementById('dobInput').value; // yyyy-mm-dd
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    if (!adm || !dob) { errEl.textContent = 'Enter both the Admission No. and date of birth.'; return; }
    const docId = `${adm}__${dob.replace(/-/g, '')}`;
    show('loadingScreen');
    loadRecord(docId).then((ok) => {
      if (ok) { saveSession(docId); }
      else { show('loginScreen'); errEl.textContent = "No matching record found. Check the Admission No. and date of birth, or contact the school office."; }
    });
  });
  document.getElementById('btnLogout').addEventListener('click', () => {
    if (notifUnsub) { notifUnsub(); notifUnsub = null; }
    clearSession();
    RECORD = null; NOTIFS = [];
    document.getElementById('loginForm').reset();
    show('loginScreen');
  });
}

function loadRecord(docId) {
  return db.collection('parent_portal').doc(docId).get()
    .then((snap) => {
      if (!snap.exists) return false;
      RECORD = snap.data();
      return db.collection('parent_portal_meta').doc('school').get().catch(() => null);
    })
    .then((schoolSnap) => {
      if (!RECORD) return false;
      SCHOOL = (schoolSnap && schoolSnap.exists) ? schoolSnap.data() : {};
      applyBranding();
      startNotifListener();
      show('app');
      switchTab('overview');
      return true;
    })
    .catch((err) => {
      console.error('Could not load record', err);
      toast('Could not connect right now. Check your internet connection and try again.', true);
      return false;
    });
}

function applyBranding() {
  const name = SCHOOL && SCHOOL.name ? SCHOOL.name : 'Ikhlas School';
  document.getElementById('appSchoolName').textContent = name;
  document.getElementById('appStudentLine').textContent =
    `${RECORD.name} \u00b7 Class ${RECORD.class}${RECORD.section ? '-' + RECORD.section : ''} \u00b7 Adm. No. ${RECORD.admissionNo}`;
  const badge = document.getElementById('appBadge');
  badge.innerHTML = (SCHOOL && SCHOOL.logo) ? `<img src="${esc(SCHOOL.logo)}" alt="${esc(name)} logo">` : 'IP';
}

/* ---------------------------------------------------------------
   Tabs
   --------------------------------------------------------------- */
document.getElementById('tabbar') && document.getElementById('tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchTab(btn.dataset.tab);
});

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-icon').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon] || ''; });
  if (tab === 'overview') renderOverview();
  else if (tab === 'fees') renderFees();
  else if (tab === 'notifications') { renderNotifications(); markNotificationsSeen(); }
}

/* ---------------------------------------------------------------
   Overview tab
   --------------------------------------------------------------- */
function renderOverview() {
  const r = RECORD;
  const rows = [
    ['Student name', r.name],
    ['Admission No.', r.admissionNo],
    ['Class', `${r.class}${r.section ? '-' + r.section : ''}`],
    ['Date of birth', fmtDate(r.dob)],
    ["Father's name", r.fatherName || '\u2014'],
    ["Mother's name", r.motherName || '\u2014'],
    ['Contact phone', r.phone || '\u2014'],
    ['Address', r.address || '\u2014'],
    ['Admission date', fmtDate(r.admissionDate)]
  ];
  setContent(`
    <div class="card">
      <h2>Student details</h2>
      <div class="profile-grid">
        ${rows.map(([k, v]) => `<div class="profile-item"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('')}
      </div>
    </div>
    <p class="small-note">For any correction to these details, please contact the school office.</p>
  `);
}

/* ---------------------------------------------------------------
   Fees tab
   --------------------------------------------------------------- */
function renderFees() {
  const fees = RECORD.fees || [];
  const totalBalance = fees.reduce((s, f) => s + Number(f.balance || 0), 0);

  const hero = `
    <div class="balance-hero ${totalBalance > 0 ? 'due' : 'clear'}">
      <div class="amt">${money(totalBalance)}</div>
      <div class="lbl">${totalBalance > 0 ? 'Total balance due across all fees' : 'All fees are fully paid \u2014 thank you!'}</div>
    </div>
  `;

  const feeCards = fees.length ? fees.map((f) => {
    const pct = f.net > 0 ? Math.min(100, Math.round((f.paid / f.net) * 100)) : 100;
    return `
      <div class="card fee-card">
        <div class="fee-card-head">
          <div><div class="type">${esc(f.type)}</div><div class="year">${esc(f.year || '')}</div></div>
          ${tagForStatus(f.status)}
        </div>
        <div class="fee-nums"><span>Total: <b>${money(f.net)}</b></span><span>Paid: <b>${money(f.paid)}</b></span><span>Balance: <b>${money(f.balance)}</b></span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%;"></div></div>
      </div>
    `;
  }).join('') : `<div class="empty-state">${ICONS.empty}<p>No fee records yet.</p></div>`;

  const payments = (RECORD.payments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const paymentRows = payments.length ? payments.map((p) => `
    <div class="payment-row">
      <div><div>${esc(p.feeType || 'Payment')}</div><div class="pmeta">${fmtDate(p.date)} \u00b7 ${esc(p.method || '')}${p.receipt ? ' \u00b7 Receipt ' + esc(p.receipt) : ''}</div></div>
      <div class="pamt">${money(p.amount)}</div>
    </div>
  `).join('') : `<p class="small-note">No payments recorded yet.</p>`;

  setContent(`
    ${hero}
    <div class="section-title">Fee records</div>
    ${feeCards}
    <div class="card" style="margin-top:4px;">
      <h2>Payment history</h2>
      ${paymentRows}
    </div>
  `);
}

function tagForStatus(status) {
  const cls = status === 'Paid' ? 'tag-paid' : status === 'Partial' ? 'tag-partial' : 'tag-pending';
  return `<span class="tag ${cls}">${esc(status)}</span>`;
}

/* ---------------------------------------------------------------
   Notifications tab
   --------------------------------------------------------------- */
function startNotifListener() {
  if (notifUnsub) notifUnsub();
  notifUnsub = db.collection('notifications').orderBy('createdAt', 'desc').limit(100)
    .onSnapshot((snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const clearedAt = getClearedAt();
      NOTIFS = all.filter(isForMe).filter((n) => Number(n.createdAt || 0) > clearedAt);
      updateNotifBadge();
      if (activeTab === 'notifications') renderNotifications();
      maybeNotify(NOTIFS);
    }, (err) => console.error('Notification listener error', err));
}

function isForMe(n) {
  const aud = n.audience || { type: 'all' };
  if (aud.type === 'all') return true;
  if (aud.type === 'class') return String(aud.class) === String(RECORD.class);
  if (aud.type === 'students') return Array.isArray(aud.ids) && aud.ids.includes(RECORD.admissionNo);
  return false;
}

function getSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}'); } catch (e) { return {}; }
}
function setSeen(obj) { localStorage.setItem(SEEN_KEY, JSON.stringify(obj)); }

function updateNotifBadge() {
  const seen = getSeen();
  const unread = NOTIFS.filter((n) => !seen[n.id]).length;
  const badge = document.getElementById('notifBadge');
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
}

function markNotificationsSeen() {
  const seen = getSeen();
  NOTIFS.forEach((n) => { seen[n.id] = true; });
  setSeen(seen);
  updateNotifBadge();
}

function notifHeader() {
  return `<div class="page-head"><h2>Notices</h2><button class="icon-btn-soft" id="btnNotifSettings" aria-label="Notice settings" title="Settings">${ICONS.gear}</button></div>`;
}

function renderNotifications() {
  const seen = getSeen();
  if (!NOTIFS.length) {
    setContent(notifHeader() + `<div class="empty-state">${ICONS.empty}<p>No notices yet. Fee reminders and school announcements will appear here.</p></div>`);
    return;
  }
  setContent(notifHeader() + NOTIFS.map((n) => `
    <div class="notif-item ${seen[n.id] ? '' : 'unread'}">
      <div class="notif-kind">${n.kind === 'fee_reminder' ? ICONS.reminder : ICONS.megaphone} ${n.kind === 'fee_reminder' ? 'Fee reminder' : 'Announcement'}</div>
      <div class="notif-head"><div class="notif-title">${esc(n.title || '')}</div><div class="notif-time">${relTime(n.createdAt)}</div></div>
      <div class="notif-msg">${esc(n.message || '')}</div>
    </div>
  `).join(''));
}

/* ---- Clear all (hides on this device only; parents can't delete school data) ---- */
function clearedKey() { return CLEARED_KEY + '_' + (RECORD ? RECORD.admissionNo : ''); }
function getClearedAt() { return Number(localStorage.getItem(clearedKey()) || 0); }
function clearAllNotices() {
  const newest = NOTIFS.reduce((m, n) => Math.max(m, Number(n.createdAt || 0)), 0);
  localStorage.setItem(clearedKey(), String(Math.max(Date.now(), newest)));
  NOTIFS = [];
  updateNotifBadge();
  if (activeTab === 'notifications') renderNotifications();
}

/* ---- Pop-up preference ---- */
function popupsWanted() { return localStorage.getItem(POPUP_KEY) !== 'off'; }
function permState() { return ('Notification' in window) ? Notification.permission : 'unsupported'; }

function openNotifSettings() {
  closeNotifSettings();
  let wanted = popupsWanted();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'notifSettings';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Notice settings">
      <div class="modal-body">
        <div class="set-row">
          <div class="set-icon">${ICONS.bell}</div>
          <div class="set-text">
            <div class="set-title">Show pop-up on this device</div>
            <div class="set-desc">Also show a device notification when a new notice arrives. <span class="perm-pill" id="permPill"></span></div>
          </div>
          <button class="switch" id="popupSwitch" role="switch" aria-label="Show pop-up on this device"><span class="knob"></span></button>
        </div>
        <button class="btn btn-primary btn-with-icon" id="btnAllowPerm">${ICONS.bell} Allow pop-up notifications</button>
        <p class="small-note perm-help hidden" id="permHelp"></p>
        <button class="btn btn-danger-outline" id="btnClearAll">Clear all notices</button>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" id="btnSetCancel">Cancel</button>
        <button class="btn btn-primary" id="btnSetDone">Done</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const sw = wrap.querySelector('#popupSwitch');
  const pill = wrap.querySelector('#permPill');
  const allowBtn = wrap.querySelector('#btnAllowPerm');
  const help = wrap.querySelector('#permHelp');

  function refresh() {
    sw.classList.toggle('on', wanted);
    sw.setAttribute('aria-checked', wanted ? 'true' : 'false');
    const st = permState();
    pill.className = 'perm-pill ' + (st === 'granted' ? 'ok' : st === 'denied' ? 'bad' : '');
    pill.textContent = st === 'granted' ? 'Pop-ups allowed' : st === 'denied' ? 'Pop-ups blocked' : st === 'unsupported' ? 'Not supported here' : 'Pop-ups not yet allowed';
    allowBtn.classList.toggle('hidden', st !== 'default');
    help.classList.toggle('hidden', st !== 'denied' && st !== 'unsupported');
    help.textContent = st === 'denied'
      ? 'Notifications are blocked for this app. Turn them on in your phone or browser site settings, then reopen the app.'
      : 'This browser does not support pop-up notifications.';
  }
  refresh();

  sw.addEventListener('click', () => { wanted = !wanted; refresh(); });
  allowBtn.addEventListener('click', () => {
    Promise.resolve(Notification.requestPermission()).then(refresh).catch(refresh);
  });
  wrap.querySelector('#btnClearAll').addEventListener('click', () => {
    if (!NOTIFS.length) { toast('There are no notices to clear.'); return; }
    if (confirm('Clear all notices from this device? New notices will still arrive.')) {
      clearAllNotices();
      closeNotifSettings();
      toast('All notices cleared.');
    }
  });
  wrap.querySelector('#btnSetCancel').addEventListener('click', closeNotifSettings);
  wrap.querySelector('#btnSetDone').addEventListener('click', () => {
    localStorage.setItem(POPUP_KEY, wanted ? 'on' : 'off');
    closeNotifSettings();
    toast(wanted ? 'Pop-ups turned on.' : 'Pop-ups turned off.');
  });
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeNotifSettings(); });
}
function closeNotifSettings() {
  const el = document.getElementById('notifSettings');
  if (el) el.remove();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#btnNotifSettings')) openNotifSettings();
});

function maybeNotify(list) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  if (!popupsWanted()) return;
  const seen = getSeen();
  const fresh = list.filter((n) => !seen[n.id] && !notifiedOnce[n.id]);
  fresh.slice(0, 3).forEach((n) => {
    notifiedOnce[n.id] = true;
    const title = n.title || 'School notice';
    const opts = { body: n.message || '', icon: 'icon-192.png', tag: n.id };
    // Service-worker notifications also work on Android, where new Notification() is blocked.
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, opts)).catch(() => {
        try { new Notification(title, opts); } catch (e) { /* ignore */ }
      });
    } else {
      try { new Notification(title, opts); } catch (e) { /* ignore */ }
    }
  });
}
const notifiedOnce = {};

/* ---------------------------------------------------------------
   Helpers
   --------------------------------------------------------------- */
function setContent(html) { document.getElementById('content').innerHTML = html; }
function money(n) { n = Math.round(Number(n) || 0); return '\u20B9' + n.toLocaleString('en-IN'); }
function fmtDate(d) {
  if (!d) return '\u2014';
  const parts = String(d).split('-');
  if (parts.length !== 3) return d;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}
function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - Number(ts);
  const day = 86400000;
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + 'm ago';
  if (diff < day) return Math.round(diff / 3600000) + 'h ago';
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return Math.round(diff / day) + 'd ago';
  const d = new Date(Number(ts));
  return fmtDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}
function esc(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, danger) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (danger ? ' danger' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast'; }, 3000);
}
