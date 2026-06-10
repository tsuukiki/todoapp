# Ma To-Do — PWA perso avec vraies notifications push 🔔

Une **liste de tâches** personnelle (un seul utilisateur), au design soigné,
**installable sur iPhone** (« Ajouter à l'écran d'accueil ») et capable d'envoyer
de **vraies notifications push planifiées** — des rappels qui arrivent **même
quand l'app est fermée**.

100 % gratuit, hébergé sur **Vercel**, **sans carte bancaire**.

> 👉 **Pour mettre l'app en ligne, suis le guide pas-à-pas : [`DEPLOY.md`](./DEPLOY.md).**
> Il est écrit pour un non-développeur et dit exactement où coller chaque clé.

---

## Fonctionnalités

- 🔁 **Habitudes quotidiennes** en groupes (**Matin**, **Journée**,
  **Notifications**) : des cases à cocher qui **se remettent à zéro chaque jour**
  (ajout / renommage / suppression directement dans l'app).
- 📊 **Graphique de réussite** : le pourcentage d'habitudes (Matin + Journée)
  effectuées sur les 7 derniers jours, avec moyenne, pour garder le cap.
- 📵 **Hors-ligne** : les habitudes sont stockées en **localStorage** (sur l'appareil).
- 🔔 **Notifications push iOS** : abonnement + bouton de test ; l'infra serveur
  (web-push + cron) est prête pour des rappels planifiés.
- 💬 **Écran d'accueil** : une citation de motivation à chaque lancement (5 s).
- 🎨 **Design** mobile-first, **thème clair** épuré (fond blanc, gris clairs,
  accent anthracite), animations douces.

---

## Architecture

```
.
├── index.html            # Interface (PWA)
├── style.css             # Thème clair (blanc / gris / anthracite)
├── app.js                # Logique : habitudes (groupes), graphique, push
├── sw.js                 # Service worker à la RACINE (push + cache hors-ligne)
├── manifest.json         # Manifeste PWA (obligatoire pour installer + push iOS)
├── icons/                # Icônes générées (192, 512, maskable, apple-touch)
├── api/                  # Fonctions serverless Vercel
│   ├── _lib.js           #   helpers (Redis + web-push) — non exposé
│   ├── config.js         #   GET  → expose la clé VAPID publique au frontend
│   ├── subscribe.js      #   POST → enregistre l'abonnement push
│   ├── reminders.js      #   POST/GET/DELETE → rappels planifiés
│   └── tick.js           #   GET  → appelé par le cron, envoie les push échus
├── scripts/
│   ├── gen_icons.py      # (re)génère les icônes (Python, sans dépendance)
│   └── test_api.mjs      # tests d'intégration des endpoints (sans réseau)
├── vercel.json           # en-têtes (sw.js servi à la racine, bon Content-Type)
└── DEPLOY.md             # ⭐ guide de déploiement pas-à-pas
```

### Pourquoi un cron externe ?
Le cron de **Vercel Hobby ne tourne qu'1 fois/jour** (heure aléatoire) →
inutilisable pour des rappels à la minute. On ping donc `/api/tick` **chaque
minute** via **cron-job.org** (gratuit). L'endpoint est protégé par `CRON_SECRET`.

### Stockage (Upstash Redis)
- `todo:subscriptions` (hash) : `deviceId → abonnement push`.
- `todo:reminders:z` (sorted set) : score = heure du rappel → requête rapide des
  rappels échus.
- `todo:reminders:h` (hash) : détails du rappel (`titre`, `remindAt`…).

---

## Variables d'environnement (sur Vercel)

| Variable | Rôle |
|----------|------|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Signent les push (clés VAPID). |
| `VAPID_SUBJECT` | `mailto:alexandre.giron11@gmail.com`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Accès à la base Redis. |
| `CRON_SECRET` | Protège `/api/tick`. |

La clé **publique** VAPID est exposée au frontend via `GET /api/config`.
Voir [`.env.example`](./.env.example).

---

## Développement local (optionnel)

```bash
npm install
npm run gen:vapid     # générer une paire de clés VAPID
npm run gen:icons     # régénérer les icônes
node scripts/test_api.mjs   # lancer les tests des endpoints (10 tests)
```

Pour tester l'app complète en local, l'outil **Vercel CLI** est pratique :
`npx vercel dev` (sert le statique + les fonctions `/api`). Les push iOS, eux, ne
se testent que sur un vrai iPhone via l'URL HTTPS `vercel.app`.

---

## Contraintes iOS (rappel)

- Push **uniquement** sur **iOS/iPadOS 16.4+**.
- **uniquement** si l'app est **installée** via « Ajouter à l'écran d'accueil ».
- Requiert **HTTPS** + **manifest.json** + **service worker à la racine** (`/sw.js`).
- La **permission** de notification se demande **sur un clic** (bouton « Activer
  les notifications »), jamais au chargement.
