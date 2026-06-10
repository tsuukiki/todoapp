/* ================================================================
   Helpers partages par les fonctions serverless (/api).
   - Connexion Upstash Redis (REST)
   - Configuration web-push (cles VAPID)
   - Petites fonctions utilitaires (cles, parsing du corps, CORS)

   Les fichiers prefixes par "_" ne sont PAS exposes comme endpoints
   par Vercel : c'est volontaire, c'est du code interne.
   ================================================================ */

import { Redis } from "@upstash/redis";
import webpush from "web-push";

// ---- Redis (cree une seule fois par instance de fonction) ----
let _redis = null;
export function getRedis() {
  // Point d'injection pour les tests (ignore en production).
  if (globalThis.__TODO_REDIS__) return globalThis.__TODO_REDIS__;
  if (_redis) return _redis;
  // On accepte les deux nommages possibles selon la facon de creer la base :
  // - integration Upstash directe : UPSTASH_REDIS_REST_URL / _TOKEN
  // - base creee via Vercel (Marketplace/KV) : KV_REST_API_URL / _TOKEN
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Variables Redis manquantes : ajoute une base Upstash/Redis (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN, ou KV_REST_API_URL + KV_REST_API_TOKEN)."
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

// ---- web-push / VAPID ----
let _vapidReady = false;
export function ensureVapid() {
  if (_vapidReady) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:alexandre.giron11@gmail.com";
  if (!pub || !priv) {
    throw new Error("Cles VAPID manquantes (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
  }
  webpush.setVapidDetails(subject, pub, priv);
  _vapidReady = true;
}

export { webpush };

// ---- Cles Redis ----
export const KEYS = {
  // hash : deviceId -> abonnement push (objet PushSubscription)
  subscriptions: "todo:subscriptions",
  // sorted set : membre = "deviceId::id", score = remindAt (ms)
  remindersZ: "todo:reminders:z",
  // hash : "deviceId::id" -> { deviceId, id, titre, remindAt }
  remindersH: "todo:reminders:h",
};

export function reminderMember(deviceId, id) {
  return `${deviceId}::${id}`;
}

// ---- Lecture du corps JSON (compatible Vercel Node) ----
export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body; // deja parse
  return await new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

// ---- Reponses utilitaires ----
export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
