# Minerva — Chatbot IA minimaliste

Minerva est un assistant IA **minimaliste** développé par **Crazy Prince Dev**.
L'application s'ouvre directement sur l'interface de chat : pas de landing page, pas de sidebar, pas de menu. Un seul écran, rien d'autre.

Le frontend est léger (HTML5 / CSS3 / JavaScript vanilla) et la clé API Groq est **uniquement lue côté serveur** via une fonction serverless. Minerva est conçue pour être rapide, directe et utile.

---

## Fonctionnalités

- Interface 100 % chat, sans landing page.
- Thème **sombre par défaut**, bascule thème clair, préférence sauvegardée dans `localStorage`.
- Icônes **Font Awesome 6** partout (header, envoi, copier, erreurs) : **aucun emoji** dans l'interface.
- Message d'accueil contextuel basé sur l'heure locale du navigateur (plusieurs formulations par créneau).
- Conversation **strictement chronologique** : le message le plus ancien en haut, la réponse la plus récente en bas.
- Bulles alignées comme une messagerie classique : **Minerva à gauche** (avec avatar), **vous à droite**, même gabarit de bulle des deux côtés.
- **Sélecteur de modèle IA simple dans la barre de saisie**, regroupé par fournisseur (**Groq** / **OpenRouter**) : le client envoie seulement l'identifiant du modèle choisi ; le backend garde `openai/gpt-oss-20b` par défaut si aucun modèle valide n'est fourni.
- **Modèle sans filtre (Uncensored)** : [Dolphin Mistral 24B Venice Edition](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free) via **OpenRouter**, en plus des modèles Groq. Les deux fournisseurs sont totalement cloisonnés (clé, endpoint et modèles de secours séparés).
- Rendu **markdown** : gras, italique, listes, liens, tableaux, blocs de code.
- Blocs de code avec **coloration syntaxique légère** et bouton **Copier**. Bouton *Copier* également sur chaque message.
- Barre de saisie auto-extensible, envoi avec **Entrée**, saut de ligne avec **Maj+Entrée**.
- Indicateur « Minerva réfléchit… » et **reprise automatique** si Groq renvoie *trop de requêtes* (429) ou une erreur serveur (5xx), côté serveur **et** côté client.
- Bascule automatique sur un **modèle de secours** si le modèle principal est saturé ou indisponible.
- Mémoire conversationnelle : fenêtre glissante des **8 derniers messages** envoyée au backend (40 conservés dans `localStorage`).
- Historique **uniquement en `localStorage`**, jamais de base de données serveur.
- Gestion d'erreurs claires dans le chat (rate limit, clé invalide, timeout, réseau) avec bouton de fermeture.
- Layout **responsive** : fonctionne parfaitement sur **mobile et PC** (CSS Flexbox).
- Accessibilité : contrastes soignés, `aria-label`, navigation au clavier, focus visibles.

---

## Stack technique

| Couche        | Technologie |
| ------------- | ----------- |
| Frontend      | HTML5 sémantique, CSS3 (Flexbox), JavaScript vanilla |
| Icônes        | Font Awesome 6.5.2 (CDN) |
| Backend       | Une seule fonction serverless `/api/chat.js` |
| Proxy IA      | SDK `openai` (`chat.completions.create`) pointé vers Groq + client `fetch` natif pour OpenRouter |
| Modèle        | `openai/gpt-oss-20b` par défaut (configurable via `GROQ_MODEL`) ; le sélecteur client peut seulement remplacer ce nom de modèle dans la requête, avec `openai/gpt-oss-120b` en secours si le modèle choisi/principal renvoie 429/5xx |
| Modèle sans filtre | `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` via OpenRouter (aucun secours par défaut) |
| Hébergement   | Vercel (fonction serverless) et Render (service Node) |
| Secrets       | `process.env.GROQ_API_KEY` et `process.env.OPENROUTER_API_KEY`, jamais exposés au client |

> Le SDK OpenAI compatible Groq prend en charge `chat.completions.create`, qui est l'endpoint stable. `responses.create` existe aussi sur Groq, mais ce projet reste volontairement sur `chat.completions` pour une compatibilité maximale.

---

## Arborescence

```
minerva/
├── public/                 # tout ce qui est envoyé au navigateur
│   ├── index.html          # interface de chat
│   ├── style.css           # styles responsive (Flexbox)
│   ├── script.js           # logique front (localStorage, markdown, envoi, retries)
│   └── assets/
│       ├── logo.svg        # logo vectoriel (casque de Minerve + regards de chouette)
│       └── og-image.png    # image de prévisualisation pour le partage
├── src/                    # modules côté serveur (jamais exposés au client)
│   ├── prompt.js           # identité + ton de Minerva (system prompt)
│   ├── skills.js           # connaissances injectées au system prompt
│   ├── models.js           # catalogue des modèles + routage Groq / OpenRouter
│   └── openrouter.js       # client fetch de l'API OpenRouter (doc officielle)
├── api/
│   └── chat.js             # fonction serverless (proxy Groq + OpenRouter, retries, fallback de modèle)
├── test/
│   └── openrouter.test.js  # tests d'intégration OpenRouter (faux serveur local, `npm test`)
├── server.js               # serveur local / Render (sert public/ + /api/chat)
├── .env.example            # modèle de variables d'environnement
├── .env.local              # clés réelles en local (ignoré par git, prioritaire sur .env)
├── .gitignore              # .env jamais commité, node_modules, etc.
├── vercel.json
└── README.md
```

