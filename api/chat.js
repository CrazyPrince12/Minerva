// api/chat.js
// Proxy serverless compatible Vercel (/api/chat) et Render (via server.js).
// Les clés (GROQ_API_KEY, OPENROUTER_API_KEY) sont lues uniquement côté serveur :
// elles ne sont jamais exposées au client.
//
// Deux fournisseurs cohabitent sans conflit (voir src/models.js) :
//   - Groq       : modèles openai/gpt-oss-*, groq/compound* (SDK OpenAI, baseURL Groq)
//   - OpenRouter : Dolphin Mistral 24B Venice Edition (sans filtre), via fetch
//                  comme dans la doc https://openrouter.ai/docs/quickstart
// Le routage se fait par modèle : un modèle OpenRouter n'utilise jamais la clé
// ni les secours Groq, et inversement.

import "../src/env.js";
import OpenAI from "openai";
import { MINERVA_PROMPT } from "../src/prompt.js";
import { buildSkillsSection } from "../src/skills.js";
import { getModel, isUncensoredModel, resolveRoute, resolveSampling } from "../src/models.js";
import { createOpenRouterCompletion } from "../src/openrouter.js";

const MEMORY_WINDOW = 8;
// Budget global : on garde de la marge sous la limite de la fonction (30 s sur Vercel).
const TOTAL_DEADLINE_MS = Number.parseInt(process.env.GROQ_DEADLINE_MS || process.env.CHAT_DEADLINE_MS || "26000", 10);
const ATTEMPTS_PER_MODEL = 2;

class ApiError extends Error {
  constructor(code, message, action, status = 500) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.action = action;
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Clés & clients par fournisseur                                       */
/* ------------------------------------------------------------------ */

const clientCache = new Map();

function requireApiKey(provider) {
  const apiKey = (process.env[provider.apiKeyEnv] || "").trim();
  if (!apiKey) {
    throw new ApiError(
      "missing_key",
      `La clé API ${provider.label} n'est pas configurée.`,
      provider.keyHint,
      500
    );
  }
  return apiKey;
}

// Le SDK OpenAI sert de transport pour Groq (endpoint compatible OpenAI).
function getOpenAIClient(provider) {
  const cached = clientCache.get(provider.id);
  if (cached) return cached;

  const client = new OpenAI({
    apiKey: requireApiKey(provider),
    baseURL: provider.baseURL,
    timeout: TOTAL_DEADLINE_MS,
    maxRetries: 0, // on gère nous-mêmes les retries (backoff + bascule de modèle)
  });
  clientCache.set(provider.id, client);
  return client;
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                         */
/* ------------------------------------------------------------------ */

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Retry-After");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(extraHeaders)) {
    res.setHeader(key, value);
  }
  res.end(body);
}

async function readBody(req) {
  if (req.body) {
    if (typeof req.body === "string") {
      return JSON.parse(req.body);
    }
    return req.body;
  }

  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1 * 1024 * 1024) {
        req.destroy();
        reject(new ApiError("too_large", "Message trop volumineux.", "Raccourcis le message et réessaie.", 413));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new ApiError("invalid_json", "Requête JSON invalide.", "Renvoie une requête correctement formée.", 400));
      }
    });
    req.on("error", reject);
  });
}

function sanitizeHistory(messages, input) {
  if (!Array.isArray(messages)) return [];

  let parsed = messages
    .map((m) => {
      const role = m && (m.role === "user" || m.role === "assistant") ? m.role : null;
      const content = typeof m?.content === "string" ? m.content.trim() : "";
      if (!role || !content) return null;
      return { role, content };
    })
    .filter(Boolean);

  // Le serveur ajoute toujours le message courant : on retire les doublons
  // (un client ancien peut renvoyer l'historique AVEC le dernier message).
  while (
    parsed.length &&
    parsed[parsed.length - 1].role === "user" &&
    parsed[parsed.length - 1].content.trim() === input
  ) {
    parsed.pop();
  }

  // Fenêtre glissante : on garde les N derniers messages utiles.
  parsed = parsed.slice(-MEMORY_WINDOW);

  // Limite de taille par message et au total (protection contre les abus).
  parsed = parsed.map((m) => ({ ...m, content: m.content.slice(-12_000) }));
  const total = parsed.reduce((acc, m) => acc + m.content.length, 0);
  if (total > 60_000) {
    parsed = parsed.slice(-4);
  }

  return parsed;
}

/* ------------------------------------------------------------------ */
/* Erreurs                                                              */
/* ------------------------------------------------------------------ */

