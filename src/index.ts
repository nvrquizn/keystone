import { registerContentGuard } from "./commands/contentguard.js";
import { registerLockdownRecovery } from "./commands/lockdown.js";
import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
  Routes,
} from "discord.js";
import { commandMap, commands } from "./commands/index.js";
import { config } from "./config.js";
import { registerStickyEvents } from "./features/stickies.js";
import { registerReminderWorker } from "./features/reminders.js";
import { registerLeveling } from "./features/leveling.js";
import { registerTicketInteractions } from "./features/tickets.js";
import { registerAutomod } from "./features/automod.js";
import { registerForumGuard } from "./features/forumguard.js";
import { registerLfgThreads } from "./features/lfg.js";
import { registerGiveaways } from "./features/giveaways.js";
import { registerLogEvents } from "./events/logs.js";
import { registerInviteTracking } from "./events/invites.js";
import { registerSelfRoleInteractions } from "./features/selfroles.js";
import { registerRoleMappings } from "./features/role-mapping.js";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});
registerStickyEvents(client);
registerLeveling(client);
registerTicketInteractions(client);
registerAutomod(client);
registerForumGuard(client);
registerLfgThreads(client);
registerGiveaways(client);
registerLogEvents(client);
registerInviteTracking(client);
registerSelfRoleInteractions(client);
registerRoleMappings(client);
registerReminderWorker(client);

client.once(Events.ClientReady, readyClient => {
  readyClient.user.setActivity("FERAL", { type: ActivityType.Watching });
  console.log(`Keystone online as ${readyClient.user.tag}.`);
  void (async () => {
    try {
      const guild = await readyClient.guilds.fetch(config.GUILD_ID);
      const existing = await guild.commands.fetch();
      const expected = commands.map(command => command.data.toJSON());
      const missing = expected.filter(command => !existing.some(registered => registered.name === command.name));
      console.log(`[commands] Guild ${guild.id}: ${existing.size} registered; missing: ${missing.map(command => command.name).join(", ") || "none"}.`);
      // Update the same guild command registry managed by commands:deploy.ts.
      // This also synchronizes permission metadata after permission changes.
      const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);
      await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, guild.id), { body: expected });
      const after = await guild.commands.fetch();
      console.log(`[commands] Discord confirmed ${after.size} guild commands; forumguard: ${after.some(c => c.name === "forumguard") ? "registered" : "MISSING"}.`);
    } catch (error) {
      console.error("[commands] Guild slash-command registration failed:", error);
    }
  })();
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.isAutocomplete()) {
    const command = commandMap.get(interaction.commandName);
    if (!command?.autocomplete) return;
    try {
      await command.autocomplete(interaction);
    } catch (error) {
      console.error(`Autocomplete failed: ${interaction.commandName}`, error);
      if (!interaction.responded) await interaction.respond([]);
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: "Command not found.", flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Command failed: ${interaction.commandName}`, error);
    const response = { content: "Something went wrong while running that command.", flags: MessageFlags.Ephemeral } as const;
    if (interaction.replied || interaction.deferred) await interaction.followUp(response);
    else await interaction.reply(response);
  }
});

client.on(Events.Error, error => console.error("Discord client error:", error));
await registerLockdownRecovery(client);
registerContentGuard(client);
client.login(config.DISCORD_TOKEN);
