// api/chat.js
// Proxy serverless compatible Vercel (/api/chat) et Render (via server.js).
// La clé GROQ_API_KEY est lue uniquement côté serveur : jamais exposée au client.

import "dotenv/config";
import OpenAI from "openai";
import { MINERVA_PROMPT } from "../prompt.js";
import { buildSkillsSection } from "../skills.js";

const MEMORY_WINDOW = 10;
const DEFAULT_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const DEFAULT_TEMPERATURE = Number.parseFloat(process.env.GROQ_TEMPERATURE || "0.7");
const DEFAULT_MAX_TOKENS = Number.parseInt(process.env.GROQ_MAX_TOKENS || "4096", 10);

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new ApiError("missing_key", "La clé API Groq n'est pas configurée.", "Ajoute GROQ_API_KEY dans les variables d'environnement du projet, puis redéploie.", 500);
    }
    cachedClient = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
      timeout: 60_000,
      maxRetries: 0,
    });
  }
  return cachedClient;
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
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
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

function sanitizeHistory(messages) {
  if (!Array.isArray(messages)) return [];

  let parsed = messages.map((m) => {
    const role = m && (m.role === "user" || m.role === "assistant") ? m.role : null;
    const content = typeof m?.content === "string" ? m.content.trim() : "";
    if (!role || !content) return null;
    return { role, content };
  }).filter(Boolean);

  // Fenêtre glissante : minimum, on garde les 10 derniers messages utiles.
  parsed = parsed.slice(-MEMORY_WINDOW);

  // Limite de taille par message et au total (protection contre les abus).
  const total = parsed.reduce((acc, m) => acc + m.content.length, 0);
  if (total > 60_000) {
    parsed = parsed.map((m) => ({ ...m, content: m.content.slice(-12_000) }));
  }

  return parsed;
}

function mapError(error) {
  if (error instanceof ApiError) return error;

  const status = error?.status || error?.statusCode || 500;

  if (status === 429) {
    return new ApiError(
      "rate_limit",
      "Limite atteinte: Groq reçoit trop de requêtes.",
      "Réessaie dans quelques minutes, ou réduis le nombre de messages envoyés.",
      429
    );
  }
  if (status === 401) {
    return new ApiError(
      "invalid_key",
      "La clé API Groq est invalide ou non autorisée.",
      "Vérifie GROQ_API_KEY dans les variables d'environnement et redéploie.",
      401
    );
  }
  if (status === 400) {
    return new ApiError(
      "bad_request",
      "La requête envoyée à Groq a été refusée.",
      "Réessaie avec un message plus court ou reformulé.",
      400
    );
  }
  if (status === 403) {
    return new ApiError(
      "forbidden",
      "L'accès au modèle demandé est bloqué.",
      "Vérifie que ce modèle est disponible sur ton compte Groq.",
      403
    );
  }
  if (error?.code === "ETIMEDOUT" || error?.name === "AbortError" || error?.message?.includes("timeout")) {
    return new ApiError(
      "timeout",
      "Minerva a mis trop de temps à répondre.",
      "Réessaie dans quelques secondes.",
      504
    );
  }
  return new ApiError(
    "server_error",
    "Une erreur interne est survenue lors de l'appel à Groq.",
    "Vérifie les logs du serveur puis réessaie.",
    500
  );
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

    const history = sanitizeHistory(body?.messages);
    const client = getClient();

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

    const completion = await client.chat.completions.create({
      model: DEFAULT_MODEL,
      messages,
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: DEFAULT_MAX_TOKENS,
    }, { signal: AbortSignal.timeout(60_000) });

    const reply = completion?.choices?.[0]?.message?.content?.trim() || "";

    if (!reply) {
      throw new ApiError(
        "empty_reply",
        "Minerva n'a rien renvoyé.",
        "Réessaie dans quelques secondes.",
        502
      );
    }

    sendJson(res, 200, {
      reply,
      model: DEFAULT_MODEL,
      usage: completion?.usage || null,
    });
  } catch (error) {
    const mapped = mapError(error);
    sendJson(res, mapped.status, {
      error: {
        code: mapped.code,
        message: mapped.message,
        action: mapped.action,
      },
    });
  }
}
