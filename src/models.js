// models.js
// Catalogue central des modèles disponibles dans Minerva + routage par fournisseur.
//
// Deux fournisseurs cohabitent, sans jamais se mélanger :
//   - `groq`       → https://api.groq.com/openai/v1   (clé GROQ_API_KEY)
//   - `openrouter` → https://openrouter.ai/api/v1     (clé OPENROUTER_API_KEY)
//
// Chaque modèle est associé à UN fournisseur. Les modèles de secours
// (fallbacks) sont toujours filtrés sur le même fournisseur : un modèle
// OpenRouter ne peut donc jamais basculer vers Groq, et inversement.

export const PROVIDERS = {
  groq: {
    id: "groq",
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    fallbackEnv: "GROQ_FALLBACK_MODELS",
    temperatureEnv: "GROQ_TEMPERATURE",
    maxTokensEnv: "GROQ_MAX_TOKENS",
    defaultModel: "openai/gpt-oss-20b",
    // Secours utilisé uniquement en cas de 429/5xx/404 sur le modèle principal.
    defaultFallbacks: "openai/gpt-oss-120b",
    keyHint: "Ajoute GROQ_API_KEY dans les variables d'environnement du projet, puis redéploie.",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    fallbackEnv: "OPENROUTER_FALLBACK_MODELS",
    temperatureEnv: "OPENROUTER_TEMPERATURE",
    maxTokensEnv: "OPENROUTER_MAX_TOKENS",
    defaultModel: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    // Fallback automatique : openrouter/free route vers un modèle gratuit disponible.
    // Si Dolphin échoue, on essaie le router automatique avant d'abandonner.
    defaultFallbacks: "openrouter/free",
    keyHint: "Ajoute OPENROUTER_API_KEY dans les variables d'environnement du projet, puis redéploie.",
  },
};

export const DEFAULT_PROVIDER = "groq";

// Modèle sans filtre (OpenRouter) — https://openrouter.ai/cognitivecomputations/dolphin-mistral-24b-venice-edition:free
export const UNCENSORED_MODEL = "cognitivecomputations/dolphin-mistral-24b-venice-edition:free";

export const CHAT_MODELS = [
  { id: "openai/gpt-oss-20b", provider: "groq", label: "GPT-OSS 20B" },
  { id: "openai/gpt-oss-120b", provider: "groq", label: "GPT-OSS 120B" },
  { id: "groq/compound", provider: "groq", label: "Groq Compound" },
  { id: "groq/compound-mini", provider: "groq", label: "Compound Mini" },
  {
    id: UNCENSORED_MODEL,
    provider: "openrouter",
    label: "Dolphin Mistral 24B — Uncensored",
    uncensored: true,
  },
];

const MODELS_BY_ID = new Map(CHAT_MODELS.map((model) => [model.id, model]));

export function getModel(id) {
  return MODELS_BY_ID.get(typeof id === "string" ? id.trim() : "") || null;
}

export function isKnownModel(id) {
  return MODELS_BY_ID.has(typeof id === "string" ? id.trim() : "");
}

export function isUncensoredModel(id) {
  return Boolean(getModel(id)?.uncensored);
}

export function getProviderOf(id) {
  return getModel(id)?.provider || "";
}

function readEnv(env, name, fallback = "") {
  const value = name ? env[name] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/**
 * Détermine le fournisseur et la liste ordonnée des modèles à essayer.
 *
 * @param {string} requestedModel  Modèle demandé par le client (peut être vide/invalide).
 * @param {object} env             Variables d'environnement (process.env par défaut).
 * @returns {{ provider: object, models: string[] }}
 */
export function resolveRoute(requestedModel = "", env = process.env) {
  const requested = getModel(requestedModel);

  let providerId = requested?.provider;
  let primary = requested?.id;

  if (!providerId) {
    // Aucun modèle valide demandé : on retombe sur la configuration Groq
    // historique (GROQ_MODEL puis le modèle par défaut).
    providerId = DEFAULT_PROVIDER;
    primary = readEnv(env, PROVIDERS[DEFAULT_PROVIDER].modelEnv, PROVIDERS[DEFAULT_PROVIDER].defaultModel);
  }

  const provider = PROVIDERS[providerId];
  const rawFallbacks = readEnv(env, provider.fallbackEnv, provider.defaultFallbacks);

  let models = [primary];
  if (!/^(none|off|0|false)$/i.test(rawFallbacks)) {
    const fallbacks = rawFallbacks
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      // Un secours doit appartenir au même fournisseur (ou être inconnu du
      // catalogue mais explicitement configuré pour ce fournisseur).
      .filter((m) => {
        const known = getModel(m);
        return !known || known.provider === providerId;
      });
    models = [...new Set([primary, ...fallbacks])];
  }

  return { provider, models };
}

/**
 * Réglages d'échantillonnage par fournisseur (valeurs par défaut communes).
 */
export function resolveSampling(provider, env = process.env) {
  const temperature = Number.parseFloat(readEnv(env, provider.temperatureEnv, "0.7"));
  const maxTokens = Number.parseInt(readEnv(env, provider.maxTokensEnv, "4096"), 10);
  return {
    temperature: Number.isFinite(temperature) ? temperature : 0.7,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
  };
}
