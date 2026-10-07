/**
 * One-off UI-evidence capture for #2664 (one `<main>` landmark per page — the
 * route-group shell owns it). Not a test — a screenshot driver for the PR's
 * zero-visual-delta evidence, kept out of `e2e/*.spec.ts` so Playwright never
 * collects it. Mirrors `apps/doctor/e2e/ui-evidence-2433.mjs`.
 *
 * The change swaps `<main>` for `<div>` (same classes) in the compositions and
 * moves the landmark onto the route-group shell, so the claim to prove is that
 * nothing PAINTS differently. It shoots the doctor `/account/events` and the
 * Academy `/webinars` and `/` at desktop + mobile, light theme, signed in as
 * one doctor registered for two seeded events, once on the base build (`before`) and once
 * on the branch build (`after`), then compares the two sets pixel by pixel.
 *
 *   capture: E2E_DOCTOR_URL=… E2E_PORTAL_URL=… MAILPIT_URL=… DATABASE_URL=<branch db> \
 *              node apps/doctor/e2e/ui-evidence-2664.mjs capture <out>/before
 *   compare: node apps/doctor/e2e/ui-evidence-2664.mjs compare <out>/before <out>/after
 *
 * The throwaway account is provisioned once (doctor register + Mailpit verify
 * code) and cached in `<out>/account.json`, so both captures sign in as the same
 * doctor. Boot recipe (bot protection off, standalone servers on the stand):
 * the docblock of `e2e/congress-submissions.spec.ts`.
 */

/* global localStorage, document, Image */
// The identifiers above are referenced only inside `page.evaluate` /
// `addInitScript` callbacks, which run in the BROWSER, not in this Node process.

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pg from "pg";

const [mode, dirA, dirB] = process.argv.slice(2);
const SHOTS = [
  ["doctor", "/account/events"],
  ["portal", "/webinars"],
  // The Academy home: its own footer moved to the root layout's `@footer`
  // slot (after the layout's `<main>`), so `/` is shot too.
  ["portal", "/"],
];
const VIEWPORTS = {
  desktop: { width: 1440, height: 1024 },
  mobile: { width: 390, height: 844 },
};
const name = (host, path, vp) =>
  `${host}${path === "/" ? "-home" : path.replaceAll("/", "-")}-${vp}-light.png`;

/** The newest Mailpit code for `email` sent after `after` whose subject names `kind`. */
async function mailCode(mailpit, email, after, kind) {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const data = res.ok ? await res.json() : {};
    const hit = (data.messages ?? []).find(
      (m) => Date.parse(m.Created) >= after - 1000 && m.Subject.includes(kind),
    );
    const code = hit?.Subject.match(/^([A-Za-z0-9]{4,12})\s+—/)?.[1];
    if (code) return code;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no «${kind}» code for ${email}`);
}

async function capture(out) {
  const DOCTOR = process.env.E2E_DOCTOR_URL.replace(/\/$/, "");
  const PORTAL = process.env.E2E_PORTAL_URL.replace(/\/$/, "");
  const MAILPIT = process.env.MAILPIT_URL.replace(/\/$/, "");
  mkdirSync(out, { recursive: true });
  const accountFile = join(dirname(out), "account.json");

  if (!existsSync(accountFile)) {
    const email = `e2e-2664-${Date.now()}@ds.test`;
    const password = `Doc-${Date.now()}-aA1!`;
    const sentAt = Date.now();
    const post = async (path, body) => {
      const res = await fetch(`${DOCTOR}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
    };
    await post("/v1/storefront/doctor/register", {
      email,
      password,
      medicalWorkerDeclaration: true,
      consent: [{ purpose: "partner-data-sharing", version: "v1" }],
    });
    const code = await mailCode(MAILPIT, email, sentAt, "код подтверждения");
    await post("/v1/auth/verify", { email, code });
    // Two seeded events in «Мои события» so the list paints real cards.
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO registrations (user_id, event_id)
         SELECT u.id, e.id FROM users u, events e
         WHERE u.email = $1 AND e.id IN (
           SELECT id FROM events WHERE state = 'published' AND starts_at > now()
           ORDER BY starts_at LIMIT 2)`,
        [email],
      );
    } finally {
      await client.end();
    }
    writeFileSync(accountFile, JSON.stringify({ email, password }));
  }
  const { email } = JSON.parse(readFileSync(accountFile, "utf8"));

  const browser = await chromium.launch();
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ locale: "ru-RU", viewport: size });
    await ctx.addInitScript(() => localStorage.setItem("ds-theme", "light"));
    const page = await ctx.newPage();
    for (const [host, path] of SHOTS) {
      const base = host === "doctor" ? DOCTOR : PORTAL;
      await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });
      // Email-code sign-in (003 login OTP): one fresh code per host session.
      const requestedAt = Date.now();
      await page.evaluate(
        async (identifier) =>
          fetch("/v1/auth/login/otp/request", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ identifier, channel: "email" }),
          }),
        email,
      );
      const code = await mailCode(MAILPIT, email, requestedAt, "код для входа");
      const status = await page.evaluate(
        async ([identifier, otp]) =>
          (
            await fetch("/v1/auth/login/otp", {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ identifier, code: otp, channel: "email" }),
            })
          ).status,
        [email, code],
      );
      if (status !== 200) throw new Error(`sign-in on ${host}: ${status}`);
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const mains = await page.locator("main").count();
      console.log(`${host}${path} ${vp}: ${mains} <main>`);
      await page.screenshot({
        path: join(out, name(host, path, vp)),
        fullPage: true,
        animations: "disabled",
      });
    }
    await ctx.close();
  }
  await browser.close();
}

async function compare(a, b) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let failed = false;
  for (const [host, path] of SHOTS) {
    for (const vp of Object.keys(VIEWPORTS)) {
      const file = name(host, path, vp);
      const urls = [a, b].map(
        (dir) => `data:image/png;base64,${readFileSync(join(dir, file)).toString("base64")}`,
      );
      const result = await page.evaluate(async ([ua, ub]) => {
        const load = (src) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = src;
          });
        const [ia, ib] = await Promise.all([load(ua), load(ub)]);
        if (ia.width !== ib.width || ia.height !== ib.height) {
          return { size: [ia.width, ia.height, ib.width, ib.height], diff: -1 };
        }
        const px = (img) => {
          const c = document.createElement("canvas");
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext("2d");
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, img.width, img.height).data;
        };
        const da = px(ia);
        const db = px(ib);
        let diff = 0;
        for (let i = 0; i < da.length; i += 4) {
          if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diff++;
        }
        return { size: [ia.width, ia.height], diff };
      }, urls);
      if (result.diff !== 0) failed = true;
      console.log(`${file}: ${result.size.join("x")} differing pixels = ${result.diff}`);
    }
  }
  await browser.close();
  if (failed) process.exitCode = 1;
}

if (mode === "capture") await capture(dirA);
else if (mode === "compare") await compare(dirA, dirB);
else throw new Error("usage: capture <out> | compare <before> <after>");
