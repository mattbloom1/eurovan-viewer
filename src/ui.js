// DOM panel: builds the five tabs and keeps controls in sync with the app state.
import { PAINTS, PAINT_FINISHES, WOODS, DOOR_COLORS, UPHOLSTERY, SEAT_COLORS, FLOORS, BUILDOUT_NAMES } from './config.js';
import { woodThumb, floorThumb } from './textures.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
};

export function friendlyName(n) {
  if (BUILDOUT_NAMES[n]) return BUILDOUT_NAMES[n];
  return n.replace(/^BO_/, '').replace(/_/g, ' ').replace(/\b([a-z])/g, (m, c) => c.toUpperCase());
}

export class UI {
  constructor(app) {
    this.app = app;
    this.syncers = [];
    this.panel = document.getElementById('panel');
    this._tabs();
  }

  _tabs() {
    const tabs = [...document.querySelectorAll('#tabs [role=tab]')];
    const panes = [...document.querySelectorAll('.pane')];
    const select = (name) => {
      const mobile = matchMedia('(max-width: 760px), (max-height: 500px) and (pointer: coarse)').matches;
      const cur = tabs.find(t => t.getAttribute('aria-selected') === 'true');
      // on phones, tapping the active tab collapses/expands the sheet
      if (mobile && cur && cur.dataset.tab === name) { document.body.classList.toggle('panel-closed'); this.app.onLayout(); return; }
      if (mobile) document.body.classList.remove('panel-closed');
      tabs.forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
      panes.forEach(p => { p.hidden = p.dataset.pane !== name; });
      document.getElementById('panes').scrollTop = 0;
      this.app.onLayout();
    };
    tabs.forEach(t => t.addEventListener('click', () => select(t.dataset.tab)));
    this.selectTab = select;
    // swipe the grab handle down/up on phones
    let y0 = null;
    this.panel.addEventListener('touchstart', e => { if (e.target.closest('#tabs') || e.target.classList.contains('grab')) y0 = e.touches[0].clientY; }, { passive: true });
    this.panel.addEventListener('touchend', e => {
      if (y0 === null) return;
      const dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy > 40) { document.body.classList.add('panel-closed'); this.app.onLayout(); }
      else if (dy < -40) { document.body.classList.remove('panel-closed'); this.app.onLayout(); }
    }, { passive: true });
  }

  sync() { for (const f of this.syncers) f(); }

  group(title, valFn) {
    const val = valFn ? h('span', { class: 'val' }) : null;
    const g = h('div', { class: 'group' }, h('h3', {}, title, val));
    if (valFn) this.syncers.push(() => { val.textContent = valFn(); });
    return g;
  }

  swatches(items, isActive, onPick, { picker, pickerValue, square } = {}) {
    const wrap = h('div', { class: 'swatches' });
    const btns = items.map(it => {
      const b = h('button', { class: 'sw' + (square ? ' sq' : ''), title: it.name, 'aria-label': it.name, style: it.bg ? `background:${it.bg}` : `background:${it.hex}`, onclick: () => onPick(it) });
      wrap.append(b);
      return [b, it];
    });
    let input = null;
    if (picker) {
      input = h('input', { type: 'color', 'aria-label': 'Custom colour' });
      input.addEventListener('input', () => picker(input.value));
      wrap.append(h('label', { class: 'sw picker', title: 'Custom colour' }, input));
    }
    this.syncers.push(() => {
      let any = false;
      for (const [b, it] of btns) { const on = isActive(it); b.classList.toggle('active', on); any ||= on; }
      if (input) { input.parentElement.classList.toggle('active', !any); if (pickerValue) input.value = pickerValue(); }
    });
    return wrap;
  }

  seg(options, isActive, onPick) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup' });
    const btns = options.map(o => { const b = h('button', { role: 'radio', onclick: () => onPick(o.id) }, o.label); wrap.append(b); return [b, o]; });
    this.syncers.push(() => btns.forEach(([b, o]) => { const on = isActive(o.id); b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); }));
    return wrap;
  }

  cards(items, thumb, isActive, onPick, cls = '') {
    const wrap = h('div', { class: 'cards' });
    const btns = items.map(it => {
      const t = thumb(it);
      const b = h('button', { class: 'card ' + cls, onclick: () => onPick(it) }, t, it.name);
      wrap.append(b);
      return [b, it];
    });
    this.syncers.push(() => btns.forEach(([b, it]) => b.classList.toggle('active', isActive(it))));
    return wrap;
  }

  toggle(label, sub, get, set, id) {
    const input = h('input', { type: 'checkbox', id, role: 'switch' });
    input.addEventListener('change', () => set(input.checked));
    this.syncers.push(() => { input.checked = !!get(); });
    return h('div', { class: 'row' }, h('label', { for: id }, label, sub ? h('span', { class: 'sub' }, sub) : null), h('span', { class: 'switch' }, input, h('span')));
  }

  build() {
    const a = this.app, s = () => a.state;
    // ---------------- Finishes ----------------
    const fin = document.querySelector('[data-pane=finishes]');
    const paintName = () => (PAINTS.find(p => p.hex.toLowerCase() === s().paint.toLowerCase()) || { name: 'Custom ' + s().paint }).name;
    const gP = this.group('Paint', paintName);
    gP.append(this.swatches(PAINTS, p => p.hex.toLowerCase() === s().paint.toLowerCase(), p => a.set({ paint: p.hex, finish: p.finish }), { picker: v => a.set({ paint: v }), pickerValue: () => s().paint }));
    gP.append(h('div', { style: 'height:10px' }));
    gP.append(this.seg(Object.entries(PAINT_FINISHES).map(([id, f]) => ({ id, label: f.label })), id => s().finish === id, id => a.set({ finish: id })));
    fin.append(gP);

    const gW = this.group('Cabinet wood', () => (WOODS.find(w => w.id === s().wood) || WOODS[0]).name);
    const woodThumbs = {};
    gW.append(this.cards(WOODS, w => { woodThumbs[w.id] = woodThumb(w); return h('span', { class: 'thumb', style: `background-image:url(${woodThumbs[w.id]})` }); }, w => s().wood === w.id, w => a.set({ wood: w.id })));
    fin.append(gW);

    const gD = this.group('Cabinet doors', () => s().door === 'custom' ? 'Custom' : (DOOR_COLORS.find(d => d.id === s().door) || DOOR_COLORS[0]).name);
    const doorItems = DOOR_COLORS.map(d => ({ ...d, bg: d.hex || `url(${woodThumbs[s().wood] || woodThumbs.birch}) center/cover` }));
    const doorSw = this.swatches(doorItems, d => s().door === d.id, d => a.set({ door: d.id, doorHex: d.hex || s().doorHex }), { picker: v => a.set({ door: 'custom', doorHex: v }), pickerValue: () => s().doorHex });
    this.syncers.push(() => { const wb = doorSw.querySelector('[title="Natural wood"]'); if (wb) wb.style.background = `url(${woodThumbs[s().wood]}) center/cover`; });
    gD.append(doorSw);
    fin.append(gD);

    const gU = this.group('Upholstery', () => (UPHOLSTERY.find(u => u.id === s().uph) || UPHOLSTERY[0]).name);
    gU.append(this.cards(UPHOLSTERY, u => h('span', { class: 'thumb' }, ...[u.charcoal, u.mustard, u.rust, u.linen, u.duvet].map(c => h('i', { style: `background:${c}` }))), u => s().uph === u.id, u => a.set({ uph: u.id }), 'pal'));
    fin.append(gU);

    const gS = this.group('Cab seats', () => s().seat === 'custom' ? 'Custom' : (SEAT_COLORS.find(c => c.id === s().seat) || SEAT_COLORS[0]).name);
    const seatItems = SEAT_COLORS.map(c => ({ ...c, bg: c.hex || 'linear-gradient(135deg,#3b3b3e 50%,#c39a32 50%)' }));
    gS.append(this.swatches(seatItems, c => s().seat === c.id, c => a.set({ seat: c.id, seatHex: c.hex || s().seatHex }), { picker: v => a.set({ seat: 'custom', seatHex: v }), pickerValue: () => s().seatHex }));
    fin.append(gS);

    const gF = this.group('Floor', () => (FLOORS.find(f => f.id === s().floor) || FLOORS[0]).name);
    gF.append(this.cards(FLOORS, f => h('span', { class: 'thumb', style: `background-image:url(${floorThumb(f)})` }), f => s().floor === f.id, f => a.set({ floor: f.id })));
    fin.append(gF);
    if (a.missingNote) fin.append(h('p', { class: 'note' }, a.missingNote));

    // ---------------- Parts ----------------
    const parts = document.querySelector('[data-pane=parts]');
    const gB = this.group('Camper buildout');
    gB.append(this.toggle('Buildout', 'All camper furniture', () => s().buildout, v => a.set({ buildout: v }), 't-buildout'));
    const cols = a.buildoutCollections();
    if (cols.length) {
      const det = h('details', { class: 'sub-list' }, h('summary', {}, `Individual parts (${cols.length})`));
      const rows = h('div', { class: 'rows' });
      cols.forEach((c, i) => rows.append(this.toggle(friendlyName(c), null, () => !s().hidden.includes(c), v => a.toggleCollection(c, v), 't-col-' + i)));
      det.append(rows);
      gB.append(det);
    } else gB.append(h('p', { class: 'note' }, 'No buildout collections found in this model.'));
    parts.append(gB);
    const gV = this.group('Van');
    gV.append(this.toggle('Factory interior', 'Dash, cab seats, trim', () => s().interior, v => a.set({ interior: v }), 't-interior'));
    gV.append(this.toggle('X-ray body', 'See the buildout through the shell', () => s().xray, v => a.set({ xray: v }), 't-xray'));
    gV.append(this.toggle('Section cut', 'Slice off the roof to look inside', () => a.section.on, v => a.setSection(v), 't-section'));
    const range = h('input', { type: 'range', min: '0.6', max: '2.2', step: '0.01', 'aria-label': 'Section cut height' });
    range.addEventListener('input', () => a.setSection(true, parseFloat(range.value)));
    this.syncers.push(() => { range.value = a.section.height; range.disabled = !a.section.on; });
    gV.append(range, h('div', { class: 'range-labels' }, h('span', {}, 'floor'), h('span', {}, 'cut height'), h('span', {}, 'roof')));
    parts.append(gV);

    // ---------------- Open ----------------
    const open = document.querySelector('[data-pane=open]');
    const gO = this.group('Doors & roof');
    const grid = h('div', { class: 'btns' });
    for (const [name, label] of a.pivotList()) {
      const b = h('button', { class: 'btn', onclick: () => { a.togglePivot(name); } }, h('span', { class: 'dot' }), label);
      this.syncers.push(() => b.classList.toggle('on', a.openings.isOpen(name)));
      grid.append(b);
    }
    if (!a.pivotList().length) grid.append(h('p', { class: 'note' }, 'No opening parts found in this model.'));
    grid.append(h('button', { class: 'btn primary', onclick: () => a.openAll() }, 'Open all'), h('button', { class: 'btn ghost', onclick: () => a.closeAll() }, 'Close all'));
    gO.append(grid, h('p', { class: 'note' }, 'Tip: tap or click a door, the tailgate or the pop-top on the van to open or close it.'));
    open.append(gO);

    // ---------------- Scene ----------------
    const sc = document.querySelector('[data-pane=scene]');
    const fmt = hr => { const H = Math.floor(hr) % 24, M = Math.round((hr - Math.floor(hr)) * 60); return `${(H % 12) || 12}:${String(M).padStart(2, '0')} ${H < 12 ? 'am' : 'pm'}`; };
    const gT = this.group('Time of day', () => fmt(s().hour));
    gT.append(this.seg([{ id: 'day', label: 'Day' }, { id: 'dusk', label: 'Dusk' }, { id: 'night', label: 'Night' }], id => ({ day: s().hour >= 7 && s().hour < 17.5, dusk: s().hour >= 17.5 && s().hour < 19.6, night: s().hour >= 19.6 || s().hour < 5.5 })[id], id => a.setHour({ day: 14, dusk: 18.6, night: 22 }[id], true)));
    const tr = h('input', { type: 'range', min: '5', max: '23.5', step: '0.05', 'aria-label': 'Time of day' });
    tr.addEventListener('input', () => a.setHour(parseFloat(tr.value), false));
    this.syncers.push(() => { tr.value = Math.max(5, Math.min(23.5, s().hour)); });
    gT.append(h('div', { style: 'height:8px' }), tr, h('div', { class: 'range-labels' }, h('span', {}, '5 am'), h('span', {}, 'noon'), h('span', {}, '11 pm')));
    sc.append(gT);
    const gL = this.group('Lights');
    gL.append(this.toggle('Headlights', 'Head and tail lights on', () => s().headlights, v => a.set({ headlights: v }), 't-head'));
    gL.append(this.toggle('Cabin lights', 'Warm LED strips (glow at night)', () => s().cabin, v => a.set({ cabin: v }), 't-cabin'));
    sc.append(gL);
    const gX = this.group('Share & save');
    gX.append(h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => a.screenshot() }, 'Screenshot'),
      h('button', { class: 'btn', onclick: () => a.copyLink() }, 'Copy link'),
      h('button', { class: 'btn ghost wide', onclick: () => a.reset() }, 'Reset to defaults')));
    gX.append(h('p', { class: 'note' }, 'Your choices are saved in this browser and in the page link, so you can share a look.'));
    sc.append(gX);
    const gM = this.group('Model');
    gM.append(h('p', { class: 'note', id: 'model-details' }, a.modelDetails()));
    sc.append(gM);

    // ---------------- Drive ----------------
    const dr = document.querySelector('[data-pane=drive]');
    const gDr = this.group('Take it for a spin');
    gDr.append(h('p', { class: 'note', style: 'margin:0 0 12px;font-size:13.5px;color:var(--ink-2)' }, 'Drive the van around a parking lot with rolling hills. Doors and the pop-top close automatically before you set off.'));
    gDr.append(h('button', { class: 'btn primary wide', style: 'width:100%', onclick: () => a.enterDrive() }, 'Start driving'));
    gDr.append(h('p', { class: 'note' }, 'Keyboard: W / ↑ gas, S / ↓ brake then reverse, A D / ← → steer, Space handbrake, C camera, R reset, Esc exit. On a phone, use the on-screen pedals and steering buttons.'));
    dr.append(gDr);

    this.sync();
  }
}
