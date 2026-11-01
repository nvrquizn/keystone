# FERAL Bot — Keystone v0.3.1

A neutral, utility-first Discord bot for the FERAL community. This project uses the same general stack and modular approach as Grey Ghost, but removes ASOIAF/lore systems, suggestion management, tester-specific tools, and custom welcome messages.

## Included

- Moderation: `/warn`, `/timeout`, `/kick`, `/ban`
- Private staff notes: `/notes add|list|remove`
- Basic custom automod: blocked terms + message-rate spam protection
- Tickets: configurable category/staff role, panel button, close button, text transcript logging
- Leveling: text XP, reaction XP, voice XP, configurable tier roles, `/level view`, `/level list`, and `/leaderboard`
- Media gating: `/setup media` restricts attachments/embeds/external emoji/stickers until a configured level tier
- Sticky messages: `/sticky set|remove|show`
- Custom embeds: `/embed`
- Logs: join/leave, role changes, reactions, moderation, tickets, invite usage
- Invite tracking
- Reminders: `/remindme`
- Stopwatch: `/stopwatch start|pause|resume|lap|status|stop|reset`
- Utilities: `/userinfo`, `/serverinfo`, `/rolemembers`, `/whohas`, `/ping`, `/help`
- Self-role select panels and automatic role-to-role mappings
- JSON persistence designed for a Railway volume at `/app/data`

## Intentionally not included

- ASOIAF/lore/quiz/collection systems
- Suggestion-management systems
- Tester-specific tools
- Custom welcome messages
- Cringey/character-style bot dialogue; responses are intentionally neutral
- Roblox verification; use Bloxlink for that

## Setup

1. Create a Discord bot application and invite it with the permissions/features you intend to use.
2. Copy `.env.example` to `.env` and fill in:
   - `DISCORD_TOKEN`
   - `CLIENT_ID`
   - `GUILD_ID`
   - `DATA_DIR` (use `/app/data` on Railway with a persistent volume)
3. Install dependencies:
   ```bash
   npm install
   ```
4. Deploy guild slash commands:
   ```bash
   npm run commands:deploy
   ```
5. Type-check and build:
   ```bash
   npm run check
   npm run build
   ```
6. Start:
   ```bash
   npm start
   ```

## Initial server configuration

Recommended order:

1. `/setup log` for moderation, tickets, joinLeave, roles, reactions, and/or a general fallback log channel.
2. `/setup tickets` with the ticket category and staff role.
3. `/ticket panel` in the public ticket-opening channel.
4. `/setup leveling enabled:true`.
5. Add each configured tier with `/setup tier` (for example Tier 1 — Ant through Tier 5 — Tiger).
6. `/setup media` on channels such as `media` to set the level at which attachments/GIF-like embeds/external emoji/stickers unlock.
7. `/automod enabled:true` and configure any custom blocked terms/spam threshold you actually want.
8. Add stickies and embeds only where useful.

## Permission note

The bot needs to sit above any tier roles it automatically assigns. For tickets, moderation actions, and channel permission changes, it also needs the corresponding Discord permissions. Avoid giving the bot Administrator unless you deliberately want it to have unrestricted server access.

## Persistence

All runtime data is stored as JSON under `DATA_DIR`:

- `settings.json`
- `levels.json`
- `stickies.json`
- `modnotes.json`
- `reminders.json`
- `stopwatches.json`

On Railway, mount a persistent volume at `/app/data` and set `DATA_DIR=/app/data` so restarts/deploys do not erase state.

## Expanded event logging (v0.2.0)

Keystone deliberately does **not** log ordinary message sends. It can log practically every other useful server change, including:

- message edits, deletes, bulk deletes, attachments on deleted messages, and possible ghost pings
- member joins/leaves, role changes, nickname changes, server-avatar changes, timeouts, and boost state
- global username/display-name/avatar changes for server members
- channel/category/forum/voice-channel creation, deletion, metadata changes, permission overwrite changes, and pin changes
- role creation/deletion, role permissions, name/color/position/mentionability changes
- voice joins/leaves/moves, mute/deafen, streaming, and camera state
- server settings, bans/unbans, emoji/sticker/webhook changes, scheduled events
- threads, reactions, invite creation/deletion/use
- existing moderation and ticket logs

