// Fixture HTTP errors can contain credentials. Retain test outcomes and only
// enumerated setup diagnostics; never persist subprocess output or response bodies.
const setupPhases = [
  ["network", /infra: create network:/],
  ["postgres", /infra: starting postgres:/],
  ["cache", /infra: starting redis:/],
  ["application", /infra: starting nodejs:/],
  ["configuration", /infra: load config:/],
  ["database", /infra: connect db:/],
  ["bootstrap", /infra\.bootstrap:/],
  ["project", /infra\.MustCreateProject:/]
];
const setupCauses = [
  ["deadline", /context deadline exceeded/],
  ["timeout", /timed out|timeout/i],
  ["connection-refused", /connection refused/i],
  ["connection-reset", /connection reset/i],
  ["unexpected-eof", /unexpected EOF/]
];

export function collectGoTestEvidence(stdout) {
  const events = [];
  const diagnostics = [];
  for (const line of stdout.split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== "object" || typeof event.Package !== "string") continue;
    if (["pass", "fail", "skip"].includes(event.Action)) {
      events.push({
        action: event.Action, package: event.Package,
        test: typeof event.Test === "string" ? event.Test : null,
        elapsed: typeof event.Elapsed === "number" ? event.Elapsed : 0
      });
    }
    if (typeof event.Output !== "string") continue;
    const phase = setupPhases.find(([, pattern]) => pattern.test(event.Output))?.[0];
    if (!phase) continue;
    diagnostics.push({
      package: event.Package, phase,
      causes: setupCauses.filter(([, pattern]) => pattern.test(event.Output)).map(([cause]) => cause)
    });
  }
  return { events, diagnostics };
}
