// server.js
// Serveur léger pour le développement local et le déploiement Render.
// Sert les fichiers statiques du dossier `public/` et route POST /api/chat vers api/chat.js.

import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chatHandler from "./api/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const INDEX_FILE = path.join(PUBLIC_DIR, "index.html");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

function sendText(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath)
    .then((data) => {
      res.statusCode = 200;
      res.setHeader("Content-Type", type);
      // index.html ne doit jamais être mis en cache (déploiements fréquents).
      res.setHeader("Cache-Control", filePath === INDEX_FILE ? "no-store" : "public, max-age=31536000, immutable");
      res.end(data);
    })
    .catch(() => {
      sendText(res, 404, "Fichier introuvable");
    });
}

function resolvePublicFile(pathname) {
  // Normalise puis vérifie que le chemin reste bien dans public/ (anti path traversal).
  const relative = path.normalize(pathname).replace(/^([/\\])+/, "");
  const target = path.resolve(PUBLIC_DIR, relative);
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) return null;
  if (relative.endsWith(path.sep) || relative === "") return null;
  return target;
}

const server = http.createServer(async (req, res) => {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(req.url || "/", `http://${req.headers.host || "localhost"}`).pathname);
  } catch {
    sendText(res, 400, "Requête invalide");
    return;
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  if (pathname === "/api/chat") {
    await chatHandler(req, res);
    return;
  }

  if (pathname === "/api/health") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, model: process.env.GROQ_MODEL || "default" }));
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    sendFile(res, INDEX_FILE);
    return;
  }

  const filePath = resolvePublicFile(pathname);
  if (filePath) {
    sendFile(res, filePath);
    return;
  }

  sendText(res, 404, "404 — Ressource introuvable");
});

server.listen(PORT, HOST, () => {
  console.log(`Minerva démarré sur http://${HOST}:${PORT}`);
});
