'use strict';
/* =====================================================================
   Home Inventory — a single-file app.
   Data lives in the browser and (optionally) in a file in your OneDrive:
   OneDrive > Apps > <your app name> > inventory.json
   ===================================================================== */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const todayStr = () => new Date().toISOString().slice(0, 10);
const DAY = 86400000;
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const fmt = n => (Math.round(n * 100) / 100).toString();

/* ---------------- storage (safe localStorage) ---------------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

/* ---------------- data model ----------------
   items:    {id,name,category,location,qty,unit,minQty,buyQty,expiry,barcode,notes,updatedAt,deleted?}
   shopping: {id,itemId|null,name,qty,unit,done,auto,updatedAt,deleted?}
   log:      {id,itemId,t,delta,kind:'use'|'restock'|'set'}   (used for "runs out in X days")
*/
const emptyData = () => ({ version: 1, items: [], shopping: [], log: [], savedAt: null });
let data = store.get('inv.data', null) || emptyData();
let ui = { tab: 'items', q: '', loc: '', cat: '' };

function liveItems() { return data.items.filter(i => !i.deleted); }
function liveShop() { return data.shopping.filter(s => !s.deleted); }
function itemById(id) { return data.items.find(i => i.id === id && !i.deleted); }

function save() {
  data.savedAt = now();
  store.set('inv.data', data);
  store.set('inv.dirty', true);
  cloud.scheduleSave();
  render();
}

/* ---------------- stock rules ---------------- */
function isLow(it) { return num(it.minQty) > 0 && num(it.qty) <= num(it.minQty); }

// Keep the shopping list in step with stock levels.
function syncShoppingFor(it) {
  const open = data.shopping.find(s => s.itemId === it.id && !s.deleted && !s.done);
  if (!it.deleted && isLow(it)) {
    if (!open) {
      const want = num(it.buyQty) > 0 ? num(it.buyQty) : Math.max(1, num(it.minQty) * 2 - num(it.qty));
      data.shopping.push({ id: uid(), itemId: it.id, name: it.name, qty: want, unit: it.unit || '', done: false, auto: true, updatedAt: now() });
    } else if (open.name !== it.name) { open.name = it.name; open.updatedAt = now(); }
  } else if (open && open.auto) {
    open.deleted = true; open.updatedAt = now();
  }
}

function changeQty(id, delta, kind) {
  const it = itemById(id); if (!it) return;
  const before = num(it.qty);
  const after = Math.max(0, Math.round((before + delta) * 1000) / 1000);
  if (after === before) return;
  it.qty = after; it.updatedAt = now();
  data.log.push({ id: uid(), itemId: id, t: now(), delta: after - before, kind: kind || (delta < 0 ? 'use' : 'restock') });
  if (data.log.length > 5000) data.log = data.log.slice(-5000);
  syncShoppingFor(it);
  save();
}

/* ---------------- consumption rate ---------------- */
// Average use per day over the last 60 days, from the "−" presses.
function usage(it) {
  const since = Date.now() - 60 * DAY;
  const uses = data.log.filter(l => l.itemId === it.id && l.kind === 'use' && Date.parse(l.t) >= since);
  if (uses.length < 2) return null;
  const used = uses.reduce((a, l) => a - l.delta, 0);
  const first = Date.parse(uses[0].t);
  const days = Math.max(7, (Date.now() - first) / DAY);   // at least a week, so 2 presses today don't look like a huge rate
  const perDay = used / days;
  if (perDay <= 0) return null;
  return { perDay, daysLeft: num(it.qty) / perDay };
}
function usageText(u, unit) {
  if (!u) return '';
  const per = u.perDay >= 1 ? `${fmt(u.perDay)} ${unit}/day` : u.perDay * 7 >= 1 ? `${fmt(u.perDay * 7)} ${unit}/week` : `${fmt(u.perDay * 30)} ${unit}/month`;
  const left = u.daysLeft < 1 ? 'runs out today' : `~${Math.round(u.daysLeft)} days left`;
  return `${per} · ${left}`;
}

