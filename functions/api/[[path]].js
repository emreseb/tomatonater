// Tomatonater API — Cloudflare Pages Function backed by D1.
// Routes (all under /api):
//   POST /api/game    {pace,target}            -> create a duel, you become seat 1
//   POST /api/join    {id}                     -> claim seat 2
//   POST /api/setup   {id,token,name,lat,lng,city}
//   POST /api/throw   {id,token,power}         -> launch a tomato
//   POST /api/dodge   {id,token}               -> dodge the incoming tomato
//   GET  /api/state?id=..&token=..             -> full state (also lazily resolves landed tomatoes)

const BASE_SPEED = 100;          // km/h at level 1
const BLITZ_DIVISOR = 120;       // compress real flight time by this much in Blitz pace
const BLITZ_MIN_MS = 20_000;     // 20s floor
const BLITZ_MAX_MS = 240_000;    // 4min ceiling

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const err = (msg, status = 400) => json({ error: msg }, status);

const readBody = async (request) => {
  try { return (await request.json()) || {}; } catch { return {}; }
};

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(lat2 - lat1), dLng = toR(lng2 - lng1);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const shortId = () => {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
};

const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

const getGame = (env, id) =>
  env.DB.prepare("SELECT * FROM games WHERE id = ?").bind(id).first();

const seatOf = (g, token) =>
  token && token === g.p1_token ? 1 : token && token === g.p2_token ? 2 : 0;

const located = (g, seat) =>
  seat === 1 ? g.p1_lat != null && g.p1_lng != null : g.p2_lat != null && g.p2_lng != null;

const speedFor = (points) => BASE_SPEED + Math.floor(points / 10) * 10;
const levelFor = (points) => 1 + Math.floor(points / 10);

// If a flying tomato's arrival time has passed, resolve it as a splat.
// Serverless-friendly: no cron needed, we resolve on read/write.
async function maybeResolve(env, g) {
  if (g.flight_status !== "flying" || Date.now() < g.flight_arrive) return g;
  const thrower = g.flight_from;
  const evader = thrower === 1 ? 2 : 1;
  const ptsCol = thrower === 1 ? "p1_points" : "p2_points";
  const coinsCol = thrower === 1 ? "p1_coins" : "p2_coins";
  const newPts = g[ptsCol] + 1;
  const levelUp = newPts % 10 === 0;
  const win = newPts >= g.target;
  const event = JSON.stringify({ type: "splat", by: thrower, to: evader, levelUp, at: g.flight_arrive });
  // Guard on flight_status='flying' so simultaneous polls can't double-count.
  await env.DB.prepare(
    `UPDATE games SET ${ptsCol}=${ptsCol}+1, ${coinsCol}=${coinsCol}+1, thrower=?, round=round+1,
       evseq=evseq+1, last_event=?, winner=?, updated_at=?,
       flight_from=NULL, flight_launch=NULL, flight_arrive=NULL,
       flight_speed=NULL, flight_dist=NULL, flight_power=NULL, flight_status=NULL
     WHERE id=? AND flight_status='flying'`
  ).bind(win ? thrower : evader, event, win ? thrower : null, Date.now(), g.id).run();
  return getGame(env, g.id);
}

function publicState(g, seat) {
  const flying = g.flight_status === "flying";
  return {
    now: Date.now(),
    id: g.id,
    pace: g.pace,
    target: g.target,
    round: g.round,
    thrower: g.thrower,
    winner: g.winner,
    you: seat,
    dist: g.p1_lat != null && g.p2_lat != null
      ? Math.round(haversine(g.p1_lat, g.p1_lng, g.p2_lat, g.p2_lng)) : null,
    players: [
      { seat: 1, name: g.p1_name, city: g.p1_city, points: g.p1_points,
        coins: g.p1_coins, level: levelFor(g.p1_points), speed: speedFor(g.p1_points),
        located: g.p1_lat != null, joined: g.p1_token != null, left: !!g.p1_left },
      { seat: 2, name: g.p2_name, city: g.p2_city, points: g.p2_points,
        coins: g.p2_coins, level: levelFor(g.p2_points), speed: speedFor(g.p2_points),
        located: g.p2_lat != null, joined: g.p2_token != null, left: !!g.p2_left },
    ],
    flight: flying ? {
      from: g.flight_from,
      evader: g.flight_from === 1 ? 2 : 1,
      launch: g.flight_launch,
      arrive: g.flight_arrive,
      speed: Math.round(g.flight_speed),
      dist: Math.round(g.flight_dist),
      power: g.flight_power,
    } : null,
    event: g.last_event ? { seq: g.evseq, ...JSON.parse(g.last_event) } : null,
  };
}

