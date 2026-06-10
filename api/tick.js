/* GET /api/tick?secret=XXX
   Appele par un cron externe (ex. cron-job.org) TOUTES LES MINUTES.
   - Verifie le secret (CRON_SECRET).
   - Trouve les rappels dont l'heure est passee.
   - Envoie le push correspondant.
   - Supprime le rappel envoye.

   Le secret peut etre passe :
   - en query : /api/tick?secret=XXX
   - ou en header : Authorization: Bearer XXX  (ou x-cron-secret: XXX) */

import {
  getRedis,
  ensureVapid,
  webpush,
  KEYS,
  sendJson,
} from "./_lib.js";

function getProvidedSecret(req) {
  if (req.query && req.query.secret) return String(req.query.secret);
  const auth = req.headers["authorization"];
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);
  if (req.headers["x-cron-secret"]) return String(req.headers["x-cron-secret"]);
  return null;
}

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const provided = getProvidedSecret(req);

  if (!expected) {
    return sendJson(res, 500, { error: "CRON_SECRET non configure cote serveur" });
  }
  if (provided !== expected) {
    return sendJson(res, 401, { error: "Secret invalide" });
  }

  try {
    const redis = getRedis();
    ensureVapid();

    const now = Date.now();

    // membres dont le score (remindAt) est <= maintenant
    const due = await redis.zrange(KEYS.remindersZ, 0, now, { byScore: true });

    if (!due || due.length === 0) {
      return sendJson(res, 200, { ok: true, checked: now, sent: 0, due: 0 });
    }

    let sent = 0;
    const errors = [];

    for (const member of due) {
      const data = await redis.hget(KEYS.remindersH, member);
      // si la donnee a disparu, on nettoie le sorted set et on continue
      if (!data) {
        await redis.zrem(KEYS.remindersZ, member);
        continue;
      }

      const deviceId = data.deviceId;
      const sub = await redis.hget(KEYS.subscriptions, deviceId);

      if (sub && sub.endpoint) {
        const payload = JSON.stringify({
          title: "Rappel : " + (data.titre || "tache"),
          body: "C'est l'heure ! ⏰",
          tag: "reminder-" + data.id,
          url: "/",
        });
        try {
          await webpush.sendNotification(sub, payload);
          sent++;
        } catch (err) {
          errors.push({ member, status: err.statusCode, msg: String(err.message || err) });
          // abonnement expire/invalide -> on le supprime
          if (err.statusCode === 404 || err.statusCode === 410) {
            await redis.hdel(KEYS.subscriptions, deviceId);
          }
        }
      }

      // le rappel a ete traite (envoye ou abonnement manquant) -> on le retire
      await redis.zrem(KEYS.remindersZ, member);
      await redis.hdel(KEYS.remindersH, member);
    }

    return sendJson(res, 200, {
      ok: true,
      checked: now,
      due: due.length,
      sent,
      errors: errors.length ? errors : undefined,
    });
  } catch (err) {
    console.error("tick error", err);
    return sendJson(res, 500, { error: "Erreur serveur", detail: String(err.message || err) });
  }
}
