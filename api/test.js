/* POST /api/test
   Envoie immediatement un push de test a l'appareil donne.
   Sert a verifier la chaine d'envoi (abonnement + cles VAPID + APNs)
   SANS dependre du cron ni des rappels planifies.
   Corps attendu : { deviceId } */

import { getRedis, ensureVapid, webpush, KEYS, readJson, sendJson } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Methode non autorisee" });
  }
  try {
    const body = await readJson(req);
    const { deviceId } = body || {};
    if (!deviceId) {
      return sendJson(res, 400, { error: "deviceId requis" });
    }

    const redis = getRedis();
    ensureVapid();

    const sub = await redis.hget(KEYS.subscriptions, deviceId);
    if (!sub || !sub.endpoint) {
      return sendJson(res, 404, {
        ok: false,
        error:
          "Aucun abonnement enregistre pour cet appareil. Reactive les notifications dans l'app.",
      });
    }

    const payload = JSON.stringify({
      title: "Notification de test ✅",
      body: "Si tu vois ceci, les notifications push fonctionnent !",
      tag: "test-notification",
      url: "/",
    });

    try {
      await webpush.sendNotification(sub, payload);
      return sendJson(res, 200, { ok: true, sent: 1, endpoint: sub.endpoint });
    } catch (err) {
      // abonnement expire/invalide -> on le nettoie
      if (err.statusCode === 404 || err.statusCode === 410) {
        await redis.hdel(KEYS.subscriptions, deviceId);
      }
      return sendJson(res, 502, {
        ok: false,
        status: err.statusCode || null,
        error: String((err && (err.body || err.message)) || err),
      });
    }
  } catch (err) {
    console.error("test error", err);
    return sendJson(res, 500, { error: "Erreur serveur", detail: String(err.message || err) });
  }
}
