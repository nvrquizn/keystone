import assert from "node:assert/strict";
import test from "node:test";
import { isLfgRecruitment, lfgThreadName } from "./lfg-core.js";

test("LFG thread names use the animal when a template starts with Animal:", () => {
  assert.equal(lfgThreadName("**Animal:** Snow Leopard\n**Playstyle:** Casual", "User"), "LFG • Snow Leopard");
});

test("LFG thread names use the first message line", () => {
  assert.equal(lfgThreadName("Anyone want to play cougar?\nI can host", "User"), "LFG • Anyone want to play cougar?");
});

test("LFG thread names remove raw mentions and use fallback for attachments", () => {
  assert.equal(lfgThreadName("", "Member"), "LFG • Member");
  assert.equal(lfgThreadName("@everyone", "Member"), "LFG • Member");
  assert.equal(lfgThreadName("<@1234567890> let's play", "Member"), "LFG • let's play");
});

test("LFG thread titles never exceed Discord's 100-character limit", () => {
  const name = lfgThreadName("animal: " + "A".repeat(180), "Member");
  assert.ok(name.length <= 100);
  assert.ok(name.startsWith("LFG • A"));
});

test("LFG accepts structured recruitment and explicit invitations", () => {
  for (const message of [
    "Animal: Snow Leopard\nPlayers Needed: 3\nServer: Public",
    "**Animal:** Harpy Eagle\n**Playstyle:** Casual",
    "Anyone wanna play snow leopard?",
    "Anyone want to join my pack?",
    "Looking for a group to survive with!",
    "LFG cougar group, need 2",
    "Need 3 players for our private server",
    "Join my group, looking for snow leopards",
  ]) {
    assert.equal(isLfgRecruitment(message), true, message);
  }
});

test("LFG rejects general chat and questions about channel rules", () => {
  for (const message of [
    "wut is this",
    "hi guys",
    "what is this channel?",
    "why don't we have more animals?",
    "I love snow leopard",
    "What does LFG mean?",
    "LFG what is this?",
    "LFG rules?",
    "Please stop spamming LFG",
    "Animal: Snow Leopard",
    "Playstyle: Casual",
    "lol",
    "",
  ]) {
    assert.equal(isLfgRecruitment(message), false, message);
  }
});
