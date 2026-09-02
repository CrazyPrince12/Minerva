// script.js
// Logique de l'interface Minerva — 100% client, aucun secret ici.

const STORAGE_KEY = "minerva.history.v1";
const THEME_KEY = "minerva.theme";
const MEMORY_LIMIT = 10;

const elements = {
  messages: document.getElementById("messages"),
  emptyState: document.getElementById("empty-state"),
  greeting: document.getElementById("greeting"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("user-input"),
  sendBtn: document.getElementById("send-btn"),
  clearBtn: document.getElementById("clear-chat"),
  themeToggle: document.getElementById("theme-toggle"),
  themeIconDark: document.getElementById("theme-icon-dark"),
  themeIconLight: document.getElementById("theme-icon-light"),
  errorToast: document.getElementById("error-toast"),
  thinking: document.getElementById("thinking"),
};

let history = loadHistory();
let isThinking = false;
let hideGreetingUntil = 0;

/* ------------------------------------------------------------------ */
/* Storage helpers                                                     */
/* ------------------------------------------------------------------ */

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m) => m && m.role && typeof m.content === "string") : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MEMORY_LIMIT)));
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

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

function updateThemeIcons() {
  const theme = document.documentElement.dataset.theme;
  const dark = theme === "dark";
  elements.themeIconDark.hidden = dark;
  elements.themeIconLight.hidden = !dark;
  elements.themeToggle.setAttribute("aria-label", dark ? "Passer au thème clair" : "Passer au thème sombre");
  elements.themeToggle.setAttribute("title", dark ? "Passer au thème clair" : "Passer au thème sombre");
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

elements.themeToggle.addEventListener("click", toggleTheme);
updateThemeIcons();

/* ------------------------------------------------------------------ */
/* Greeting contextuel selon l'heure locale                             */
/* ------------------------------------------------------------------ */

const GREETINGS = [
  { start: 5, end: 12, options: ["Bonjour, bien réveillé ? ☕", "Bonjour, prêt à attaquer la journée ? ☀️", "Salut ! Tu démarres du bon pied ? ✨"] },
  { start: 12, end: 14, options: ["Bon après-midi, cher ami 😊", "Bonjour, on est déjà à midi ? Le temps file !"] },
  { start: 14, end: 18, options: ["L'après-midi avance bien ?", "Salut, belle après-midi ! Une question ?"] },
  { start: 18, end: 22, options: ["Bonsoir, comment se passe ta soirée ? 🌙", "Bonsoir ! On termine la journée en beauté ?"] },
  { start: 22, end: 24, options: ["Salut couche-tard, on veille ensemble ? 🌌", "Salut la nuit ! Qu'est-ce qu'on explore ?"] },
  { start: 0, end: 5, options: ["Salut couche-tard, on veille ensemble ? 🌌", "Encore debout ? Qu'est-ce qu'on fait ?"] },
];

function getGreeting() {
  const hour = new Date().getHours();
  const bucket = GREETINGS.find((g) => hour >= g.start && hour < g.end) || GREETINGS[0];
  const key = `${bucket.start}-${Math.floor(hour / 4)}`;
  const rotated = (key.length * 7 + hour) % bucket.options.length;
  return bucket.options[rotated];
}

function renderGreeting() {
  elements.greeting.textContent = getGreeting();
}

/* ------------------------------------------------------------------ */
/* UI helpers                                                          */
/* ------------------------------------------------------------------ */

function formatTime(date = new Date()) {
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function showToast(message, action) {
  elements.errorToast.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = "⚠️ ";
  strong.append(document.createTextNode(message));
  elements.errorToast.append(strong);
  if (action) {
    const span = document.createElement("span");
    span.textContent = ` ${action}`;
    elements.errorToast.append(span);
  }
  elements.errorToast.hidden = false;
  setTimeout(() => {
    elements.errorToast.hidden = true;
  }, 8000);
}

function clearError() {
  elements.errorToast.hidden = true;
}

function scrollToBottom(force = false) {
  const chat = elements.messages.parentElement;
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
  const tokens = LANGUAGE_KEYWORDS[normalized] ? LANGUAGE_KEYWORDS[normalized].source.replace(/\\b/g, "\\b") : null;

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
  copy.textContent = "Copier";

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
    row.forEach((cell, i) => {
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

function parseNodes(markdown, container, inline = false) {
  // Lignes de tableau
  const tableRegex = /^\|.+\|\s*$/gm;
  let tableMatches = [];
  let tableCounter = 0;
  let tableStripped = markdown.replace(tableRegex, (match) => {
    const idx = tableCounter++;
    tableMatches.push(match);
    return `\u0000TABLE${idx}\u0000`;
  });

  const blockRegex = /```([^\n]*)\n([\s\S]*?)```/g;
  let codeBlocks = [];
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

  // Blocs => pour le rendre re-parse par inline (lien/images)
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  html = html.replace(linkRegex, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  const boldRegex = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  html = html.replace(boldRegex, "<strong>$1$2</strong>");

  const italicRegex = /(?<!\*)\*([^*\n]+)\*(?!\*)|(?<![_])_([^_\n]+)_(?![_])/g;
  html = html.replace(italicRegex, "<em>$1$2</em>");

  // Code inline après avoir échappé les accents, pour éviter de casser les balises.
  const codeRegex = /`([^`\n]+)`/g;
  html = html.replace(codeRegex, '<code class="inline-code">$1</code>');

  return html;
}

function renderMarkdown(container, text) {
  container.innerHTML = "";
  parseNodes(text, container);
}

/* ------------------------------------------------------------------ */
/* Message rendering                                                    */
/* ------------------------------------------------------------------ */

function appendMessage(role, content, options = {}) {
  const msg = document.createElement("div");
  const roleClass = role === "assistant" ? "bot" : "user";
  msg.className = `msg msg-${roleClass}`;
  msg.dataset.messageId = options.id || createId();

  const avatar = document.createElement("img");
  avatar.className = "msg-avatar";
  avatar.src = "/assets/logo.svg";
  avatar.alt = "";
  if (role === "user") {
    const userAvatar = document.createElement("div");
    userAvatar.className = "msg-avatar msg-avatar-user";
    userAvatar.style.cssText = "background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:0.85rem;font-weight:700;";
    userAvatar.textContent = "Moi";
    msg.append(userAvatar);
  } else {
    msg.append(avatar);
  }

  const contentWrap = document.createElement("div");
  contentWrap.className = "msg-content";

  const meta = document.createElement("div");
  meta.className = "msg-meta";

  const roleSpan = document.createElement("span");
  roleSpan.className = "msg-role";
  roleSpan.textContent = role === "user" ? "Vous" : "Minerva";

  const time = document.createElement("span");
  time.className = "msg-time";
  time.textContent = formatTime(options.date || new Date());

  meta.append(roleSpan, time);

  const bubble = document.createElement("div");
  bubble.className = "msg-bubble";

  if (role === "user") {
    bubble.textContent = content;
  } else {
    renderMarkdown(bubble, content);
  }

  contentWrap.append(meta, bubble);

  const actions = document.createElement("div");
  actions.className = "msg-actions";

  const copyMsg = document.createElement("button");
  copyMsg.className = "copy-msg";
  copyMsg.type = "button";
  copyMsg.dataset.copyMessage = "";
  copyMsg.textContent = "Copier";
  actions.append(copyMsg);

  contentWrap.append(actions);
  msg.append(contentWrap);

  if (options.append) elements.messages.append(msg);
  else elements.messages.prepend(msg);

  scrollToBottom(true);
  syncEmptyState();
  return msg;
}

function appendTyping() {
  const msg = document.createElement("div");
  msg.className = "msg msg-bot msg-typing";
  msg.id = "typing-message";

  const avatar = document.createElement("img");
  avatar.className = "msg-avatar";
  avatar.src = "/assets/logo.svg";
  avatar.alt = "";

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
  bubble.innerHTML = `<span>Minerva réfléchit</span><span class="typing-dots"><span></span><span></span><span></span></span>`;

  contentWrap.append(meta, bubble);
  msg.append(avatar, contentWrap);
  elements.messages.append(msg);
  scrollToBottom(true);
  return msg;
}

function removeTyping() {
  const typing = document.getElementById("typing-message");
  if (typing) typing.remove();
}

function syncEmptyState() {
  const hasMessages = elements.messages.children.length > 0;
  elements.greeting.hidden = hasMessages;
  // On garde le conteneur mais on masque visuellement pour l'accès.
  elements.emptyState.hidden = hasMessages;
}

/* ------------------------------------------------------------------ */
/* Copy helpers                                                        */
/* ------------------------------------------------------------------ */

async function copyText(text, button) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copié !";
  } catch {
    // Fallback pour anciens navigateurs / HTTPS strict.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand("copy");
      button.textContent = "Copié !";
    } catch {
      button.textContent = "Erreur";
    }
    ta.remove();
  }
  setTimeout(() => {
    button.textContent = original || "Copier";
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

async function sendMessage(input) {
  if (!input || isThinking) return;

  const userMessage = { role: "user", content: input };
  history.push(userMessage);
  saveHistory();

  appendMessage("user", input, { date: new Date() });
  hideGreetingUntil = Date.now() + 120000;
  syncEmptyState();

  setThinking(true);
  clearError();
  const typing = appendTyping();

  const payload = {
    input,
    messages: history.slice(-MEMORY_LIMIT),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.reply) {
      const err = data?.error || {};
      throw new Error(err.message || "Réponse inattendue du serveur.");
    }

    const botMessage = { role: "assistant", content: data.reply };
    history.push(botMessage);
    saveHistory();

    removeTyping();
    appendMessage("assistant", data.reply, { date: new Date() });
    clearError();
  } catch (error) {
    removeTyping();
    clearError();

    if (error.name === "AbortError" || controller.signal.aborted) {
      showToast("Minerva a mis trop de temps à répondre.", "Réessaie dans quelques secondes.");
    } else if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
      showToast("Impossible de joindre le serveur.", "Vérifie ta connexion puis réessaie.");
    } else {
      showToast(error.message || "Une erreur est survenue.", "Réessaie dans quelques secondes.");
    }
  } finally {
    clearTimeout(timeout);
    setThinking(false);
    elements.input.value = "";
    autoResize();
    elements.input.focus();
    scrollToBottom();
  }
}

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = elements.input.value.trim();
  if (!value) return;
  sendMessage(value);
});

function clearConversation() {
  history = [];
  saveHistory();
  elements.messages.innerHTML = "";
  elements.messages.append(); // reset
  hideGreetingUntil = Date.now() + 3000;
  renderGreeting();
  syncEmptyState();
  elements.input.focus();
}

elements.clearBtn.addEventListener("click", clearConversation);

/* ------------------------------------------------------------------ */
/* Initialisation                                                       */
/* ------------------------------------------------------------------ */

function restoreHistory() {
  if (!history.length) return;
  for (const m of history) {
    appendMessage(m.role, m.content, { date: new Date() });
  }
}

function init() {
  scrollToBottom(true);
  renderGreeting();
  restoreHistory();
  syncEmptyState();
  autoResize();
}

// Ré-affiche le message d'accueil si on revient du haut d'une conversation vide.
setInterval(() => {
  if (!elements.messages.children.length && Date.now() < hideGreetingUntil) {
    renderGreeting();
  }
}, 30000);

init();
