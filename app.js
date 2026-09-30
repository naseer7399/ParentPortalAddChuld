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
const MAX_CHILDREN = 5;

const ICONS = {
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c0-3.6 3.4-6.5 7.5-6.5s7.5 2.9 7.5 6.5"/></svg>',
  fees: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13l3 3v13H4z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 4.5 1.5 6 1.5 6h-15S6 12.5 6 8Z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18M3 12h18M3 17h11"/></svg>',
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11v2a2 2 0 0 0 2 2h1l3.5 4.5V6.5L6 11H5a2 2 0 0 0-2 2Z"/><path d="M9.5 6.5 19 3v16l-9.5-3.5"/><path d="M19 9.5a3 3 0 0 1 0 5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  reminder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h13l3 3v13H4z"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>'
};

let db = null;
let RECORD = null;            // the parent_portal doc for this student
let SCHOOL = null;            // parent_portal_meta/school doc
let NOTIFS = [];              // relevant, sorted notifications
let notifUnsub = null;
let activeTab = 'overview';
let SESSION = null;           // { docIds: [...], activeId, labels: { docId: {name, cls, adm} } }

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
  SESSION = loadSession();
  if (SESSION) {
    show('loadingScreen');
    bootFromSession();
  } else {
    show('loginScreen');
  }
});

function show(id) {
  ['setupScreen', 'loginScreen', 'loadingScreen', 'app'].forEach((s) => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

/* Try the last-active child first; if that record is gone, fall back to the others. */
async function bootFromSession() {
  const order = [SESSION.activeId, ...SESSION.docIds.filter((d) => d !== SESSION.activeId)];
  for (const id of order) {
    const res = await loadRecord(id);
    if (res === 'ok') { SESSION.activeId = id; rememberLabel(id); saveSession(); renderChildBar(); return; }
    if (res === 'error') { show('loginScreen'); return; }   // offline: keep the saved session
    removeChildFromSession(id);                              // 'missing'
  }
  clearSession();
  show('loginScreen');
}

/* ---------------------------------------------------------------
   Session (supports several children per device)
   --------------------------------------------------------------- */
function loadSession() {
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  if (!s) return null;
  if (s.docId && !s.docIds) s = { docIds: [s.docId], activeId: s.docId, labels: {} };   // old single-child format
  if (!Array.isArray(s.docIds) || !s.docIds.length) return null;
  if (!s.activeId || !s.docIds.includes(s.activeId)) s.activeId = s.docIds[0];
  s.labels = s.labels || {};
  return s;
}
function saveSession() {
  if (SESSION) localStorage.setItem(SESSION_KEY, JSON.stringify(SESSION));
}
function clearSession() {
  SESSION = null;
  localStorage.removeItem(SESSION_KEY);
}
function removeChildFromSession(docId) {
  if (!SESSION) return;
  SESSION.docIds = SESSION.docIds.filter((d) => d !== docId);
  delete SESSION.labels[docId];
  if (SESSION.activeId === docId) SESSION.activeId = SESSION.docIds[0] || null;
  if (SESSION.docIds.length) saveSession(); else clearSession();
}

/* ---------------------------------------------------------------
   Login
   --------------------------------------------------------------- */
function makeDocId(adm, dob) { return `${adm}__${dob.replace(/-/g, '')}`; }

function wireLogin() {
  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const adm = document.getElementById('admInput').value.trim();
    const dob = document.getElementById('dobInput').value; // yyyy-mm-dd
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    if (!adm || !dob) { errEl.textContent = 'Enter both the Admission No. and date of birth.'; return; }
    const docId = makeDocId(adm, dob);
    show('loadingScreen');
    const res = await loadRecord(docId);
    if (res === 'ok') {
      SESSION = { docIds: [docId], activeId: docId, labels: {} };
      rememberLabel(docId);
      saveSession();
      renderChildBar();
    } else {
      show('loginScreen');
      errEl.textContent = res === 'missing'
        ? 'No matching record found. Check the Admission No. and date of birth, or contact the school office.'
        : 'Could not connect right now. Check your internet connection and try again.';
    }
  });
  document.getElementById('btnLogout').addEventListener('click', () => {
    if (notifUnsub) { notifUnsub(); notifUnsub = null; }
    closeChildModal();
    clearSession();
    RECORD = null; NOTIFS = [];
    activeTab = 'overview';
    document.getElementById('loginForm').reset();
    show('loginScreen');
  });
}

/* Returns 'ok' | 'missing' | 'error'. RECORD is only replaced when the load succeeds. */
async function loadRecord(docId) {
  try {
    const snap = await db.collection('parent_portal').doc(docId).get();
    if (!snap.exists) return 'missing';
    RECORD = snap.data();
    if (!SCHOOL) {
      try {
        const sc = await db.collection('parent_portal_meta').doc('school').get();
        SCHOOL = sc.exists ? sc.data() : {};
      } catch (e) { SCHOOL = {}; }
    }
    NOTIFS = [];
    applyBranding();
    startNotifListener();
    show('app');
    switchTab(activeTab);
    return 'ok';
  } catch (err) {
    console.error('Could not load record', err);
    return 'error';
  }
}

/* ---------------------------------------------------------------
   Multiple children: switcher bar + "Add child" sheet
   --------------------------------------------------------------- */
function rememberLabel(docId) {
  if (!SESSION || !RECORD) return;
  SESSION.labels[docId] = { name: RECORD.name || '', cls: `${RECORD.class || ''}${RECORD.section ? '-' + RECORD.section : ''}`, adm: RECORD.admissionNo || '' };
}

