import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => [key, sortJson(value[key])]),
  );
}

export function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

async function currentContents(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function reconcileGeneratedFiles(outputs, { check }) {
  const stale = [];
  for (const [path, expected] of outputs) {
    if ((await currentContents(path)) !== expected) stale.push(path);
  }

  if (check) {
    if (stale.length > 0) {
      throw new Error(
        `Generated API artifacts are stale: ${stale.map((path) => basename(path)).join(", ")}. Run pnpm generate:api-client and commit the result.`,
      );
    }
    return;
  }

  for (const path of stale) {
    const expected = outputs.get(path);
    const temporary = `${path}.tmp-${process.pid}`;
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(temporary, expected, "utf8");
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
}
