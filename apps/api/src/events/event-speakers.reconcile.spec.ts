import { describe, expect, it } from "vitest";
import {
  planSpeakerReconcile,
  type DesiredSpeaker,
} from "./event-speakers.reconcile.js";

// #1278 (ADR-0003 design §3.6) — the matching rules of the speaker-list
// reconcile that replaced the wholesale delete-then-insert. The plan is pure
// data, so every rule is asserted here without a database; the physical
// behaviour it produces (retired rows surviving, a position being reused) is
// covered by the 007 EARS-2 edit e2e and `test/db/retained-row-lifecycle`.
describe("#1278 speaker-list reconcile plan", () => {
  const row = (
    id: string,
    position: number,
    name: string,
    recordStatus: "active" | "retired" = "active",
  ) => ({ id, position, name, recordStatus });

  const want = (
    position: number,
    name: string,
    regalia = "",
  ): DesiredSpeaker => ({
    position,
    name,
    regalia,
  });

  it("#1278: an unchanged list is a pure in-place update — nothing is inserted and nothing is retired", () => {
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И."), row("b", 1, "Петрова А.С.")],
      [want(0, "Иванов И.И."), want(1, "Петрова А.С.")],
    );
    expect(plan.update.map((u) => u.id)).toEqual(["a", "b"]);
    expect(plan.insert).toEqual([]);
    expect(plan.retire).toEqual([]);
    expect(plan.restore).toEqual([]);
  });

  it("#1278: a departing speaker is RETIRED, never deleted — and the row that stays keeps its identity", () => {
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И."), row("b", 1, "Петрова А.С.")],
      [want(0, "Иванов И.И.")],
    );
    expect(plan.retire).toEqual([{ id: "b", position: 1 }]);
    expect(plan.update).toEqual([
      { id: "a", position: 0, name: "Иванов И.И.", regalia: "" },
    ]);
    expect(plan.insert).toEqual([]);
  });

  it("#1278: a returning speaker RESTORES the retired row in place (§3.6 rule 2) — a second row is never created", () => {
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И."), row("b", 1, "Петрова А.С.", "retired")],
      [want(0, "Иванов И.И."), want(1, "Петрова А.С.", "к.м.н.")],
    );
    expect(plan.restore).toEqual([
      { id: "b", position: 1, name: "Петрова А.С.", regalia: "к.м.н." },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.retire).toEqual([]);
  });

  it("#1278: a NEW name at a slot a retired speaker used to hold is an insert — the retired row is not overwritten", () => {
    // Identity is the name, not the position: reusing slot 1 for a different
    // person must not rewrite the row that records who was announced before.
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И."), row("b", 1, "Петрова А.С.", "retired")],
      [want(0, "Иванов И.И."), want(1, "Сидоров П.П.")],
    );
    expect(plan.insert).toEqual([
      { position: 1, name: "Сидоров П.П.", regalia: "" },
    ]);
    expect(plan.restore).toEqual([]);
  });

  it("#1278: re-ordering the same people moves positions on the SAME rows", () => {
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И."), row("b", 1, "Петрова А.С.")],
      [want(0, "Петрова А.С."), want(1, "Иванов И.И.")],
    );
    expect(plan.update).toEqual([
      { id: "b", position: 0, name: "Петрова А.С.", regalia: "" },
      { id: "a", position: 1, name: "Иванов И.И.", regalia: "" },
    ]);
    expect(plan.insert).toEqual([]);
    expect(plan.retire).toEqual([]);
  });

  it("#1278: names match trimmed + case-insensitively, so re-typing a name is an edit, not a churn of rows", () => {
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И.")],
      [want(0, "  иванов и.и.  ", "профессор")],
    );
    expect(plan.update).toEqual([
      { id: "a", position: 0, name: "  иванов и.и.  ", regalia: "профессор" },
    ]);
    expect(plan.insert).toEqual([]);
  });

  it("#1278: duplicate names in the desired list consume DISTINCT existing rows", () => {
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И."), row("b", 1, "Иванов И.И.")],
      [want(0, "Иванов И.И."), want(1, "Иванов И.И.")],
    );
    expect(plan.update.map((u) => u.id)).toEqual(["a", "b"]);
    expect(plan.insert).toEqual([]);
    expect(plan.retire).toEqual([]);
  });

  it("#1278: clearing the list retires every active row and inserts nothing", () => {
    const plan = planSpeakerReconcile(
      [row("a", 0, "Иванов И.И."), row("b", 1, "Петрова А.С.")],
      [],
    );
    expect(plan.retire).toEqual([
      { id: "a", position: 0 },
      { id: "b", position: 1 },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.insert).toEqual([]);
  });

  it("#1278: an omitted regalia is stored as the empty string, never as null", () => {
    const plan = planSpeakerReconcile(
      [],
      [{ position: 0, name: "Новый Н.Н." }],
    );
    expect(plan.insert).toEqual([
      { position: 0, name: "Новый Н.Н.", regalia: "" },
    ]);
  });
});
