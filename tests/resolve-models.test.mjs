// Tests du routage des modèles dans api/chat.js.
//
// Le frontend envoie un identifiant abstrait ("dolphin-24b", "groq/compound",
// ...). Le backend le traduit en { provider, apiModel } concrets :
//   - "Dolphin 24B"  → fournisseur Hugging Face (routeur), jamais Groq ;
//   - les autres     → fournisseur Groq (avec les secours configurés).
//
// Ces tests garantissent que l'ajout de "dolphin-24b" n'a pas cassé le routage
// Groq existant. Ils sont purement déterministes (aucun appel réseau).

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveModels } from "../api/chat.js";

const DOLPHIN_API = "dphn/Dolphin-Mistral-24B-Venice-Edition:featherless-ai";

test("dolphin-24b → un seul plan sur Hugging Face, aucun Groq", () => {
  const plans = resolveModels("dolphin-24b");
  assert.equal(plans.length, 1);
  assert.equal(plans[0].provider, "hf");
  assert.equal(plans[0].apiModel, DOLPHIN_API);
});

test("les identifiants Groq sélectionnables restent sur Groq", () => {
  for (const id of ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "groq/compound", "groq/compound-mini"]) {
    const plans = resolveModels(id);
    assert.ok(plans.length >= 1, `${id} doit produire au moins un plan`);
    for (const plan of plans) {
      assert.equal(plan.provider, "groq", `${id} doit rester sur Groq`);
    }
  }
});

test("aucun modèle fourni → défaut Groq (env ou openai/gpt-oss-20b)", () => {
  const plans = resolveModels(undefined);
  assert.ok(plans.length >= 1);
  assert.equal(plans[0].provider, "groq");
  assert.equal(
    plans[0].apiModel,
    (process.env.GROQ_MODEL || "").trim() || "openai/gpt-oss-20b"
  );
});

test("identifiant inconnu → ignoré, défaut Groq (comportement d'origine)", () => {
  const plans = resolveModels("modele/inexistant");
  assert.ok(plans.length >= 1);
  assert.equal(plans[0].provider, "groq");
  assert.equal(plans[0].apiModel, "openai/gpt-oss-20b");
});

test("une chaîne vide → défaut Groq", () => {
  const plans = resolveModels("   ");
  assert.equal(plans[0].provider, "groq");
});
