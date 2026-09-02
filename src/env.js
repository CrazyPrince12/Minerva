// env.js
// Chargement des variables d'environnement, côté serveur uniquement.
//
// Ordre de priorité :
//   1. Variables déjà définies dans l'environnement (Vercel, Render, shell)
//   2. `.env.local`  → fichier NON commité (ignoré par git), idéal pour les vraies clés
//   3. `.env`        → fichier commité, sert de base/documentation
//
// dotenv n'écrase jamais une variable déjà définie : `.env.local` gagne donc
// sur `.env`, et l'environnement d'hébergement gagne sur les deux.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

config({ path: path.join(ROOT_DIR, ".env.local"), quiet: true });
config({ path: path.join(ROOT_DIR, ".env"), quiet: true });

export const ENV_ROOT_DIR = ROOT_DIR;
