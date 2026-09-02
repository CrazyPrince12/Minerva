// script.js
// Logique de l'interface Minerva — 100% client, aucun secret ici.

const STORAGE_KEY = "minerva.history.v1";
const THEME_KEY = "minerva.theme";
const MODEL_KEY = "minerva.model.v1";

// Nombre de messages conservés dans localStorage (affichage au rechargement).
const STORED_MESSAGES = 40;
// Fenêtre de contexte envoyée au serveur (plus petite = moins de tokens = moins de 429).
const CONTEXT_WINDOW = 8;
// Tentatives côté client quand Groq renvoie 429/5xx.
const MAX_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 55_000;

const elements = {
  messages: document.getElementById("messages"),
  emptyState: document.getElementById("empty-state"),
  greeting: document.getElementById("greeting"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("user-input"),
  sendBtn: document.getElementById("send-btn"),
  clearBtn: document.getElementById("clear-chat"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIcon: document.getElementById("theme-icon"),
  errorToast: document.getElementById("error-toast"),
  thinking: document.getElementById("thinking"),
  thinkingText: document.getElementById("thinking-text"),
  modelSelect: document.getElementById("model-select"),
};

let history = loadHistory();
let isThinking = false;
let toastTimer = null;

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({
        role: m.role,
        content: m.content,
        ts: Number.isFinite(m.ts) ? m.ts : Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-STORED_MESSAGES)));
  } catch {
    // localStorage indisponible (privé / quota) : on continue en mémoire.
  }
}

function createId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function initModelSelect() {
  if (!elements.modelSelect) return;
  try {
    const savedModel = localStorage.getItem(MODEL_KEY);
    if (savedModel && [...elements.modelSelect.options].some((option) => option.value === savedModel)) {
      elements.modelSelect.value = savedModel;
    }
  } catch {
    /* localStorage indisponible : on garde le modèle par défaut. */
  }

  elements.modelSelect.addEventListener("change", () => {
    try {
      localStorage.setItem(MODEL_KEY, elements.modelSelect.value);
    } catch {
      /* ignore */
    }
  });
}

function getSelectedModel() {
  return elements.modelSelect?.value || "openai/gpt-oss-20b";
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function updateThemeIcons() {
  const dark = document.documentElement.dataset.theme === "dark";
  // Une seule icône "cercle demi-ouvert" : elle fonctionne pour les deux
  // thèmes et reste cohérente avec Font Awesome (pas d'emoji). Le garde-fou
  // évite qu'un ancien index.html encore en cache bloque l'initialisation du
  // formulaire de chat.
  if (elements.themeIcon) {
    elements.themeIcon.classList.toggle("fa-moon", !dark);
    elements.themeIcon.classList.toggle("fa-sun", dark);
    elements.themeIcon.classList.remove("fa-circle-half-stroke");
  }
  elements.themeToggle?.setAttribute("aria-label", dark ? "Passer au thème clair" : "Passer au thème sombre");
  elements.themeToggle?.setAttribute("title", dark ? "Passer au thème clair" : "Passer au thème sombre");
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* ignore */
  }
  updateThemeIcons();
}

elements.themeToggle?.addEventListener("click", toggleTheme);
updateThemeIcons();
initModelSelect();

/* ------------------------------------------------------------------ */
/* Message d'accueil contextuel selon l'heure locale (sans emoji)       */
/* ------------------------------------------------------------------ */

const GREETINGS = [
  { start: 5, end: 12, options: ["Bonjour, bien réveillé ?", "Bonjour, prêt à attaquer la journée ?", "Salut ! Tu démarres du bon pied ?"] },
  { start: 12, end: 14, options: ["Bon après-midi, cher ami", "Bonjour, on est déjà à midi ? Le temps file !"] },
  { start: 14, end: 18, options: ["L'après-midi avance bien ?", "Salut, belle après-midi ! Une question ?"] },
  { start: 18, end: 22, options: ["Bonsoir, comment se passe ta soirée ?", "Bonsoir ! On termine la journée en beauté ?"] },
  { start: 22, end: 24, options: ["Salut couche-tard, on veille ensemble ?", "Salut la nuit ! Qu'est-ce qu'on explore ?"] },
  { start: 0, end: 5, options: ["Salut couche-tard, on veille ensemble ?", "Encore debout ? Qu'est-ce qu'on fait ?"] },
];