function renderChildBar() {
  const bar = document.getElementById('childBar');
  if (!bar || !SESSION) return;
  const chips = SESSION.docIds.length > 1 ? SESSION.docIds.map((id) => {
    const l = SESSION.labels[id] || {};
    const first = String(l.name || 'Student').split(' ')[0];
    return `<button class="child-chip ${id === SESSION.activeId ? 'active' : ''}" data-child="${esc(id)}">${esc(first)}</button>`;
  }).join('') : '';
  bar.innerHTML = chips +
    `<button class="child-chip child-add" id="btnAddChild">${ICONS.plus}<span>${SESSION.docIds.length > 1 ? 'Add child' : 'Add another child'}</span></button>`;
}

async function switchChild(docId) {
  if (!SESSION || docId === SESSION.activeId) return;
  const res = await loadRecord(docId);
  if (res === 'ok') {
    SESSION.activeId = docId;
    rememberLabel(docId);
    saveSession();
    renderChildBar();
    window.scrollTo(0, 0);
  } else if (res === 'missing') {
    removeChildFromSession(docId);
    renderChildBar();
    toast("This child's record is no longer available. Please contact the school office.", true);
  } else {
    toast('Could not connect right now. Check your internet connection and try again.', true);
  }
}

function openChildModal() {
  closeChildModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.id = 'childModal';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="Add another child">
      <form id="addChildForm" novalidate>
        <div class="modal-body">
          <div class="set-row">
            <div class="set-icon">${ICONS.user}</div>
            <div class="set-text">
              <div class="set-title">Add another child</div>
              <div class="set-desc">Enter your other child's Admission No. and date of birth, just like on the login screen.</div>
            </div>
          </div>
          <div class="field" style="margin:0;">
            <label for="addAdm">Admission No.</label>
            <input type="text" id="addAdm" autocomplete="off" inputmode="numeric" placeholder="e.g. 102">
          </div>
          <div class="field" style="margin:0;">
            <label for="addDob">Student's date of birth</label>
            <input type="date" id="addDob">
          </div>
          <p class="login-error" id="addChildError" style="margin:0;"></p>
          <div id="childList"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" id="btnAddCancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btnAddSubmit">Add child</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(wrap);
  renderChildList();
  wrap.querySelector('#addAdm').focus();

  wrap.querySelector('#btnAddCancel').addEventListener('click', closeChildModal);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) { closeChildModal(); return; }
    const rm = e.target.closest('[data-remove]');
    if (rm) removeChild(rm.dataset.remove);
  });
  wrap.querySelector('#addChildForm').addEventListener('submit', submitAddChild);
}

function closeChildModal() {
  const el = document.getElementById('childModal');
  if (el) el.remove();
}

function renderChildList() {
  const box = document.getElementById('childList');
  if (!box || !SESSION) return;
  if (SESSION.docIds.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="section-title" style="margin:6px 0 4px;">Children on this device</div>` +
    SESSION.docIds.map((id) => {
      const l = SESSION.labels[id] || {};
      return `<div class="child-row">
        <div><div class="child-row-name">${esc(l.name || 'Student')}</div><div class="child-row-meta">Class ${esc(l.cls || '\u2014')} \u00b7 Adm. No. ${esc(l.adm || '')}</div></div>
        <button type="button" class="btn-link-danger" data-remove="${esc(id)}">Remove</button>
      </div>`;
    }).join('');
}

async function submitAddChild(e) {
  e.preventDefault();
  const adm = document.getElementById('addAdm').value.trim();
  const dob = document.getElementById('addDob').value;
  const errEl = document.getElementById('addChildError');
  const btn = document.getElementById('btnAddSubmit');
  errEl.textContent = '';
  if (!adm || !dob) { errEl.textContent = 'Enter both the Admission No. and date of birth.'; return; }
  const docId = makeDocId(adm, dob);
  if (SESSION.docIds.includes(docId)) { errEl.textContent = 'This child is already added.'; return; }
  if (SESSION.docIds.length >= MAX_CHILDREN) { errEl.textContent = `You can add up to ${MAX_CHILDREN} children.`; return; }

  btn.disabled = true; btn.textContent = 'Checking\u2026';
  const res = await loadRecord(docId);           // switches to the new child if it succeeds
  if (res === 'ok') {
    SESSION.docIds.push(docId);
    SESSION.activeId = docId;
    rememberLabel(docId);
    saveSession();
    renderChildBar();
    closeChildModal();
    window.scrollTo(0, 0);
    toast(`${RECORD.name} added.`);
  } else {
    btn.disabled = false; btn.textContent = 'Add child';
    errEl.textContent = res === 'missing'
      ? 'No matching record found. Check the Admission No. and date of birth, or contact the school office.'
      : 'Could not connect right now. Check your internet connection and try again.';
  }
}

async function removeChild(docId) {
  if (!SESSION || SESSION.docIds.length < 2) return;
  const l = SESSION.labels[docId] || {};
  if (!confirm(`Remove ${l.name || 'this child'} from this device? You can add them again later with their Admission No. and date of birth.`)) return;
  const wasActive = docId === SESSION.activeId;
  removeChildFromSession(docId);
  if (wasActive && SESSION) {
    const res = await loadRecord(SESSION.activeId);
    if (res === 'ok') { rememberLabel(SESSION.activeId); saveSession(); }
    else toast('Could not load the other child. Please try again.', true);
  }
  renderChildBar();
  renderChildList();
  toast('Child removed.');
}

document.addEventListener('click', (e) => {
  if (e.target.closest('#btnAddChild')) { openChildModal(); return; }
  const chip = e.target.closest('[data-child]');
  if (chip) switchChild(chip.dataset.child);
});

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