// ---- Handlers ----

async function createGame(env, request) {
  const b = await readBody(request);
  const id = shortId();
  const token = crypto.randomUUID();
  const now = Date.now();
  const pace = b.pace === "real" ? "real" : "blitz";
  const target = clampInt(b.target, 3, 30, 10);
  await env.DB.prepare(
    `INSERT INTO games (id, created_at, updated_at, pace, target, thrower, round, p1_token)
     VALUES (?,?,?,?,?,1,1,?)`
  ).bind(id, now, now, pace, target, token).run();
  return json({ id, token, seat: 1 });
}

async function joinGame(env, request) {
  const { id } = await readBody(request);
  const g = await getGame(env, id);
  if (!g) return err("No duel with that code.", 404);
  if (g.p2_token) return err("This duel already has two players.", 409);
  const token = crypto.randomUUID();
  const res = await env.DB.prepare(
    "UPDATE games SET p2_token=?, updated_at=? WHERE id=? AND p2_token IS NULL"
  ).bind(token, Date.now(), id).run();
  if (!res.meta.changes) return err("Someone just took the last seat.", 409);
  return json({ id, token, seat: 2 });
}

async function setup(env, request) {
  const b = await readBody(request);
  const g = await getGame(env, b.id);
  if (!g) return err("No such duel.", 404);
  const seat = seatOf(g, b.token);
  if (!seat) return err("You're not a player in this duel.", 403);
  const name = String(b.name || "").slice(0, 14).trim() || `Player ${seat}`;
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return err("Bad coordinates.");
  const city = String(b.city || "Somewhere").slice(0, 40);
  const p = seat === 1 ? "p1" : "p2";
  await env.DB.prepare(
    `UPDATE games SET ${p}_name=?, ${p}_lat=?, ${p}_lng=?, ${p}_city=?, updated_at=? WHERE id=?`
  ).bind(name, lat, lng, city, Date.now(), b.id).run();
  return json({ ok: true, seat });
}

async function doThrow(env, request) {
  const b = await readBody(request);
  let g = await getGame(env, b.id);
  if (!g) return err("No such duel.", 404);
  g = await maybeResolve(env, g);
  const seat = seatOf(g, b.token);
  if (!seat) return err("You're not a player in this duel.", 403);
  if (g.winner) return err("This duel is already over.");
  if (seat !== g.thrower) return err("It's not your turn to throw.");
  if (g.flight_status === "flying") return err("A tomato is already in flight.");
  if (!located(g, 1) || !located(g, 2)) return err("Both players need to set a location first.");

  const evader = seat === 1 ? 2 : 1;
  const power = clampInt(b.power, 0, 100, 50);
  const dist = Math.max(haversine(g.p1_lat, g.p1_lng, g.p2_lat, g.p2_lng), 5);
  const myPoints = seat === 1 ? g.p1_points : g.p2_points;
  const powerMult = 0.78 + (power / 100) * 0.62; // 0.78 .. 1.40
  const speed = speedFor(myPoints) * powerMult;

  // Wild throw: too much power sends it over the fence and wastes the turn.
  const wildChance = power > 90 ? 0.4 : power > 80 ? 0.12 : 0;
  const now = Date.now();
  if (Math.random() < wildChance) {
    const event = JSON.stringify({ type: "wild", by: seat });
    const res = await env.DB.prepare(
      `UPDATE games SET thrower=?, round=round+1, evseq=evseq+1, last_event=?, updated_at=?
       WHERE id=? AND thrower=? AND flight_status IS NULL`
    ).bind(evader, event, now, g.id, seat).run();
    if (!res.meta.changes) return err("Turn already resolved — refresh.", 409);
    return json({ ok: true, wild: true });
  }

  const realMs = (dist / speed) * 3600 * 1000;
  const travelMs = g.pace === "real"
    ? Math.round(realMs)
    : Math.min(BLITZ_MAX_MS, Math.max(BLITZ_MIN_MS, Math.round(realMs / BLITZ_DIVISOR)));
  const arrive = now + travelMs;
  const event = JSON.stringify({ type: "thrown", by: seat, to: evader });
  const res = await env.DB.prepare(
    `UPDATE games SET flight_from=?, flight_launch=?, flight_arrive=?, flight_speed=?,
       flight_dist=?, flight_power=?, flight_status='flying', evseq=evseq+1, last_event=?, updated_at=?
     WHERE id=? AND thrower=? AND flight_status IS NULL`
  ).bind(seat, now, arrive, speed, dist, power, event, now, g.id, seat).run();
  if (!res.meta.changes) return err("Couldn't throw — the game state changed. Refresh.", 409);
  return json({ ok: true, arrive, travelMs });
}

