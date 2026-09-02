# Minerva — Chatbot IA minimaliste

Minerva est un assistant IA **minimaliste** développé par **Crazy Prince Dev**.
L'application s'ouvre directement sur l'interface de chat : pas de landing page, pas de sidebar, pas de menu. Un seul écran, rien d'autre.

Le frontend est léger (HTML5 / CSS3 / JavaScript vanilla) et la clé API Groq est **uniquement lue côté serveur** via une fonction serverless. Minerva est conçue pour être rapide, utile et serviable sur un large spectre de sujets légitimes : développement web, code, tech, recherche, business, etc.

---

## ✨ Fonctionnalités

- Interface 100 % chat, sans landing page.
- Thème **sombre par défaut**, bascule thème clair, préférence sauvegardée dans `localStorage`.
- Message d'accueil contextuel basé sur l'heure locale du navigateur (plusieurs formulations par créneau).
- Bulles de messages avec distinction claire utilisateur / Minerva, timestamps discret.
- Rendu **markdown** : gras, italique, listes, liens, tableaux, blocs de code.
- Blocs de code avec **coloration syntaxique légère** et bouton **Copier**. Bouton *Copier* également sur chaque message.
- Barre de saisie auto-extensible, envoi avec **Entrée**, saut de ligne avec **Maj+Entrée**.
- État **« Minerva réfléchit… »** pendant la requête.
- Mémoire conversationnelle : fenêtre glissante des **10 derniers messages** envoyée au backend.
- Historique **uniquement en `localStorage`**, jamais de base de données serveur.
- Gestion d'erreurs claires dans le chat (rate limit, clé invalide, timeout, réseau).
- Layout **responsive** : fonctionne parfaitement sur **mobile et PC** (CSS Grid + Flexbox).
- Accessibilité : contrastes soignés, `aria-label`, navigation au clavier, focus visibles.

---

## 🧱 Stack technique

| Couche        | Technologie |
| ------------- | ----------- |
| Frontend      | HTML5 sémantique, CSS3 (Grid + Flexbox), JavaScript vanilla |
| Backend       | Une seule fonction serverless `/api/chat.js` |
| Proxy IA      | SDK `openai` (`chat.completions.create`) pointé vers Groq |
| Modèle        | `openai/gpt-oss-20b` (configurable via `GROQ_MODEL`) |
| Hébergement   | Vercel (fonction serverless) et Render (service Node) |
| Secrets       | `process.env.GROQ_API_KEY`, jamais exposé au client |

> Note : le SDK OpenAI compatible Groq prend en charge `chat.completions.create`, qui est l'endpoint stable. `responses.create` est disponible sur Groq, mais ce projet reste volontairement sur `chat.completions` pour une compatibilité maximale.

---

## 📁 Arborescence

```
minerva/
├── index.html          # interface de chat
├── style.css           # styles responsive (Grid + Flexbox)
├── script.js           # logique front (localStorage, markdown, envoi)
├── prompt.js           # identité + instructions système de Minerva
├── skills.js           # connaissances / mémoire injectée au system prompt
├── api/
│   └── chat.js         # fonction serverless (proxy Groq, lit process.env)
├── assets/
│   ├── logo.svg        # logo vectoriel (casque Minerve + regards de chouette)
│   └── og-image.png    # image de prévisualisation pour le partage
├── server.js           # serveur local / Render (sert le front + /api/chat)
├── .env.example        # modèle de variables d'environnement
├── .gitignore          # .env jamais commité, node_modules, etc.
├── vercel.json
└── README.md
```

---

## 🚀 Installation locale

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

> 💡 Obtiens une clé sur <https://console.groq.com/keys>. Elle est **strictement confidentielle** : ne la colle jamais dans le chat ni dans un fichier commité.

5. Lancer le serveur local :

```bash
npm run dev
```

L'application est disponible sur **<http://localhost:3000>**.

---

## ⚙️ Variables d'environnement

