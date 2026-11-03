import fs from "node:fs";
import path from "node:path";

const target = path.resolve("src/commands/index.ts");

if (!fs.existsSync(target)) {
  console.error("Could not find src/commands/index.ts. Run this from the main feral-bot folder.");
  process.exit(1);
}

let source = fs.readFileSync(target, "utf8");
const original = source;

const backup = `${target}.bak-before-moderation-registry`;
if (!fs.existsSync(backup)) {
  fs.writeFileSync(backup, original, "utf8");
  console.log(`Backup created: ${path.relative(process.cwd(), backup)}`);
}

const moderationImportRe =
  /import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/moderation\.js["'];?/m;

const match = source.match(moderationImportRe);

if (!match) {
  console.error('Could not find an import from "./moderation.js" in src/commands/index.ts.');
  console.error("Please send ChatGPT that file so it can be patched manually.");
  process.exit(1);
}

const existingImports = match[1]
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

const requiredModerationImports = [
  "warnCommand",
  "unwarnCommand",
  "timeoutCommand",
  "kickCommand",
  "banCommand",
  "unbanCommand",
  "softbanCommand",
  "dmCommand",
];

// If another file already owns purgeCommand (for example channel-moderation.ts),
// keep that one so Discord does not receive two commands named /purge.
const sourceWithoutModerationImport = source.replace(moderationImportRe, "");
const purgeAlreadyImportedElsewhere =
  /\bimport\s*\{[\s\S]*?\bpurgeCommand\b[\s\S]*?\}\s*from\s*["'][^"']+["']/m.test(
    sourceWithoutModerationImport,
  );

if (!purgeAlreadyImportedElsewhere) {
  requiredModerationImports.push("purgeCommand");
}

const mergedImports = [];
for (const name of [...existingImports, ...requiredModerationImports]) {
  if (!mergedImports.includes(name)) mergedImports.push(name);
}

const newImport =
  `import {\n` +
  mergedImports.map(name => `  ${name},`).join("\n") +
  `\n} from "./moderation.js";`;

source = source.replace(moderationImportRe, newImport);

// Find the command registration occurrence AFTER the imports.
// We anchor on banCommand because it is one of the original registered commands.
const importEnd = source.indexOf(newImport) + newImport.length;
const rest = source.slice(importEnd);

const banRegistrationRe = /\bbanCommand\s*,/;
const banMatch = rest.match(banRegistrationRe);

if (!banMatch || banMatch.index == null) {
  console.error("Updated the moderation import, but could not locate banCommand in the command registry.");
  console.error("Your backup is untouched. Please send ChatGPT src/commands/index.ts.");
  process.exit(1);
}

const absoluteBanStart = importEnd + banMatch.index;
const banLineEnd = source.indexOf("\n", absoluteBanStart);
const insertionPoint = banLineEnd === -1 ? source.length : banLineEnd + 1;

// Only add commands that are not already registered after the imports.
const registryRegion = source.slice(importEnd);
const commandsToRegister = [
  "unwarnCommand",
  "unbanCommand",
  "softbanCommand",
  "dmCommand",
];

if (!purgeAlreadyImportedElsewhere) {
  commandsToRegister.push("purgeCommand");
}

const missing = commandsToRegister.filter(
  name => !new RegExp(`\\b${name}\\s*,`).test(registryRegion),
);

if (missing.length) {
  // Preserve indentation of the banCommand registry line.
  const lineStart = source.lastIndexOf("\n", absoluteBanStart) + 1;
  const banLine = source.slice(lineStart, banLineEnd === -1 ? source.length : banLineEnd);
  const indent = banLine.match(/^\s*/)?.[0] ?? "  ";

  const insertion = missing.map(name => `${indent}${name},\n`).join("");
  source = source.slice(0, insertionPoint) + insertion + source.slice(insertionPoint);
}

if (source === original) {
  console.log("No changes were needed; the new moderation commands already appear to be registered.");
  process.exit(0);
}

fs.writeFileSync(target, source, "utf8");

console.log("Patched src/commands/index.ts successfully.");
console.log(
  purgeAlreadyImportedElsewhere
    ? "Existing purgeCommand detected elsewhere; it was kept to avoid a duplicate /purge."
    : "Registered purgeCommand from moderation.ts.",
);
console.log("Registered: /unwarn, /unban, /softban, /dm");
console.log("Existing /warn, /timeout, /kick, and /ban remain registered.");
console.log("\nNext run:");
console.log("  npm run check");
console.log("  npm run build");
console.log("  npm run commands:deploy");
