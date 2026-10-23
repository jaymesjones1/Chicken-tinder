import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const PLAYERS = { joobacca: 'Joobacca', jd: 'JD' };

// Both stores expose the same interface:
//   restaurants() latestRound() swipes(roundId) newRound()
//   swipe(roundId, restaurantId, player, liked) -> round
//   verify(pass) save(pass, restaurant) remove(pass, id)
//   subscribe(onChange) -> unsubscribe
export async function createStore() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) return supabaseStore();
  return demoStore();
}

async function supabaseStore() {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const ok = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    demo: false,
    async restaurants() {
      return ok(await db.from('restaurants').select('*').order('name'));
    },
    async latestRound() {
      const rows = ok(await db.from('rounds').select('*').order('created_at', { ascending: false }).limit(1));
      return rows[0] || null;
    },
    async swipes(roundId) {
      return ok(await db.from('swipes').select('restaurant_id,player,liked').eq('round_id', roundId));
    },
    async newRound() {
      return ok(await db.rpc('new_round'));
    },
    async swipe(roundId, restaurantId, player, liked) {
      return ok(await db.rpc('swipe', { p_round: roundId, p_restaurant: restaurantId, p_player: player, p_liked: liked }));
    },
    async verify(pass) {
      return ok(await db.rpc('admin_verify', { passcode: pass }));
    },
    async save(pass, r) {
      return ok(await db.rpc('admin_save_restaurant', {
        passcode: pass, rid: r.id || null, rname: r.name, rcuisine: r.cuisine, ractive: r.active,
      }));
    },
    async remove(pass, id) {
      ok(await db.rpc('admin_delete_restaurant', { passcode: pass, rid: id }));
    },
    subscribe(onChange) {
      const channel = db.channel('chicken-tinder');
      for (const table of ['restaurants', 'rounds', 'swipes']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, onChange);
      }
      channel.subscribe();
      // Polling backs up realtime in case it's disabled or the socket drops.
      const timer = setInterval(onChange, 5000);
      return () => {
        clearInterval(timer);
        db.removeChannel(channel);
      };
    },
  };
}

// Demo mode mirrors the database functions on localStorage, so two tabs
// in one browser can play against each other.
const DEMO_KEY = 'chicken-tinder-demo-v1';
const DEMO_PASS = 'chicken';
const DEMO_LIST = [
  ['Pho Real', 'Vietnamese'], ['Taco Bout It', 'Mexican'], ['The Brisket Bunker', 'Barbecue'],
  ['Slice Slice Baby', 'Pizza'], ['Udon Know', 'Japanese'], ['Curry Up', 'Indian'],
  ['Gyro Captain', 'Greek'], ['Big Sal’s Red Sauce', 'Italian'], ['Seoul Food', 'Korean'],
  ['Wok This Way', 'Chinese'], ['Falafel Fortress', 'Middle Eastern'], ['The Grilled Ultimatum', 'Sandwiches'],
];

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

function demoStore() {
  const listeners = new Set();
  const read = () => {
    try {
      const raw = localStorage.getItem(DEMO_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* fall through to seed */ }
    const now = new Date().toISOString();
    seed ||= {
      restaurants: DEMO_LIST.map(([name, cuisine]) => ({ id: uuid(), name, cuisine, active: true, created_at: now })),
      rounds: [],
      swipes: [],
    };
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(seed)); } catch { /* keep in memory */ }
    return JSON.parse(JSON.stringify(seed));
  };
  let seed = null;
  const write = (data) => {
    seed = data;
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(data)); } catch { /* demo only */ }
    listeners.forEach((fn) => fn());
  };
  const check = (pass) => {
    if (pass !== DEMO_PASS) throw new Error('Wrong passcode');
  };
  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : x);

  return {
    demo: true,
    demoPass: DEMO_PASS,
    async restaurants() {
      return clone(read().restaurants).sort((a, b) => a.name.localeCompare(b.name));
    },
    async latestRound() {
      return clone(read().rounds.at(-1)) || null;
    },
    async swipes(roundId) {
      return clone(read().swipes.filter((s) => s.round_id === roundId));
    },
    async newRound() {
      const data = read();
      const lineup = data.restaurants.filter((r) => r.active).map((r) => r.id);
      if (!lineup.length) throw new Error('No active restaurants on the list');
      for (let i = lineup.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [lineup[i], lineup[j]] = [lineup[j], lineup[i]];
      }
      const round = { id: uuid(), lineup, status: 'open', match_id: null, created_at: new Date().toISOString() };
      data.rounds.push(round);
      write(data);
      return clone(round);
    },
    async swipe(roundId, restaurantId, player, liked) {
      const data = read();
      const round = data.rounds.find((r) => r.id === roundId);
      if (!round) throw new Error('Round not found');
      if (round.status !== 'open' || !round.lineup.includes(restaurantId)) return clone(round);
      const exists = data.swipes.some((s) => s.round_id === roundId && s.restaurant_id === restaurantId && s.player === player);
      if (!exists) data.swipes.push({ round_id: roundId, restaurant_id: restaurantId, player, liked });
      if (liked && data.swipes.some((s) => s.round_id === roundId && s.restaurant_id === restaurantId && s.player !== player && s.liked)) {
        round.status = 'matched';
        round.match_id = restaurantId;
      }
      write(data);
      return clone(round);
    },
    async verify(pass) {
      check(pass);
      return true;
    },
    async save(pass, r) {
      check(pass);
      const data = read();
      let row = r.id && data.restaurants.find((x) => x.id === r.id);
      if (row) Object.assign(row, { name: r.name.trim(), cuisine: (r.cuisine || '').trim(), active: r.active !== false });
      else {
        row = { id: uuid(), name: r.name.trim(), cuisine: (r.cuisine || '').trim(), active: r.active !== false, created_at: new Date().toISOString() };
        data.restaurants.push(row);
      }
      write(data);
      return clone(row);
    },
    async remove(pass, id) {
      check(pass);
      const data = read();
      data.restaurants = data.restaurants.filter((r) => r.id !== id);
      data.swipes = data.swipes.filter((s) => s.restaurant_id !== id);
      for (const round of data.rounds) if (round.match_id === id) round.match_id = null;
      write(data);
    },
    subscribe(onChange) {
      const onStorage = (e) => { if (e.key === DEMO_KEY) onChange(); };
      window.addEventListener('storage', onStorage);
      listeners.add(onChange);
      return () => {
        window.removeEventListener('storage', onStorage);
        listeners.delete(onChange);
      };
    },
  };
}
