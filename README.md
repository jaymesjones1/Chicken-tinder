# Chicken Tinder

Two people, one list of restaurants, one card at a time. Swipe right for
yep, left for nope. The first place you both say yep to wins.

- **Players:** Joobacca and JD. Each phone picks once and remembers.
- **Rounds:** a round freezes a shuffled lineup, so you both see the same
  order. Either of you can start a new round from the result screen.
- **No match?** You get the "closest calls": places only one of you liked.
- **Admin:** the Admin button (bottom right) unlocks the list editor with a
  passcode. Add, rename, switch off (keeps history) or delete restaurants.
  Changes apply from the next round.

It's a static site (HTML, CSS, ES modules) backed by Supabase. There's no
build step.

## Try it locally (demo mode)

With `js/config.js` left empty, the app runs in demo mode. Data lives in
the browser's localStorage, and the admin passcode is `chicken`.

```sh
python3 -m http.server 8000
# open http://localhost:8000 in two tabs, pick a different player in each
```

ES modules don't load from `file://`, so serve the folder over HTTP.

## Set up Supabase (so two phones can play)

1. Create a free project at <https://supabase.com>.
2. In **SQL Editor**, paste and run all of `supabase/schema.sql`.
3. Set your admin passcode. Run this in the SQL editor with your own
   passcode, and don't commit it anywhere:

   ```sql
   insert into private.admin (passcode_hash)
   values (extensions.crypt('your-passcode-here', extensions.gen_salt('bf')))
   on conflict (id) do update set passcode_hash = excluded.passcode_hash;
   ```

4. In **Project Settings → API**, copy the Project URL and the `anon`
   public key into `js/config.js`.

The anon key is meant to be public. The database only accepts writes
through the functions in `schema.sql`, and list edits check the passcode
on the server. Anyone with the link can see the list and swipe as either
player, which is fine for a two-person dinner app but worth knowing.

## Host it on GitHub Pages

1. In the repo on GitHub, open **Settings → Pages**, choose **Deploy from
   a branch**, and pick `main` with the `/ (root)` folder.
2. The app will be at `https://<your-username>.github.io/chicken-tinder/`.
   Send that link to your co-swiper.

GitHub Pages on a private repo needs a paid GitHub plan. Any static host
works too: Netlify, Vercel or Cloudflare Pages can serve the repo
as-is.

## Files

```
index.html          page shell
css/style.css       the brutalist bits: five colours, 4px rules, 23° everything
js/app.js           screens, swiping, admin
js/store.js         Supabase store + localStorage demo store (same interface)
js/gl.js            WebGL halftone backdrop, generated card art, pixel chicken
js/config.js        your Supabase URL + anon key
supabase/schema.sql tables, row-level security, functions, realtime
```

## The look

Five colours: ink `#282323`, field green `#599033` (yep), indigo `#323282`
(nope), yolk `#FFD31A`, eggshell `#F1ECE1`. Every hatch, halftone grid
and stamp sits at 23°. Each restaurant gets its own poster, a halftone
sphere and stripe band rendered by a shader and seeded from the
restaurant's name, so the same place always gets the same art.
