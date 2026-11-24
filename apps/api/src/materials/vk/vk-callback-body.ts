import type { FastifyInstance, FastifyRequest } from "fastify";

// 048 EARS-39 (#4004) — the VK Callback route answers `401` to a body that
// does not parse, where Fastify's JSON parser would answer its own `400`
// before the route runs. The default parser stays the parser of every route
// (same limits, same prototype-poisoning refusal); only on the Callback path a
// parse failure becomes the {@link VK_CALLBACK_UNPARSABLE} body the
// controller refuses. The body limit stays Fastify's 1 MB default.

/** The Callback path the tolerant parse applies to. */
export const VK_CALLBACK_PATH = "/v1/integrations/vk/callback";

/** The parsed body of a Callback request whose JSON did not parse. */
export const VK_CALLBACK_UNPARSABLE = Symbol("VK_CALLBACK_UNPARSABLE");

function isCallback(req: FastifyRequest): boolean {
  const path = req.url.split("?", 1)[0];
  return path === VK_CALLBACK_PATH;
}

/** Install the Callback-tolerant JSON parser on the app's Fastify instance. */
export function installVkCallbackJsonParser(instance: FastifyInstance): void {
  const parseJson = instance.getDefaultJsonParser("error", "error");
  instance.removeContentTypeParser("application/json");
  instance.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (req, raw, done) => {
      // `parseAs: "string"` hands a string; the type also admits a Buffer.
      const body = typeof raw === "string" ? raw : raw.toString("utf8");
      if (!isCallback(req)) {
        parseJson(req, body, done);
        return;
      }
      parseJson(req, body, (error, value) => {
        done(null, error ? VK_CALLBACK_UNPARSABLE : value);
      });
    },
  );
}
