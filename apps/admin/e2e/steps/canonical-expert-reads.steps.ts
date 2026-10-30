import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import ts from "typescript";

import { Given, When, Then, test, type AdminWorld } from "../support/fixtures";
import {
  CanonicalExpertFixture,
  type Speaker,
} from "../support/canonical-expert-fixture";

const { Before, After } = createBdd(test);
const states = new WeakMap<
  AdminWorld,
  {
    fixture: CanonicalExpertFixture;
    reads: Speaker[][];
    page?: Speaker[];
    card?: { name: string }[];
  }
>();
function state(world: AdminWorld) {
  const value = states.get(world);
  if (!value) throw new Error("Canonical Expert fixture hook did not run");
  return value;
}

Before({ tags: "@canonical-expert-reads" }, async ({ world }) => {
  const fixture = new CanonicalExpertFixture();
  states.set(world, { fixture, reads: [] });
  await fixture.start();
});
After({ tags: "@canonical-expert-reads" }, async ({ world }) => {
  await states.get(world)?.fixture.close();
  states.delete(world);
});

Given(
  "active event_experts include published and draft Experts",
  async ({ world }) => {
    const fixture = state(world).fixture;
    expect(fixture.experts.map((expert) => expert.status)).toEqual([
      "published",
      "published",
      "published",
      "draft",
      "retired",
    ]);
  },
);
Given("an eligible event has ordered event_experts", async ({ world }) => {
  expect(state(world).fixture.expected).toHaveLength(3);
});
Given("the cutover release is deployed", async ({ world }) => {
  await state(world).fixture.cutover();
});

async function readSpeakers(world: AdminWorld) {
  const current = state(world);
  const response = await current.fixture.get(
    `/v1/public/events/${current.fixture.slug}/speakers`,
  );
  expect(response.status()).toBe(200);
  const speakers: Speaker[] = await response.json();
  current.reads.push(speakers);
  return speakers;
}
async function readSurfaces(world: AdminWorld) {
  const current = state(world);
  await readSpeakers(world);
  const page = await current.fixture.get(
    `/v1/public/events/${current.fixture.slug}`,
  );
  expect(page.status()).toBe(200);
  current.page = (await page.json()).speakers;
  const cards = await current.fixture.get("/v1/public/events");
  expect(cards.status()).toBe(200);
  const card = (
    (await cards.json()) as { id: string; speakers: { name: string }[] }[]
  ).find((item) => item.id === current.fixture.eventId);
  expect(card).toBeTruthy();
  current.card = card!.speakers;
}
When("the public speaker projection is read repeatedly", async ({ world }) => {
  for (let index = 0; index < 4; index++) await readSpeakers(world);
});
When(
  "its speakers endpoint, PublicEventPage and UpcomingBroadcastCard are read",
  async ({ world }) => readSurfaces(world),
);
When(
  "any public or admin surface reads the speaker projection of an event",
  async ({ world }) => readSurfaces(world),
);

function exactProjection(world: AdminWorld) {
  const current = state(world);
  expect(current.reads.length).toBeGreaterThan(0);
  for (const read of current.reads)
    expect(read).toEqual(current.fixture.expected);
  return current;
}
Then("only published non-retired Experts render", async ({ world }) => {
  exactProjection(world);
});
Then("repeated reads return the same order", async ({ world }) => {
  const current = exactProjection(world);
  expect(current.reads).toHaveLength(4);
  for (const read of current.reads) expect(read).toEqual(current.reads[0]);
});
Then(
  "the endpoint and page return the same ordered Expert projection",
  async ({ world }) => {
    const current = exactProjection(world);
    expect(current.page).toEqual(current.reads[0]);
  },
);
Then(
  "the card returns the same order mapped to exactly name-only items",
  async ({ world }) => {
    const current = exactProjection(world);
    expect(current.card).toEqual(
      current.fixture.expected.map((speaker) => ({ name: speaker.name })),
    );
  },
);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
function tree(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(resolve(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}
function method(file: string, name: string): ts.MethodDeclaration {
  const methods: ts.MethodDeclaration[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText() === name)
      methods.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree(file));
  expect(methods).toHaveLength(1);
  return methods[0];
}
const printer = ts.createPrinter({ removeComments: true });
function code(node: ts.Node) {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())
    .replace(/\s+/gu, "");
}
const service = "apps/api/src/taxonomy/speaker-projection.service.ts";
const repository = "apps/api/src/taxonomy/speaker-projection.repository.ts";

