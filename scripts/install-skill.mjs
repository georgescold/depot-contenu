#!/usr/bin/env node
// Installe le skill Claude Code « depot-contenu » dans ~/.claude/skills/depot-contenu/
// (copie skill/depot-contenu/SKILL.md et cli/depot.mjs). Usage : node scripts/install-skill.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dest = path.join(os.homedir(), ".claude", "skills", "depot-contenu");

const files = [
  [path.join(root, "skill", "depot-contenu", "SKILL.md"), path.join(dest, "SKILL.md")],
  [path.join(root, "cli", "depot.mjs"), path.join(dest, "depot.mjs")],
];

for (const [src] of files) {
  if (!fs.existsSync(src)) {
    console.error(`Fichier source introuvable : ${src}`);
    process.exit(1);
  }
}

fs.mkdirSync(dest, { recursive: true });
for (const [src, dst] of files) {
  fs.copyFileSync(src, dst);
  console.log(`copié : ${path.relative(root, src)} → ${dst}`);
}

const cfg = path.join(os.homedir(), ".depot-contenu.json");
console.log(`\nSkill installé dans ${dest}`);
console.log(`Test : node "${path.join(dest, "depot.mjs")}" me`);
if (!fs.existsSync(cfg)) {
  console.log(
    `\nPas encore de config (${cfg}). Crée une clé dans l'app (Réglages → Clés API) puis :\n` +
      `  node "${path.join(dest, "depot.mjs")}" config --url "https://adresse-de-l-app" --key "dpc_…"`,
  );
}