/* ---------------- expiry ---------------- */
function daysToExpiry(it) {
  if (!it.expiry) return null;
  return Math.round((Date.parse(it.expiry) - Date.parse(todayStr())) / DAY);
}
function expiryTag(it) {
  const d = daysToExpiry(it); if (d == null) return '';
  const soonDays = settings.soonDays;
  if (d < 0) return `<span class="tag bad">expired ${-d}d ago</span>`;
  if (d === 0) return `<span class="tag bad">expires today</span>`;
  if (d <= soonDays) return `<span class="tag low">expires in ${d}d</span>`;
  return `<span class="tag ok">exp ${esc(it.expiry)}</span>`;
}

/* ---------------- settings ---------------- */
const settings = Object.assign({ soonDays: 7, runOutDays: 7, clientId: '' }, store.get('inv.settings', {}));
function saveSettings() { store.set('inv.settings', settings); }

/* ---------------- rendering ---------------- */
function uniq(arr) { return [...new Set(arr.filter(Boolean).map(s => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)); }

function itemRow(it) {
  const u = usage(it);
  return `<div class="row">
    <div class="main" data-edit="${esc(it.id)}">
      <div class="name">${esc(it.name)}</div>
      <div class="sub">
        ${it.category ? `<span>${esc(it.category)}</span>` : ''}
        ${isLow(it) ? `<span class="tag low">low · min ${fmt(num(it.minQty))}</span>` : ''}
        ${expiryTag(it)}
        ${u ? `<span>${esc(usageText(u, it.unit || ''))}</span>` : ''}
      </div>
    </div>
    <div class="qty">
      <button data-dec="${esc(it.id)}" aria-label="Use one">−</button>
      <b>${fmt(num(it.qty))}${it.unit ? `<br><small class="muted">${esc(it.unit)}</small>` : ''}</b>
      <button data-inc="${esc(it.id)}" aria-label="Add one">+</button>
    </div>
  </div>`;
}

function renderItems() {
  const all = liveItems();
  const locs = uniq(all.map(i => i.location));
  const cats = uniq(all.map(i => i.category));
  $('#headerExtra').innerHTML = `
    <input class="search" id="q" type="search" placeholder="Search items…" value="${esc(ui.q)}">
    ${locs.length > 1 ? `<div class="chips">${['', ...locs].map(l => `<button class="chip ${ui.loc === l ? 'on' : ''}" data-loc="${esc(l)}">${l ? esc(l) : 'All places'}</button>`).join('')}</div>` : ''}
    ${cats.length > 1 ? `<div class="chips">${['', ...cats].map(c => `<button class="chip ${ui.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${c ? esc(c) : 'All categories'}</button>`).join('')}</div>` : ''}`;
  const q = ui.q.toLowerCase();
  const list = all.filter(i =>
    (!ui.loc || i.location === ui.loc) && (!ui.cat || i.category === ui.cat) &&
    (!q || [i.name, i.category, i.location, i.notes, i.barcode].join(' ').toLowerCase().includes(q)));
  if (!all.length) return `<div class="empty">No items yet.<br>Tap <b>+</b> to add your first one, or <b>▦ Scan</b> a barcode.</div>`;
  if (!list.length) return `<div class="empty">Nothing matches.</div>`;
  const groups = {};
  list.forEach(i => (groups[i.location || 'No place set'] ||= []).push(i));
  return Object.keys(groups).sort().map(g =>
    `<h2>${esc(g)} · ${groups[g].length}</h2><div class="list">${groups[g].sort((a, b) => a.name.localeCompare(b.name)).map(itemRow).join('')}</div>`).join('');
}

function renderShop() {
  $('#headerExtra').innerHTML = `<div class="inline" style="margin-top:8px">
    <input class="search" style="margin:0;flex:1" id="shopAdd" placeholder="Add something to buy…">
    <button class="btn primary" id="shopAddBtn">Add</button></div>`;
  const list = liveShop();
  if (!list.length) return `<div class="empty">Shopping list is empty.<br>Items you mark with a minimum stock appear here automatically when they run low.</div>`;
  const open = list.filter(s => !s.done), done = list.filter(s => s.done);
  const row = s => {
    const it = s.itemId && itemById(s.itemId);
    return `<div class="row ${s.done ? 'done' : ''}">
      <input type="checkbox" class="check" data-tick="${esc(s.id)}" ${s.done ? 'checked' : ''} aria-label="Bought">
      <div class="main" data-shopedit="${esc(s.id)}">
        <div class="name">${esc(s.name)}</div>
        <div class="sub"><span>Buy ${fmt(num(s.qty))} ${esc(s.unit || '')}</span>
          ${it ? `<span>have ${fmt(num(it.qty))}${it.location ? ' · ' + esc(it.location) : ''}</span>` : ''}
          ${s.auto ? '<span class="tag low">auto</span>' : ''}</div>
      </div></div>`;
  };
  return `${open.length ? `<h2>To buy · ${open.length}</h2><div class="list">${open.map(row).join('')}</div>` : ''}
    ${done.length ? `<h2>Bought · ${done.length}</h2><div class="list">${done.map(row).join('')}</div>
    <div class="actions"><button class="btn" id="clearDone">Clear bought items</button></div>` : ''}
    <p class="muted">Ticking an item that's linked to your inventory adds the bought amount to its stock.</p>`;
}

function soonLists() {
  const all = liveItems();
  const exp = all.filter(i => { const d = daysToExpiry(i); return d != null && d <= settings.soonDays; })
    .sort((a, b) => daysToExpiry(a) - daysToExpiry(b));
  const run = all.map(i => ({ i, u: usage(i) })).filter(x => x.u && x.u.daysLeft <= settings.runOutDays && num(x.i.qty) > 0 && !exp.includes(x.i))
    .sort((a, b) => a.u.daysLeft - b.u.daysLeft);
  return { exp, run };
}
function renderSoon() {
  $('#headerExtra').innerHTML = '';
  const { exp, run } = soonLists();
  if (!exp.length && !run.length) return `<div class="empty">Nothing to worry about. 🎉<br><span class="muted">Items expiring within ${settings.soonDays} days, and items likely to run out within ${settings.runOutDays} days, show up here.</span></div>`;
  return `${exp.length ? `<h2>Expiring · use these first</h2><div class="list">${exp.map(itemRow).join('')}</div>` : ''}
    ${run.length ? `<h2>Likely to run out soon</h2><div class="list">${run.map(x => itemRow(x.i)).join('')}</div>` : ''}`;
}

function renderSettings() {
  $('#headerExtra').innerHTML = '';
  const signedIn = cloud.signedIn();
  const redirect = cloud.redirectUri();
  const canCloud = location.protocol === 'https:' || location.hostname === 'localhost';
  return `
  <div class="card">
    <h3 style="margin-top:0">OneDrive</h3>
    ${signedIn ? `<p>✅ Connected${cloud.account ? ' as <b>' + esc(cloud.account) + '</b>' : ''}. Your data is saved to <b>OneDrive › Apps › (your app name) › inventory.json</b>.</p>
      <div class="actions" style="justify-content:flex-start"><button class="btn" id="syncNow">Sync now</button><button class="btn danger" id="signOut">Disconnect</button></div><p class="muted">Disconnect removes the sign-in from this device. To fully withdraw the app's permission, visit <a href="https://account.live.com/consent/Manage" target="_blank" rel="noopener">account.live.com/consent/Manage</a>.</p>`
    : `<p class="muted">Not connected. Your data is only saved in this browser on this device.</p>
      ${canCloud ? '' : `<p class="tag bad" style="display:inline-block;padding:4px 8px">OneDrive needs the app to be opened from a web address (https://…), not a file on your computer.</p>`}
      <label>Application (client) ID from Microsoft
        <input id="clientId" placeholder="e.g. 1a2b3c4d-…" value="${esc(settings.clientId)}" autocomplete="off"></label>
      <p class="muted">When registering the app with Microsoft, use this as the redirect address:<br><code>${esc(redirect)}</code></p>
      <div class="actions" style="justify-content:flex-start"><button class="btn primary" id="signIn" ${canCloud ? '' : 'disabled'}>Connect OneDrive</button></div>`}
  </div>
  <div class="card">
    <h3 style="margin-top:0">Reminders</h3>
    <div class="grid">
      <label>"Use soon" if expiring within (days)<input type="number" min="0" id="soonDays" value="${settings.soonDays}"></label>
      <label>"Running out" if within (days)<input type="number" min="0" id="runOutDays" value="${settings.runOutDays}"></label>
    </div>
  </div>
  <div class="card">
    <h3 style="margin-top:0">Backup</h3>
    <p class="muted">Download a copy of everything, or load one back in.</p>
    <div class="actions" style="justify-content:flex-start">
      <button class="btn" id="exportBtn">Download backup</button>
      <button class="btn" id="exportCsv">Download as spreadsheet (CSV)</button>
      <label class="btn" style="color:inherit;font-size:inherit">Load backup<input type="file" id="importFile" accept=".json,application/json" hidden></label>
    </div>
  </div>
  <p class="muted">${liveItems().length} items · ${liveShop().filter(s => !s.done).length} to buy</p>`;
}

function render() {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === ui.tab));
  const v = { items: renderItems, shop: renderShop, soon: renderSoon, settings: renderSettings }[ui.tab]();
  $('#view').innerHTML = v;
  $('#fab').hidden = !(ui.tab === 'items');
  const nShop = liveShop().filter(s => !s.done).length;
  const { exp, run } = soonLists();
  const nSoon = new Set([...exp.map(i => i.id), ...run.map(x => x.i.id)]).size;
  setBadge('#shopBadge', nShop); setBadge('#soonBadge', nSoon);
  $('#syncState').textContent = cloud.status;
  // keep focus in search while typing
  if (ui.tab === 'items' && document.activeElement?.id !== 'q' && ui._focusQ) { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
function setBadge(sel, n) { const b = $(sel); b.hidden = !n; b.textContent = n; }

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2500); }

