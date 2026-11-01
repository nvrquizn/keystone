import {
  ActionRowBuilder,
  EmbedBuilder,
  Events,
  StringSelectMenuBuilder,
  type Client,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { getGuildSettings } from "../storage/settings.js";

export const SELFROLE_MENU_ID = "keystone:selfroles";

export async function buildSelfRolePanel(guild: Guild): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<StringSelectMenuBuilder>[] }> {
  const settings = await getGuildSettings(guild.id);
  const roles = settings.selfRoles
    .map(id => guild.roles.cache.get(id))
    .filter((role): role is NonNullable<typeof role> => Boolean(role))
    .slice(0, 25);

  const embed = new EmbedBuilder()
    .setColor(0x8297ab)
    .setTitle("Self Roles")
    .setDescription(roles.length ? "Select the roles you want. Submitting the menu updates your self roles to match your selection." : "No self roles are configured yet.");

  if (!roles.length) return { embeds: [embed], components: [] };

  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELFROLE_MENU_ID)
    .setPlaceholder("Choose your roles")
    .setMinValues(0)
    .setMaxValues(roles.length)
    .addOptions(roles.map(role => ({ label: role.name.slice(0, 100), value: role.id })));

  return { embeds: [embed], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

export async function postSelfRolePanel(channel: TextChannel): Promise<void> {
  const panel = await buildSelfRolePanel(channel.guild);
  await channel.send(panel);
}

export function registerSelfRoleInteractions(client: Client): void {
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isStringSelectMenu() || interaction.customId !== SELFROLE_MENU_ID || !interaction.inCachedGuild()) return;
    const member = interaction.member as GuildMember;
    const settings = await getGuildSettings(interaction.guild.id);
    const configured = new Set(settings.selfRoles);
    const selected = new Set(interaction.values.filter(id => configured.has(id)));

    const add = [...selected].filter(id => !member.roles.cache.has(id));
    const remove = [...configured].filter(id => member.roles.cache.has(id) && !selected.has(id));

    for (const id of add) await member.roles.add(id, "Self role selection").catch(() => undefined);
    for (const id of remove) await member.roles.remove(id, "Self role selection").catch(() => undefined);

    await interaction.reply({ content: "Your self roles have been updated.", ephemeral: true });
  });
}
