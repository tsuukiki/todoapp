/* GET /api/config
   Expose au frontend la cle VAPID PUBLIQUE (jamais la privee).
   Permet de ne pas coder la cle en dur dans app.js. */

import { sendJson } from "./_lib.js";

export default function handler(req, res) {
  sendJson(res, 200, {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  });
}
