// Tests du rendu des réponses de public/script.js.
//
// Décision produit : AUCUN reformatage côté client. Le texte renvoyé par
// l'API est affiché tel quel (voir le cas TABLE0/TABLE1 des PR #14 et
// suivantes). Ces tests garantissent que :
//   1. le contenu n'est pas transformé (listes, tableaux, gras, code…) ;
//   2. rien n'est injecté en HTML (textContent uniquement) ;
//   3. aucun jeton temporaire ne peut apparaître ;
//   4. le code de rendu ne contient plus de parseur Markdown.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(root, "public", "script.js"), "utf8");

const beginMarker = "// __MINERVA_RENDER_BEGIN__";
const endMarker = "// __MINERVA_RENDER_END__";
const begin = source.indexOf(beginMarker);
const end = source.indexOf(endMarker);
assert.ok(begin !== -1 && end !== -1, "marqueurs du rendu introuvables dans script.js");

const renderSource = source.slice(begin + beginMarker.length, end);
const { normalizeReply, renderPlainText } = new Function(
  `${renderSource}\nreturn { normalizeReply, renderPlainText };`
)();

function fakeContainer() {
  const node = { textContent: "", innerHTMLWrites: 0 };
  Object.defineProperty(node, "innerHTML", {
    set() {
      node.innerHTMLWrites += 1;
    },
    get() {
      return "";
    },
  });
  return node;
}

test("le cas rapporté : liste + tableau affichés tels quels, jamais TABLE0/TABLE1", () => {
  const reply = [
    "Top 5 des pays comptant le plus d'entreprises du secteur pornographique",
    "",
    "| Rang | Pays | Estimation |",
    "|---|---|---|",
    "| 1 | États-Unis | ~300 |",
    "| 2 | Japon | ~150 |",
    "| 3 | Allemagne | ~80 |",
    "| 4 | Royaume-Uni | ~60 |",
    "| 5 | Canada | ~45 |",
    "",
    "*Chiffres issus de registres publics ; les valeurs exactes varient selon les sources.*",
  ].join("\n");

  const container = fakeContainer();
  renderPlainText(container, reply);

  assert.equal(container.textContent, reply, "le texte doit être identique à la réponse de l'API");
  assert.ok(!/TABLE\d/.test(container.textContent), "aucun jeton TABLEn ne doit apparaître");
  assert.equal(container.innerHTMLWrites, 0, "le rendu ne doit jamais passer par innerHTML");
});

test("une liste numérotée reste une liste numérotée, ligne par ligne", () => {
  const reply = [
    "Voici 5 pays :",
    "1. États-Unis",
    "2. Japon",
    "3. Allemagne",
    "4. Royaume-Uni",
    "5. Canada",
  ].join("\n");

  const container = fakeContainer();
  renderPlainText(container, reply);
  assert.equal(container.textContent, reply);
  assert.equal(container.textContent.split("\n").length, 6);
});

test("le Markdown inline n'est pas interprété (gras, code, liens, puces)", () => {
  const reply = "- **Gras** et `code` et [lien](https://example.com)\n- Deuxième *puce*";
  const container = fakeContainer();
  renderPlainText(container, reply);
  assert.equal(container.textContent, reply);
});

test("le HTML n'est pas injecté : il est affiché comme du texte", () => {
  const reply = '<img src=x onerror="alert(1)"> <script>alert(2)</script>';
  const container = fakeContainer();
  renderPlainText(container, reply);
  assert.equal(container.textContent, reply);
  assert.equal(container.innerHTMLWrites, 0);
});

test("normalizeReply : CRLF → LF, espaces aux extrémités retirés, contenu intact", () => {
  assert.equal(normalizeReply("  a\r\nb\rc\n\n"), "a\nb\nc");
  assert.equal(normalizeReply(null), "");
  assert.equal(normalizeReply(undefined), "");
  assert.equal(normalizeReply("| a | b |\n|---|---|"), "| a | b |\n|---|---|");
});

test("garde-fou : plus aucun parseur Markdown ni jeton temporaire dans script.js", () => {
  assert.ok(!source.includes("parseMarkdownBlocks"), "parseMarkdownBlocks ne doit plus exister");
  assert.ok(!source.includes("inlineMarkdown"), "inlineMarkdown ne doit plus exister");
  assert.ok(!source.includes("renderMarkdown("), "renderMarkdown ne doit plus être appelé");
  assert.ok(!/\\u0000TABLE|`TABLE\$\{/.test(source), "aucun jeton TABLEn ne doit être généré");
  // Les bulles du bot passent bien par le rendu brut.
  assert.match(source, /renderPlainText\(bubble, content\)/);
});
