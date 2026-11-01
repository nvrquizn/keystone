import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";

/**
 * SlashCommandBuilder changes its concrete return type after options/subcommands
 * are added. The bot only needs a command name plus toJSON(), so keep the
 * command-data contract structural instead of requiring one exact builder type.
 */
export type BotCommandData = Pick<SlashCommandBuilder, "name" | "toJSON">;

export interface BotCommand {
  data: BotCommandData;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