---

## Installation locale

Prérequis : **Node.js 20+** et npm.

1. Cloner le dépôt :

```bash
git clone <url-du-repo> minerva
cd minerva
```

2. Installer les dépendances :

```bash
npm install
```

3. Créer le fichier d'environnement depuis le modèle :

```bash
cp .env.example .env
```

4. Ouvrir le fichier `.env` et renseigner la clé Groq :

```env
GROQ_API_KEY=ta_cle_groq_ici
```

> Obtiens une clé sur <https://console.groq.com/keys>. Elle est **strictement confidentielle** : ne la colle jamais dans le chat ni dans un fichier commité.

5. Lancer le serveur local :

```bash
npm run dev
```

L'application est disponible sur **<http://localhost:3000>**.

---

## Variables d'environnement

| Variable               | Obligatoire | Défaut                                                | Description |
| ---------------------- | ----------- | ----------------------------------------------------- | ----------- |
| `GROQ_API_KEY`         | oui         | —                                                     | Clé API Groq (jamais côté client). |
| `GROQ_MODEL`           | non         | `openai/gpt-oss-20b`                                  | Modèle Groq principal. |
| `GROQ_FALLBACK_MODELS` | non         | `openai/gpt-oss-120b`                                 | Modèles de secours (uniquement si le principal renvoie 429/5xx/404). `none` pour désactiver. |
| `GROQ_TEMPERATURE`     | non         | `0.7`                                                 | Température de génération. |
| `GROQ_MAX_TOKENS`      | non         | `4096`                                                | Nombre max de tokens de sortie. |
| `GROQ_DEADLINE_MS`     | non         | `26000`                                               | Budget total d'une requête côté serveur (doit rester < `maxDuration`). |
| `OPENROUTER_API_KEY`   | oui (modèle sans filtre) | —                                        | Clé API OpenRouter (jamais côté client). Sans elle, seuls les modèles Groq répondent. À mettre de préférence dans `.env.local`. |
| `OPENROUTER_MODEL`     | non         | `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` | Modèle OpenRouter par défaut. |
| `OPENROUTER_FALLBACK_MODELS` | non   | `none`                                                | Secours OpenRouter (jamais un modèle Groq). `none` = aucun secours. |
| `OPENROUTER_TEMPERATURE` | non       | `0.7`                                                 | Température pour les modèles OpenRouter. |
| `OPENROUTER_MAX_TOKENS` | non        | `4096`                                                | Tokens de sortie max pour les modèles OpenRouter. |
| `OPENROUTER_SITE_URL`  | non         | *(vide)*                                              | En-tête optionnel `HTTP-Referer` (classements openrouter.ai). Laissé vide = non envoyé. |
| `OPENROUTER_SITE_NAME` | non         | *(vide)*                                              | En-tête optionnel `X-OpenRouter-Title` (classements openrouter.ai). Laissé vide = non envoyé. |
| `OPENROUTER_BASE_URL`  | non         | `https://openrouter.ai/api/v1`                        | À ne changer que pour un proxy/miroir ou les tests. |
| `PORT`                 | non         | `3000`                                                | Port du serveur (utilisé par Render). |

### Où mettre la clé OpenRouter

Le serveur charge, dans cet ordre : les variables d'environnement de l'hébergeur, puis
`.env.local` (**ignoré par git**, prioritaire), puis `.env`. GitHub refuse tout push
contenant une clé OpenRouter (*push protection*) : garde donc la vraie clé dans `.env.local`
en local, et dans les variables d'environnement sur Vercel/Render.

```bash
# .env.local  (jamais commité)
OPENROUTER_API_KEY=sk-or-v1-...
```

### Modèle sans filtre (OpenRouter)

Le sélecteur de modèles propose, sous le groupe **OpenRouter**, l'entrée **Dolphin 24B · Uncensored**
([`cognitivecomputations/dolphin-mistral-24b-venice-edition:free`](https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free)).
Quand il est sélectionné, un repère « Mode sans filtre actif » s'affiche sous la barre de saisie.

Cloisonnement avec Groq (aucun conflit possible) :

- le fournisseur est déduit **du modèle** (`src/models.js`), pas d'une variable globale ;
- un modèle OpenRouter n'utilise **jamais** `GROQ_API_KEY`, `GROQ_MODEL` ni `GROQ_FALLBACK_MODELS` — et inversement ;
- les modèles de secours sont filtrés sur le fournisseur courant : pas de bascule Groq ↔ OpenRouter ;
- les messages d'erreur (429, 401, 5xx…) nomment le bon fournisseur.

