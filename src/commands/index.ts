import { contentGuardCommand } from "./contentguard.js";
import { slowmodeCommand } from "./slowmode.js";
import { forumGuardCommand } from "./forumguard.js";
import { lfgCommand } from "./lfg.js";
import { syncTiersCommand } from "./sync-tiers.js";
import { giveawayCommand } from "./giveaway.js";
import { lockdownCommand, unlockdownCommand } from "./lockdown.js";
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

import {
  warnCommand,
  unwarnCommand,
  timeoutCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  softbanCommand,
  dmCommand,
  purgeCommand,
} from "./moderation.js";

import { warningsCommand } from "./warnings.js";
import { ticketAddCommand } from "./ticketadd.js";
import { notesCommand } from "./notes.js";
import { levelCommand } from "./level.js";
import { setupCommand } from "./setup.js";
import { ticketCommand } from "./ticket.js";
import { automodCommand } from "./automod.js";
import { leaderboardCommand } from "./leaderboard.js";
import { selfRolesCommand } from "./selfroles.js";
import { stopwatchCommand } from "./stopwatch.js";
import { tiersCommand } from "./tiers.js";
import {
  addLevelCommand,
  removeLevelCommand,
  addXpCommand,
  removeXpCommand,
} from "./leveladmin.js";

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
  unwarnCommand,
  timeoutCommand,
  kickCommand,
  banCommand,
  unbanCommand,
  softbanCommand,
  dmCommand,
  purgeCommand,

  warningsCommand,
  ticketAddCommand,
  notesCommand,
  levelCommand,
  tiersCommand,
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
  lockdownCommand,
  unlockdownCommand,
  contentGuardCommand,
  slowmodeCommand,
  forumGuardCommand,
  lfgCommand,
  syncTiersCommand,
  giveawayCommand,
];

export const commandMap = new Map(
  commands.map(command => [command.data.name, command]),
);