function getRetryAfterSeconds(error) {
  const raw =
    error?.headers?.get?.("retry-after") ||
    error?.headers?.["retry-after"] ||
    error?.response?.headers?.get?.("retry-after") ||
    error?.response?.headers?.["retry-after"];
  const seconds = Number.parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(seconds) && seconds > 0 && seconds < 60 ? seconds : 0;
}

function mapError(error, provider = null) {
  if (error instanceof ApiError) return error;

  const label = provider?.label || "le fournisseur d'IA";
  const keyEnv = provider?.apiKeyEnv || "la clé API";
  const modelEnv = provider?.modelEnv || "le modèle";

  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  const code = String(error?.code || error?.error?.code || "");
  const message = String(error?.message || "");
  const retryAfterSeconds = getRetryAfterSeconds(error);

  // Groq/OpenRouter renvoient parfois 429 sans status explicite sur le SDK.
  if (status === 429 || code === "rate_limit_exceeded" || /rate[_ ]?limit/i.test(message)) {
    const apiError = new ApiError(
      "rate_limit",
      `Limite atteinte : ${label} reçoit trop de requêtes.`,
      "Patiente quelques secondes puis renvoie ton message.",
      429
    );
    apiError.retryAfterSeconds = retryAfterSeconds || 2;
    return apiError;
  }
  if (status === 401) {
    return new ApiError(
      "invalid_key",
      `La clé API ${label} est invalide ou non autorisée.`,
      `Vérifie ${keyEnv} dans les variables d'environnement et redéploie.`,
      401
    );
  }
  if (status === 402) {
    return new ApiError(
      "insufficient_credits",
      `Crédits ${label} insuffisants pour ce modèle.`,
      "Recharge le compte ou choisis un modèle gratuit dans la liste.",
      402
    );
  }
  if (status === 403) {
    return new ApiError(
      "forbidden",
      "L'accès au modèle demandé est bloqué.",
      `Vérifie que ce modèle est disponible sur ton compte ${label}.`,
      403
    );
  }
  if (status === 404 || /model.*(not found|decommissioned|does not exist)/i.test(message)) {
    return new ApiError(
      "model_unavailable",
      "Le modèle demandé n'est pas disponible.",
      `Choisis un autre modèle ou change ${modelEnv} dans les variables d'environnement.`,
      404
    );
  }
  if (status === 400 && /context|max(?:imum)?[_ ]?tokens|too (?:many|long)|length/i.test(message)) {
    return new ApiError(
      "context_too_long",
      "La conversation est trop longue pour le modèle.",
      "Efface la conversation ou envoie un message plus court.",
      400
    );
  }
  if (status === 400) {
    return new ApiError(
      "bad_request",
      `La requête envoyée à ${label} a été refusée.`,
      "Réessaie avec un message plus court ou reformulé.",
      400
    );
  }
  if (error?.code === "ETIMEDOUT" || error?.name === "AbortError" || error?.name === "TimeoutError" || /timeout/i.test(message)) {
    return new ApiError("timeout", "Minerva a mis trop de temps à répondre.", "Réessaie dans quelques secondes.", 504);
  }
  // Échec réseau côté serveur (DNS, TLS, coupure) : fetch lève un TypeError.
  const causeCode = String(error?.cause?.code || "");
  if (/fetch failed|network|socket|ECONNRESET|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(`${message} ${causeCode}`)) {
    return new ApiError(
      "network_error",
      `Impossible de joindre ${label} depuis le serveur.`,
      "Vérifie la connexion réseau du serveur puis réessaie.",
      502
    );
  }
  if (status >= 500) {
    return new ApiError(
      "upstream_error",
      `Le service ${label} est momentanément indisponible.`,
      "Réessaie dans quelques secondes.",
      502
    );
  }
  return new ApiError(
    "server_error",
    `Une erreur interne est survenue lors de l'appel à ${label}.`,
    "Vérifie les logs du serveur puis réessaie.",
    500
  );
}

