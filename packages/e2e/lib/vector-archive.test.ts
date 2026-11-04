import { describe, expect, it } from "vitest";
import {
  ownedDatabasePair,
  withoutVector,
} from "../api-probes/vector-archive.js";

const source = "postgres://ds:secret@localhost:5432/ds_dev_3688";
const toc = [
  "; Archive created by pg_dump",
  "2; 3079 16400 EXTENSION - vector",
  "3; 0 0 COMMENT - EXTENSION vector",
  "4; 3079 16401 EXTENSION - pg_partman",
  "5; 1259 16402 TABLE public users ds",
  "6; 0 16402 TABLE DATA public users ds",
].join("\n");

describe("002 EARS-2: missing-vector native archive safety", () => {
  it("accepts only the exact new task database pair on one server and account", () => {
    expect(ownedDatabasePair(source, source + "_novector")).toEqual({
      source: "ds_dev_3688",
      target: "ds_dev_3688_novector",
    });
    for (const target of [
      source,
      source.replace("3688", "3679"),
      source.replace("localhost", "elsewhere") + "_novector",
      source.replace("secret", "other") + "_novector",
    ])
      expect(() => ownedDatabasePair(source, target)).toThrow();
    expect(() =>
      ownedDatabasePair(
        source.replace("3688", "3679"),
        source.replace("3688", "3679") + "_novector",
      ),
    ).toThrow();
  });

  it("omits only vector extension metadata and preserves every other TOC byte", () => {
    const result = withoutVector(toc);
    expect(result.omitted).toEqual(toc.split("\n").slice(1, 3));
    expect(result.list).toBe(
      toc
        .split("\n")
        .filter((_, index) => index !== 1 && index !== 2)
        .join("\n"),
    );
    expect(result.list).toContain("EXTENSION - pg_partman");
    expect(result.list).toContain("TABLE DATA public users");
  });

  it("refuses absent/duplicate extensions and unanticipated vector dependents", () => {
    for (const input of [
      toc.replace("EXTENSION - vector", "EXTENSION - other"),
      toc + "\n7; 3079 16403 EXTENSION - vector",
      toc + "\n7; 1247 16403 TYPE public vector ds",
      toc + "\n7; 1259 16403 TABLE public vector_index ds",
    ])
      expect(() => withoutVector(input)).toThrow();
  });

  it("also excludes an explicit vector extension ACL without excluding other ACLs", () => {
    const result = withoutVector(
      toc + "\n7; 0 0 ACL - EXTENSION vector ds\n8; 0 0 ACL public users ds",
    );
    expect(result.omitted).toHaveLength(3);
    expect(result.list).toContain("ACL public users ds");
  });
});