async function doDodge(env, request) {
  const b = await readBody(request);
  let g = await getGame(env, b.id);
  if (!g) return err("No such duel.", 404);
  const seat = seatOf(g, b.token);
  if (!seat) return err("You're not a player in this duel.", 403);
  if (g.flight_status !== "flying") return err("There's no tomato to dodge.");
  const evader = g.flight_from === 1 ? 2 : 1;
  if (seat !== evader) return err("This tomato isn't coming at you.");

  if (Date.now() >= g.flight_arrive) {
    // Too late — resolve the splat instead.
    g = await maybeResolve(env, g);
    return json({ ok: true, dodged: false });
  }
  const event = JSON.stringify({ type: "dodged", by: evader });
  const res = await env.DB.prepare(
    `UPDATE games SET thrower=?, round=round+1, evseq=evseq+1, last_event=?, updated_at=?,
       flight_from=NULL, flight_launch=NULL, flight_arrive=NULL,
       flight_speed=NULL, flight_dist=NULL, flight_power=NULL, flight_status=NULL
     WHERE id=? AND flight_status='flying'`
  ).bind(evader, event, Date.now(), g.id).run();
  if (!res.meta.changes) { await maybeResolve(env, g); return json({ ok: true, dodged: false }); }
  return json({ ok: true, dodged: true });
}

async function state(env, url) {
  const id = url.searchParams.get("id");
  const token = url.searchParams.get("token") || "";
  if (!id) return err("Missing duel id.");
  let g = await getGame(env, id);
  if (!g) return err("No such duel.", 404);
  g = await maybeResolve(env, g);
  // If the requester left earlier but is polling again, they're back — clear it.
  const seat = seatOf(g, token);
  if (seat && (seat === 1 ? g.p1_left : g.p2_left)) {
    await env.DB.prepare(`UPDATE games SET ${seat === 1 ? "p1_left" : "p2_left"}=0, updated_at=? WHERE id=?`)
      .bind(Date.now(), g.id).run();
    g = await getGame(env, g.id);
  }
  return json(publicState(g, seat));
}

// A player leaves the duel. When BOTH have left, the row is deleted and the
// session is terminated. Otherwise the flag lets the other player be told.
async function doLeave(env, request) {
  const b = await readBody(request);
  const g = await getGame(env, b.id);
  if (!g) return json({ ok: true, ended: true }); // already gone
  const seat = seatOf(g, b.token);
  if (!seat) return err("You're not a player in this duel.", 403);
  const otherLeft = seat === 1 ? g.p2_left : g.p1_left;
  if (otherLeft || !g.p2_token) {
    // both have left (or there was never a second player) — terminate the session
    await env.DB.prepare("DELETE FROM games WHERE id=?").bind(g.id).run();
    return json({ ok: true, ended: true });
  }
  await env.DB.prepare(`UPDATE games SET ${seat === 1 ? "p1_left" : "p2_left"}=1, updated_at=? WHERE id=?`)
    .bind(Date.now(), g.id).run();
  return json({ ok: true, ended: false });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);
  const route = (params.path || []).join("/");
  const method = request.method;
  if (!env.DB) return err("Database binding 'DB' is not configured.", 500);
  try {
    if (method === "POST" && route === "game") return await createGame(env, request);
    if (method === "POST" && route === "join") return await joinGame(env, request);
    if (method === "POST" && route === "setup") return await setup(env, request);
    if (method === "POST" && route === "throw") return await doThrow(env, request);
    if (method === "POST" && route === "dodge") return await doDodge(env, request);
    if (method === "POST" && route === "leave") return await doLeave(env, request);
    if (method === "GET" && route === "state") return await state(env, url);
    return err("Not found.", 404);
  } catch (e) {
    return err(String((e && e.message) || e), 500);
  }
}
