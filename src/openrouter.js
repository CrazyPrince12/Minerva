// openrouter.js
// Client minimal pour l'API OpenRouter (chat completions), écrit en JavaScript
// à partir de l'exemple TypeScript de la doc officielle :
// https://openrouter.ai/docs/quickstart
//
//   fetch('https://openrouter.ai/api/v1/chat/completions', {
//     method: 'POST',
//     headers: {
//       Authorization: 'Bearer <OPENROUTER_API_KEY>',
//       'HTTP-Referer': '<YOUR_SITE_URL>',        // Optionnel (classements openrouter.ai)
//       'X-OpenRouter-Title': '<YOUR_SITE_NAME>', // Optionnel (classements openrouter.ai)
//       'Content-Type': 'application/json',
//     },
//     body: JSON.stringify({ model, messages }),
//   })
//
// Les deux en-têtes optionnels ne sont envoyés QUE s'ils sont renseignés
// (OPENROUTER_SITE_URL / OPENROUTER_SITE_NAME). Laissés vides, ils sont omis.
//
// Ce module est utilisé uniquement côté serveur : la clé n'atteint jamais le navigateur.

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Permet de pointer vers un proxy/miroir (ou un mock de test) sans toucher au code.
// Accepte soit l'URL complète, soit la base « .../api/v1 ».
export function resolveEndpoint(baseUrl = "") {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return OPENROUTER_URL;
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

export class OpenRouterHttpError extends Error {
  constructor(message, { status = 0, code = "", headers = null, body = null } = {}) {
    super(message);
    this.name = "OpenRouterHttpError";
    this.status = status;
    this.code = code;
    this.headers = headers;
    this.body = body;
  }
}

function buildHeaders({ apiKey, siteUrl, siteName }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  // Optionnels : uniquement si l'utilisateur les configure un jour.
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (siteName) headers["X-OpenRouter-Title"] = siteName;
  return headers;
}

/**
 * Appelle POST /api/v1/chat/completions et renvoie la réponse JSON brute
 * (même forme que l'API OpenAI : { choices: [...], usage: {...} }).
 */
export async function createOpenRouterCompletion({
  apiKey,
  model,
  messages,
  temperature,
  maxTokens,
  siteUrl = "",
  siteName = "",
  baseUrl = "",
  signal,
}) {
  const endpoint = resolveEndpoint(baseUrl);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: buildHeaders({ apiKey, siteUrl, siteName }),
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal,
    });
  } catch (error) {
    // Erreur réseau / abort : on laisse le mapping d'erreurs d'api/chat.js décider.
    throw error;
  }

  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      rawText.slice(0, 300) ||
      `OpenRouter a renvoyé le statut ${response.status}.`;
    throw new OpenRouterHttpError(message, {
      status: response.status,
      code: String(data?.error?.code || data?.error?.type || ""),
      headers: response.headers,
      body: data,
    });
  }

  // OpenRouter peut renvoyer un 200 contenant une erreur de fournisseur amont.
  if (data?.error) {
    const status = Number(data.error.code) >= 400 && Number(data.error.code) < 600 ? Number(data.error.code) : 502;
    throw new OpenRouterHttpError(data.error.message || "Erreur renvoyée par OpenRouter.", {
      status,
      code: String(data.error.code || ""),
      headers: response.headers,
      body: data,
    });
  }

  return data || {};
}
