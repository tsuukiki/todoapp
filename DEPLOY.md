# 📲 Guide de déploiement pas-à-pas (pour non-développeur)

Ce guide t'emmène de zéro jusqu'à **l'app installée sur ton iPhone avec des vraies
notifications push**. Suis les étapes **dans l'ordre**. Compte ~30 minutes la
première fois. **Tout est 100 % gratuit, sans carte bancaire.**

> 💡 Tu vas devoir **copier-coller des clés/tokens**. Garde un bloc-notes ouvert
> pour les coller au fur et à mesure. À chaque étape je te dis exactement
> **où coller quoi**.

---

## Vue d'ensemble (les 6 ingrédients)

| Étape | Service | Gratuit ? | Ce que tu obtiens |
|------|---------|-----------|-------------------|
| 1 | GitHub | ✅ | Héberge le code |
| 2 | Clés VAPID | ✅ | Signent les notifications push |
| 3 | Vercel | ✅ (Hobby) | Met l'app en ligne (`xxx.vercel.app`) |
| 4 | Upstash Redis | ✅ | Stocke abonnement + rappels |
| 5 | Variables Vercel | — | On colle toutes les clés ici |
| 6 | cron-job.org | ✅ | Déclenche les rappels chaque minute |

À la fin : **étape 7** = installer sur l'iPhone.

---

## Étape 1 — Mettre le code sur GitHub

