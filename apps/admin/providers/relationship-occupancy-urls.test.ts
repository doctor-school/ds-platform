import { describe, expect, it } from "vitest";

import {
  projectExpertsUrl,
  projectPartnersUrl,
} from "@/providers/data-provider";

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

describe("EARS-22: authoritative relationship occupancy URLs", () => {
  it("EARS-22: scopes curator occupancy to one project, active role and one result", () => {
    expect(
      projectExpertsUrl.list({
        projectId: PROJECT_ID,
        role: "curator",
        status: "active",
        pageSize: 1,
      }),
    ).toBe(
      `/v1/admin/project-experts?projectId=${PROJECT_ID}&role=curator&status=active&pageSize=1`,
    );
  });

  it("EARS-22: scopes primary occupancy to one project, active flag and one result", () => {
    expect(
      projectPartnersUrl.list({
        projectId: PROJECT_ID,
        isPrimary: true,
        status: "active",
        pageSize: 1,
      }),
    ).toBe(
      `/v1/admin/project-partners?projectId=${PROJECT_ID}&isPrimary=true&status=active&pageSize=1`,
    );
  });

  it("EARS-22: serializes an explicit false primary filter instead of dropping it", () => {
    expect(
      projectPartnersUrl.list({ projectId: PROJECT_ID, isPrimary: false }),
    ).toContain("isPrimary=false");
  });
});
