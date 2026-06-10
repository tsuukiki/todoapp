/* /api/reminders — gestion des rappels planifies cote serveur.

   POST   { deviceId, id, titre, remindAt }  -> ajoute/met a jour un rappel
   GET    ?deviceId=XXX                       -> liste les rappels de l'appareil
   DELETE ?deviceId=XXX&id=YYY                -> supprime un rappel

   Stockage :
   - sorted set  todo:reminders:z  (score = remindAt, membre = "deviceId::id")
   - hash        todo:reminders:h  ("deviceId::id" -> { deviceId, id, titre, remindAt })
   Le sorted set permet a /api/tick de trouver vite les rappels echus. */

import {
  getRedis,
  KEYS,
  reminderMember,
  readJson,
  sendJson,
} from "./_lib.js";

export default async function handler(req, res) {
  try {
    const redis = getRedis();

    // -------------------- POST : ajouter / mettre a jour --------------------
    if (req.method === "POST") {
      const body = await readJson(req);
      const { deviceId, id, titre, remindAt } = body || {};

      if (!deviceId || !id || !remindAt) {
        return sendJson(res, 400, { error: "deviceId, id et remindAt requis" });
      }
      const ts = Number(remindAt);
      if (!Number.isFinite(ts)) {
        return sendJson(res, 400, { error: "remindAt invalide" });
      }

      const member = reminderMember(deviceId, id);
      const data = { deviceId, id, titre: titre || "Rappel", remindAt: ts };

      // upsert : zadd remplace le score si le membre existe deja
      await redis.zadd(KEYS.remindersZ, { score: ts, member });
      await redis.hset(KEYS.remindersH, { [member]: data });

      return sendJson(res, 200, { ok: true, reminder: data });
    }

    // -------------------- GET : lister --------------------
    if (req.method === "GET") {
      const { deviceId } = req.query || {};
      if (!deviceId) {
        return sendJson(res, 400, { error: "deviceId requis" });
      }

      // tous les membres tries par echeance, puis on filtre par appareil
      const members = await redis.zrange(KEYS.remindersZ, 0, -1);
      const mine = members.filter((m) => String(m).startsWith(deviceId + "::"));
      const reminders = [];
      for (const m of mine) {
        const data = await redis.hget(KEYS.remindersH, m);
        if (data) reminders.push(data);
      }
      return sendJson(res, 200, { reminders });
    }

    // -------------------- DELETE : supprimer --------------------
    if (req.method === "DELETE") {
      const { deviceId, id } = req.query || {};
      if (!deviceId || !id) {
        return sendJson(res, 400, { error: "deviceId et id requis" });
      }
      const member = reminderMember(deviceId, id);
      await redis.zrem(KEYS.remindersZ, member);
      await redis.hdel(KEYS.remindersH, member);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { error: "Methode non autorisee" });
  } catch (err) {
    console.error("reminders error", err);
    return sendJson(res, 500, { error: "Erreur serveur", detail: String(err.message || err) });
  }
}