function getGreeting() {
  const hour = new Date().getHours();
  const bucket = GREETINGS.find((g) => hour >= g.start && hour < g.end) || GREETINGS[0];
  const rotated = (hour + bucket.start) % bucket.options.length;
  return bucket.options[rotated];
}

function renderGreeting() {
  elements.greeting.textContent = getGreeting();
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

function formatTime(value) {
  const date = value instanceof Date ? value : new Date(Number(value) || Date.now());
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function icon(className) {
  const el = document.createElement("i");
  el.className = className;
  el.setAttribute("aria-hidden", "true");
  return el;
}

function showToast(message, action) {
  clearTimeout(toastTimer);
  elements.errorToast.innerHTML = "";

  const body = document.createElement("div");
  body.className = "toast-body";

  const title = document.createElement("strong");
  title.textContent = message;
  body.append(title);

  if (action) {
    const span = document.createElement("span");
    span.className = "toast-action";
    span.textContent = action;
    body.append(span);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Fermer le message");
  close.append(icon("fa-solid fa-xmark"));
  close.addEventListener("click", hideToast);

  elements.errorToast.append(icon("fa-solid fa-triangle-exclamation"), body, close);
  elements.errorToast.hidden = false;

  toastTimer = setTimeout(hideToast, 8000);
}

function hideToast() {
  clearTimeout(toastTimer);
  elements.errorToast.hidden = true;
}

function scrollToBottom(force = false) {
  const chat = elements.messages.parentElement;
  if (!chat) return;
  const nearBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 160;
  if (force || nearBottom) {
    requestAnimationFrame(() => {
      if (typeof chat.scrollTo === "function") {
        chat.scrollTo({ top: chat.scrollHeight, behavior: "smooth" });
      } else {
        chat.scrollTop = chat.scrollHeight;
      }
    });
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/* ------------------------------------------------------------------ */
/* Markdown simple (gras, italique, liens, listes, code, tableaux)      */
/* ------------------------------------------------------------------ */

const LANGUAGE_KEYWORDS = {
  js: /(const|let|var|function|return|if|else|for|while|import|export|from|class|new|try|catch|async|await|throw|typeof|extends|default|switch|case|break|continue|null|undefined|true|false|=>)\b/g,
  ts: /(const|let|var|function|return|if|else|for|while|import|export|from|class|new|try|catch|async|await|throw|typeof|extends|default|switch|case|break|interface|type|enum|implements|public|private|readonly|=>)\b/g,
  python: /(def|return|if|elif|else|for|while|import|from|class|try|except|finally|with|as|lambda|None|True|False|and|or|not|in|is|raise|pass)\b/g,
  css: /(@media|@import|@keyframes|color|background|border|margin|padding|display|flex|grid|font|width|height|position|top|left|right|bottom|transition|animation|transform|opacity|z-index|overflow|align-items|justify-content|gap)\b/g,
};

function escapeCode(code) {
  return escapeHtml(code).replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
}

function highlightCode(code, lang = "") {
  const normalized = String(lang).toLowerCase();
  const safe = escapeCode(code);
  const tokens = LANGUAGE_KEYWORDS[normalized] ? LANGUAGE_KEYWORDS[normalized].source.replace(/\\\\b/g, "\\b") : null;

  let highlighted = safe;
  if (tokens) {
    try {
      highlighted = safe.replace(new RegExp(tokens, "g"), '<span class="tok-keyword">$1</span>');
    } catch {
      highlighted = safe;
    }
  }

  // Heuristique simple strings / comments selon le langage.
  if (normalized === "js" || normalized === "ts" || normalized === "python") {
    highlighted = highlighted
      .replace(/(\/\/[^\n<]*|#[^\n<]*)/g, '<span class="tok-comment">$1</span>')
      .replace(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g, '<span class="tok-string">$1</span>');
  } else if (normalized === "css" || normalized === "html") {
    highlighted = highlighted
      .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>')
      .replace(/(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)\b)/g, '<span class="tok-number">$1</span>');
  }

  return highlighted;
}

function renderCodeBlock(code, lang = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";

  const header = document.createElement("div");
  header.className = "code-header";

  const langSpan = document.createElement("span");
  langSpan.className = "code-lang";
  langSpan.textContent = lang || "code";

  const copy = document.createElement("button");
  copy.className = "copy-code";
  copy.type = "button";
  copy.dataset.copyCode = "";
  copy.setAttribute("aria-label", "Copier le code");
  copy.append(icon("fa-regular fa-copy"), document.createTextNode("Copier"));

  header.append(langSpan, copy);

  const codeEl = document.createElement("code");
  codeEl.innerHTML = highlightCode(code, lang);

  wrapper.append(header, codeEl);
  return wrapper;
}

function renderTable(rows) {
  const table = document.createElement("table");
  table.style.cssText = "border-collapse:collapse;width:100%;font-size:0.92rem;";
  const head = rows[0] || [];
  const thead = document.createElement("thead");
  const trHead = document.createElement("tr");
  head.forEach((cell) => {
    const th = document.createElement("th");
    th.textContent = cell.trim();
    th.style.cssText = "border:1px solid var(--border);padding:7px 10px;text-align:left;background:var(--surface-2);";
    trHead.append(th);
  });
  thead.append(trHead);
  table.append(thead);

  const tbody = document.createElement("tbody");
  rows.slice(1).forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((cell) => {
      const td = document.createElement("td");
      td.textContent = cell.trim();
      td.style.cssText = "border:1px solid var(--border);padding:7px 10px;";
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  return table;
}

function parseNodes(markdown, container) {
  // Lignes de tableau
  const tableRegex = /^\|.+\|\s*$/gm;
  const tableMatches = [];
  let tableCounter = 0;
  const tableStripped = markdown.replace(tableRegex, (match) => {
    tableMatches.push(match);
    return `\u0000TABLE${tableCounter++}\u0000`;
  });

  const blockRegex = /```([^\n]*)\n([\s\S]*?)```/g;
  const codeBlocks = [];
  const codeStripped = tableStripped.replace(blockRegex, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ code: code.replace(/\n$/, ""), lang: lang.trim() });
    return `\u0000CODE${idx}\u0000`;
  });

  const parts = codeStripped.split(/\n\n+/);

  for (const raw of parts) {
    if (!raw.trim()) continue;

    const tableTag = raw.match(/^\u0000TABLE\d+\u0000$/);
    if (tableTag) {
      const tokenIndex = Number(tableTag[0].replace(/\D/g, ""));
      let rows = [];
      if (tableMatches[tokenIndex]) {
        rows = tableMatches[tokenIndex]
          .split("\n")
          .filter((line) => line.trim().startsWith("|"))
          .map((line) => line.trim().slice(1, -1).split("|"))
          .filter((cells) => !cells.every((c) => /^\s*[-: ]+\s*$/.test(c)));
      }
      if (rows.length) container.append(renderTable(rows));
      continue;
    }

    const codeTag = raw.match(/^\u0000CODE(\d+)\u0000$/);
    if (codeTag) {
      const item = codeBlocks[Number(codeTag[1])];
      if (item) container.append(renderCodeBlock(item.code, item.lang));
      continue;
    }

    const lines = raw.split("\n");

    if (lines.every((line) => /^>\s?/.test(line) || !line.trim())) {
      const quote = document.createElement("blockquote");
      quote.innerHTML = inlineMarkdown(lines.map((l) => l.replace(/^>\s?/, "")).join(" "));
      container.append(quote);
      continue;
    }

    if (lines.every((line) => /^#{1,4}\s/.test(line) || !line.trim())) {
      for (const line of lines) {
        if (!line.trim()) continue;
        const level = (line.match(/^#+/) || [""])[0].length;
        const tag = ["h1", "h2", "h3", "h4"][Math.min(level, 4) - 1];
        const h = document.createElement(tag);
        h.innerHTML = inlineMarkdown(line.replace(/^#+\s?/, ""));
        container.append(h);
      }
      continue;
    }

    if (lines.every((line) => /^\s*[-*+]\s+/.test(line) || !line.trim())) {
      const ul = document.createElement("ul");
      lines.filter((line) => /^\s*[-*+]\s+/.test(line)).forEach((line) => {
        const li = document.createElement("li");
        li.innerHTML = inlineMarkdown(line.replace(/^\s*[-*+]\s+/, ""));
        ul.append(li);
      });
      container.append(ul);
      continue;
    }

    if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line) || !line.trim())) {
      const ol = document.createElement("ol");
      lines.filter((line) => /^\s*\d+[.)]\s+/.test(line)).forEach((line) => {
        const li = document.createElement("li");
        li.innerHTML = inlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ""));
        ol.append(li);
      });
      container.append(ol);
      continue;
    }

    const p = document.createElement("p");
    p.innerHTML = inlineMarkdown(lines.join("\n"));
    container.append(p);
  }
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);

  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  html = html.replace(linkRegex, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const boldRegex = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  html = html.replace(boldRegex, "<strong>$1$2</strong>");

  const italicRegex = /(?<!\*)\*([^*\n]+)\*(?!\*)|(?<![_])_([^_\n]+)_(?![_])/g;
  html = html.replace(italicRegex, "<em>$1$2</em>");

  // Code inline après le gras/italique, pour éviter de casser les balises.
  const codeRegex = /`([^`\n]+)`/g;
  html = html.replace(codeRegex, '<code class="inline-code">$1</code>');

  return html;
}

function renderMarkdown(container, text) {
  container.innerHTML = "";
  parseNodes(text, container);
}

/* ------------------------------------------------------------------ */
/* Rendu des messages (ordre chronologique : toujours append)           */
/* ------------------------------------------------------------------ */

function buildMessage(role, content, options = {}) {
  const isBot = role === "assistant";
  const msg = document.createElement("div");
  msg.className = `msg msg-${isBot ? "bot" : "user"}`;
  msg.dataset.messageId = options.id || createId();

  const contentWrap = document.createElement("div");
  contentWrap.className = "msg-content";

  // La ligne d'identité (nom + heure) n'apparaît que pour le bot. Pour
  // l'utilisateur, l'avatar suffit — pas de bulle "Moi"/"Vous" parasite.
  if (isBot) {
    const meta = document.createElement("div");
    meta.className = "msg-meta";

    const roleSpan = document.createElement("span");
    roleSpan.className = "msg-role";
    roleSpan.textContent = "Minerva";

    const time = document.createElement("span");
    time.className = "msg-time";
    time.textContent = formatTime(options.ts);

    meta.append(roleSpan, time);
    contentWrap.append(meta);
  }

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (!isBot) {
    bubble.textContent = content;
  } else {
    renderMarkdown(bubble, content);
  }

  contentWrap.append(bubble);

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  const copyMsg = document.createElement("button");
  copyMsg.className = "copy-msg";
  copyMsg.type = "button";
  copyMsg.dataset.copyMessage = "";
  copyMsg.setAttribute("aria-label", "Copier le message");
  copyMsg.append(icon("fa-regular fa-copy"), document.createTextNode("Copier"));
  actions.append(copyMsg);

  contentWrap.append(actions);

  // Avatar : logo pour le bot, icône Font Awesome "utilisateur" pour l'humain.
  // Même taille, même cercle, même halo : cohérence visuelle.
  if (isBot) {
    const avatar = document.createElement("img");
    avatar.className = "msg-avatar";
    avatar.src = "/assets/logo.svg";
    avatar.alt = "";
    avatar.width = 34;
    avatar.height = 34;
    msg.append(avatar);
  } else {
    const avatar = document.createElement("span");
    avatar.className = "msg-avatar msg-avatar-user";
    avatar.setAttribute("aria-hidden", "true");
    const userIcon = document.createElement("i");
    userIcon.className = "fa-solid fa-user";
    avatar.append(userIcon);
    msg.append(avatar);
  }

  msg.append(contentWrap);
  return msg;
}

function appendMessage(role, content, options = {}) {
  // Le DOM est la source de vérité de l'ordre : on ajoute toujours à la fin.
  // Aucun prepend : le premier enfant reste le message le plus ancien.
  const msg = buildMessage(role, content, options);
  elements.messages.append(msg);
  scrollToBottom(true);
  syncEmptyState();
  return msg;
}

function appendTyping() {
  removeTyping();

  const msg = document.createElement("div");
  msg.className = "msg msg-bot msg-typing";
  msg.id = "typing-message";

  const avatar = document.createElement("img");
  avatar.className = "msg-avatar";
  avatar.src = "/assets/logo.svg";
  avatar.alt = "";
  avatar.width = 34;
  avatar.height = 34;

  const contentWrap = document.createElement("div");
  contentWrap.className = "msg-content";

  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const roleSpan = document.createElement("span");
  roleSpan.className = "msg-role";
  roleSpan.textContent = "Minerva";
  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime();
  meta.append(roleSpan, time);

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";
  bubble.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.id = "typing-label";
  label.textContent = "Minerva réfléchit";

  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));

  bubble.append(label, dots);
  contentWrap.append(meta, bubble);
  msg.append(avatar, contentWrap);

  elements.messages.append(msg);
  scrollToBottom(true);
  return msg;
}

function setTypingLabel(text) {
  const label = document.getElementById("typing-label");
  if (label) label.textContent = text;
}

function removeTyping() {
  document.getElementById("typing-message")?.remove();
}

function syncEmptyState() {
  const hasMessages = elements.messages.children.length > 0;
  elements.emptyState.hidden = hasMessages;
  elements.greeting.hidden = hasMessages;
}

/* ------------------------------------------------------------------ */
/* Copie                                                               */
/* ------------------------------------------------------------------ */

async function copyText(text, button) {
  const label = button.lastChild;
  const original = label && label.nodeType === Node.TEXT_NODE ? label.textContent : "Copier";
  let ok = false;

  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    // Fallback pour anciens navigateurs / contexte non sécurisé.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
  }

  if (label && label.nodeType === Node.TEXT_NODE) {
    label.textContent = ok ? "Copié !" : "Erreur";
  }
  setTimeout(() => {
    if (label && label.nodeType === Node.TEXT_NODE) label.textContent = original;
  }, 1800);
}

document.addEventListener("click", (event) => {
  const copyCodeBtn = event.target.closest("[data-copy-code]");
  if (copyCodeBtn) {
    const code = copyCodeBtn.closest(".code-block")?.querySelector("code")?.textContent || "";
    copyText(code, copyCodeBtn);
    return;
  }

  const copyMsgBtn = event.target.closest("[data-copy-message]");
  if (copyMsgBtn) {
    const bubble = copyMsgBtn.closest(".msg")?.querySelector(".msg-bubble");
    copyText(bubble?.textContent || "", copyMsgBtn);
  }
});

/* ------------------------------------------------------------------ */
/* Composition / envoi                                                  */
/* ------------------------------------------------------------------ */

function setThinking(state) {
  isThinking = state;
  elements.sendBtn.disabled = state;
  elements.sendBtn.setAttribute("aria-busy", state ? "true" : "false");
  elements.thinking.classList.toggle("sr-only", !state);
  if (state) elements.thinkingText.textContent = "Minerva réfléchit…";
}

function autoResize() {
  const el = elements.input;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}

elements.input.addEventListener("input", autoResize);

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

async function requestReply(payload, signal) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.ok && data?.reply) return data;

  const error = new Error(data?.error?.message || "Réponse inattendue du serveur.");
  error.status = response.status;
  error.code = data?.error?.code || "server_error";
  error.action = data?.error?.action || "";
  const retryAfter = Number(response.headers.get("Retry-After") || data?.retryAfter || 0);
  error.retryAfter = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 0;
  throw error;
}

async function sendMessage(input) {
  if (!input || isThinking) return;

  const now = Date.now();
  const userMessage = { role: "user", content: input, ts: now };
  history.push(userMessage);
  saveHistory();

  appendMessage("user", input, { ts: now });
  syncEmptyState();

  setThinking(true);
  hideToast();
  appendTyping();
  scrollToBottom(true);

  // Contexte = messages précédents uniquement (le serveur ajoute le message courant).
  const context = history.slice(0, -1).slice(-CONTEXT_WINDOW).map(({ role, content }) => ({ role, content }));
  const payload = { input, messages: context, model: getSelectedModel() };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let reply = null;
  let lastError = null;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const data = await requestReply(payload, controller.signal);
        reply = data.reply;
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const retriable = attempt < MAX_ATTEMPTS && (error.status === 429 || error.status >= 500);
        if (!retriable) break;

        const waitMs = Math.min(Math.max(error.retryAfter * 1000, 1200 * attempt), 8000);
        setTypingLabel(`Groq est saturé, nouvel essai dans ${Math.ceil(waitMs / 1000)} s`);
        await sleep(waitMs, controller.signal);
        setTypingLabel("Minerva réfléchit");
      }
    }

    if (reply) {
      const ts = Date.now();
      history.push({ role: "assistant", content: reply, ts });
      saveHistory();

      removeTyping();
      appendMessage("assistant", reply, { ts });
      hideToast();
      return;
    }

    // Échec : on remet le texte dans le champ pour ne pas le perdre.
    throw lastError || new Error("Une erreur est survenue.");
  } catch (error) {
    removeTyping();
    hideToast();

    if (error.name === "AbortError") {
      showToast("Minerva a mis trop de temps à répondre.", "Réessaie dans quelques secondes.");
    } else if (error instanceof TypeError) {
      showToast("Impossible de joindre le serveur.", "Vérifie ta connexion puis réessaie.");
    } else if (error.status === 429) {
      showToast(
        error.message || "Limite atteinte : Groq reçoit trop de requêtes.",
        error.action || "Patiente quelques secondes, la réponse arrive automatiquement au prochain essai."
      );
    } else {
      showToast(error.message || "Une erreur est survenue.", error.action || "Réessaie dans quelques secondes.");
    }

    if (!elements.input.value.trim()) elements.input.value = input;
  } finally {
    clearTimeout(timeout);
    setThinking(false);
    autoResize();
    elements.input.focus();
    scrollToBottom();
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = elements.input.value.trim();
  if (!value) return;
  elements.input.value = "";
  autoResize();
  sendMessage(value);
});

function clearConversation() {
  history = [];
  saveHistory();
  elements.messages.replaceChildren();
  renderGreeting();
  syncEmptyState();
  hideToast();
  elements.input.value = "";
  autoResize();
  elements.input.focus();
}

elements.clearBtn.addEventListener("click", clearConversation);

/* ------------------------------------------------------------------ */
/* Initialisation                                                       */
/* ------------------------------------------------------------------ */

function restoreHistory() {
  // Ordre d'insertion = ordre chronologique (le plus ancien en haut).
  for (const m of history) {
    elements.messages.append(buildMessage(m.role, m.content, { ts: m.ts }));
  }
}

function init() {
  renderGreeting();
  restoreHistory();
  syncEmptyState();
  autoResize();
  // Au chargement, on force le scroll tout en bas pour que les messages les
  // plus récents soient visibles (ordre chronologique : ancien en haut,
  // récent en bas). Double rAF pour laisser la mise en page se stabiliser.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const chat = elements.messages.parentElement;
      if (chat) chat.scrollTop = chat.scrollHeight;
    });
  });
}

init();
