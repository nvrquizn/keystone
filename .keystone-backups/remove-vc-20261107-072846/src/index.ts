import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
} from "discord.js";
import { commandMap } from "./commands/index.js";
import { config } from "./config.js";
import { registerStickyEvents } from "./features/stickies.js";
import { registerReminderWorker } from "./features/reminders.js";
import { registerLeveling } from "./features/leveling.js";
import { registerTicketInteractions } from "./features/tickets.js";
import { registerAutomod } from "./features/automod.js";
import { registerLogEvents } from "./events/logs.js";
import { registerInviteTracking } from "./events/invites.js";
import { registerSelfRoleInteractions } from "./features/selfroles.js";
import { registerRoleMappings } from "./features/role-mapping.js";
import { registerVoiceTranscripts } from "./voice-transcripts/runtime.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User],
});

registerVoiceTranscripts(client);

registerStickyEvents(client);
registerLeveling(client);
registerTicketInteractions(client);
registerAutomod(client);
registerLogEvents(client);
registerInviteTracking(client);
registerSelfRoleInteractions(client);
registerRoleMappings(client);
registerReminderWorker(client);

client.once(Events.ClientReady, readyClient => {
  readyClient.user.setActivity("FERAL", { type: ActivityType.Watching });
  console.log(`Keystone online as ${readyClient.user.tag}.`);
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
await client.login(config.DISCORD_TOKEN);
