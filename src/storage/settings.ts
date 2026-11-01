import { readJson, updateJson } from "./json-store.js";
import { DEFAULT_GUILD_SETTINGS, DEFAULT_SETTINGS, type GuildSettings, type SettingsFile } from "./schema.js";

function normalizeGuildSettings(settings?: Partial<GuildSettings>): GuildSettings {
  return {
    ...structuredClone(DEFAULT_GUILD_SETTINGS),
    ...(settings ?? {}),
    logs: { ...(settings?.logs ?? {}) },
    tickets: {
      ...structuredClone(DEFAULT_GUILD_SETTINGS.tickets),
      ...(settings?.tickets ?? {}),
      staffRoleIds: [...(settings?.tickets?.staffRoleIds ?? [])],
    },
    leveling: {
      ...structuredClone(DEFAULT_GUILD_SETTINGS.leveling),
      ...(settings?.leveling ?? {}),
      tiers: [...(settings?.leveling?.tiers ?? [])],
    },
    media: { ...(settings?.media ?? {}) },
    selfRoles: [...(settings?.selfRoles ?? [])],
    roleMappings: [...(settings?.roleMappings ?? [])],
    automod: {
      ...structuredClone(DEFAULT_GUILD_SETTINGS.automod),
      ...(settings?.automod ?? {}),
      blockedTerms: [...(settings?.automod?.blockedTerms ?? [])],
    },
  };
}

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
  const file = await readJson<SettingsFile>("settings", DEFAULT_SETTINGS);
  return normalizeGuildSettings(file.guilds[guildId]);
}

export async function updateGuildSettings(guildId: string, mutate: (settings: GuildSettings) => void | Promise<void>): Promise<GuildSettings> {
  const file = await updateJson<SettingsFile>("settings", DEFAULT_SETTINGS, async data => {
    data.guilds[guildId] = normalizeGuildSettings(data.guilds[guildId]);
    await mutate(data.guilds[guildId]!);
  });
  return normalizeGuildSettings(file.guilds[guildId]);
}