Le code est déjà dans ce dépôt. Il te suffit qu'il soit sur **ton compte GitHub**
(c'est sûrement déjà le cas si tu lis ceci depuis GitHub). Si tu pars d'un dossier
local :

1. Crée un compte sur https://github.com (gratuit).
2. Crée un nouveau dépôt (« New repository »), par ex. `ma-todo`.
3. Envoie le code dedans (bouton « uploading an existing file » ou via Git).

👉 **Rien à coller pour l'instant.**

---

## Étape 2 — Générer les clés VAPID (signature des push)

Les notifications push doivent être **signées** par une paire de clés VAPID.

### Méthode A — la plus simple (en ligne, rien à installer)

1. Va sur **https://vapidkeys.com/**
2. Entre ton e-mail : `alexandre.giron11@gmail.com`
3. Clique pour générer. Tu obtiens **Public Key** et **Private Key**.
4. **Copie les deux** dans ton bloc-notes. Note bien laquelle est *Public* et
   laquelle est *Private*.

### Méthode B — en ligne de commande (si tu as Node installé)

```bash
npx web-push generate-vapid-keys
```

Ça affiche :

```
Public Key:
BPxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx...
Private Key:
yyyyyyyyyyyyyyyyyyyyyyyyyy...
```

👉 **À garder dans ton bloc-notes :**
- `VAPID_PUBLIC_KEY` = la clé **publique**
- `VAPID_PRIVATE_KEY` = la clé **privée** (⚠️ secrète, ne la partage jamais)

---

## Étape 3 — Créer le compte Vercel et déployer

1. Va sur **https://vercel.com** → « Sign Up » → **Continue with GitHub**
   (choisis le plan **Hobby**, gratuit, **pas de carte demandée**).
2. Clique **« Add New… » → « Project »**.
3. Vercel liste tes dépôts GitHub. Choisis ton dépôt (`ma-todo`) → **Import**.
4. Laisse tous les réglages par défaut (Framework Preset : « Other ». Pas de
   build command nécessaire, c'est un site statique + fonctions).
5. **NE clique pas encore sur Deploy** si tu veux mettre les variables tout de
   suite — sinon clique **Deploy**, on ajoutera les variables juste après
   (étape 5) puis on redéploiera.

À la fin, tu obtiens une URL du type **`https://ma-todo.vercel.app`**.

👉 **À noter :** ton URL `xxx.vercel.app`.

---

## Étape 4 — Créer la base Upstash Redis (gratuite)

C'est là que sont stockés ton abonnement push et tes rappels.

### Option recommandée : via l'intégration Vercel (le plus simple)

1. Dans Vercel, ouvre ton projet → onglet **« Storage »** → **« Create / Connect
   Database »** → choisis **Upstash (Redis)** → **Continue**.
2. Crée la base (nom au choix, région proche de toi, ex. Paris/Frankfurt).
3. ✅ Bonne nouvelle : Vercel ajoute **automatiquement** les variables
   `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` à ton projet. **Tu n'as
   rien à copier.** (Passe directement à l'étape 5 pour les variables VAPID/CRON.)

### Option B : compte Upstash direct

1. Va sur **https://upstash.com** → Sign up (gratuit, sans carte).
2. **Create Database** → type **Redis** → région proche → Create.
3. Sur la page de la base, onglet **« REST API »**, copie :
   - **`UPSTASH_REDIS_REST_URL`** (commence par `https://...upstash.io`)
   - **`UPSTASH_REDIS_REST_TOKEN`** (longue chaîne)

👉 **À garder dans ton bloc-notes** (sauf si Vercel les a déjà ajoutées).

---

## Étape 5 — Configurer les variables d'environnement sur Vercel

C'est **l'étape centrale** : on colle toutes les clés au même endroit.

1. Dans Vercel : ton projet → **Settings** → **Environment Variables**.
2. Ajoute **chaque** variable ci-dessous (Name = à gauche, Value = ce que tu as
   copié). Laisse les 3 environnements cochés (Production / Preview / Development).

| Name (à taper exactement) | Value (ce que tu colles) |
|---------------------------|--------------------------|
| `VAPID_PUBLIC_KEY` | ta clé **publique** VAPID (étape 2) |
| `VAPID_PRIVATE_KEY` | ta clé **privée** VAPID (étape 2) |
| `VAPID_SUBJECT` | `mailto:alexandre.giron11@gmail.com` |
| `UPSTASH_REDIS_REST_URL` | URL Upstash (étape 4, si pas déjà là) |
| `UPSTASH_REDIS_REST_TOKEN` | Token Upstash (étape 4, si pas déjà là) |
| `CRON_SECRET` | **invente** une longue chaîne secrète, ex. `mon-secret-93h2kd0fj2` |

> 🔐 **`CRON_SECRET`** : choisis n'importe quelle suite de lettres/chiffres
> difficile à deviner (20+ caractères). C'est ce qui empêche les autres de
> déclencher tes rappels. **Garde-la** : tu en as besoin à l'étape 6.

3. **Redéploie** pour que les variables soient prises en compte :
   onglet **Deployments** → bouton **« … » du dernier déploiement → Redeploy**.

✅ Pour vérifier que c'est bon, ouvre dans ton navigateur :
`https://TON-APP.vercel.app/api/config`
Tu dois voir ta **clé publique** s'afficher (`{"vapidPublicKey":"BPxxxx..."}`).
Si tu vois `null`, c'est que la variable `VAPID_PUBLIC_KEY` n'est pas prise en
compte → revérifie l'orthographe et redéploie.

---

## Étape 6 — Créer le cron gratuit (les rappels chaque minute)

⚠️ **Important :** le cron de Vercel gratuit ne tourne qu'**une fois par jour** →
inutilisable pour des rappels à la minute. On utilise donc **cron-job.org**
(gratuit, sans carte) qui « pingue » ton app **chaque minute**.

1. Va sur **https://cron-job.org** → crée un compte gratuit.
2. **Create cronjob**.
3. **Title** : `Tick To-Do`
4. **URL** (⚠️ remplace les deux parties) :
   ```
   https://TON-APP.vercel.app/api/tick?secret=TON_CRON_SECRET
   ```
   - `TON-APP.vercel.app` = ton URL Vercel (étape 3)
   - `TON_CRON_SECRET` = exactement la valeur de `CRON_SECRET` (étape 5)
5. **Schedule** : choisis **« Every 1 minute »** (toutes les minutes).
6. **Create / Save**.

✅ Pour tester tout de suite : clique sur **« Run now »** (ou ouvre l'URL dans ton
navigateur). Tu dois voir une réponse du type `{"ok":true,"sent":0,...}`.
Si tu vois `{"error":"Secret invalide"}` → le `secret=` dans l'URL ne correspond
pas à `CRON_SECRET`.

---

## Étape 7 — Installer sur l'iPhone et activer les notifications

> 📵 **Pré-requis iOS :** les push ne marchent **que** sur **iOS 16.4 ou plus**, et
> **uniquement** quand l'app est installée sur l'écran d'accueil (pas dans Safari).

1. Ouvre **Safari** (pas Chrome) sur ton iPhone.
2. Va sur **`https://TON-APP.vercel.app`**.
3. Appuie sur le bouton **Partager** (carré avec une flèche ↑ en bas).
4. Choisis **« Sur l'écran d'accueil »** → **Ajouter**.
5. **Ferme Safari** et ouvre l'app depuis sa **nouvelle icône** sur l'écran
   d'accueil. (C'est indispensable : les push ne marchent que lancée comme ça.)
6. À la première ouverture, **crée ton code PIN** (4 à 6 chiffres).
7. Dans l'app, appuie sur **« Activer les notifications »** et **Autorise**
   quand iOS le demande. ✅

---

## ✅ Test du parcours complet (le grand test !)

1. Dans l'app, ajoute une tâche, par ex. **« Test rappel »**.
2. Mets-lui une **échéance dans ~2 minutes** (champ date + heure).
3. Vérifie qu'une petite **🔔 cloche** apparaît sur la tâche : ça veut dire que le
   rappel est **synchronisé avec le serveur**.
4. **Ferme complètement l'app** (balaie-la hors du sélecteur d'apps).
5. Attends l'heure dite (le cron vérifie chaque minute, prévois ~1 min de marge).
6. 🎉 Tu dois recevoir une **notification « Rappel : Test rappel »** même app
   fermée.

Si ça marche : **félicitations, tout est opérationnel !**

---

## 🧯 Dépannage rapide

| Problème | Cause probable / solution |
|----------|---------------------------|
| `/api/config` renvoie `null` | `VAPID_PUBLIC_KEY` manquante sur Vercel → ajoute-la et **redéploie**. |
| Le bouton « Activer » est grisé sur iPhone | Tu es dans **Safari**, pas dans l'app installée. Ouvre via l'icône de l'écran d'accueil. |
| `/api/tick` dit « Secret invalide » | Le `secret=` de l'URL cron ≠ `CRON_SECRET` de Vercel. Aligne les deux. |
| « Erreur serveur » sur `/api/...` | Variables Upstash absentes/incorrectes → vérifie l'étape 4 et redéploie. |
| Pas de notif reçue | 1) iOS ≥ 16.4 ? 2) App **installée** (pas Safari) ? 3) Notifications **autorisées** ? 4) Cron actif sur cron-job.org (« Run now » pour tester) ? |
| La notif arrive en retard | Normal : le cron tourne **chaque minute**, il peut y avoir jusqu'à ~1 min de décalage. |

---

## 🌍 (Optionnel) Brancher `app.bliix.fr` plus tard

1. Vercel → projet → **Settings → Domains** → ajoute `app.bliix.fr`.
2. Chez ton registrar (DNS de bliix.fr), ajoute l'enregistrement **CNAME** que
   Vercel t'indique.
3. Rien à changer dans le code ni le cron (tu peux garder l'URL `.vercel.app`
   pour le cron, ou la remplacer par le nouveau domaine).

---

## 🔒 Note sur la confidentialité

- Tes **tâches** restent **sur ton téléphone** (localStorage), pas sur le serveur.
- Le serveur ne stocke que le **minimum** pour les push : ton abonnement push et,
  pour chaque rappel actif, son **titre + l'heure** (supprimé dès l'envoi).
- Le **code PIN** est une protection **légère** (côté téléphone) pour que personne
  ne lise tes tâches si on ouvre l'URL. Ce n'est pas une sécurité serveur, mais
  c'est suffisant pour un usage perso.
