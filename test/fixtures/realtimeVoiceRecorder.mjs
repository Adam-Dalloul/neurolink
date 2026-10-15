// Child process for test/continuous-test-suite-realtime-voice.ts.
//
// Builds the realtime model through the package's shipped `./livekit` entry with
// both LiveKit plugins replaced by stand-ins that only record the options they
// were constructed with. That is the one place the options handed to a plugin
// can be read exactly, including keys whose value is `undefined` (JSON drops
// those, `Object.keys` does not). A plugin treats such a key as "set to
// nothing" and skips its own default, which for `baseURL` means falling back to
// OPENAI_BASE_URL or api.openai.com, so the distinction is load-bearing.
//
// The stand-ins are served from data: URLs by a resolve hook, so nothing here
// touches the network or the real plugins. The result is one JSON line on
// stdout, prefixed with RESULT.
import { register } from "node:module";

const PLUGIN_STANDINS = {
  "@livekit/agents-plugin-xai": "xai",
  "@livekit/agents-plugin-google": "google",
};

function standinSource(plugin) {
  return [
    "export const realtime = { RealtimeModel: class {",
    "  constructor(options) {",
    `    console.log("RECORDED " + JSON.stringify({ plugin: ${JSON.stringify(plugin)}, keys: Object.keys(options), options }));`,
    "  }",
    '  label() { return "recorded"; }',
    '  get model() { return ""; }',
    "  async close() {}",
    "} };",
  ].join("\n");
}

const hooks = [
  `const standins = ${JSON.stringify(PLUGIN_STANDINS)};`,
  `const sources = ${JSON.stringify(
    Object.fromEntries(
      Object.entries(PLUGIN_STANDINS).map(([name, plugin]) => [
        name,
        standinSource(plugin),
      ]),
    ),
  )};`,
  "export async function resolve(specifier, context, nextResolve) {",
  "  if (Object.hasOwn(standins, specifier)) {",
  '    return { url: "data:text/javascript," + encodeURIComponent(sources[specifier]), shortCircuit: true };',
  "  }",
  "  return nextResolve(specifier, context);",
  "}",
].join("\n");

register("data:text/javascript," + encodeURIComponent(hooks));

const livekit = await import("../../dist/voice/livekit/index.js");

const recorded = [];
const originalLog = console.log;
console.log = (...args) => {
  const first = args[0];
  if (typeof first === "string" && first.startsWith("RECORDED ")) {
    recorded.push(JSON.parse(first.slice("RECORDED ".length)));
    return;
  }
  originalLog(...args);
};

let outcome;
try {
  const config = livekit.resolveRealtimeVoiceConfig();
  await livekit.createRealtimeLlm(config);
  outcome = { ok: true, recorded };
} catch (error) {
  outcome = {
    ok: false,
    recorded,
    message: error instanceof Error ? error.message : String(error),
  };
}
originalLog("RESULT " + JSON.stringify(outcome));
