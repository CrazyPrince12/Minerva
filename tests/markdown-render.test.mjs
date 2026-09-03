// Test de rendu DOM (avec un faux document) : vérifie que le cas exact du
// bug (tableau collé entre deux paragraphes) produit un vrai <table> et
// jamais de texte « TABLE0 / TABLE1 … » dans la sortie.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(path.join(root, "public", "script.js"), "utf8");

// Extraire les fonctions de rendu Markdown : de `renderTable` jusqu'à la
// section suivante du fichier (Rendu des messages).
const start = source.indexOf("function renderTable");
const end = source.indexOf("/* Rendu des messages");
assert.ok(start !== -1 && end !== -1, "bornes du rendu Markdown introuvables");

// --- Faux DOM minimal ---
function stubNode(tag) {
  const node = {
    tag,
    className: "",
    style: {},
    children: [],
    _text: null,
    _html: null,
    append(...kids) {
      this.children.push(...kids);
    },
    setAttribute() {},
    addEventListener() {},
    remove() {},
  };
  Object.defineProperty(node, "innerHTML", {
    get() {
      return this._html ?? "";
    },
    set(v) {
      this._html = String(v);
    },
    enumerable: true,
  });
  Object.defineProperty(node, "textContent", {
    get() {
      return this._text ?? this._html ?? "";
    },
    set(v) {
      this._text = String(v);
      this._html = null;
    },
    enumerable: true,
  });
  return node;
}

const document = { createElement: (tag) => stubNode(tag) };

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

const fnSource = `${source.slice(start, end)}\nreturn { renderMarkdown };`;
const { renderMarkdown } = new Function("document", "escapeHtml", `${fnSource}`)(document, escapeHtml);

function serialize(node) {
  if (node._text !== null) return node._text;
  if (node._html !== null) return node._html;
  return node.children.map((child) => `<${child.tag}>${serialize(child)}</${child.tag}>`).join("");
}

function cellTexts(table) {
  const out = [];
  for (const child of table.children) {
    for (const tr of child.children) {
      const row = [];
      for (const cell of tr.children) row.push(cell.textContent);
      out.push(row);
    }
  }
  return out;
}

test("rendu du cas du bug : vrai tableau, aucun texte TABLE0", () => {
  const markdown = [
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

  const container = stubNode("div");
  renderMarkdown(container, markdown);

  const full = serialize(container);
  assert.ok(!/TABLE\d/.test(full), `des jetons TABLE ont fuité dans le rendu : ${full}`);

  const tags = container.children.map((c) => c.tag);
  assert.deepEqual(tags, ["p", "table", "p"], "p, tableau, p attendus dans cet ordre");

  const rows = cellTexts(container.children[1]);
  assert.equal(rows.length, 6, "en-tête + 5 lignes");
  assert.deepEqual(rows[0], ["Rang", "Pays", "Estimation"]);
  assert.deepEqual(rows[1], ["1", "États-Unis", "~300"]);
  assert.deepEqual(rows[5], ["5", "Canada", "~45"]);
});

test("une liste numérotée devient <ol>", () => {
  const markdown = ["1. États-Unis", "2. Japon", "3. Allemagne", "4. Royaume-Uni", "5. Canada"].join("\n");
  const container = stubNode("div");
  renderMarkdown(container, markdown);

  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].tag, "ol");
  const items = container.children[0].children.map((li) => li.textContent);
  assert.equal(items.length, 5);
  assert.equal(items[0], "États-Unis");
});
