import assert from "node:assert/strict";
import test from "node:test";
import { parseGiveawayDuration, selectWinners } from "./giveaways-core.js";

test("duration parser accepts safe giveaway windows", () => {
  assert.equal(parseGiveawayDuration("30m"), 1_800_000);
  assert.equal(parseGiveawayDuration("2h"), 7_200_000);
  assert.equal(parseGiveawayDuration("7D"), 604_800_000);
  assert.equal(parseGiveawayDuration("30d"), 2_592_000_000);
  for (const invalid of ["0m", "31d", "1s", "10minutes", "-2h", "999h", "hi"]) {
    assert.equal(parseGiveawayDuration(invalid), null, invalid);
  }
});

test("draws unique winners only from entrants", () => {
  const participants = ["a", "b", "c", "d", "d"];
  for (let i = 0; i < 50; i++) {
    const winners = selectWinners(participants, 3);
    assert.equal(winners.length, 3);
    assert.equal(new Set(winners).size, 3);
    assert.ok(winners.every(id => participants.includes(id)));
  }
});

test("rerolls never select earlier winners", () => {
  const winners = selectWinners(["a", "b", "c", "d"], 10, ["a", "b"]);
  assert.deepEqual(new Set(winners), new Set(["c", "d"]));
  assert.deepEqual(selectWinners(["a"], 1, ["a"]), []);
});
