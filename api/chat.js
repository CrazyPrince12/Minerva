// api/chat.js
// Proxy serverless compatible Vercel (/api/chat) et Render (via server.js).
// Les clés (GROQ_API_KEY, HF_TOKEN) sont lues uniquement côté serveur :
// jamais exposées au client. Le sélecteur du frontend envoie seulement un
// identifiant abstrait ("dolphin-24b", "groq/compound", ...) : le nom exact
// du fournisseur et du modèle reste un détail interne au backend.

import "dotenv/config";
import OpenAI from "openai";
import { MINERVA_PROMPT } from "../src/prompt.js";
import { buildSkillsSection } from "../src/skills.js";

const MEMORY_WINDOW = 8;
const DEFAULT_TEMPERATURE = Number.parseFloat(process.env.GROQ_TEMPERATURE || "0.7");
const DEFAULT_MAX_TOKENS = Number.parseInt(process.env.GROQ_MAX_TOKENS || "4096", 10);
// Budget global : on garde de la marge sous la limite de la fonction (30 s sur Vercel).
const TOTAL_DEADLINE_MS = Number.parseInt(process.env.GROQ_DEADLINE_MS || "26000", 10);
const ATTEMPTS_PER_MODEL = 2;

// Modèle principal Groq : openai/gpt-oss-20b (inchangé).
// Le modèle de secours n'est utilisé QUE si le principal renvoie 429/5xx/404 :
// il ne change rien au fonctionnement normal.
// Désactiver les secours : GROQ_FALLBACK_MODELS=none
const DEFAULT_MODEL = "openai/gpt-oss-20b";
const DEFAULT_FALLBACK_MODELS = "openai/gpt-oss-120b";

// Fournisseurs supportés par le proxy. Chacun pointe vers son endpoint
// OpenAI-compatible et lit sa propre clé dans l'environnement.
const PROVIDERS = {
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
  },
  hf: {
    baseURL: "https://router.huggingface.co/v1",
    apiKeyEnv: "HF_TOKEN",
  },
};

// Option "Dolphin 24B" affichée dans la barre de saisie (valeur abstraite) →
// modèle Hugging Face réel (le "featherless-ai" est un fournisseur du routeur HF).
const DOLPHIN_OPTION = "dolphin-24b";
const DOLPHIN_API_MODEL = "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai";

// Identifiants Groq que le client peut demander dans le sélecteur.
const GROQ_SELECTABLE = new Set([
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "groq/compound",
  "groq/compound-mini",
]);

// Résout l'identifiant envoyé par le client en plans d'appel concrets
// { provider, apiModel }. Exporté pour les tests unitaires (aucun réseau requis).
export function resolveModels(requestedModel = "") {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";

  // Cas particulier : "Dolphin 24B" vit sur Hugging Face. Aucun secours
  // Groq n'est appliqué derrière lui (fournisseur et clé différents).
  if (requested === DOLPHIN_OPTION) {
    return [{ provider: "hf", apiModel: DOLPHIN_API_MODEL }];
  }

  // Groq : modèle demandé si valide, sinon GROQ_MODEL (env) sinon défaut,
  // puis la liste des secours configurée.
  const primary =
    (GROQ_SELECTABLE.has(requested) ? requested : "") ||
    (process.env.GROQ_MODEL || "").trim() ||
    DEFAULT_MODEL;

  const raw = (process.env.GROQ_FALLBACK_MODELS ?? DEFAULT_FALLBACK_MODELS).trim();
  const fallbacks = /^(none|off|0|false)$/i.test(raw)
    ? []
    : raw
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);

  return [...new Set([primary, ...fallbacks])].map((apiModel) => ({ provider: "groq", apiModel }));
}

const clients = new Map();

function getClient(provider) {
  if (clients.has(provider)) return clients.get(provider);

  const config = PROVIDERS[provider];
  if (!config) {
    throw new ApiError(
      "server_error",
      "Fournisseur de modèle inconnu.",
      "Vérifie la configuration du serveur puis réessaie.",
      500
    );
  }

  const apiKey = process.env[config.apiKeyEnv];
  if (!apiKey) {
    throw new ApiError(
      "missing_key",
      `La clé ${config.apiKeyEnv} n'est pas configurée.`,
      `Ajoute ${config.apiKeyEnv} dans les variables d'environnement du projet, puis redéploie.`,
      500
    );
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.baseURL,
    timeout: TOTAL_DEADLINE_MS,
    maxRetries: 0, // on gère nous-mêmes les retries (backoff + bascule de modèle)
  });
  clients.set(provider, client);
  return client;
}

class ApiError extends Error {
  constructor(code, message, action, status = 500) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.action = action;
    this.status = status;
  }
}

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

