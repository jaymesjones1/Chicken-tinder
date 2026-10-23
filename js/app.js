import { createStore, PLAYERS } from './store.js';
import { Backdrop, posterFor, schemeFor, chickenSVG } from './gl.js';

const $ = (sel, el = document) => el.querySelector(sel);
const view = $('#view');
const statusBar = $('#status');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const saved = {
  get(kind, key) { try { return window[`${kind}Storage`].getItem(key); } catch { return null; } },
  set(kind, key, value) {
    try {
      const store = window[`${kind}Storage`];
      value == null ? store.removeItem(key) : store.setItem(key, value);
    } catch { /* not persisted */ }
  },
};

// The tab remembers its own player first, so two demo tabs can play each other.
const rememberedPlayer = saved.get('session', 'ct-player') || saved.get('local', 'ct-player');
const rememberPlayer = (p) => {
  saved.set('session', 'ct-player', p);
  saved.set('local', 'ct-player', p);
};

const state = {
  store: null,
  me: PLAYERS[rememberedPlayer] ? rememberedPlayer : null,
  restaurants: new Map(),
  round: null,
  swipes: [],
  screen: 'play',
  pass: saved.get('session', 'ct-pass'),
  busy: false,
  shown: '',
};

const backdrop = new Backdrop($('#backdrop'));

// Data --------------------------------------------------------------------

let refreshing = null;
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const [list, round] = await Promise.all([state.store.restaurants(), state.store.latestRound()]);
    const swipes = round ? await state.store.swipes(round.id) : [];
    state.restaurants = new Map(list.map((r) => [r.id, r]));
    // Keep optimistic swipes that the server hasn't echoed back yet.
    const key = (s) => `${s.restaurant_id}:${s.player}`;
    const known = new Set(swipes.map(key));
    const pending = round && state.round?.id === round.id
      ? state.swipes.filter((s) => s.pending && !known.has(key(s)))
      : [];
    state.round = round;
    state.swipes = [...swipes, ...pending];
  })();
  try {
    await refreshing;
  } catch (err) {
    toast(err.message);
  } finally {
    refreshing = null;
  }
  render();
}

function derive() {
  const { round, swipes, restaurants, me } = state;
  if (!round) return { kind: [...restaurants.values()].some((r) => r.active) ? 'start' : 'empty' };
  const other = me === 'jd' ? 'joobacca' : 'jd';
  const lineup = round.lineup.filter((id) => restaurants.has(id));
  const mine = new Map();
  const theirs = new Map();
  for (const s of swipes) {
    if (s.player === me) mine.set(s.restaurant_id, s.liked);
    else if (s.player === other) theirs.set(s.restaurant_id, s.liked);
  }
  const base = { lineup, mine, theirs, other };
  if (round.status === 'matched') return { ...base, kind: 'match' };
  const queue = lineup.filter((id) => !mine.has(id));
  if (queue.length) return { ...base, kind: 'deck', queue };
  const theirLeft = lineup.filter((id) => !theirs.has(id)).length;
  if (theirLeft) return { ...base, kind: 'wait', theirLeft };
  return { ...base, kind: 'nomatch' };
}

// Rendering ---------------------------------------------------------------

function render() {
  const chip = $('#who-chip');
  chip.hidden = !state.me;
  if (state.me) chip.innerHTML = `<span>Swiping as</span> <b>${esc(PLAYERS[state.me])}</b>`;

  if (!state.me) return show('who', renderWho);
  if (state.screen === 'admin') {
    const sig = [...state.restaurants.values()].map((r) => `${r.id}${r.name}${r.cuisine}${r.active}`).join('|');
    return show(`admin:${state.pass ? 1 : 0}:${sig}`, renderAdmin);
  }

  const d = derive();
  renderStatus(d);
  if (d.kind === 'deck') return show('deck', () => renderDeck(d), () => syncDeck(d));
  const key = `${d.kind}:${state.round?.id}:${d.kind === 'wait' ? d.theirLeft : ''}`;
  show(key, () => ({ start: renderStart, empty: renderEmpty, wait: renderWait, match: renderMatch, nomatch: renderNoMatch })[d.kind](d));
}

