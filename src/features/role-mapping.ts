import { Events, type Client, type GuildMember } from "discord.js";
import { getGuildSettings } from "../storage/settings.js";

const syncing = new Set<string>();

export async function syncRoleMappingsForMember(member: GuildMember): Promise<void> {
  const key = `${member.guild.id}:${member.id}`;
  if (syncing.has(key) || member.user.bot) return;
  syncing.add(key);
  try {
    const settings = await getGuildSettings(member.guild.id);
    const targets = new Map<string, typeof settings.roleMappings>();
    for (const mapping of settings.roleMappings) {
      const list = targets.get(mapping.targetRoleId) ?? [];
      list.push(mapping);
      targets.set(mapping.targetRoleId, list);
    }

    for (const [targetRoleId, mappings] of targets) {
      const shouldHave = mappings.some(mapping => member.roles.cache.has(mapping.triggerRoleId));
      const hasTarget = member.roles.cache.has(targetRoleId);
      if (shouldHave && !hasTarget) {
        await member.roles.add(targetRoleId, "Automatic role mapping").catch(() => undefined);
        continue;
      }
      const shouldRemove = !shouldHave && hasTarget && mappings.some(mapping => mapping.removeWithTrigger);
      if (shouldRemove) await member.roles.remove(targetRoleId, "Automatic role mapping removed").catch(() => undefined);
    }
  } finally {
    syncing.delete(key);
  }
}

export function registerRoleMappings(client: Client): void {
  client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => {
    void syncRoleMappingsForMember(newMember).catch(error => console.error("Role mapping sync failed:", error));
  });
  client.on(Events.GuildMemberAdd, member => {
    void syncRoleMappingsForMember(member).catch(error => console.error("Role mapping join sync failed:", error));
  });
}
