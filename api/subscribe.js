/* POST /api/subscribe
   Enregistre l'abonnement push du navigateur pour cet appareil.
   Corps attendu : { deviceId, subscription }
   subscription = objet PushSubscription renvoye par pushManager.subscribe(). */

import { getRedis, KEYS, readJson, sendJson } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "Methode non autorisee" });
  }

  try {
    const body = await readJson(req);
    const { deviceId, subscription } = body || {};

    if (!deviceId || !subscription || !subscription.endpoint) {
      return sendJson(res, 400, { error: "deviceId et subscription requis" });
    }

    const redis = getRedis();
    await redis.hset(KEYS.subscriptions, { [deviceId]: subscription });

    return sendJson(res, 200, { ok: true });
  } catch (err) {
    console.error("subscribe error", err);
    return sendJson(res, 500, { error: "Erreur serveur", detail: String(err.message || err) });
  }
}
