#!/usr/bin/env node
// Installe (ou met à jour) le skill Claude Code « depot-contenu » dans ~/.claude/skills/depot-contenu/ :
//   skill/depot-contenu/SKILL.md → SKILL.md
//   cli/depot.mjs                → depot.mjs
//   docs/API.md                  → reference.md
// Ne touche jamais à ~/.depot-contenu.json (la config et la clé de l'utilisateur).
// Usage : node scripts/install-skill.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`Node.js ${process.versions.node} détecté : il faut Node 20 ou plus récent (https://nodejs.org).`);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(os.homedir(), ".claude", "skills", "depot-contenu");
const files = [
  [path.join(root, "skill", "depot-contenu", "SKILL.md"), "SKILL.md"],
  [path.join(root, "cli", "depot.mjs"), "depot.mjs"],
  [path.join(root, "docs", "API.md"), "reference.md"],
];

const versionOf = (file) => {
  try {
    return fs.readFileSync(file, "utf8").match(/const VERSION = "([^"]+)"/)?.[1] ?? "inconnue (ancienne)";
  } catch {
    return null;
  }
};

for (const [src] of files) {
  if (!fs.existsSync(src)) {
    console.error(`Fichier source introuvable : ${src}`);
    process.exit(1);
  }
}

const before = versionOf(path.join(dest, "depot.mjs"));
const after = versionOf(path.join(root, "cli", "depot.mjs"));

fs.mkdirSync(dest, { recursive: true });
for (const [src, name] of files) {
  fs.copyFileSync(src, path.join(dest, name));
  console.log(`copié : ${path.relative(root, src)} → ${path.join(dest, name)}`);
}

const cli = path.join(dest, "depot.mjs").replace(/\\/g, "/");
console.log(`\nSkill installé dans ${dest}`);
console.log(before ? `Version du CLI : ${before} → ${after}` : `Version du CLI : ${after} (première installation)`);
console.log(`Test : node "${cli}" me`);

const cfg = path.join(os.homedir(), ".depot-contenu.json");
if (!fs.existsSync(cfg)) {
  console.log(
    `\nPas encore de config (${cfg}). Crée une clé dans l'app (Réglages → Clés API) puis :\n` +
      `  node "${cli}" config --url "https://adresse-de-l-app" --key -`,
  );
}
