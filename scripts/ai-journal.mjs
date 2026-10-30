#!/usr/bin/env node
import { Journal, repositoryRoot } from "./lib/ai-journal.mjs";

async function input() {
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
    if (Buffer.byteLength(data) > 1024 * 1024) throw new Error("Input too large");
  }
  try { return JSON.parse(data.replace(/^\uFEFF/, "")); } catch { throw new Error("Supply one JSON object on stdin"); }
}

try {
  const [command, session, arg] = process.argv.slice(2);
  if (!command || command === "help") {
    console.log("Vaultix project journal: start < JSON | append SESSION KIND < JSON | snapshot PATH... | refresh-plan SESSION < {reason} | run SESSION CHECK | assess SESSION | finish SESSION < {remaining_limits} | resume SESSION | list [YYYY-MM] [LIMIT] | context [FOLDER] | validate SESSION");
  } else {
    const journal = new Journal(repositoryRoot());
    let result;
    switch (command) {
      case "start": result = journal.start(await input()); break;
      case "append": { const event = journal.append(session, arg, await input()); result = { event_id: event.event_id, kind: event.kind, redaction_count: event.redaction_count }; break; }
      case "snapshot": result = journal.snapshot(process.argv.slice(3)); break;
      case "refresh-plan": { const event = journal.refreshPlan(session, (await input()).reason); result = { event_id: event.event_id, revision: event.payload.revision }; break; }
      case "run": { const event = await journal.run(session, arg); result = { event_id: event.event_id, ...event.payload, sources: undefined }; if (event.payload.outcome !== "pass") process.exitCode = 1; break; }
      case "assess": result = journal.assess(session); if (!result.checks_satisfied) process.exitCode = 1; break;
      case "finish": { const event = journal.finish(session, (await input()).remaining_limits); result = { event_id: event.event_id, meaning: event.payload.meaning }; break; }
      case "resume": result = journal.resume(session); break;
      case "list": result = journal.list(session, arg === undefined ? 20 : Number(arg), process.argv[5]); break;
      case "context": result = journal.context(session); break;
      case "validate": result = { valid: true, events: journal.events(session).length }; break;
      default: throw new Error("Unknown journal command; use help");
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  // Never print raw parser input, command output, child environment or stack.
  console.error(JSON.stringify({ error: error instanceof Error ? error.message.replace(/[\r\n]/g, " ").slice(0, 250) : "Journal operation failed" }));
  process.exitCode = 1;
}
