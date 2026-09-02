// server.js
// Serveur léger pour le développement local et le déploiement Render.
// Sert les fichiers statiques du frontend et route POST /api/chat vers api/chat.js.

import "dotenv/config";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chatHandler from "./api/chat.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const HOST = "0.0.0.0";
const INDEX_FILE = path.join(__dirname, "index.html");

const PUBLIC_FILES = new Set([
  "/index.html",
  "/style.css",
  "/script.js",
  "/assets/logo.svg",
  "/assets/og-image.png"
]);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
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
      res.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable");
      res.end(data);
    })
    .catch(() => {
      sendText(res, 404, "Fichier introuvable");
    });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/api/chat") {
    await chatHandler(req, res);
    return;
  }

  if (pathname === "/") {
    sendFile(res, INDEX_FILE);
    return;
  }

  if (PUBLIC_FILES.has(pathname)) {
    sendFile(res, path.join(__dirname, pathname.replace(/^\//, "")));
    return;
  }

  sendText(res, 404, "404 — Ressource introuvable");});

server.listen(PORT, HOST, () => {
  console.log(`Minerva démarré sur http://${HOST}:${PORT}`);
});
