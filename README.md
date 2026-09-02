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
| Proxy IA      | SDK `openai` (`chat.completions.create`) pointé vers Groq |
| Modèle        | `openai/gpt-oss-20b` (configurable via `GROQ_MODEL`), avec `llama-3.1-8b-instant` en secours uniquement si le principal renvoie 429/5xx |
| Hébergement   | Vercel (fonction serverless) et Render (service Node) |
| Secrets       | `process.env.GROQ_API_KEY`, jamais exposé au client |

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
│   └── skills.js           # connaissances injectées au system prompt
├── api/
│   └── chat.js             # fonction serverless (proxy Groq, retries, fallback de modèle)
├── server.js               # serveur local / Render (sert public/ + /api/chat)
├── .env.example            # modèle de variables d'environnement
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
| `GROQ_FALLBACK_MODELS` | non         | `llama-3.1-8b-instant`                                | Modèles de secours (uniquement si le principal renvoie 429/5xx/404). `none` pour désactiver. |
| `GROQ_TEMPERATURE`     | non         | `0.7`                                                 | Température de génération. |
| `GROQ_MAX_TOKENS`      | non         | `4096`                                                | Nombre max de tokens de sortie. |
| `GROQ_DEADLINE_MS`     | non         | `26000`                                               | Budget total d'une requête côté serveur (doit rester < `maxDuration`). |
| `PORT`                 | non         | `3000`                                                | Port du serveur (utilisé par Render). |

---

## Déploiement Vercel

1. Pousse ce dossier sur ton dépôt GitHub.
2. Sur [Vercel](https://vercel.com), importe le dépôt.
3. Framework preset : **Other**. Répertoire racine : `/`.
4. Build command : laisser vide (ou `npm install`). **Output directory : `public`** (déjà configuré dans `vercel.json`, champ `outputDirectory`).
5. Dans **Settings → Environment Variables**, ajoute :
   - `GROQ_API_KEY` = ta clé Groq
   - (optionnel) `GROQ_MODEL`, `GROQ_FALLBACK_MODELS`, `GROQ_TEMPERATURE`, `GROQ_MAX_TOKENS`
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
4. Dans **Environment** (Render), ajoute la variable :
   - `GROQ_API_KEY` = ta clé Groq
5. Déclenche le déploiement.

Le serveur expose aussi `GET /api/health` pour vérifier que le service tourne.

---

## Sécurité

- La clé API Groq n'est **jamais** incluse dans `public/`, ni dans les appels réseau du navigateur.
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
