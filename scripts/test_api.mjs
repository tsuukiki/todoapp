/* Test d'integration leger des endpoints /api, sans reseau.
   - Redis remplace par un mock en memoire (via globalThis.__TODO_REDIS__)
   - web-push.sendNotification est stubbe pour ne rien envoyer reellement
   Lance : node scripts/test_api.mjs */

import assert from "node:assert";
import webpush from "web-push";

// ---- env factice mais au bon format ----
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.VAPID_SUBJECT = "mailto:test@example.com";
process.env.CRON_SECRET = "secret-test-123";
process.env.UPSTASH_REDIS_REST_URL = "https://fake";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake";

// ---- mock Redis en memoire (juste les commandes utilisees) ----
const store = { hashes: new Map(), zsets: new Map() };
function getHash(k) {
  if (!store.hashes.has(k)) store.hashes.set(k, new Map());
  return store.hashes.get(k);
}
function getZ(k) {
  if (!store.zsets.has(k)) store.zsets.set(k, new Map());
  return store.zsets.get(k);
}
globalThis.__TODO_REDIS__ = {
  async hset(key, obj) {
    const h = getHash(key);
    for (const [f, v] of Object.entries(obj)) h.set(f, v);
    return Object.keys(obj).length;
  },
  async hget(key, field) {
    return getHash(key).get(field) ?? null;
  },
  async hdel(key, field) {
    return getHash(key).delete(field) ? 1 : 0;
  },
  async zadd(key, { score, member }) {
    getZ(key).set(member, score);
    return 1;
  },
  async zrem(key, member) {
    return getZ(key).delete(member) ? 1 : 0;
  },
  async zrange(key, min, max, opts) {
    const entries = [...getZ(key).entries()].sort((a, b) => a[1] - b[1]);
    if (opts && opts.byScore) {
      return entries.filter(([, s]) => s >= min && s <= max).map(([m]) => m);
    }
    // par index (0..-1)
    return entries.map(([m]) => m);
  },
};

// ---- stub web-push ----
const sentPushes = [];
webpush.sendNotification = async (sub, payload) => {
  sentPushes.push({ endpoint: sub.endpoint, payload });
  return { statusCode: 201 };
};

// ---- faux req/res ----
function makeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { this.body = s ? JSON.parse(s) : null; },
  };
}
function makeReq({ method = "GET", query = {}, body = null, headers = {} }) {
  return { method, query, body, headers };
}

const DEVICE = "device-abc";
const SUB = { endpoint: "https://web.push.apple.com/xyz", keys: { p256dh: "p", auth: "a" } };

const { default: subscribe } = await import("../api/subscribe.js");
const { default: reminders } = await import("../api/reminders.js");
const { default: tick } = await import("../api/tick.js");
const { default: config } = await import("../api/config.js");

let pass = 0;
function ok(name) { console.log("  ✓", name); pass++; }

// 1) config expose la cle publique
{
  const res = makeRes();
  config(makeReq({}), res);
  assert.equal(res.body.vapidPublicKey, keys.publicKey);
  ok("GET /api/config renvoie la cle VAPID publique");
}

// 2) subscribe enregistre l'abonnement
{
  const res = makeRes();
  await subscribe(makeReq({ method: "POST", body: { deviceId: DEVICE, subscription: SUB } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  ok("POST /api/subscribe enregistre l'abonnement");
}

// 3) subscribe refuse un corps invalide
{
  const res = makeRes();
  await subscribe(makeReq({ method: "POST", body: {} }), res);
  assert.equal(res.statusCode, 400);
  ok("POST /api/subscribe rejette un corps invalide (400)");
}

// 4) reminders : ajout d'un rappel ECHU (passe) et d'un rappel FUTUR
const pastId = "task-past";
const futureId = "task-future";
{
  const res1 = makeRes();
  await reminders(makeReq({ method: "POST", body: { deviceId: DEVICE, id: pastId, titre: "Sortir le chien", remindAt: Date.now() - 5000 } }), res1);
  assert.equal(res1.body.ok, true);

  const res2 = makeRes();
  await reminders(makeReq({ method: "POST", body: { deviceId: DEVICE, id: futureId, titre: "Reunion", remindAt: Date.now() + 3600_000 } }), res2);
  assert.equal(res2.body.ok, true);
  ok("POST /api/reminders ajoute un rappel passe et un futur");
}

// 5) reminders GET liste les 2 rappels de l'appareil
{
  const res = makeRes();
  await reminders(makeReq({ method: "GET", query: { deviceId: DEVICE } }), res);
  assert.equal(res.body.reminders.length, 2);
  ok("GET /api/reminders liste les rappels de l'appareil");
}

// 6) tick refuse un mauvais secret
{
  const res = makeRes();
  await tick(makeReq({ method: "GET", query: { secret: "mauvais" } }), res);
  assert.equal(res.statusCode, 401);
  ok("GET /api/tick refuse un mauvais secret (401)");
}

// 7) tick avec bon secret : envoie le push du rappel ECHU, garde le futur
{
  const res = makeRes();
  await tick(makeReq({ method: "GET", query: { secret: "secret-test-123" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 1, "un seul push (le rappel echu)");
  assert.equal(sentPushes.length, 1);
  const payload = JSON.parse(sentPushes[0].payload);
  assert.ok(payload.title.includes("Sortir le chien"), "titre du push correct");
  ok("GET /api/tick envoie le push du rappel echu uniquement");
}

// 8) le rappel echu est supprime, le futur reste
{
  const res = makeRes();
  await reminders(makeReq({ method: "GET", query: { deviceId: DEVICE } }), res);
  assert.equal(res.body.reminders.length, 1);
  assert.equal(res.body.reminders[0].id, futureId);
  ok("Le rappel echu est supprime apres envoi, le futur reste");
}

// 9) DELETE supprime un rappel
{
  const res = makeRes();
  await reminders(makeReq({ method: "DELETE", query: { deviceId: DEVICE, id: futureId } }), res);
  assert.equal(res.body.ok, true);
  const res2 = makeRes();
  await reminders(makeReq({ method: "GET", query: { deviceId: DEVICE } }), res2);
  assert.equal(res2.body.reminders.length, 0);
  ok("DELETE /api/reminders supprime le rappel");
}

// 10) tick a vide ne renvoie aucun push
{
  const res = makeRes();
  await tick(makeReq({ method: "GET", query: { secret: "secret-test-123" } }), res);
  assert.equal(res.body.sent, 0);
  ok("GET /api/tick ne fait rien quand aucun rappel n'est echu");
}

console.log(`\n${pass} tests OK ✅`);
