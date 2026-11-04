import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { setImmediate } from "node:timers/promises";

import { LOCAL_EXECUTOR, shipTree } from "./remote.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function archiveHarness(
  t,
  { archiveExit = 0, archiveError, readError, extractExit = 0 } = {},
) {
  const prefix = `ds-ship-3692-${randomUUID()}`;
  const path = join(tmpdir(), `${prefix}-${SHA.slice(0, 12)}.tar.gz`);
  const bytes = Buffer.from("a complete archive");
  const archiver = new EventEmitter();
  archiver.stdout = Readable.from([bytes]);
  archiver.kill = t.mock.fn(() => archiver.emit("close", null));
  const archiveClosed = Promise.withResolvers();
  const finalizing = Promise.withResolvers();
  let finishArchive;
  let extractCount = 0;
  let received = Buffer.alloc(0);
  fs.writeFileSync(path, "incomplete");
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final(callback) {
      finishArchive = () => {
        fs.writeFileSync(path, bytes);
        callback();
      };
      finalizing.resolve();
    },
  });
  archiver.stdout.once("end", () => {
    archiver.emit("close", archiveExit);
    archiveClosed.resolve();
  });
  t.mock.method(fs, "createWriteStream", (target) => {
    assert.equal(target, path);
    return output;
  });
  if (readError) {
    t.mock.method(
      fs,
      "createReadStream",
      () =>
        new Readable({
          read() {
            this.destroy(readError);
          },
        }),
    );
  }
  t.mock.method(childProcess, "spawn", () => {
    if (extractCount === 0 && !archiver.spawned) {
      archiver.spawned = true;
      if (archiveError)
        globalThis.queueMicrotask(() => archiver.emit("error", archiveError));
      return archiver;
    }
    extractCount += 1;
    const extractor = new EventEmitter();
    extractor.kill = t.mock.fn(() => extractor.emit("close", null));
    extractor.stdin = new Writable({
      write(chunk, _encoding, callback) {
        received = Buffer.concat([received, chunk]);
        callback();
      },
      final(callback) {
        callback();
        globalThis.queueMicrotask(() => extractor.emit("close", extractExit));
      },
    });
    return extractor;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    fs.rmSync(path, { force: true });
  });
  return {
    path,
    bytes,
    output,
    archiver,
    archiveClosed: archiveClosed.promise,
    finalizing: finalizing.promise,
    release: () => finishArchive(),
    failOutput: (error) => output.destroy(error),
    extractCount: () => extractCount,
    received: () => received,
    run: () =>
      shipTree(SHA, LOCAL_EXECUTOR, {
        sourceDir: "fixture-tree",
        tmpPrefix: prefix,
      }),
  };
}

test("3692: a ship waits for the archive output to finish after the archiver closes", async (t) => {
  const h = archiveHarness(t);
  const shipping = h.run();
  try {
    await Promise.all([h.archiveClosed, h.finalizing]);
    await setImmediate();
    assert.equal(
      h.extractCount(),
      0,
      "the unfinished archive must not reach the box",
    );
  } finally {
    h.release();
    await shipping;
  }
  assert.deepEqual(h.received(), h.bytes);
  assert.equal(
    fs.existsSync(h.path),
    false,
    "the owned archive is removed after shipping",
  );
});

test("3692: an archiver failure refuses extraction and removes its partial archive", async (t) => {
  const h = archiveHarness(t, { archiveExit: 7 });
  try {
    await assert.rejects(h.run(), /tar czf exited 7/);
    assert.equal(h.extractCount(), 0);
    assert.equal(
      fs.existsSync(h.path),
      false,
      "a failed archive is removed too",
    );
  } finally {
    h.release();
  }
});

test("3692: an archive output failure is reported and the partial archive is removed", async (t) => {
  const h = archiveHarness(t);
  const error = new Error("archive destination is full");
  const rejected = assert.rejects(h.run(), (actual) => actual === error);
  await h.finalizing;
  h.failOutput(error);
  await rejected;
  assert.equal(h.extractCount(), 0);
  assert.equal(fs.existsSync(h.path), false);
});

test("3692: a failed archiver spawn reports its error and removes the partial archive", async (t) => {
  const error = new Error("archiver executable is unavailable");
  const h = archiveHarness(t, { archiveError: error });
  await assert.rejects(h.run(), (actual) => actual === error);
  assert.equal(h.extractCount(), 0);
  assert.equal(fs.existsSync(h.path), false);
});

test("3692: a failed archive read refuses the send and cleans the archive", async (t) => {
  const error = new Error("archive cannot be read");
  const h = archiveHarness(t, { readError: error });
  const rejected = assert.rejects(h.run(), (actual) => actual === error);
  await h.finalizing;
  h.release();
  await rejected;
  assert.equal(fs.existsSync(h.path), false);
});

test("3692: a nonzero extractor exit remains a failure after the complete send", async (t) => {
  const h = archiveHarness(t, { extractExit: 9 });
  const rejected = assert.rejects(h.run(), /tar x on local exited 9/);
  await h.finalizing;
  h.release();
  await rejected;
  assert.deepEqual(h.received(), h.bytes);
  assert.equal(fs.existsSync(h.path), false);
});