function orderingPolicy() {
  const resolver = code(method(service, "resolveMany"));
  // 012 EARS-8; the owning unit suite exercises ties forbidden by the active-position index.
  expect(resolver).toContain(
    "a.position-b.position||(a.id<b.id?-1:a.id>b.id?1:0)",
  );
  expect(resolver).toContain("id:link.linkId");
}
Then("rows sort by position and stable relation id", async ({ world }) => {
  exactProjection(world);
  orderingPolicy();
});

function singleProjectionPolicy() {
  const controller =
    "apps/api/src/taxonomy/speaker-projection.public.controller.ts";
  expect(code(method(controller, "list"))).toContain(
    "this.speakers.publicSpeakersFor(publicKey(idOrSlug))",
  );
  expect(code(method(service, "publicSpeakersFor"))).toContain(
    "returnthis.resolve(eventId)",
  );
  expect(code(method(service, "resolve"))).toContain(
    "this.resolveMany([eventId])",
  );
  const events = "apps/api/src/events/events.service.ts";
  expect(code(method(events, "toPublicPage"))).toContain(
    "speakers:awaitthis.speakerProjection.resolve(e.id)",
  );
  expect(code(method(events, "toUpcomingCards"))).toContain(
    "this.speakerProjection.resolveMany(ids)",
  );
  expect(code(method(events, "toUpcomingCard"))).toContain(
    "speakers:merged.map((s)=>({name:s.name}))",
  );
  const query = code(method(repository, "eligibleExpertLinks"));
  expect(query).toContain(
    ".from(eventExperts).innerJoin(experts,eq(experts.id,eventExperts.expertId))",
  );
  expect(query).toContain('eq(eventExperts.status,"active")');
  expect(query).toContain("isNull(eventExperts.deletedAt)");
  expect(query).toContain('eq(experts.status,"published")');
  expect(query).toContain("isNull(experts.deletedAt)");
  expect(query).toContain("isNull(experts.contentRemovedAt)");
  const resolver = code(method(service, "resolveMany"));
  expect(resolver.match(/this\.repo\.eligibleExpertLinks\(/gu)).toHaveLength(1);
  expect(resolver).not.toMatch(/legacy|speakerMigration|eventSpeakers/iu);
  expect(query).not.toMatch(/legacy|speakerMigration|eventSpeakers/iu);
}
Then(
  "no surface reads legacy speakers or runs a second projection policy",
  async ({ world }) => {
    await state(world).fixture.cutover();
    singleProjectionPolicy();
  },
);
Then(
  "the canonical resolver returns only eligible event_experts ordered by position and stable relation id",
  async ({ world }) => {
    const current = exactProjection(world);
    expect(current.page).toEqual(current.fixture.expected);
    expect(current.card).toEqual(
      current.fixture.expected.map(({ name }) => ({ name })),
    );
    orderingPolicy();
    singleProjectionPolicy();
  },
);
Then(
  "it consults no legacy free-text speaker row and no legacy fallback",
  async ({ world }) => {
    await state(world).fixture.cutover();
    singleProjectionPolicy();
  },
);
Then("it infers no identity from a name", async ({ world }) => {
  const current = exactProjection(world);
  const sameName = current.reads[0].filter(
    (speaker) => speaker.name === "Резолвер Анна",
  );
  expect(sameName).toHaveLength(2);
  expect(new Set(sameName.map((speaker) => speaker.expertId)).size).toBe(2);
  expect(current.reads[0].map((speaker) => speaker.expertSlug)).toEqual(
    current.fixture.expected.map((speaker) => speaker.expertSlug),
  );
  singleProjectionPolicy();
});
