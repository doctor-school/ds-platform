/** Shared read-only Codex envelope boundary. Never interpret tool program text. */
import fs from "node:fs";
import path from "node:path";

export function readRecords(jsonl) {
  const records = [];
  for (const line of String(jsonl).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      /* tolerate torn final writes */
    }
  }
  return records;
}

export function rolloutMeta(records) {
  const record = records.find((entry) => entry?.type === "session_meta");
  const meta = record?.payload ?? {};
  return { ...meta, timestamp: meta.timestamp ?? record?.timestamp ?? null };
}

export function parentThread(meta) {
  return meta.source?.subagent?.thread_spawn?.parent_thread_id ?? null;
}

export function codexSessionsRoot(env = process.env) {
  const home = env.USERPROFILE ?? env.HOME;
  const codexHome = env.CODEX_HOME || (home ? path.join(home, ".codex") : null);
  return codexHome ? path.resolve(codexHome, "sessions") : null;
}

export function walkJsonl(dir, out = []) {
  if (!dir || !fs.existsSync(dir)) return out;
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) walkJsonl(file, out);
    else if (item.isFile() && item.name.endsWith(".jsonl")) out.push(file);
  }
  return out;
}

export function analyzeCodexJsonl(jsonl) {
  const records = readRecords(jsonl);
  const meta = rolloutMeta(records);
  const child = Boolean(
    parentThread(meta) ||
    meta.source?.subagent ||
    meta.thread_source === "subagent",
  );
  const start = Date.parse(meta.timestamp);
  const warnings = [];
  let inherited = null;
  let latest = null;
  let previousKey = null;
  let turns = 0;
  let peak = null;
  let peakTs = null;
  let contextWindow = number(meta.context_window);
  let compacts = 0;
  let userTurns = 0;
  let counterReset = false;
  const models = new Set();
  const ownRecords = [];
  for (const record of records) {
    const payload = record?.payload;
    const copied =
      child && Number.isFinite(start) && Date.parse(record.timestamp) < start;
    if (copied) {
      if (
        record.type === "event_msg" &&
        payload?.type === "token_count" &&
        payload.info?.total_token_usage
      )
        inherited = payload.info.total_token_usage;
      continue;
    }
    ownRecords.push(record);
    if (record.type === "turn_context" && payload?.model)
      models.add(payload.model);
    if (record.type === "compacted" || payload?.type === "context_compacted")
      compacts++;
    if (
      record.type === "response_item" &&
      payload?.type === "message" &&
      payload.role === "user"
    )
      userTurns++;
    if (
      record.type !== "event_msg" ||
      payload?.type !== "token_count" ||
      !payload.info
    )
      continue;
    const info = payload.info;
    contextWindow = number(info.model_context_window) ?? contextWindow;
    const current = info.total_token_usage;
    const previous = latest ?? inherited;
    if (
      current &&
      previous &&
      ["input_tokens", "output_tokens", "total_tokens"].some(
        (key) =>
          number(current[key]) !== null &&
          number(previous[key]) !== null &&
          current[key] < previous[key],
      )
    )
      counterReset = true;
    const key = current
      ? JSON.stringify([
          current.input_tokens,
          current.cached_input_tokens,
          current.cache_write_input_tokens,
          current.output_tokens,
          current.reasoning_output_tokens,
          current.total_tokens,
        ])
      : null;
    if (key && key !== previousKey) turns++;
    if (key) previousKey = key;
    if (current) latest = current;
    const context = number(info.last_token_usage?.input_tokens);
    if (context !== null && (peak === null || context > peak)) {
      peak = context;
      peakTs = record.timestamp ?? null;
    }
  }
  const mapping = {
    input: "input_tokens",
    cacheWrite: "cache_write_input_tokens",
    cacheRead: "cached_input_tokens",
    output: "output_tokens",
    reasoningOutput: "reasoning_output_tokens",
    totalTokens: "total_tokens",
  };
  let total = Object.fromEntries(
    Object.entries(mapping).map(([name, key]) => [name, number(latest?.[key])]),
  );
  if (inherited && latest) {
    const deltas = Object.fromEntries(
      Object.entries(mapping).map(([name, key]) => {
        const before = number(inherited[key]);
        const after = number(latest[key]);
        return [
          name,
          before !== null && after !== null && after >= before
            ? after - before
            : null,
        ];
      }),
    );
    total = deltas;
    warnings.push(
      "Inherited history excluded; usage is the observable cumulative delta (counter resets remain ambiguous).",
    );
  } else if (child) {
    warnings.push(
      "UNKNOWN child usage attribution: no inherited cumulative baseline; reported counters may include fork history.",
    );
  }
  if (child && !Number.isFinite(start))
    warnings.push(
      "UNKNOWN own-history boundary: session timestamp missing; context may include copied history.",
    );
  if (counterReset) {
    total = Object.fromEntries(Object.keys(mapping).map((key) => [key, null]));
    warnings.push(
      "UNKNOWN usage: cumulative counters reset; the final snapshot is not a session total.",
    );
  }
  if (!latest)
    warnings.push("UNKNOWN token usage: no cumulative token telemetry.");
  if (peak === null)
    warnings.push("UNKNOWN context peak: no per-request input telemetry.");
  warnings.push(
    "UNKNOWN cost: no verified Codex price table; token telemetry is not billing.",
  );
  const timestamps = ownRecords.map((row) => row?.timestamp).filter(Boolean);
  const firstTs = timestamps[0] ?? null;
  const lastTs = timestamps.at(-1) ?? null;
  const elapsed = Date.parse(lastTs) - Date.parse(firstTs);
  return {
    harness: "codex",
    turns: latest ? turns : null,
    userTurns,
    compacts,
    total,
    peak,
    peakTs,
    contextWindow,
    cost: null,
    warnings,
    models: [...models],
    firstTs,
    lastTs,
    durationH: Number.isFinite(elapsed) ? elapsed / 3.6e6 : null,
  };
}

export function number(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