L'appel suit la [doc OpenRouter](https://openrouter.ai/docs/quickstart) (`POST https://openrouter.ai/api/v1/chat/completions`,
en-tête `Authorization: Bearer <clé>`), en JavaScript avec `fetch` (`src/openrouter.js`).
Les en-têtes optionnels `HTTP-Referer` et `X-OpenRouter-Title` ne sont envoyés que si
`OPENROUTER_SITE_URL` / `OPENROUTER_SITE_NAME` sont renseignés.

### Tests

```bash
npm test
```

`test/openrouter.test.js` démarre un faux serveur OpenRouter local et vérifie l'URL, la méthode,
les en-têtes, le corps JSON, le parsing de la réponse, le routage par fournisseur et la gestion
des erreurs (401, 429, 5xx, clé manquante) — sans appeler le réseau.

---

## Déploiement Vercel

1. Pousse ce dossier sur ton dépôt GitHub.
2. Sur [Vercel](https://vercel.com), importe le dépôt.
3. Framework preset : **Other**. Répertoire racine : `/`.
4. Build command : laisser vide (ou `npm install`). **Output directory : `public`** (déjà configuré dans `vercel.json`, champ `outputDirectory`).
5. Dans **Settings → Environment Variables**, ajoute :
   - `GROQ_API_KEY` = ta clé Groq
   - `OPENROUTER_API_KEY` = ta clé OpenRouter (pour le modèle sans filtre)
   - (optionnel) `GROQ_MODEL`, `GROQ_FALLBACK_MODELS`, `GROQ_TEMPERATURE`, `GROQ_MAX_TOKENS`, `OPENROUTER_MODEL`
6. Déploie. La route `/api/chat` est servie par `api/chat.js`.

Après le premier déploiement, remplace l'URL de domaine par défaut dans les balises Open Graph de `public/index.html` :

```html
<meta property="og:url" content="https://ton-domaine.vercel.app/" />
<meta property="og:image" content="https://ton-domaine.vercel.app/assets/og-image.png" />
```

---

## Déploiement Render

Render lance l'application comme un **service web Node** : `server.js` sert le dossier `public/` et route `POST /api/chat` vers la même logique que sur Vercel.

1. Sur [Render](https://render.com), crée un **New → Web Service**.
2. Connecte ton dépôt Git.
3. Configurations :
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Dans **Environment** (Render), ajoute les variables :
   - `GROQ_API_KEY` = ta clé Groq
   - `OPENROUTER_API_KEY` = ta clé OpenRouter (pour le modèle sans filtre)
5. Déclenche le déploiement.

Le serveur expose aussi `GET /api/health` pour vérifier que le service tourne.

---

## Sécurité

- Les clés API (Groq et OpenRouter) ne sont **jamais** incluses dans `public/`, ni dans les appels réseau du navigateur : le client n'envoie qu'un identifiant de modèle.
- Le backend valide la méthode, la longueur du message et la fenêtre de mémoire.
- Réponses d'erreur simplifiées : les détails sensibles ne sont pas renvoyés au client.
- `.gitignore` exclut `.env` et tous les secrets. **Attention :** un fichier `.env` contenant une vraie clé a été commité par le passé. Il a été retiré du suivi git — mais la clé reste dans l'historique : **révoque-la et régénère-la** sur <https://console.groq.com/keys>.

---

## UI / Logo / Preview

- **Logo** : SVG minimaliste (`public/assets/logo.svg`) inspiré du casque de Minerve fusionné aux yeux d'une chouette.
- **Preview de partage** : `public/assets/og-image.png` + balises Open Graph et Twitter Card dans `public/index.html`.
- **Icônes** : Font Awesome 6 chargé depuis cdnjs (aucun emoji). Pour fonctionner hors ligne, télécharge le paquet `@fortawesome/fontawesome-free` et remplace le `<link>` par un chemin local.

Description de l'UI :

> Un header fin avec le logo et « Minerva » à gauche, et à droite le bouton d'effacement (corbeille) puis le toggle de thème (lune / soleil). Le centre est occupé uniquement par la conversation. Quand elle est vide, un message d'accueil contextuel apparaît. Les messages de Minerva sont à gauche avec le logo en avatar, les vôtres à droite en violet, même forme de bulle des deux côtés, avec timestamps et bouton « Copier ». La barre de saisie est fixée en bas, avec envoi via Entrée ou le bouton avion en papier, et un indicateur « Minerva réfléchit… » pendant l'appel.

---

## À propos du prompt

- `src/prompt.js` contient l'identité de Minerva et son ton : **direct, sans morale, sans disclaimer automatique, sans refus de prudence** (inspiré du ton de Desk-GPT : on répond au lieu de sermonner).
- Il reste un plancher légal volontairement réduit à une ligne (armes opérationnelles, contenus impliquant des mineurs, atteinte ciblée à une personne identifiée, fraude/intrusion contre un tiers non consentant). Tout le reste, y compris la sécurité offensive, l'OSINT, les sujets tabous ou controversés, est traité comme une question technique normale.
- `src/skills.js` injecte des connaissances ciblées : développement web, code & architecture, sécurité / hacking, recherche et esprit critique.

---

## Author

Développé par **Crazy Prince Dev**. Projet open source pour apprendre, s'amuser et discuter avec un assistant rapide.
