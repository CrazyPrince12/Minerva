# Audit Minerva — pannes corrigées et améliorations proposées

Revue complète du code (frontend, backend, prompt, déploiement) effectuée le 2026-09-02.

---

## 1. Pannes corrigées dans cette branche

### 1.1 Ordre des messages inversé (messages les plus récents en haut)

**Cause exacte** — `script.js` :

```js
if (options.append) elements.messages.append(msg);
else elements.messages.prepend(msg);
```

Aucun appel ne passait `append: true` → **tous** les messages (utilisateur, assistant, restauration de l'historique) étaient insérés avec `prepend`, donc empilés à l'envers.

**Correctif** — insertion toujours en fin de conteneur (`append`), le DOM reflète l'ordre chronologique : le premier enfant est le message le plus ancien. La restauration de l'historique parcourt le tableau dans l'ordre.

### 1.2 Bulle utilisateur à gauche et mal alignée

**Cause** — le layout était en `display: grid` :

```css
.msg { grid-template-columns: 34px minmax(0, 1fr); }
.msg-user { grid-template-columns: minmax(0, 1fr) 34px; }
.msg-user .msg-avatar { grid-column: 2; grid-row: 1; display: none; }
```

L'avatar utilisateur était masqué (`display: none`) mais le gabarit lui réservait la colonne 2, et le contenu (auto-placé) retombait dans la colonne 1, **à gauche**. Sur mobile, la colonne vide restait réservée.

**Correctif** — passage en Flexbox, alignement de messagerie classique :

- `.msg-bot { justify-content: flex-start }` → Minerva à gauche, avatar logo + bulle.
- `.msg-user { justify-content: flex-end }` → vous à droite.
- Une seule classe `.msg-bubble` pour les deux : **même forme, même padding, même rayon** ; seule la couleur et la petite pointe (bas-gauche / bas-droite) diffèrent.

### 1.3 Bulle « Moi »

Supprimée (elle était créée en JS avec des styles inline). L'utilisateur n'a plus d'avatar : bulle violette alignée à droite, comme dans une messagerie standard.

### 1.4 « Limite atteinte : Groq reçoit trop de requêtes » au 2e message

Quatre causes cumulées :

1. `maxRetries: 0` sur le client OpenAI + aucun retry nulle part → le premier 429 était renvoyé tel quel à l'écran.
2. `vercel.json` : `maxDuration: 10` s, alors que le serveur attend Groq jusqu'à 60 s → la fonction était tuée avant la réponse ; le client attendait encore 65 s et la requête suivante se cumulait avec la précédente.
3. Le dernier message utilisateur était envoyé **deux fois** (voir 1.5), donc ~2× plus de tokens pour rien.

**Correctifs** (le modèle et `max_tokens` restent ceux d'origine : `openai/gpt-oss-20b`, 4096)

- Côté serveur : 2 tentatives sur le modèle principal avec backoff (respect de l'en-tête `Retry-After` de Groq), puis **bascule sur un modèle de secours uniquement en cas d'échec** (`llama-3.1-8b-instant`, désactivable avec `GROQ_FALLBACK_MODELS=none`). Budget global borné (`GROQ_DEADLINE_MS`, défaut 26 s).
- `vercel.json` : `maxDuration` 10 s → 30 s ; timeout client aligné à 55 s.
- Fenêtre de mémoire ramenée de 10 à 8 messages envoyés (40 conservés dans `localStorage`) : moins de tokens par requête, donc moins de 429. Remettre `MEMORY_WINDOW = 10` dans `api/chat.js` si tu préfères l'ancien comportement.
- Côté client : jusqu'à 3 tentatives sur 429/5xx, avec affichage « Groq est saturé, nouvel essai dans X s » dans la bulle de réflexion au lieu d'un message d'erreur immédiat.
- Le serveur renvoie l'en-tête `Retry-After` pour que le client patiente le temps exact demandé par Groq.

### 1.5 Message utilisateur envoyé en double

Le client poussait le message dans `history` **puis** envoyait `history.slice(-10)` (qui le contient), et le serveur ajoutait `{ role: "user", content: input }` → le dernier message apparaissait deux fois dans le payload.

**Correctif** — le client n'envoie que le contexte précédent (`history.slice(0, -1)`) ; le serveur dédoublonne défensivement (boucle de suppression des messages de fin identiques à `input`).

### 1.6 Emojis dans l'interface

Présents dans les salutations (`☕ ☀️ ✨ 😊 🌙 🌌`) et dans les toasts (`⚠️`). Remplacés par **Font Awesome 6.5.2** : `fa-moon` / `fa-sun` pour le thème, `fa-trash-can`, `fa-paper-plane`, `fa-copy`, `fa-triangle-exclamation`, `fa-xmark`, `fa-circle-notch fa-spin`.

### 1.7 Autres correctifs

| # | Problème | Correctif |
| - | -------- | --------- |
| 7.1 | Horodatages faux après rechargement (`restoreHistory` re-stampait tout à l'heure courante) | `ts` persisté dans `localStorage` et réutilisé |
| 7.2 | Historique silencieusement tronqué (10 messages sauvés, tableau en mémoire illimité) | 40 messages conservés, 8 envoyés au modèle |
| 7.3 | Message tapé perdu quand la requête échouait (`input.value = ""` dans `finally`) | le texte est remis dans le champ si l'envoi échoue |
| 7.4 | Retours à la ligne écrasés dans les bulles utilisateur (`textContent` + `white-space: normal`) | `white-space: pre-wrap` sur la bulle utilisateur |
| 7.5 | `copyText` écrasait l'icône du bouton (`textContent = "Copié !"`) | seul le nœud de texte est modifié |
| 7.6 | `setInterval` de 30 s qui re-générait aléatoirement le message d'accueil, variable `hideGreetingUntil` morte | supprimés |
| 7.7 | `clearConversation` : `elements.messages.append()` sans argument (no-op) | `replaceChildren()` |
| 7.8 | Toast : emoji, pas de fermeture manuelle, timers empilés | icône FA + titre + action + bouton fermer, timer unique |
| 7.9 | `server.js` : liste blanche de fichiers à maintenir à la main, aucun garde-fou de chemin | sert tout `public/` avec vérification anti *path traversal* |
| 7.10 | **Sécurité** : `.env` avec une vraie clé `gsk_…` est commité dans l'historique git | fichier retiré du suivi ; **la clé reste dans l'historique → à révoquer d'urgence** sur <https://console.groq.com/keys> |
| 7.11 | `vercel.json` : `maxDuration` 10 s incompatible avec un appel Groq | 30 s |

### 1.8 Réorganisation des dossiers

```
public/   index.html  style.css  script.js  assets/     → ce que voit le navigateur
src/      prompt.js   skills.js                         → modules serveur (jamais exposés)
```

`vercel.json` déclare `"outputDirectory": "public"` (indispensable : sans ça, Vercel servirait `public/index.html` sur `/public`). `server.js` sert `public/` sur Render et en local.

---

## 2. Améliorations proposées (non implémentées)

### Priorité haute

1. **`/api/chat` est un proxy ouvert.** `Access-Control-Allow-Origin: *` + aucune authentification : n'importe qui peut POSTer dessus et brûler ton quota Groq (ou te faire bannir). À faire : restreindre l'origine à ton domaine, et ajouter un plafond par IP (Upstash Redis `@upstash/ratelimit`, ou un *token bucket* en mémoire pour Render — suffisant pour un petit projet).
2. **Révoquer la clé Groq exposée**, puis nettoyer l'historique si tu veux être tranquille :
   `git filter-repo --path .env --invert-paths` (réécrit l'historique, à faire avant tout partage du dépôt).
3. **Streaming (SSE / `ReadableStream`).** C'est le plus gros gain perçu : la réponse s'affiche au fur et à mesure au lieu d'attendre 5-15 s. Groq supporte `stream: true`. Le client lit le flux avec `response.body.getReader()` et remplit la bulle progressivement. Réduit aussi les timeouts perçus.

### Priorité moyenne

4. **Conversations multiples** : clé `minerva.conversations.v1` (tableau d'objets `{ id, title, messages }`), liste dans un tiroir, renommage, suppression. Aujourd'hui une seule conversation, écrasée par le bouton corbeille.
5. **Bouton « Arrêter »** pendant la génération : l'`AbortController` existe déjà dans `sendMessage`, il ne manque que l'UI.
6. **Garde-fou de taille sur `localStorage`** : 40 messages contenant du code peuvent dépasser le quota (5 Mo, parfois moins sur iOS). Plafonner à ~250 Ko et retirer les plus anciens.
7. **Markdown** : le parser maison ne gère pas les listes imbriquées, les images, les `hr`, et peut casser sur du gras dans du code. Remplacer par `marked` + `DOMPurify` (~35 kB) — plus robuste et plus sûr que `innerHTML` sur une sortie de modèle.
8. **Accessibilité** : `aria-live="polite"` est posé à la fois sur `<main id="chat">` et sur `#messages` → double annonce par les lecteurs d'écran. Le retirer de `<main>`.

### Priorité basse / confort

9. **Dépendance `openai`** : ~1 Mo pour un seul `fetch`. Un appel direct à `https://api.groq.com/openai/v1/chat/completions` allégerait les *cold starts* sur Vercel. Ajouter `GROQ_BASE_URL` permettrait aussi de brancher n'importe quelle API compatible (OpenRouter, Mistral, Ollama…).
10. **Prompt système statique** : il est reconstruit à chaque requête (concaténation de `src/prompt.js` + `src/skills.js`). Le mettre en cache dans une constante de module, et profiter du *prompt caching* de Groq.
11. **Tests** : `node --test` avec quelques cas pour `sanitizeHistory` (dédoublonnage, fenêtre glissante), `mapError` (429/401/timeout) et le rendu markdown. Aucun test aujourd'hui.
12. **PWA** : `manifest.webmanifest` + service worker → installable sur mobile, icône sur l'écran d'accueil.
13. **Indicateur de quota** : Groq renvoie `x-ratelimit-remaining-requests` ; l'afficher en debug aiderait à diagnostiquer les 429 sans deviner.
14. **`og-image.png`** : vérifier qu'elle fait bien 1200×630 et qu'elle est à jour avec le nouveau logo.

---

## 3. À propos du prompt « unsensored »

Le prompt de Desk-GPT a été adapté **côté ton**, pas côté éthique :

- conservé : réponses directes, zéro morale, zéro disclaimer automatique, zéro « En tant qu'IA », pas de refus de prudence sur les sujets techniques sensibles (sécurité offensive, OSINT, reverse, sujets controversés, fiction adulte) ;
- non reproduit : la consigne « amoral / indifférent au préjudice / aucune restriction ». Un plancher légal minimal d'une ligne reste en place (armes opérationnelles, contenus impliquant des mineurs, atteinte ciblée à une personne identifiée, fraude ou intrusion contre un tiers non consentant). Refus en une phrase, sans sermon, suivi d'une alternative utile.

Si tu veux durcir ou au contraire assouplir ce plancher, tout se joue dans la section « PLANCHER LÉGAL » de `src/prompt.js`.