// Only rebuild a screen when it changes, so live updates don't reset focus
// or animations. `update` runs on every render of an unchanged screen.
function show(key, build, update) {
  if (state.shown === key) return update?.();
  // Don't yank the admin form out from under someone who's typing.
  if (key.startsWith('admin') && state.shown.startsWith('admin') && document.activeElement?.closest('#view input')) return;
  state.shown = key;
  view.innerHTML = build() || '';
  view.dataset.screen = key.split(':')[0];
  update?.();
}

function renderStatus(d) {
  if (!state.round || !d.lineup) {
    statusBar.innerHTML = '';
    return;
  }
  const total = d.lineup.length;
  const date = new Date(state.round.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toUpperCase();
  statusBar.innerHTML = `
    <span class="cell">Round · ${esc(date)}</span>
    <span class="cell">${esc(PLAYERS[state.me])} <b>${pad(d.mine.size)}/${pad(total)}</b></span>
    <span class="cell">${esc(PLAYERS[d.other])} <b>${pad(d.theirs.size)}/${pad(total)}</b></span>`;
}

function renderWho() {
  statusBar.innerHTML = '';
  return `
    <section class="who">
      <h1 class="headline">Who’s<br>hungry?</h1>
      <p class="kicker">Pick yourself. This phone will remember.</p>
      <div class="who-grid">
        ${Object.entries(PLAYERS).map(([id, name], i) => `
          <button class="who-btn who-${i}" data-player="${id}">
            ${chickenSVG('who-chick')}
            <span>${esc(name)}</span>
          </button>`).join('')}
      </div>
    </section>`;
}

function renderStart() {
  return `
    <section class="panel center">
      ${chickenSVG('big-chick peck')}
      <h1 class="headline">Dinner<br>is a<br>stand-off.</h1>
      <p class="kicker">Swipe until you both say yep to the same place.</p>
      <button class="btn btn-ink" data-act="new-round">Start a round</button>
    </section>`;
}

function renderEmpty() {
  return `
    <section class="panel center">
      ${chickenSVG('big-chick')}
      <h1 class="headline">The list<br>is empty.</h1>
      <p class="kicker">Add some restaurants in the admin screen.</p>
      <button class="btn btn-ink" data-act="admin">Open admin</button>
    </section>`;
}

function cardHTML(id, d, depth) {
  const r = state.restaurants.get(id);
  const art = posterFor(r.name);
  const [bg] = schemeFor(r.name);
  const n = d.lineup.indexOf(id) + 1;
  const long = r.name.length > 16 ? ' long' : r.name.length > 10 ? ' mid' : '';
  return `
    <article class="card" data-id="${esc(id)}" style="--depth:${depth}" aria-label="${esc(r.name)}">
      <div class="card-art" style="--art-bg: var(--${bg})">
        ${art ? `<img src="${art}" alt="" draggable="false">` : ''}
        <span class="card-num">№ ${pad(n)} / ${pad(d.lineup.length)}</span>
      </div>
      <div class="card-body">
        <h2 class="card-name${long}">${esc(r.name)}</h2>
        <p class="card-cuisine">${esc(r.cuisine || '—')}</p>
      </div>
      <div class="stamp stamp-yep" aria-hidden="true">Yep</div>
      <div class="stamp stamp-nope" aria-hidden="true">Nope</div>
    </article>`;
}

function renderDeck() {
  return `
    <section class="deck-screen">
      <div class="deck" id="deck"></div>
      <div class="actions">
        <button class="btn btn-nope" data-act="nope" aria-label="Nope (left arrow)"><span class="glyph">✕</span> Nope</button>
        <button class="btn btn-yep" data-act="yep" aria-label="Yep (right arrow)">Yep <span class="glyph">✓</span></button>
      </div>
    </section>`;
}

// Reuse card elements by id so the stack doesn't flash between swipes.
function syncDeck(d) {
  const deck = $('#deck');
  if (!deck) return;
  const ids = d.queue.slice(0, 3);
  for (const el of deck.querySelectorAll('.card:not(.gone)')) {
    if (!ids.includes(el.dataset.id)) el.remove();
  }
  ids.forEach((id, depth) => {
    let el = deck.querySelector(`.card[data-id="${CSS.escape(id)}"]:not(.gone)`);
    if (!el) {
      deck.insertAdjacentHTML('afterbegin', cardHTML(id, d, depth));
      el = deck.querySelector('.card');
    }
    el.style.setProperty('--depth', depth);
    el.style.zIndex = 10 - depth;
    el.classList.toggle('top', depth === 0);
    if (depth === 0 && !el.dataset.bound) bindDrag(el);
  });
}

function renderWait(d) {
  const other = PLAYERS[d.other];
  return `
    <section class="panel center">
      ${chickenSVG('big-chick peck')}
      <h1 class="headline">Your turn’s<br>done.</h1>
      <p class="kicker">Waiting on ${esc(other)}: <b>${d.theirLeft}</b> left to swipe.</p>
      <p class="small">This screen updates on its own. You’ll see the match the moment it happens.</p>
    </section>`;
}

function renderMatch() {
  const r = state.restaurants.get(state.round.match_id);
  backdrop.celebrate();
  if (!r) {
    return `
      <section class="panel center">
        <h1 class="headline">It was a<br>match…</h1>
        <p class="kicker">…but that restaurant has since been removed from the list.</p>
        <button class="btn btn-ink" data-act="new-round">New round</button>
      </section>`;
  }
  const art = posterFor(r.name);
  const [bg] = schemeFor(r.name);
  return `
    <section class="result">
      <p class="banner"><span>It’s a match</span><span>It’s a match</span><span>It’s a match</span></p>
      <article class="card result-card">
        <div class="card-art" style="--art-bg: var(--${bg})">
          ${art ? `<img src="${art}" alt="">` : ''}
          <span class="card-num">Both said yep</span>
        </div>
        <div class="card-body">
          <h2 class="card-name${r.name.length > 16 ? ' long' : r.name.length > 10 ? ' mid' : ''}">${esc(r.name)}</h2>
          <p class="card-cuisine">${esc(r.cuisine || '—')}</p>
        </div>
      </article>
      <p class="kicker">Dinner is decided. No take-backs.</p>
      <button class="btn btn-ink" data-act="new-round">New round</button>
    </section>`;
}

function renderNoMatch(d) {
  const close = d.lineup.filter((id) => d.mine.get(id) !== d.theirs.get(id)).map((id) => ({
    r: state.restaurants.get(id),
    who: d.mine.get(id) ? PLAYERS[state.me] : PLAYERS[d.other],
  }));
  return `
    <section class="panel">
      <h1 class="headline">No<br>match.</h1>
      ${close.length ? `
        <p class="kicker">Closest calls: only one of you said yep.</p>
        <ol class="close-list">
          ${close.map(({ r, who }) => `
            <li><span class="cl-name">${esc(r.name)}</span><span class="cl-cuisine">${esc(r.cuisine)}</span><span class="cl-who">${esc(who)} ✓</span></li>`).join('')}
        </ol>` : `<p class="kicker">You both said nope to everything. Bold. Maybe groom the list.</p>`}
      <button class="btn btn-ink" data-act="new-round">Go again</button>
    </section>`;
}

function renderAdmin() {
  statusBar.innerHTML = '';
  if (!state.pass) {
    return `
      <section class="panel">
        <div class="admin-head"><h1 class="headline">Admin</h1><button class="btn btn-small" data-act="close-admin">Close</button></div>
        <form class="stack" data-form="pass">
          <label class="label" for="pass">Passcode</label>
          <input class="field" id="pass" name="pass" type="password" autocomplete="current-password" required>
          ${state.store.demo ? `<p class="small">Demo mode passcode: <b>${esc(state.store.demoPass)}</b></p>` : ''}
          <button class="btn btn-ink">Unlock</button>
        </form>
      </section>`;
  }
  const list = [...state.restaurants.values()];
  const live = list.filter((r) => r.active).length;
  return `
    <section class="panel admin">
      <div class="admin-head"><h1 class="headline">The list</h1><button class="btn btn-small" data-act="close-admin">Close</button></div>
      <p class="kicker">${list.length} places · ${live} in rotation. Changes apply from the next round.</p>
      <form class="add-row" data-form="add">
        <input class="field" name="name" placeholder="Restaurant" maxlength="80" required aria-label="Restaurant name">
        <input class="field" name="cuisine" placeholder="Cuisine" maxlength="40" aria-label="Cuisine">
        <button class="btn btn-yep btn-small">Add</button>
      </form>
      <ul class="admin-list">
        ${list.map((r) => `
          <li class="admin-row${r.active ? '' : ' off'}">
            <form data-form="edit" data-id="${esc(r.id)}">
              <input class="field" name="name" value="${esc(r.name)}" maxlength="80" required aria-label="Name">
              <input class="field" name="cuisine" value="${esc(r.cuisine)}" maxlength="40" aria-label="Cuisine">
              <label class="toggle"><input type="checkbox" name="active" ${r.active ? 'checked' : ''}><span>${r.active ? 'On' : 'Off'}</span></label>
              <button class="btn btn-small">Save</button>
              <button class="btn btn-small btn-nope" type="button" data-act="delete" aria-label="Delete ${esc(r.name)}">✕</button>
            </form>
          </li>`).join('')}
      </ul>
      <button class="btn btn-ink" data-act="new-round" data-confirm="1">Start a new round now</button>
      <button class="btn btn-small btn-ghost" data-act="lock">Lock admin</button>
    </section>`;
}

// Swiping -----------------------------------------------------------------

function pose(card, dx, dy) {
  const lean = Math.max(-1, Math.min(1, dx / 140));
  card.style.transform = `translate3d(${dx}px, ${dy * 0.35}px, 0) rotate(${dx * 0.05}deg) rotateY(${lean * 14}deg)`;
  card.style.setProperty('--yep', Math.max(0, lean));
  card.style.setProperty('--nope', Math.max(0, -lean));
  backdrop.lean = lean;
}

function bindDrag(card) {
  card.dataset.bound = '1';
  let id = null;
  let x0 = 0, y0 = 0, dx = 0, dy = 0, t0 = 0;
  card.addEventListener('pointerdown', (e) => {
    if (state.busy || id !== null) return;
    id = e.pointerId;
    card.setPointerCapture(id);
    x0 = e.clientX; y0 = e.clientY; t0 = performance.now();
    dx = dy = 0;
    card.classList.add('dragging');
  });
  card.addEventListener('pointermove', (e) => {
    if (e.pointerId !== id) return;
    dx = e.clientX - x0;
    dy = e.clientY - y0;
    pose(card, dx, dy);
  });
  const end = (e) => {
    if (e.pointerId !== id) return;
    id = null;
    card.classList.remove('dragging');
    const speed = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > 110 || (speed > 0.6 && Math.abs(dx) > 40)) commit(dx > 0);
    else {
      pose(card, 0, 0);
      card.style.transform = '';
    }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

async function commit(liked) {
  const d = derive();
  if (d.kind !== 'deck' || state.busy) return;
  state.busy = true;
  const id = d.queue[0];
  const card = $(`#deck .card[data-id="${CSS.escape(id)}"]:not(.gone)`);
  if (card) {
    card.classList.add('gone');
    card.classList.remove('top');
    card.classList.remove('dragging');
    pose(card, 0, 0);
    card.style.setProperty(liked ? '--yep' : '--nope', 1);
    const dir = liked ? 1 : -1;
    card.style.transform = `translate3d(${dir * (innerWidth * 0.75 + 200)}px, 40px, 0) rotate(${dir * 28}deg) rotateY(${dir * 20}deg)`;
    setTimeout(() => card.remove(), 450);
  }
  backdrop.lean = liked ? 1 : -1;
  setTimeout(() => { backdrop.lean = 0; }, 260);

  const swipe = { restaurant_id: id, player: state.me, liked, pending: true };
  state.swipes.push(swipe);
  const roundId = state.round.id;
  await wait(120);
  state.busy = false;
  render();
  try {
    const round = await state.store.swipe(roundId, id, state.me, liked);
    swipe.pending = false;
    if (round && state.round?.id === round.id) state.round = round;
  } catch (err) {
    state.swipes = state.swipes.filter((s) => s !== swipe);
    toast(`Swipe didn’t save: ${err.message}`);
  }
  render();
}

// Events ------------------------------------------------------------------

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act], [data-player], #who-chip, #admin-link');
  if (!btn) return;
  if (btn.dataset.player) {
    state.me = btn.dataset.player;
    rememberPlayer(state.me);
    state.shown = '';
    return render();
  }
  if (btn.id === 'who-chip') {
    state.me = null;
    rememberPlayer(null);
    state.screen = 'play';
    return render();
  }
  if (btn.id === 'admin-link') {
    state.screen = state.screen === 'admin' ? 'play' : 'admin';
    state.shown = '';
    return render();
  }
  switch (btn.dataset.act) {
    case 'yep': return commit(true);
    case 'nope': return commit(false);
    case 'admin':
      state.screen = 'admin';
      state.shown = '';
      return render();
    case 'close-admin':
      state.screen = 'play';
      state.shown = '';
      return render();
    case 'lock':
      state.pass = null;
      saved.set('session', 'ct-pass', null);
      state.shown = '';
      return render();
    case 'new-round': {
      if (btn.dataset.confirm && state.round?.status === 'open' && !confirm('Start a new round? The current one will be abandoned.')) return;
      return run(btn, async () => {
        state.round = await state.store.newRound();
        state.swipes = [];
        state.screen = 'play';
        state.shown = '';
        await refresh();
      });
    }
    case 'delete': {
      const form = btn.closest('form');
      const name = state.restaurants.get(form.dataset.id)?.name;
      if (!confirm(`Delete ${name}? Its past swipes go with it. (Switching it off keeps them.)`)) return;
      return run(btn, async () => {
        await state.store.remove(state.pass, form.dataset.id);
        state.shown = '';
        await refresh();
      });
    }
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  const btn = form.querySelector('button:not([type=button])');
  if (form.dataset.form === 'pass') {
    const pass = data.get('pass');
    return run(btn, async () => {
      await state.store.verify(pass);
      state.pass = pass;
      saved.set('session', 'ct-pass', pass);
      state.shown = '';
      render();
    });
  }
  const row = {
    id: form.dataset.form === 'edit' ? form.dataset.id : null,
    name: String(data.get('name')).trim(),
    cuisine: String(data.get('cuisine') || '').trim(),
    active: form.dataset.form === 'add' ? true : data.get('active') === 'on',
  };
  if (!row.name) return;
  await run(btn, async () => {
    await state.store.save(state.pass, row);
    document.activeElement?.blur();
    state.shown = '';
    await refresh();
    if (form.dataset.form === 'add') $('[data-form=add] [name=name]')?.focus();
  });
});

document.addEventListener('change', (e) => {
  const box = e.target.closest('.toggle input');
  if (box) box.nextElementSibling.textContent = box.checked ? 'On' : 'Off';
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea') || state.screen !== 'play') return;
  if (e.key === 'ArrowRight') commit(true);
  if (e.key === 'ArrowLeft') commit(false);
});

async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    if (/passcode/i.test(err.message)) {
      state.pass = null;
      saved.set('session', 'ct-pass', null);
      state.shown = '';
      render();
    }
    toast(err.message);
  } finally {
    if (btn?.isConnected) btn.disabled = false;
  }
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// Boot --------------------------------------------------------------------

$('#brand-chick').innerHTML = chickenSVG('brand-svg');
try {
  state.store = await createStore();
  $('#mode').textContent = state.store.demo ? 'Demo mode · data stays in this browser' : 'Live';
  state.store.subscribe(() => refresh());
  await refresh();
} catch (err) {
  view.innerHTML = `<section class="panel"><h1 class="headline">Can’t reach<br>the kitchen.</h1><p class="kicker">${esc(err.message)}</p></section>`;
}
