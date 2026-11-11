import fs from "node:fs";

const schemaPath = "src/storage/schema.ts";
const setupPath = "src/commands/setup.ts";
const indexPath = "src/commands/index.ts";
const tiersPath = "src/commands/tiers.ts";

for (const file of [schemaPath, setupPath, indexPath]) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}`);
    process.exit(1);
  }
}

for (const file of [schemaPath, setupPath, indexPath]) {
  const backup = `${file}.bak-before-tiers-command`;
  if (!fs.existsSync(backup)) {
    fs.copyFileSync(file, backup);
  }
}

/* ---------------- schema.ts ---------------- */

let schema = fs.readFileSync(schemaPath, "utf8");

if (!schema.includes("unlocks?: string;")) {
  schema = schema.replace(
`export interface LevelTier {
  level: number;
  roleId: string;
  name: string;
}`,
`export interface LevelTier {
  level: number;
  roleId: string;
  name: string;
  unlocks?: string;
}`
  );
}

fs.writeFileSync(schemaPath, schema, "utf8");

/* ---------------- setup.ts ---------------- */

let setup = fs.readFileSync(setupPath, "utf8");

if (!setup.includes('setName("unlocks")')) {
  setup = setup.replace(
`.addStringOption(o => o.setName("name").setDescription("Display name, e.g. T3 — Fox").setRequired(true).setMaxLength(100)))`,
`.addStringOption(o => o.setName("name").setDescription("Display name, e.g. T3 — Fox").setRequired(true).setMaxLength(100))
        .addStringOption(o => o.setName("unlocks").setDescription("What this tier unlocks").setRequired(false).setMaxLength(1000)))`
  );
}

if (!setup.includes('const unlocks = interaction.options.getString("unlocks")')) {
  setup = setup.replace(
`const name = interaction.options.getString("name", true);

      await updateGuildSettings(interaction.guild.id, s => {
        s.leveling.tiers = s.leveling.tiers.filter(t => t.level !== level && t.roleId !== role.id);
        s.leveling.tiers.push({ level, roleId: role.id, name });`,
`const name = interaction.options.getString("name", true);
      const unlocks = interaction.options.getString("unlocks");

      await updateGuildSettings(interaction.guild.id, s => {
        const existing = s.leveling.tiers.find(t => t.level === level || t.roleId === role.id);

        s.leveling.tiers = s.leveling.tiers.filter(
          t => t.level !== level && t.roleId !== role.id
        );

        s.leveling.tiers.push({
          level,
          roleId: role.id,
          name,
          unlocks: unlocks ?? existing?.unlocks,
        });`
  );
}

fs.writeFileSync(setupPath, setup, "utf8");

/* ---------------- tiers.ts ---------------- */

fs.writeFileSync(
  tiersPath,
`import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { BotCommand } from "../lib/command.js";
import { getGuildSettings } from "../storage/settings.js";

export const tiersCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName("tiers")
    .setDescription("View FERAL leveling tiers and their unlocks."),

  async execute(interaction) {
    if (!interaction.inCachedGuild()) {
      return void await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
    }

    const settings = await getGuildSettings(interaction.guild.id);

    const tiers = [...settings.leveling.tiers].sort(
      (a, b) => a.level - b.level,
    );

    const embed = new EmbedBuilder()
      .setColor(0x8297ab)
      .setTitle("FERAL Leveling Tiers");

    if (!tiers.length) {
      embed.setDescription("No leveling tiers have been configured yet.");

      await interaction.reply({
        embeds: [embed],
      });

      return;
    }

    embed.setDescription(
      "Earn XP by being active in the server. Higher tiers unlock additional perks and access.",
    );

    for (const tier of tiers) {
      const role = interaction.guild.roles.cache.get(tier.roleId);

      const roleText = role
        ? \`<@&\${tier.roleId}>\`
        : \`**\${tier.name}**\`;

      const unlockText =
        tier.unlocks?.trim() ||
        "No additional unlocks have been listed for this tier yet.";

      embed.addFields({
        name: \`\${tier.name} — Level \${tier.level}\`,
        value:
          \`\${roleText}\\n\` +
          \`**Unlocks:**\\n\${unlockText}\`,
      });
    }

    await interaction.reply({
      embeds: [embed],
      allowedMentions: { roles: [] },
    });
  },
};
`,
  "utf8",
);

/* ---------------- command registry ---------------- */

let index = fs.readFileSync(indexPath, "utf8");

if (!index.includes('from "./tiers.js"')) {
  const importMatches = [...index.matchAll(/^import .*;$/gm)];

  if (!importMatches.length) {
    console.error("Could not locate command imports in src/commands/index.ts");
    process.exit(1);
  }

  const last = importMatches.at(-1);
  const insertAt = last.index + last[0].length;

  index =
    index.slice(0, insertAt) +
    `\nimport { tiersCommand } from "./tiers.js";` +
    index.slice(insertAt);
}

if (!/\btiersCommand\s*,/.test(index)) {
  const levelRegistration = index.match(/^(\s*)levelCommand,\s*$/m);

  if (!levelRegistration || levelRegistration.index == null) {
    console.error(
      "Created /tiers, but could not find levelCommand in the command registry."
    );
    console.error(
      "Send ChatGPT src/commands/index.ts and it can be added manually."
    );
    process.exit(1);
  }

  const lineEnd = index.indexOf("\n", levelRegistration.index);
  const insertionPoint = lineEnd === -1 ? index.length : lineEnd + 1;

  index =
    index.slice(0, insertionPoint) +
    `${levelRegistration[1]}tiersCommand,\n` +
    index.slice(insertionPoint);
}

fs.writeFileSync(indexPath, index, "utf8");

console.log("Installed /tiers successfully.");
console.log("Updated:");
console.log("  src/storage/schema.ts");
console.log("  src/commands/setup.ts");
console.log("  src/commands/tiers.ts");
console.log("  src/commands/index.ts");
console.log("");
console.log("Next:");
console.log("  npm run check");
console.log("  npm run build");
console.log("  npm run commands:deploy");