/* ---------------- dialogs ---------------- */
const dlg = $('#dlg');
function openDialog(html) { $('#dlgBody').innerHTML = html; if (!dlg.open) dlg.showModal(); }
function closeDialog() { scanner.stop(); if (dlg.open) dlg.close(); }
dlg.addEventListener('close', () => scanner.stop());
dlg.addEventListener('click', e => { if (e.target === dlg) closeDialog(); });

function itemForm(it, isNew) {
  const all = liveItems();
  const dl = (id, vals) => `<datalist id="${id}">${vals.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
  const u = !isNew && usage(it);
  openDialog(`<h3>${isNew ? 'Add item' : 'Edit item'}</h3>
  <form id="itemForm" class="grid">
    <label class="full">Name<input name="name" required value="${esc(it.name)}" autocomplete="off"></label>
    <label>Category<input name="category" list="dlCat" value="${esc(it.category)}" placeholder="e.g. Pantry"></label>
    <label>Place<input name="location" list="dlLoc" value="${esc(it.location)}" placeholder="e.g. Kitchen cupboard"></label>
    <label>Quantity<input name="qty" type="number" step="any" min="0" inputmode="decimal" value="${fmt(num(it.qty))}"></label>
    <label>Unit<input name="unit" list="dlUnit" value="${esc(it.unit)}" placeholder="e.g. pcs, kg, L"></label>
    <label>Minimum to keep<input name="minQty" type="number" step="any" min="0" inputmode="decimal" value="${it.minQty ? fmt(num(it.minQty)) : ''}" placeholder="0 = no alert"></label>
    <label>Amount to buy<input name="buyQty" type="number" step="any" min="0" inputmode="decimal" value="${it.buyQty ? fmt(num(it.buyQty)) : ''}" placeholder="auto"></label>
    <label>Expiry date<input name="expiry" type="date" value="${esc(it.expiry || '')}"></label>
    <label>Barcode<input name="barcode" value="${esc(it.barcode || '')}" inputmode="numeric" autocomplete="off"></label>
    <label class="full">Notes<textarea name="notes" rows="2">${esc(it.notes || '')}</textarea></label>
    ${u ? `<p class="full muted" style="margin:0">Usage: ${esc(usageText(u, it.unit || ''))}</p>` : ''}
    ${dl('dlCat', uniq([...all.map(i => i.category), 'Pantry', 'Fridge', 'Freezer', 'Cleaning', 'Toiletries', 'Medicine', 'Household']))}
    ${dl('dlLoc', uniq([...all.map(i => i.location), 'Kitchen', 'Fridge', 'Freezer', 'Bathroom', 'Garage', 'Storage room']))}
    ${dl('dlUnit', uniq([...all.map(i => i.unit), 'pcs', 'pack', 'bottle', 'can', 'kg', 'g', 'L', 'ml', 'roll', 'box']))}
  </form>
  <div class="actions">
    ${isNew ? '' : '<button class="btn danger left" id="delItem">Delete</button>'}
    <button class="btn" id="cancel">Cancel</button>
    <button class="btn primary" id="saveItem">Save</button>
  </div>`);
  $('#cancel').onclick = closeDialog;
  if (!isNew) $('#delItem').onclick = () => {
    if (!confirm(`Delete "${it.name}"?`)) return;
    it.deleted = true; it.updatedAt = now(); syncShoppingFor(it); closeDialog(); save(); toast('Deleted');
  };
  const submit = () => {
    const f = $('#itemForm'); if (!f.reportValidity()) return;
    const v = Object.fromEntries(new FormData(f));
    const newQty = num(v.qty);
    const target = isNew ? { id: uid() } : it;
    const oldQty = isNew ? 0 : num(it.qty);
    Object.assign(target, {
      name: v.name.trim(), category: v.category.trim(), location: v.location.trim(),
      qty: newQty, unit: v.unit.trim(), minQty: num(v.minQty), buyQty: num(v.buyQty),
      expiry: v.expiry || '', barcode: v.barcode.trim(), notes: v.notes.trim(), updatedAt: now(),
    });
    if (isNew) data.items.push(target);
    else if (newQty !== oldQty) data.log.push({ id: uid(), itemId: target.id, t: now(), delta: newQty - oldQty, kind: 'set' });
    syncShoppingFor(target);
    closeDialog(); save(); toast(isNew ? 'Added' : 'Saved');
  };
  $('#saveItem').onclick = submit;
  $('#itemForm').onsubmit = e => { e.preventDefault(); submit(); };
  if (isNew && !it.name) setTimeout(() => $('#itemForm [name=name]').focus(), 50);
}

function shopForm(s) {
  openDialog(`<h3>Shopping item</h3>
  <form id="shopForm" class="grid">
    <label class="full">Name<input name="name" required value="${esc(s.name)}"></label>
    <label>Amount<input name="qty" type="number" step="any" min="0" value="${fmt(num(s.qty))}"></label>
    <label>Unit<input name="unit" value="${esc(s.unit || '')}"></label>
  </form>
  <div class="actions"><button class="btn danger left" id="delShop">Remove</button><button class="btn" id="cancel">Cancel</button><button class="btn primary" id="saveShop">Save</button></div>`);
  $('#cancel').onclick = closeDialog;
  $('#delShop').onclick = () => { s.deleted = true; s.updatedAt = now(); closeDialog(); save(); };
  $('#saveShop').onclick = () => {
    const v = Object.fromEntries(new FormData($('#shopForm')));
    Object.assign(s, { name: v.name.trim() || s.name, qty: num(v.qty), unit: v.unit.trim(), auto: false, updatedAt: now() });
    closeDialog(); save();
  };
}

function tickShop(id, checked) {
  const s = data.shopping.find(x => x.id === id); if (!s) return;
  s.done = checked; s.updatedAt = now();
  const it = s.itemId && itemById(s.itemId);
  if (it && num(s.qty) > 0) {
    // ticking adds the bought amount to stock, unticking takes it back
    const before = num(it.qty);
    it.qty = Math.max(0, before + (checked ? 1 : -1) * num(s.qty)); it.updatedAt = now();
    data.log.push({ id: uid(), itemId: it.id, t: now(), delta: it.qty - before, kind: 'restock' });
    if (checked) toast(`${it.name}: now ${fmt(it.qty)} ${it.unit || ''}`);
  }
  save();
}

/* ---------------- barcode scanning ---------------- */
const scanner = {
  stream: null, reader: null, timer: null,
  stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.reader) { try { this.reader.reset(); } catch {} this.reader = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
  },
  async start(video, onCode, onError) {
    try {
      if ('BarcodeDetector' in window) {
        const det = new BarcodeDetector();
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = this.stream; await video.play();
        this.timer = setInterval(async () => {
          try { const r = await det.detect(video); if (r.length) { this.stop(); onCode(r[0].rawValue); } } catch {}
        }, 250);
      } else {
        // Safari/iPhone and Firefox: load a scanner library on demand
        if (!window.ZXing) await loadScript('vendor/zxing-0.21.3.min.js');
        this.reader = new ZXing.BrowserMultiFormatReader();
        await this.reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => {
          if (res) { const code = res.getText(); this.stop(); onCode(code); }
        });
      }
    } catch (e) { this.stop(); onError(e); }
  },
};
function loadScript(src) {
  return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load the scanner')); document.head.appendChild(s); });
}

function openScanner() {
  openDialog(`<h3>Scan a barcode</h3>
    <video id="scanVideo" playsinline muted></video>
    <p class="muted" id="scanMsg">Point your camera at the barcode.</p>
    <div class="inline"><input class="search" style="margin:0;flex:1" id="manualCode" inputmode="numeric" placeholder="…or type the number">
    <button class="btn" id="manualGo">Go</button></div>
    <div class="actions"><button class="btn" id="cancel">Close</button></div>`);
  $('#cancel').onclick = closeDialog;
  $('#manualGo').onclick = () => { const c = $('#manualCode').value.trim(); if (c) handleCode(c); };
  if (!navigator.mediaDevices?.getUserMedia) { $('#scanMsg').textContent = 'Camera not available here. Type the number instead.'; return; }
  scanner.start($('#scanVideo'), handleCode, e => { $('#scanMsg').textContent = 'Camera could not start (' + (e.message || e.name) + '). Type the number instead.'; });
}

async function handleCode(code) {
  scanner.stop();
  const found = liveItems().find(i => i.barcode && i.barcode === code);
  if (found) { quickItem(found); return; }
  openDialog(`<h3>New barcode</h3><p class="muted">Looking up ${esc(code)}…</p>`);
  let name = '', category = '';
  try {
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,generic_name,categories`, { signal: ctl.signal });
    if (r.ok) {
      const j = await r.json();
      if (j.product) {
        name = [j.product.brands?.split(',')[0], j.product.product_name || j.product.generic_name].filter(Boolean).join(' ').trim();
        category = (j.product.categories || '').split(',')[0]?.trim() || '';
      }
    }
  } catch {}
  itemForm({ name, category, location: '', qty: 1, unit: 'pcs', minQty: 0, barcode: code }, true);
  if (!name) toast("Product not found online. Type its name.");
}