Configure destinations with `/setup log`. Log types are: `general`, `moderation`, `tickets`, `joinLeave`, `messages`, `members`, `channels`, `roles`, `voice`, `server`, `reactions`, and `invites`.

Any log type without its own configured channel falls back to the `general` log channel.

## Leveling rules (v0.3.0)

- **Text:** 8–15 XP per eligible message. Message XP uses a rolling 60-second bucket capped at **45 XP**, so up to three 15-XP messages can count inside one minute. Exact duplicate/reposted content within 30 minutes earns nothing, and obvious repeated-character/repeated-word spam earns nothing.
- **Reactions:** 2 XP to the person adding the reaction. There is **no daily reaction-XP cap**. A member can still only earn reaction XP once per message, cannot earn it from their own message or bot messages, and has a 30-second cooldown to prevent rapid farming. Removing and re-adding the same reaction does not award XP again.
- **Voice:** 10 XP per 5 eligible minutes. At least two non-bot members must be in the voice channel; AFK-channel users and deafened users do not earn voice XP.
- **Progression:** XP needed for the next level is `3 × level² + 35 × level + 80`. Lower tier roles are retained as higher tier roles are earned.
- **Weekly XP:** Keystone tracks XP earned during the current Monday-based UTC week for the weekly leaderboard.

`/leaderboard` supports **Weekly XP**, **Total XP**, and **Highest Level** views. `/level list` shows each configured tier role and its required level.


## Level-up announcement channel
Configure the channel Keystone should use for level-up pings with `/setup level-channel`. Level-ups earned from messages, reactions, or eligible voice activity all use this channel.

Reaction XP awards 2 XP to the member who adds the reaction, subject to the anti-farming limits described above. Keystone logs reaction XP errors to the console if a reaction cannot be processed.

### Testing reaction XP
Reaction XP is awarded to the member who adds a reaction. Test with a fresh reaction on another human member's message that is less than 7 days old. Wait 30 seconds between eligible reaction-XP awards. Self-reactions and reactions to bot-authored messages do not grant XP.


## Ticket workflow (v0.2.3)
- Tickets are named `ticket-0001-username`, `ticket-0002-username`, etc.
- The opening ticket message includes **Close** and **Owner Only** buttons.
- Owner Only can be enabled by the ticket opener and restricts the channel to the opener + server owner.
- Closing a ticket no longer deletes it. It is renamed to `closed-...`, the opener is locked from sending, and Keystone posts who closed it.
- Closed tickets get **Delete** and **Transcript** buttons.
- Transcript downloads up to 1,000 recent messages into a text file.
- Deleting a ticket is staff-only and also attempts to archive the transcript to the configured ticket log channel first.


## Self roles and role mappings (v0.3.0)

- Add self-assignable roles with `/setup selfrole-add` and remove them with `/setup selfrole-remove`.
- Post the select-menu panel with `/selfroles panel`. The panel supports up to 25 configured roles.
- Create automatic role mappings with `/setup role-map trigger:<role> target:<role>`. By default, the target role is also removed when the trigger role is removed.
- Remove a mapping with `/setup role-unmap`.

Example: map a Bloxlink/verification role to FERAL's `Verified` role so Keystone maintains it automatically.


## Stopwatch (v0.3.1)

`/stopwatch` provides a personal persistent stopwatch for each member.

- `start` starts a new stopwatch.
- `pause` pauses without clearing elapsed time.
- `resume` continues a paused stopwatch.
- `lap` records the current elapsed time; up to 50 laps are stored.
- `status` shows the current state and up to the 10 most recent laps.
- `stop` freezes the final time while retaining the result.
- `reset` clears the stopwatch and laps.
- Stopwatch state is stored in `stopwatches.json`, so a running stopwatch continues to measure elapsed real time across Keystone restarts.
- Command replies are ephemeral to avoid cluttering public channels.

## v0.3.2
Staff leveling controls added:
- `/add-level user amount`
- `/remove-level user amount`
- `/add-xp user amount`
- `/remove-xp user amount`

These commands recalculate the member's level, synchronize configured tier roles, and log the adjustment to the moderation log. Level adjustments preserve the member's existing progress within their current level where possible.
