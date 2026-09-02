// test/openrouter.test.js
// Vérifie l'intégration OpenRouter sans dépendre du réseau :
// un faux serveur OpenRouter local reçoit la requête et on contrôle
// l'URL, la méthode, les en-têtes, le corps JSON et le parsing de la réponse.
//
// Lancer : node test/openrouter.test.js

import assert from "node:assert/strict";
import http from "node:http";
import chatHandler from "../api/chat.js";
import { resolveEndpoint } from "../src/openrouter.js";
import { resolveRoute } from "../src/models.js";

const UNCENSORED = "cognitivecomputations/dolphin-mistral-24b-venice-edition:free";
let received = null;
let nextResponse = null;

/* -------------------- Faux serveur OpenRouter -------------------- */

const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    received = { method: req.method, url: req.url, headers: req.headers, body: JSON.parse(raw || "{}") };
    const { status = 200, payload } = nextResponse || {};
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        payload || {
          id: "gen-test",
          model: UNCENSORED,
          choices: [{ message: { role: "assistant", content: "Réponse sans filtre." } }],
          usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
        }
      )
    );
  });
});

await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const { port } = mock.address();
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${port}/api/v1`;
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "sk-or-test";

/* -------------------- Utilitaire d'appel du handler -------------------- */

function callHandler(body) {
  return new Promise((resolve) => {
    const req = { method: "POST", body, on() {}, headers: {} };
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(k, v) {
        headers[k] = v;
      },
      end(payload) {
        resolve({ status: res.statusCode, headers, json: JSON.parse(payload) });
      },
    };
    chatHandler(req, res);
  });
}

/* -------------------- Tests -------------------- */

// 1. Endpoint par défaut = celui de la doc.
assert.equal(resolveEndpoint(""), "https://openrouter.ai/api/v1/chat/completions");
assert.equal(resolveEndpoint("https://openrouter.ai/api/v1"), "https://openrouter.ai/api/v1/chat/completions");

// 2. Routage : chaque modèle part chez le bon fournisseur, sans mélange.
// Le fallback par défaut pour OpenRouter est Hermes 3 (uncensored).
assert.equal(resolveRoute(UNCENSORED).provider.id, "openrouter");
assert.deepEqual(resolveRoute(UNCENSORED).models, [UNCENSORED, "nousresearch/hermes-3-llama-3.1-405b:free"]);
assert.equal(resolveRoute("openai/gpt-oss-20b").provider.id, "groq");
assert.equal(resolveRoute("groq/compound").provider.id, "groq");
assert.equal(resolveRoute("").provider.id, "groq"); // comportement historique inchangé
assert.equal(resolveRoute("modele/inconnu").provider.id, "groq");

// 3. Appel nominal du modèle sans filtre.
process.env.OPENROUTER_SITE_URL = "";
process.env.OPENROUTER_SITE_NAME = "";
let out = await callHandler({ input: "Salut", model: UNCENSORED, messages: [] });

assert.equal(out.status, 200, JSON.stringify(out.json));
assert.equal(out.json.reply, "Réponse sans filtre.");
assert.equal(out.json.provider, "openrouter");
assert.equal(out.json.model, UNCENSORED);
assert.equal(out.json.uncensored, true);

assert.equal(received.method, "POST");
assert.equal(received.url, "/api/v1/chat/completions");
assert.equal(received.headers.authorization, `Bearer ${process.env.OPENROUTER_API_KEY}`);
assert.equal(received.headers["content-type"], "application/json");
// En-têtes optionnels laissés vides : ils ne doivent pas être envoyés.
assert.equal(received.headers["http-referer"], undefined);
assert.equal(received.headers["x-openrouter-title"], undefined);

assert.equal(received.body.model, UNCENSORED);
assert.equal(received.body.messages[0].role, "system");
assert.match(received.body.messages[0].content, /Minerva/);
assert.match(received.body.messages[0].content, /sans filtre/i);
assert.equal(received.body.messages.at(-1).role, "user");
assert.equal(received.body.messages.at(-1).content, "Salut");
assert.equal(typeof received.body.temperature, "number");
assert.equal(typeof received.body.max_tokens, "number");

// 4. En-têtes optionnels envoyés uniquement s'ils sont renseignés.
process.env.OPENROUTER_SITE_URL = "https://exemple.test";
process.env.OPENROUTER_SITE_NAME = "Minerva";
await callHandler({ input: "Salut", model: UNCENSORED, messages: [] });
assert.equal(received.headers["http-referer"], "https://exemple.test");
assert.equal(received.headers["x-openrouter-title"], "Minerva");
process.env.OPENROUTER_SITE_URL = "";
process.env.OPENROUTER_SITE_NAME = "";

// 5. Mémoire : l'historique est bien transmis.
await callHandler({
  input: "Et ensuite ?",
  model: UNCENSORED,
  messages: [
    { role: "user", content: "Première question" },
    { role: "assistant", content: "Première réponse" },
  ],
});
assert.equal(received.body.messages.length, 4);
assert.equal(received.body.messages[1].content, "Première question");

// 6. Erreur 401 renvoyée par OpenRouter → message clair côté client.
nextResponse = { status: 401, payload: { error: { message: "No auth credentials found", code: 401 } } };
out = await callHandler({ input: "Salut", model: UNCENSORED, messages: [] });
assert.equal(out.status, 401);
assert.equal(out.json.error.code, "invalid_key");
assert.match(out.json.error.message, /OpenRouter/);
assert.match(out.json.error.action, /OPENROUTER_API_KEY/);

// 7. Erreur 429 → Retry-After exposé, pas de bascule vers Groq.
nextResponse = { status: 429, payload: { error: { message: "Rate limit exceeded", code: 429 } } };
out = await callHandler({ input: "Salut", model: UNCENSORED, messages: [] });
assert.equal(out.status, 429);
assert.equal(out.json.error.code, "rate_limit");
assert.match(out.json.error.message, /OpenRouter/);
assert.ok(Number(out.headers["Retry-After"]) >= 1);

// 8. Erreur applicative renvoyée dans un 200 (cas OpenRouter amont).
nextResponse = { status: 200, payload: { error: { message: "Provider returned error", code: 502 } } };
out = await callHandler({ input: "Salut", model: UNCENSORED, messages: [] });
assert.equal(out.json.error.code, "upstream_error");

// 9. Clé manquante → message explicite, aucun appel réseau.
nextResponse = null;
const savedKey = process.env.OPENROUTER_API_KEY;
delete process.env.OPENROUTER_API_KEY;
out = await callHandler({ input: "Salut", model: UNCENSORED, messages: [] });
assert.equal(out.json.error.code, "missing_key");
assert.match(out.json.error.message, /OpenRouter/);
process.env.OPENROUTER_API_KEY = savedKey;

// 10. Le chemin Groq n'appelle jamais OpenRouter (le mock ne bouge pas).
const before = received;
out = await callHandler({ input: "Salut", model: "openai/gpt-oss-20b", messages: [] });
assert.equal(received, before, "Une requête Groq ne doit jamais partir vers OpenRouter");

mock.close();
console.log("✓ Tous les tests OpenRouter sont passés");
