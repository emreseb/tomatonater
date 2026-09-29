# 🍅 Tomatonater

A two-player, two-phone tomato duel. You throw a tomato; it flies at 100 km/h across the real distance between your two locations; your opponent has until it lands to dodge. Miss and the thrower scores. Every 10 points → +10 km/h. First to the target wins.

- **Frontend:** `index.html` + `pics/` (static)
- **Backend:** Cloudflare Pages Function in `functions/api/[[path]].js`
- **Database:** Cloudflare **D1** (SQLite), schema in `schema.sql`

Everything runs on Cloudflare's free tier.

---

## One-time setup

You need the Cloudflare CLI (`wrangler`) and a free Cloudflare account.

```bash
npm install -g wrangler        # or: npx wrangler ...
wrangler login                 # opens the browser to authorize
```

### 1. Create the database

```bash
wrangler d1 create tomatonater
```

This prints a `database_id`. Open `wrangler.toml` and paste it into:

```toml
database_id = "PASTE_YOUR_D1_DATABASE_ID_HERE"
```

### 2. Create the table

```bash
# local copy (for `wrangler pages dev`)
wrangler d1 execute tomatonater --local  --file=./schema.sql
# the real remote database
wrangler d1 execute tomatonater --remote --file=./schema.sql
```

### 3. Run it locally (optional but recommended)

The static site lives in `public/`; the API lives in `functions/`. Point dev at `public`:

```bash
wrangler pages dev public
```

Open the printed URL (e.g. http://localhost:8788). Geolocation works on `localhost`.
Open a second browser/incognito window with the same `?g=...` link to play both sides.

---

## Deploy to Cloudflare Pages

Only `public/` is served (so `wrangler.toml`, `schema.sql`, etc. stay private). The
project's production branch is **`production`**, so always deploy with `--branch production`
— otherwise it goes to a preview URL and `tomatonater.pages.dev` won't update:

```bash
wrangler pages deploy public --branch production
```

The **`DB`** binding is applied automatically from `wrangler.toml` on every deploy — no
dashboard step needed. (If you ever move the D1 binding out of `wrangler.toml`, add it under
**Workers & Pages → tomatonater → Settings → Functions → D1 database bindings** instead.)

Your game is live at `https://tomatonater.pages.dev`.

> Tip: to check the live site from a script you'll hit Cloudflare's bot filter (empty/403
> responses). Check it in a real browser instead.

> Geolocation and the clipboard "Copy" button require **HTTPS**, which Cloudflare Pages gives you automatically. They will not work if you open `index.html` as a local file.

---

## How to play

1. One of you opens the site and taps **Start the duel** (pick **Blitz** to play now, or **Real flight** for the slow romantic version).
2. Set your name and share your location, then **send the link** to the other person.
3. They open the link on their phone, join, and set their location.
4. Take turns: the thrower charges a **power meter** and throws; the evader taps **DODGE** before the tomato lands.

### Pace
- **Blitz** — real flight time compressed to ~20 s–4 min. Good for a live session.
- **Real flight** — literal 100 km/h. A long-distance tomato can take hours; dodge whenever you next open the app. (Push notifications are a natural future add-on so you get pinged when one is incoming.)

---

## Data model (`games` table)

One row per duel holds everything: both players (name, location, points, coins, `*_left`), whose turn it is, the round, and the tomato currently in flight. Per-player `*_coins` and `*_upgrades` (JSON) columns are already there for the future **shop** — speed tiers, power-ups, and cosmetics — so adding it won't need a schema migration.

**Leaving:** `POST /api/leave` marks a player's `*_left` flag; the other player is shown "they left." When **both** have left, the row is deleted and the session is terminated. A player who re-opens their link and polls again has their own flag auto-cleared (rejoin). If you add columns to `schema.sql` later, migrate the live DB with `ALTER TABLE games ADD COLUMN … ` (a re-run of `schema.sql` won't add columns to an existing table).

To wipe all games during testing:

```bash
wrangler d1 execute tomatonater --remote --command "DELETE FROM games;"
```
