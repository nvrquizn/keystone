import type { BotCommand } from "../lib/command.js";
import { pingCommand } from "./ping.js";
import { helpCommand } from "./help.js";
import { userinfoCommand } from "./userinfo.js";
import { serverinfoCommand } from "./serverinfo.js";
import { rolemembersCommand } from "./rolemembers.js";
import { whohasCommand } from "./whohas.js";
import { remindmeCommand } from "./remindme.js";
import { stickyCommand } from "./sticky.js";
import { embedCommand } from "./embed.js";
import { warnCommand, timeoutCommand, kickCommand, banCommand } from "./moderation.js";
import { notesCommand } from "./notes.js";
import { levelCommand } from "./level.js";
import { setupCommand } from "./setup.js";
import { ticketCommand } from "./ticket.js";
import { automodCommand } from "./automod.js";
import { leaderboardCommand } from "./leaderboard.js";
import { selfRolesCommand } from "./selfroles.js";
import { stopwatchCommand } from "./stopwatch.js";
import { addLevelCommand, removeLevelCommand, addXpCommand, removeXpCommand } from "./leveladmin.js";

export const commands: BotCommand[] = [
  pingCommand,
  helpCommand,
  userinfoCommand,
  serverinfoCommand,
  rolemembersCommand,
  whohasCommand,
  remindmeCommand,
  stickyCommand,
  embedCommand,
  warnCommand,
  timeoutCommand,
  kickCommand,
  banCommand,
  notesCommand,
  levelCommand,
  setupCommand,
  ticketCommand,
  automodCommand,
  leaderboardCommand,
  selfRolesCommand,
  stopwatchCommand,
  addLevelCommand,
  removeLevelCommand,
  addXpCommand,
  removeXpCommand,
];

export const commandMap = new Map(commands.map(command => [command.data.name, command]));