function getRetryAfterSeconds(error) {
  const raw =
    error?.headers?.get?.("retry-after") ||
    error?.headers?.["retry-after"] ||
    error?.response?.headers?.get?.("retry-after") ||
    error?.response?.headers?.["retry-after"];
  const seconds = Number.parseFloat(String(raw).replace(/[^0-9.]/g, ""));
  return Number.isFinite(seconds) && seconds > 0 && seconds < 60 ? seconds : 0;
}

function mapError(error) {
  if (error instanceof ApiError) return error;

  const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);
  const code = String(error?.code || error?.error?.code || "");
  const message = String(error?.message || "");
  const retryAfterSeconds = getRetryAfterSeconds(error);

  // Messages volontairement neutres : le frontend n'a pas à afficher quel
  // fournisseur (Groq / Hugging Face) a servi la requête.
  if (status === 429 || code === "rate_limit_exceeded" || /rate[_ ]?limit/i.test(message)) {
    const apiError = new ApiError(
      "rate_limit",
      "Limite atteinte : le service reçoit trop de requêtes.",
      "Patiente quelques secondes puis renvoie ton message.",
      429
    );
    apiError.retryAfterSeconds = retryAfterSeconds || 2;
    return apiError;
  }
  if (status === 401) {
    return new ApiError(
      "invalid_key",
      "La clé API est invalide ou non autorisée.",
      "Vérifie la clé API dans les variables d'environnement du projet et redéploie.",
      401
    );
  }
  if (status === 403) {
    return new ApiError(
      "forbidden",
      "L'accès au modèle demandé est bloqué.",
      "Vérifie que ce modèle est disponible sur le compte associé à ta clé.",
      403
    );
  }
  if (status === 404 || /model.*(not found|decommissioned|does not exist)/i.test(message)) {
    return new ApiError(
      "model_unavailable",
      "Le modèle demandé n'est pas disponible.",
      "Sélectionne un autre modèle dans la liste.",
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
      "La requête envoyée au modèle a été refusée.",
      "Réessaie avec un message plus court ou reformulé.",
      400
    );
  }
  if (error?.code === "ETIMEDOUT" || error?.name === "AbortError" || /timeout/i.test(message)) {
    return new ApiError("timeout", "Minerva a mis trop de temps à répondre.", "Réessaie dans quelques secondes.", 504);
  }
  if (status >= 500) {
    return new ApiError(
      "upstream_error",
      "Le service du modèle est momentanément indisponible.",
      "Réessaie dans quelques secondes.",
      502
    );
  }
  return new ApiError(
    "server_error",
    "Une erreur interne est survenue lors de l'appel au modèle.",
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

async function createCompletion(messages, plans) {
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  let lastError = null;

  // Chaque "plan" est { provider, apiModel } : le bon client (et la bonne clé)
  // sont résolus par fournisseur au moment de l'appel.
  for (const plan of plans) {
    const client = getClient(plan.provider);

    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 3000) break;

      try {
        const completion = await client.chat.completions.create(
          {
            model: plan.apiModel,
            messages,
            temperature: DEFAULT_TEMPERATURE,
            max_tokens: DEFAULT_MAX_TOKENS,
          },
          { signal: AbortSignal.timeout(Math.min(remaining, TOTAL_DEADLINE_MS)) }
        );

        const reply = completion?.choices?.[0]?.message?.content?.trim() || "";
        if (!reply) {
          lastError = new ApiError("empty_reply", "Minerva n'a rien renvoyé.", "Réessaie dans quelques secondes.", 502);
        } else {
          return { reply, model: plan.apiModel, usage: completion?.usage || null };
        }
      } catch (error) {
        lastError = mapError(error);
      }

      // Erreur définitive (clé invalide, requête refusée…) : pas de retry.
      if (!isRetryable(lastError)) throw lastError;

      const backoffMs = Math.min((lastError.retryAfterSeconds || 0.8 * attempt) * 1000, 4000);
      if (Date.now() + backoffMs >= deadline) break;
      await delay(backoffMs);
    }
  }

  throw lastError || new ApiError("server_error", "Aucune réponse du modèle.", "Réessaie dans quelques secondes.", 502);
}

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

    const history = sanitizeHistory(body?.messages, input);

    const system = [
      MINERVA_PROMPT.trim(),
      "",
      buildSkillsSection(),
      "",
      "CONSIGNE D'EXÉCUTION",
      "- Utilise la fenêtre de mémoire fournie pour garder le fil, mais ne la commente pas.",
      "- Réponds de manière autonome et utile au dernier message de l'utilisateur.",
    ].join("\n");

    const messages = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: input },
    ];

    const { reply, model, usage } = await createCompletion(messages, resolveModels(body?.model));

    sendJson(res, 200, { reply, model, usage });
  } catch (error) {
    const mapped = mapError(error);
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
        retryAfter: mapped.status === 429 ? Number(headers["Retry-After"] || 2) : undefined,
      },
      headers
    );
  }
}