function isRetryable(apiError) {
  return (
    apiError.status === 429 ||
    apiError.status >= 500 ||
    apiError.status === 404 ||
    (apiError.status === 400 && apiError.code === "bad_request")
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

/* ------------------------------------------------------------------ */
/* Appel modèle (routé par fournisseur)                                 */
/* ------------------------------------------------------------------ */

async function callModel({ provider, model, messages, sampling, signal }) {
  if (provider.id === "openrouter") {
    return createOpenRouterCompletion({
      apiKey: requireApiKey(provider),
      model,
      messages,
      temperature: sampling.temperature,
      maxTokens: sampling.maxTokens,
      // Laissés vides volontairement : en-têtes optionnels de classement
      // OpenRouter, à remplir plus tard si le site a une URL/un nom publics.
      siteUrl: (process.env.OPENROUTER_SITE_URL || "").trim(),
      siteName: (process.env.OPENROUTER_SITE_NAME || "").trim(),
      // Vide par défaut → https://openrouter.ai/api/v1/chat/completions
      baseUrl: (process.env.OPENROUTER_BASE_URL || "").trim(),
      signal,
    });
  }

  // Groq (et tout futur endpoint compatible OpenAI) via le SDK officiel.
  const client = getOpenAIClient(provider);
  return client.chat.completions.create(
    {
      model,
      messages,
      temperature: sampling.temperature,
      max_tokens: sampling.maxTokens,
    },
    { signal }
  );
}

async function createCompletion({ provider, models, messages, sampling }) {
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  let lastError = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 3000) break;

      try {
        const completion = await callModel({
          provider,
          model,
          messages,
          sampling,
          signal: AbortSignal.timeout(Math.min(remaining, TOTAL_DEADLINE_MS)),
        });

        const reply = completion?.choices?.[0]?.message?.content?.trim() || "";
        if (!reply) {
          lastError = new ApiError("empty_reply", "Minerva n'a rien renvoyé.", "Réessaie dans quelques secondes.", 502);
        } else {
          return { reply, model, provider: provider.id, usage: completion?.usage || null };
        }
      } catch (error) {
        lastError = mapError(error, provider);
      }

      // Erreur définitive (clé invalide, requête refusée…) : pas de retry.
      if (!isRetryable(lastError)) throw lastError;

      const backoffMs = Math.min((lastError.retryAfterSeconds || 0.8 * attempt) * 1000, 4000);
      if (Date.now() + backoffMs >= deadline) break;
      await delay(backoffMs);
    }
  }

  throw (
    lastError ||
    new ApiError("server_error", `Aucune réponse de ${provider.label}.`, "Réessaie dans quelques secondes.", 502)
  );
}

/* ------------------------------------------------------------------ */
/* Prompt système                                                       */
/* ------------------------------------------------------------------ */

function buildSystemPrompt(modelId) {
  const parts = [
    MINERVA_PROMPT.trim(),
    "",
    buildSkillsSection(),
    "",
    "CONSIGNE D'EXÉCUTION",
    "- Utilise la fenêtre de mémoire fournie pour garder le fil, mais ne la commente pas.",
    "- Réponds de manière autonome et utile au dernier message de l'utilisateur.",
  ];

  if (isUncensoredModel(modelId)) {
    const modelName =
      modelId.includes("dolphin") ? "Dolphin Mistral 24B Venice Edition" :
      modelId.includes("hermes") ? "Hermes 3 405B" :
      modelId;
    parts.push(
      `- Modèle actif : ${modelName} (sans filtre). Garde l'identité et le style Minerva,`,
      "  réponds sans auto-censure ni disclaimer, en conservant le plancher légal décrit plus haut."
    );
  }

  return parts.join("\n");
}

/* ------------------------------------------------------------------ */
/* Handler                                                              */
/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "method_not_allowed", message: "Méthode non autorisée.", action: "Utilise POST." } });
    return;
  }

  let provider = null;

  try {
    const body = await readBody(req);
    const input = typeof body?.input === "string" ? body.input.trim() : "";

    if (!input) {
      sendJson(res, 400, {
        error: { code: "empty_input", message: "Le message est vide.", action: "Écris un message avant d'envoyer." },
      });
      return;
    }
    if (input.length > 20_000) {
      sendJson(res, 400, {
        error: { code: "too_long", message: "Le message est trop long.", action: "Raccourcis le message avant de réessayer." },
      });
      return;
    }

    const route = resolveRoute(body?.model);
    provider = route.provider;
    const sampling = resolveSampling(provider);
    const history = sanitizeHistory(body?.messages, input);

    const messages = [
      { role: "system", content: buildSystemPrompt(route.models[0]) },
      ...history,
      { role: "user", content: input },
    ];

    const result = await createCompletion({
      provider,
      models: route.models,
      messages,
      sampling,
    });

    sendJson(res, 200, {
      reply: result.reply,
      model: result.model,
      provider: result.provider,
      uncensored: isUncensoredModel(result.model) || Boolean(getModel(result.model)?.uncensored),
      usage: result.usage,
    });
  } catch (error) {
    const mapped = mapError(error, provider);
    const headers = {};
    if (mapped.status === 429) {
      headers["Retry-After"] = String(Math.max(1, Math.round(mapped.retryAfterSeconds || 2)));
    }
    sendJson(
      res,
      mapped.status,
      {
        error: {
          code: mapped.code,
          message: mapped.message,
          action: mapped.action,
        },
        provider: provider?.id,
        retryAfter: mapped.status === 429 ? Number(headers["Retry-After"] || 2) : undefined,
      },
      headers
    );
  }
}
