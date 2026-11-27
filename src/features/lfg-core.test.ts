import assert from "node:assert/strict";
import test from "node:test";
import { lfgThreadName } from "./lfg-core.js";

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
