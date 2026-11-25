# ForumGuard — FERAL Game Ideas

An advisory forum moderation feature for Keystone. Disabled until explicitly configured. It never automatically warns, times out, locks, archives, or deletes member content.

## Configure

Run as a Discord server administrator after deploying slash commands:

- /forumguard enable forum:#game-ideas logs:#staff-review
- /forumguard status
- /forumguard disable

The selected log channel must be hidden from @everyone. The optional remind flag controls whether Keystone posts a polite link to a similar existing suggestion. It defaults to **off**.

The command configures *monitoring*, not Discord role access. Set Tier 2+ access using Discord's forum permissions. Existing ContentGuard and AutoMod rules remain independent of ForumGuard.

## Detects

- Titles matching other **active** posts in the configured forum, using conservative word overlap. Matching titles are not proof of duplicated proposals.
- Four or more new suggestions from the same author within six hours.
- Four or more bump-only replies in one hour from the same author within one post.

All detections are informational. Staff should examine intent, content, context, history and previous redirection before taking action. Discussion, disagreement, criticism and proposing tougher game rules are not punishable by themselves.

ForumGuard stores the active forum/log channel identifiers and its enable/disable settings in Keystone's existing persistent settings.json. It stores only temporary timestamps for rate checks in RAM; the timestamps reset on restart. Staff notifications remain in the configured Discord log channel.

## Limitations and testing

- Scans active titles only; not archived historical threads or the old staff-only archive.
- Does not automatically enforce required tags or Tier 2 eligibility.
- Does not have staff resolution buttons yet.
- Thresholds are initial operational defaults; review whether they are appropriate before enabling for members.
- Confirm Keystone can view the forum and send staff alerts; for public duplicate reminders it needs to send messages in forum threads.
- Do not merge before running npm run check and a bot test in a private test forum.
- Run unit tests with Node 22+ using: node --experimental-strip-types --test test/forumguard-core.test.mjs
- Tests cover pure core logic, not Discord event permissions or API behavior.

This feature is designed to preserve developer feedback and reduce the repetitive workload imposed on FERAL staff.
