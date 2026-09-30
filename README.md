# 🍅 Tomatonater

**A tomato duel for two phones, across any distance.**

One of you winds up and throws a tomato. It sails across the *real* map — flying at 100 km/h over the actual distance between your two locations — and the other person has until it lands to leap out of the way. Dodge in time and you're safe; miss it and you wear the splat while the thrower scores. Then you swap, and go again. The more you land, the faster your tomatoes fly. First to the target score wins.

It's a silly, flirty little game built for playing with someone you're into — especially long-distance. Two grumpy-but-adorable cats do the throwing and dodging, and the whole thing lives at a link you can text to someone: they open it on their phone, you open it on yours, and the duel is on.

> Live: **https://tomatonater.pages.dev**

---

## How it plays

1. One of you opens the site and taps **Start the duel** — pick a **pace** and a **target score**.
2. Set your name and share your location, then **send the invite link** to the other person.
3. They open the link on their own phone, join as the second player, and set their location.
4. Take turns:
   - **Throwing?** Time the **power meter** and let it fly. More power = a faster tomato = less time for them to react — but push into the red and it might sail wide and waste your turn.
   - **Dodging?** Wait for the **INCOMING!** alert, then tap **DODGE** before it lands.
5. Miss a dodge → the thrower scores. Every **10 points → +10 km/h** on your throws. First to the target wins.

### Two paces
- **Blitz** — the real flight time is compressed to roughly 20 seconds to 4 minutes, so you can play a whole session together in one sitting.
- **Real flight** — the literal 100 km/h. A tomato thrown across the country genuinely takes *hours* to arrive. Throw one before bed; they dodge it when they wake up. Slow, and a little romantic.

### Nice touches
- **Pass-free, two-device play** — each phone is its own player; no passing one screen back and forth.
- **Come back anytime** — your link remembers your seat, so you can close the tab and rejoin later from any device.
- **You're told when they leave** — and when *both* of you leave, the duel cleans itself up.
- **Location stays yours** — see [Privacy](#privacy) below.

---

## What's in the repo

It's a tiny full-stack app, all on Cloudflare's free tier:

```
public/
  index.html          the entire game — one self-contained HTML/CSS/JS file
  pics/
    throw.png         the throwing cat
    evade.png         the dodging cat
functions/
  api/[[path]].js     the backend API (one Cloudflare Pages Function)
schema.sql            the database table
wrangler.toml         Cloudflare config (Pages + the D1 binding)
maint/index.html      a maintenance holding page, for planned downtime
```

- **Frontend** — a single static page with a few screens (start → join → set up → the arena → game over). It polls the backend a couple of times a second to stay in sync.
- **Backend** — one function handling a handful of JSON endpoints: `POST /api/game`, `/join`, `/setup`, `/throw`, `/dodge`, `/leave`, and `GET /api/state`.
- **Database** — Cloudflare **D1** (SQLite). One small row per duel holds the whole game: both players, whose turn it is, the score, and the tomato currently in flight.

---

## Privacy

The game needs to know *how far apart* you are, but it's careful with that:

- Your coordinates are **rounded to ~11 km on your device** before anything is sent — so your exact spot never leaves your phone, and the database only ever holds a fuzzy, city-level point.
- Your opponent only ever sees your **city name** and a **rough distance** — never coordinates.
- Anyone who merely has the link (without being a player) sees **nothing about location** at all.

---

## Run it yourself

You'll need a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and the `wrangler` CLI.

```bash
npm install -g wrangler     # or just use: npx wrangler ...
wrangler login              # opens the browser to authorize
```

**1. Create the database** and paste the printed `database_id` into `wrangler.toml`:

```bash
wrangler d1 create tomatonater
```

**2. Create the table** (both the local copy and the real one):

```bash
wrangler d1 execute tomatonater --local  --file=./schema.sql
wrangler d1 execute tomatonater --remote --file=./schema.sql
```

**3. Play locally** — the static site is in `public/`, so point dev at it:

```bash
wrangler pages dev public
```

Open the printed URL (e.g. http://localhost:8788), then open the same `?g=...` link in a second window to play both sides. (Geolocation and the copy button need **HTTPS**, which you get on `localhost` and on the live site — but *not* by opening the file directly.)

---

## Deploy

Only `public/` is served, so your `wrangler.toml` and `schema.sql` stay private. The project's production branch is **`production`** — always deploy with that flag, or it lands on a preview URL and the live site won't update:

```bash
wrangler pages deploy public --branch production
```

The **`DB`** binding is applied automatically from `wrangler.toml` — no dashboard step needed.

> **Checking the live site from a script?** Cloudflare's bot filter will reject automated requests (empty or `403` responses). Check it in a real browser instead.

---

## Data model & housekeeping

The `games` table is one row per duel. Alongside the obvious fields (names, rounded location, points, whose turn, the in-flight tomato), each player already has `*_coins` and `*_upgrades` (JSON) columns reserved for a future **shop** — speed tiers, power-ups, and cosmetics — so adding it won't need a migration.

**Leaving:** `POST /api/leave` marks a player as gone and tells the other; when **both** have left, the row is deleted. Re-opening your link auto-clears the flag so you rejoin.

**Adding columns later:** migrate the live DB with `ALTER TABLE games ADD COLUMN …` — re-running `schema.sql` won't add columns to an existing table.

**Wipe all games** (handy while testing):

```bash
wrangler d1 execute tomatonater --remote --command "DELETE FROM games;"
```

---

## Roadmap

- **The shop** — spend coins earned from splats on faster throws, one-off power-ups (a curveball, a shield dodge), and cat/tomato cosmetics. The database is already shaped for it.
- **Push notifications** — get pinged when a tomato is incoming, which is what "Real flight" mode is really waiting for.

Made with a splat of 🍅 — two phones, one tomato.
