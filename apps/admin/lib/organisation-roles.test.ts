import { describe, expect, it } from "vitest";
import type { OrganisationRoleRef } from "@ds/schemas";
import {
  offeredRoles,
  rolesBookReady,
  submittedRoleIds,
} from "./organisation-roles";

/**
 * 032 EARS-2 — the pure half of the organisation form's role checkboxes: which
 * roles it offers, when it may be saved, and which role ids a save sends. A save
 * must never drop a role the organisation already holds.
 */
const investor: OrganisationRoleRef = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "investor",
  title: "Инвестор",
  status: "active",
};
const sponsor: OrganisationRoleRef = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "sponsor",
  title: "Спонсор",
  status: "active",
};
const vendor: OrganisationRoleRef = {
  id: "33333333-3333-4333-8333-333333333333",
  slug: "vendor",
  title: "Поставщик",
  status: "retired",
};

describe("organisation form roles (032 EARS-2)", () => {
  it("EARS-2: a held active role stays offered while the role book has not loaded", () => {
    expect(offeredRoles([], [investor])).toEqual([investor]);
  });

  it("EARS-2: a held active role stays checked and is sent back on save before the book arrives", () => {
    const offered = offeredRoles([], [investor]);
    expect(submittedRoleIds(offered, [investor.id])).toEqual([investor.id]);
  });

  it("EARS-2: the form cannot be saved while the role book is loading or failed", () => {
    expect(rolesBookReady({ isLoading: true, isError: false })).toBe(false);
    expect(rolesBookReady({ isLoading: false, isError: true })).toBe(false);
    expect(rolesBookReady({ isLoading: false, isError: false })).toBe(true);
  });

  it("EARS-2: every active book role plus every held role (active or retired) is offered, once each, book order first", () => {
    expect(
      offeredRoles([investor, sponsor, vendor], [vendor, investor]),
    ).toEqual([investor, sponsor, vendor]);
  });

  it("EARS-2: a retired role the organisation does not hold is not offered", () => {
    expect(offeredRoles([investor, vendor], [])).toEqual([investor]);
  });

  it("EARS-2: the sent role ids follow the offered order and drop unknown ids", () => {
    const offered = offeredRoles([investor, sponsor], []);
    expect(submittedRoleIds(offered, [sponsor.id, investor.id, "x"])).toEqual([
      investor.id,
      sponsor.id,
    ]);
  });
});