// After a scan of a known item: quick −/+ without hunting for it
function quickItem(it) {
  const draw = () => openDialog(`<h3>${esc(it.name)}</h3>
    <p class="muted">${esc([it.location, it.category].filter(Boolean).join(' · '))}</p>
    <div class="inline" style="justify-content:center;gap:16px;margin:16px 0">
      <button class="btn" style="font-size:22px;width:64px" id="qMinus">−1</button>
      <b style="font-size:28px">${fmt(num(it.qty))} <small class="muted">${esc(it.unit || '')}</small></b>
      <button class="btn" style="font-size:22px;width:64px" id="qPlus">+1</button>
    </div>
    <div class="actions"><button class="btn left" id="qEdit">Edit details</button><button class="btn" id="qScan">Scan another</button><button class="btn primary" id="cancel">Done</button></div>`);
  draw();
  const bind = () => {
    $('#qMinus').onclick = () => { changeQty(it.id, -1); draw(); bind(); };
    $('#qPlus').onclick = () => { changeQty(it.id, +1); draw(); bind(); };
    $('#qEdit').onclick = () => itemForm(it, false);
    $('#qScan').onclick = openScanner;
    $('#cancel').onclick = closeDialog;
  };
  bind();
}

/* ---------------- export / import ---------------- */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCsv() {
  const cols = ['name', 'category', 'location', 'qty', 'unit', 'minQty', 'expiry', 'barcode', 'notes'];
  const q = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
  const rows = [cols.join(','), ...liveItems().map(i => cols.map(c => q(i[c])).join(','))];
  download(`inventory-${todayStr()}.csv`, '﻿' + rows.join('\r\n'), 'text/csv');
}

