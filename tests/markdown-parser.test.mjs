// Tests du parseur Markdown de public/script.js.
//
// Le parseur pur (parseMarkdownBlocks) est extrait du fichier réel entre les
// marqueurs __MINERVA_PARSER_BEGIN__ / __MINERVA_PARSER_END__, ce qui évite
// qu'un copier-coller de test diverge du code de production.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(root, "public", "script.js"), "utf8");

const beginMarker = "// __MINERVA_PARSER_BEGIN__";
const endMarker = "// __MINERVA_PARSER_END__";
const begin = source.indexOf(beginMarker);
const end = source.indexOf(endMarker);
assert.ok(begin !== -1 && end !== -1, "marqueurs du parseur introuvables dans script.js");

const parserSource = source.slice(begin + beginMarker.length, end);
const { parseMarkdownBlocks } = new Function(`${parserSource}\nreturn { parseMarkdownBlocks };`)();

const dump = (blocks) => JSON.stringify(blocks);
const countType = (blocks, type) => blocks.filter((b) => b.type === type).length;

test("le cas du bug : tableau collé à un paragraphe ne fuit plus TABLE0/TABLE1", () => {
  // Reproduit la réponse de l'exemple : ligne d'intro directement suivie du
  // tableau (sans ligne vide) et paragraphe de conclusion juste après la
  // dernière ligne — exactement le cas où l'ancien code affichait
  // « TABLE0 TABLE1 … TABLE6 ».
  const md = [
    "Pays où le nombre d'entreprises du secteur pornographique est le plus élevé (selon les études de marché)",
    "| Rang | Pays | Estimation |",
    "|---|---|---|",
    "| 1 | États-Unis | ~300 |",
    "| 2 | Japon | ~150 |",
    "| 3 | Allemagne | ~80 |",
    "| 4 | Royaume-Uni | ~60 |",
    "| 5 | Canada | ~45 |",
    "Ces classements sont basés sur les données publiques ; les chiffres exacts varient.",
  ].join("\n");

  const blocks = parseMarkdownBlocks(md);

  // Aucun jeton TABLE0/TABLE1 ne doit survivre dans les blocs.
  assert.ok(!dump(blocks).includes("TABLE"), "des jetons TABLE ont fuité dans les blocs");

  // Un tableau complet (en-tête + 5 lignes) est bien reconnu.
  const tables = blocks.filter((b) => b.type === "table");
  assert.equal(tables.length, 1, "un seul bloc tableau attendu");
  assert.equal(tables[0].rows.length, 6, "en-tête + 5 pays attendus");
  assert.deepEqual(tables[0].rows[0], ["Rang", "Pays", "Estimation"]);
  assert.equal(tables[0].rows[1][1], "États-Unis");
  assert.equal(tables[0].rows[5][1], "Canada");

  // Les paragraphes d'intro et de conclusion restent des paragraphes.
  const texts = blocks.filter((b) => b.type === "text").map((b) => b.text);
  assert.equal(texts.length, 2);
  assert.match(texts[0], /^Pays où le nombre/);
  assert.match(texts[1], /^Ces classements/);
});

test("tableau séparé par des lignes vides : toujours un seul bloc", () => {
  const md = [
    "Introduction.",
    "",
    "| A | B |",
    "|---|---|",
    "| 1 | x |",
    "| 2 | y |",
    "",
    "Conclusion.",
  ].join("\n");

  const blocks = parseMarkdownBlocks(md);
  assert.equal(countType(blocks, "table"), 1);
  assert.deepEqual(blocks.find((b) => b.type === "table").rows, [
    ["A", "B"],
    ["1", "x"],
    ["2", "y"],
  ]);
  assert.ok(!dump(blocks).includes("TABLE"));
});

test("tableau sans ligne de séparation : la 1re ligne reste l'en-tête", () => {
  const md = ["| Rang | Pays |", "| 1 | États-Unis |", "| 2 | Japon |"].join("\n");
  const blocks = parseMarkdownBlocks(md);
  const table = blocks.find((b) => b.type === "table");
  assert.ok(table, "tableau attendu");
  assert.equal(table.rows.length, 3);
  assert.deepEqual(table.rows[0], ["Rang", "Pays"]);
});

test("des pipes dans un bloc de code ne sont pas pris pour un tableau", () => {
  const md = [
    "Voici le code :",
    "```js",
    "const data = [",
    "  { a: 1, b: 2 },",
    "];",
    "// | pseudo | tableau |",
    "```",
    "",
    "| vrais | en-têtes |",
    "|---|---|",
    "| 1 | 2 |",
  ].join("\n");

  const blocks = parseMarkdownBlocks(md);
  assert.equal(countType(blocks, "code"), 1);
  assert.equal(countType(blocks, "table"), 1);

  const code = blocks.find((b) => b.type === "code");
  assert.ok(code.code.includes("| pseudo | tableau |"), "la ligne avec pipes doit rester dans le code");
  assert.ok(!dump(blocks).includes("TABLE"), "aucun jeton TABLE ne doit fuité");
});

test("liste numérotée collée à un paragraphe d'intro", () => {
  const md = ["Pays avec le plus d'entreprises :", "1. États-Unis", "2. Japon", "3. Allemagne", "4. Royaume-Uni", "5. Canada"].join("\n");

  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].type, "text");
  assert.equal(blocks[1].type, "ol");
  assert.equal(blocks[1].items.length, 5);
  assert.equal(blocks[1].items[0], "États-Unis");
  assert.equal(blocks[1].items[4], "Canada");
});

test("liste à puces simple", () => {
  const md = ["- un", "- deux", "- trois"].join("\n");
  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "ul");
  assert.deepEqual(blocks[0].items, ["un", "deux", "trois"]);
});

test("changement de type de liste : deux listes séparées", () => {
  const md = ["- puce", "1. numérotée"].join("\n");
  const blocks = parseMarkdownBlocks(md);
  assert.equal(countType(blocks, "ul"), 1);
  assert.equal(countType(blocks, "ol"), 1);
});

test("titres immédiatement suivis de texte", () => {
  const md = ["## Section", "Du texte directement sous le titre.", "", "### Sous-section", "Encore du texte."].join("\n");
  const blocks = parseMarkdownBlocks(md);
  assert.deepEqual(
    blocks.map((b) => b.type),
    ["heading", "text", "heading", "text"]
  );
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[2].level, 3);
});

test("citation multi-lignes", () => {
  const md = ["> Première ligne", "> Deuxième ligne"].join("\n");
  const blocks = parseMarkdownBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "quote");
  assert.equal(blocks[0].text, "Première ligne Deuxième ligne");
});

test("entrées vides ou sans markdown restent sans erreur", () => {
  assert.deepEqual(parseMarkdownBlocks(""), []);
  assert.deepEqual(parseMarkdownBlocks("   \n\n  "), []);
  const blocks = parseMarkdownBlocks("Un simple texte.");
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "text");
});

test("bloc de code seul avec langage", () => {
  const blocks = parseMarkdownBlocks(["```python", "print('ok')", "```"].join("\n"));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, "code");
  assert.equal(blocks[0].lang, "python");
  assert.equal(blocks[0].code, "print('ok')");
});