| Variable           | Obligatoire | Défaut                  | Description                          |
| ------------------ | ----------- | ----------------------- | ------------------------------------ |
| `GROQ_API_KEY`     | ✅          | —                       | Clé API Groq (jamais côté client).   |
| `GROQ_MODEL`       | ❌          | `openai/gpt-oss-20b`    | Modèle Groq à utiliser.              |
| `GROQ_TEMPERATURE` | ❌          | `0.7`                   | Température de génération.           |
| `GROQ_MAX_TOKENS`  | ❌          | `4096`                  | Nombre max de tokens de sortie.      |
| `PORT`             | ❌          | `3000`                  | Port du serveur (utilisé par Render).|

---

## ☁️ Déploiement Vercel

1. Pousse ce dossier sur ton dépôt GitHub.
2. Sur [Vercel](https://vercel.com), importe le dépôt.
3. Framework preset : **Other**. Répertoire racine : `/`.
4. Build command : laisser vide (ou `npm install`). Output directory : laisser vide.
5. Dans **Settings → Environment Variables**, ajoute :
   - `GROQ_API_KEY` = ta clé Groq
   - (optionnel) `GROQ_MODEL`, `GROQ_TEMPERATURE`, `GROQ_MAX_TOKENS`
6. Déploie. La route `/api/chat` sera automatiquement servie par `api/chat.js` grâce à `vercel.json`.

Après le premier déploiement, remplace l'URL de domaine par défaut dans les balises Open Graph de `index.html` :

```html
<meta property="og:url" content="https://ton-domaine.vercel.app/" />
<meta property="og:image" content="https://ton-domaine.vercel.app/assets/og-image.png" />
```

---

## ☁️ Déploiement Render

Render peut lancer l'application comme un **service web Node** (le frontend est servi par `server.js` et `POST /api/chat` est routé vers la même logique que sur Vercel).

1. Sur [Render](https://render.com), crée un **New → Web Service**.
2. Connecte ton dépôt Git.
3. Configurations :
   - **Environment** : `Node`
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Dans **Environment** (Render), ajoute la variable :
   - `GROQ_API_KEY` = ta clé Groq
5. Déclenche le déploiement.

Render exposera un domaine du type `https://mon-service.onrender.com`. Même principe : mets à jour les balises Open Graph de `index.html` avec la vraie URL.

---

## 🔒 Sécurité

- La clé API Groq n'est **jamais** incluse dans `index.html`, `script.js`, ni dans les appels réseau du navigateur.
- Le backend valide la méthode, la longueur du message et la fenêtre de mémoire.
- Réponses d'erreur simplifiées : les détails sensibles ne sont pas renvoyés au client.
- `.gitignore` exclut `.env` et tous les secrets.

---

## 🖼️ UI / Logo / Preview

- **Logo** : SVG minimaliste (`assets/logo.svg`) inspiré du casque de Minerve fusionné aux yeux d'une chouette.
- **Preview de partage** : `assets/og-image.png` + balises Open Graph et Twitter Card dans `index.html`.

Description de l'UI :

> Un header fin avec le logo et « Minerva » à gauche, et à droite le bouton d'effacement de la conversation puis le toggle de thème. Le centre est occupé uniquement par la conversation. Quand elle est vide, un message d'accueil contextuel apparaît en arrière-plan. Les messages utilisateur sont en violet à droite, ceux de Minerva en surface sombre à gauche, avec timestamps et bouton « Copier ». La barre de saisie est fixée en bas, avec envoi via Entrée ou le bouton flèche, et un minuteur « Minerva réfléchit… » pendant l'appel.

---

## 📸 Captures d'écran

À ajouter après déploiement : `docs/screenshot-mobile.png` et `docs/screenshot-desktop.png`.

---

## 🧠 À propos du prompt

- `prompt.js` contient l'identité de Minerva et le ton souhaité.
- `skills.js` injecte des connaissances ciblées : développement web, code & architecture, sécurité éthique/légitime, recherche approfondie.
- Ce projet **ne contient aucune instruction de type jailbreak**. Minerva reste serviable et évite les refus abusifs sur des demandes légitimes, mais ne fournit pas de contenu conçu pour causer un préjudice ou contourner délibérément des protections.

---

## ✍️ Author

Développé par **Crazy Prince Dev**. Projet open source pour apprendre, s'amuser et discuter avec un assistant rapide.