/* ---------------- merge (so phone + laptop edits don't overwrite each other) ---------------- */
function mergeData(a, b) {
  const byId = (x, y) => {
    const m = new Map();
    [...(x || []), ...(y || [])].forEach(r => { const o = m.get(r.id); if (!o || (r.updatedAt || '') > (o.updatedAt || '')) m.set(r.id, r); });
    return [...m.values()];
  };
  const logs = new Map(); [...(a.log || []), ...(b.log || [])].forEach(l => logs.set(l.id, l));
  return {
    version: 1,
    items: byId(a.items, b.items),
    shopping: byId(a.shopping, b.shopping),
    log: [...logs.values()].sort((x, y) => x.t.localeCompare(y.t)).slice(-5000),
    savedAt: [a.savedAt, b.savedAt].filter(Boolean).sort().pop() || null,
  };
}

/* ---------------- OneDrive (Microsoft Graph) ----------------
   Sign-in uses the standard Microsoft "authorization code + PKCE" flow for
   web apps. Only permission asked: read/write this app's own folder in OneDrive.
*/
const cloud = {
  status: '',
  account: store.get('inv.account', ''),
  saveTimer: null, busy: false, again: false,
  AUTH: 'https://login.microsoftonline.com/common/oauth2/v2.0',
  SCOPE: 'Files.ReadWrite.AppFolder User.Read offline_access',
  FILE: 'https://graph.microsoft.com/v1.0/me/drive/special/approot:/inventory.json:/content',
  redirectUri() { return location.origin + location.pathname; },
  signedIn() { return !!store.get('inv.tokens', null); },
  setStatus(s) { this.status = s; const el = $('#syncState'); if (el) el.textContent = s; },

  async signIn() {
    if (!settings.clientId) { toast('Paste the Application (client) ID first'); return; }
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = uid();
    sessionStorage.setItem('inv.pkce', JSON.stringify({ verifier, state }));
    const p = new URLSearchParams({ client_id: settings.clientId, response_type: 'code', redirect_uri: this.redirectUri(),
      scope: this.SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' });
    location.href = `${this.AUTH}/authorize?${p}`;
  },

  async handleRedirect() {
    const qs = new URLSearchParams(location.search);
    if (!qs.has('code') && !qs.has('error')) return;
    history.replaceState(null, '', this.redirectUri());
    if (qs.has('error')) { alert('Microsoft sign-in failed: ' + (qs.get('error_description') || qs.get('error'))); return; }
    let saved; try { saved = JSON.parse(sessionStorage.getItem('inv.pkce')); } catch {}
    if (!saved || saved.state !== qs.get('state')) { toast('Sign-in expired, please try again'); return; }
    sessionStorage.removeItem('inv.pkce');
    await this.token({ grant_type: 'authorization_code', code: qs.get('code'), code_verifier: saved.verifier, redirect_uri: this.redirectUri() });
    try {
      const me = await this.graph('https://graph.microsoft.com/v1.0/me');
      if (me.ok) { const j = await me.json(); this.account = j.userPrincipalName || j.displayName || ''; store.set('inv.account', this.account); }
    } catch {}
    store.set('inv.dirty', true);   // first connection: push local data up (merged with anything already there)
    toast('OneDrive connected');
  },

  async token(params) {
    const r = await fetch(`${this.AUTH}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: settings.clientId, scope: this.SCOPE, ...params }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.error || 'token error');
    store.set('inv.tokens', { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in - 120) * 1000 });
  },

  async accessToken() {
    const t = store.get('inv.tokens', null); if (!t) throw new Error('not signed in');
    if (Date.now() < t.exp) return t.access;
    try { await this.token({ grant_type: 'refresh_token', refresh_token: t.refresh }); }
    catch (e) { store.del('inv.tokens'); this.setStatus('⚠ sign in again'); throw e; }
    return store.get('inv.tokens').access;
  },

  async graph(url, opts = {}) {
    const tok = await this.accessToken();
    return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tok } });
  },

  // Pull from OneDrive, merge with local, push back if needed.
  async sync() {
    if (!this.signedIn() || !settings.clientId) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.setStatus('syncing…');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const r = await this.graph(this.FILE.replace(':/content', ''), {});   // metadata (eTag)
        let remote = null, etag = null;
        if (r.ok) {
          const meta = await r.json(); etag = meta.eTag;
          const c = await this.graph(this.FILE);
          if (c.ok) remote = await c.json();
        } else if (r.status !== 404) throw new Error('OneDrive ' + r.status);
        const dirty = store.get('inv.dirty', false);
        const merged = remote ? mergeData(remote, data) : data;
        data = merged; store.set('inv.data', data);
        if (!dirty && remote) { break; }
        const put = await this.graph(this.FILE, { method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) },
          body: JSON.stringify(data) });
        if (put.status === 412) continue;   // changed meanwhile on another device: merge again
        if (!put.ok) throw new Error('OneDrive save ' + put.status);
        store.set('inv.dirty', false);
        break;
      }
      this.setStatus('☁ saved');
    } catch (e) {
      console.warn(e);
      this.setStatus(navigator.onLine ? '⚠ not synced' : 'offline');
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.sync(); } else render();
    }
  },
  scheduleSave() {
    if (!this.signedIn()) return;
    this.setStatus('…');
    clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.sync(), 1500);
  },
  signOut() { store.del('inv.tokens'); store.del('inv.account'); this.account = ''; this.setStatus(''); render(); },
};
function b64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('button,[data-edit],[data-shopedit],input[type=checkbox]');
  if (!t) return;
  const d = t.dataset;
  if (d.tab) { ui.tab = d.tab; ui._focusQ = false; render(); window.scrollTo(0, 0); return; }
  if (d.inc) return changeQty(d.inc, +1);
  if (d.dec) return changeQty(d.dec, -1);
  if (d.edit) return itemForm(itemById(d.edit), false);
  if (d.shopedit) return shopForm(data.shopping.find(s => s.id === d.shopedit));
  if (d.tick) return tickShop(d.tick, t.checked);
  if ('loc' in d) { ui.loc = d.loc; return render(); }
  if ('cat' in d) { ui.cat = d.cat; return render(); }
  switch (t.id) {
    case 'fab': return itemForm({ name: '', category: ui.cat, location: ui.loc, qty: 1, unit: 'pcs', minQty: 0 }, true);
    case 'scanBtn': return openScanner();
    case 'shopAddBtn': return addShop();
    case 'clearDone': data.shopping.filter(s => s.done && !s.deleted).forEach(s => { s.deleted = true; s.updatedAt = now(); }); return save();
    case 'signIn': settings.clientId = $('#clientId').value.trim(); saveSettings(); return cloud.signIn();
    case 'signOut': return cloud.signOut();
    case 'syncNow': store.set('inv.dirty', true); return cloud.sync();
    case 'exportBtn': return download(`inventory-backup-${todayStr()}.json`, JSON.stringify(data, null, 1), 'application/json');
    case 'exportCsv': return exportCsv();
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { ui.q = e.target.value; ui._focusQ = true; $('#view').innerHTML = renderItems(); $('#q').focus(); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'soonDays') { settings.soonDays = Math.max(0, num(t.value)); saveSettings(); render(); }
  if (t.id === 'runOutDays') { settings.runOutDays = Math.max(0, num(t.value)); saveSettings(); render(); }
  if (t.id === 'clientId') { settings.clientId = t.value.trim(); saveSettings(); }
  if (t.id === 'importFile' && t.files[0]) {
    t.files[0].text().then(txt => {
      const j = JSON.parse(txt);
      if (!Array.isArray(j.items)) throw new Error('not a backup');
      data = mergeData(data, j); save(); toast('Backup loaded');
    }).catch(() => alert("That file doesn't look like an inventory backup."));
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'shopAdd') addShop(); });
function addShop() {
  const v = $('#shopAdd').value.trim(); if (!v) return;
  const it = liveItems().find(i => i.name.toLowerCase() === v.toLowerCase());
  data.shopping.push({ id: uid(), itemId: it?.id || null, name: it?.name || v, qty: it ? (num(it.buyQty) || 1) : 1, unit: it?.unit || '', done: false, auto: false, updatedAt: now() });
  save(); setTimeout(() => $('#shopAdd')?.focus(), 0);
}
// re-sync when coming back to the app (e.g. after using it on the other device)
document.addEventListener('visibilitychange', () => { if (!document.hidden) cloud.sync(); });
window.addEventListener('online', () => cloud.sync());

/* ---------------- start ---------------- */
(async () => {
  render();
  try { await cloud.handleRedirect(); } catch (e) { alert('Could not finish OneDrive sign-in: ' + e.message); }
  if (cloud.signedIn()) cloud.sync(); else render();
})();
