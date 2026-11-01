// Independent MCP host fixture around the actual self-contained React artifact.
// This is not acceptance in Codex, Claude or ChatGPT.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const axe = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const artifact = resolve(root, process.argv[2] ?? "core/frontend/dist/mcp-apps");
const html = readFileSync(resolve(artifact, "references.html"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(artifact, "manifest.json")));
assert.equal(createHash("sha256").update(html).digest("hex"), manifest.sha256);
const content = JSON.parse(readFileSync(resolve(root, "scripts/fixtures/mcp-app-content.json")));
const projectId = "11111111-1111-4111-8111-111111111111";
const fixtures = {
  "vaultix.catalog.get": content.catalog,
  "vaultix.configure.show": content.configure,
  "vaultix.guidance.get": content.guidance,
  "vaultix.projects.list": { projects: [{ id: projectId, name: "Fixture App", environments: [{ id: "dev-id", name: "Development", slug: "dev" }] }] },
  "vaultix.secrets.references": { references: [{ id: "ref-1", name: "DATABASE_URL", version: 2 }], nextOffset: null, narration: "One authorized reference. Values stay in the vault." }
};
const host = `<!doctype html><html lang="en"><title>Independent MCP host</title><style>body{margin:0}iframe{border:0;width:100%;height:900px}</style><body><iframe title="Vaultix MCP view" sandbox="allow-scripts" src="/app"></iframe><script>
window.calls=[];window.pending=[];window.mode="normal";window.fixtures=${JSON.stringify(fixtures).replaceAll("<", "\\u003c")};
window.send=(body)=>document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',...body},'*');
addEventListener('message',event=>{
 if(event.source!==document.querySelector('iframe').contentWindow)return;
 const m=event.data;if(!m||m.jsonrpc!=='2.0')return;window.calls.push(m);
 if(m.method==='ui/initialize'){
   window.lastInitializationMode=window.mode;
   window.send({id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'fixture',version:'1'},hostCapabilities:window.mode==='unsupported'?{}:{serverTools:{}},hostContext:{displayMode:'inline',containerDimensions:{maxHeight:900}}}});
 }else if(m.method==='ui/notifications/initialized'){
   if(window.mode==='noInput')return;
   if(window.mode==='invalidInput'){window.send({method:'ui/notifications/tool-input',params:{arguments:{secretValue:'CANARY'}}});return;}
   window.send({method:'ui/notifications/tool-input',params:{arguments:{projectId:'${projectId}',environment:'dev',secretPath:'/'}}});
 }else if(m.method==='tools/call'){
   if(window.mode==='hold'){window.pending.push(m);return;}
   const denied=window.mode==='denied'&&m.params.name==='vaultix.secrets.references';
   window.send({id:m.id,result:{isError:denied,content:[{type:'text',text:denied?'CANARY-DENIAL-DETAIL':JSON.stringify(window.fixtures[m.params.name])}]}});
 }
});</script></body></html>`;
const server = createServer((req, res) => {
  if (req.url === "/app") {
    res.writeHead(200, { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" });
    res.end(html);
  } else if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(host); }
  else { res.writeHead(404); res.end(); }
});
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/mcp-app-browser-"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const checks = [], audits = [], errors = [], requests = [];
let browser;
const record = name => checks.push(name);
try {
  browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.goto(origin);
  const view = page.frameLocator("iframe");
  const frame = page.frames().find(frame => frame.url() === `${origin}/app`);
  assert.ok(frame);
  const audit = async state => {
    await frame.evaluate(async () => Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))));
    await frame.evaluate(axe);
    const result = await frame.evaluate(async () => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }));
    audits.push({ state, violations: result.violations, incomplete: result.incomplete.map(rule => rule.id) });
    assert.equal(result.violations.length, 0, `Accessibility violations: ${state}`);
  };
  await expect(view.getByRole("heading", { name: "Secret References", exact: true })).toBeVisible();
  await expect(view.getByRole("combobox", { name: "App", exact: true })).toContainText("Fixture App");
  assert.equal(await page.evaluate(() => window.calls.filter(m => m.params?.name === "vaultix.secrets.references").length), 0, "Host input prefills; it must not run an action");
  await expect(view.getByRole("button", { name: "Show References", exact: true })).toBeEnabled();
  const layout = await frame.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, padding: getComputedStyle(document.getElementById("root")).padding, background: getComputedStyle(document.documentElement).backgroundColor }));
  assert.match(layout.font, /sans-serif/);
  assert.equal(layout.padding, "16px");
  await audit("reference-workspace");
  await page.screenshot({ path: resolve(evidence, "reference-desktop.png"), fullPage: true });
  record("Opaque sandbox initializes, validates catalog, prefills authorized scope without executing a tool");
  const guide = view.getByRole("button", { name: "Guide Me", exact: true });
  await guide.focus();
  await expect(view.getByRole("tooltip")).toContainText("Learn this workflow");
  await guide.press("Enter");
  const dialog = view.getByRole("dialog", { name: "Find the Right Secret Reference", exact: true });
  await expect(dialog).toBeVisible();
  await audit("guide-desktop");
  await page.screenshot({ path: resolve(evidence, "guide-desktop.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(guide).toBeFocused();
  await view.getByRole("button", { name: "Help: Choose the Environment", exact: true }).click();
  await dialog.getByRole("button", { name: "Show This Control", exact: true }).click();
  await expect(view.getByRole("combobox", { name: "Environment", exact: true })).toBeFocused();
  record("Keyboard tooltip, dialog, Escape return and contextual focus work in the embedded view");
  const list = view.getByRole("button", { name: "Show References", exact: true });
  await list.click();
  await expect(view.getByText("DATABASE_URL", { exact: true })).toBeVisible();
  const call = await page.evaluate(() => window.calls.find(m => m.params?.name === "vaultix.secrets.references"));
  assert.deepEqual(call.params.arguments, { projectId, environment: "dev", secretPath: "/", offset: 0, limit: 50 });
  await view.getByRole("searchbox", { name: "Find on this page" }).fill("absent");
  await expect(view.getByText("No names match on this page. Clear the filter or try the next page.")).toBeVisible();
  await view.getByRole("searchbox", { name: "Find on this page" }).fill("");
  await view.getByRole("button", { name: "Copy Name: DATABASE_URL" }).click();
  await expect(view.getByText("Clipboard unavailable. Select and copy the reference name.")).toBeVisible();
  record("Host-proxied read uses exact scope, names render, filtering and denied clipboard provide feedback");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await guide.click();
  const box = await dialog.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 320.5);
  assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  await audit("guide-320px-reduced-motion");
  await page.screenshot({ path: resolve(evidence, "guide-mobile.png"), fullPage: true });
  assert.equal(await frame.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running").length), 0);
  await page.keyboard.press("Escape");
  record("320px guide reflows; reduced-motion preference suppresses animation");
  await page.evaluate(() => { window.mode = "denied"; });
  await list.click();
  await expect(view.getByRole("alert")).toContainText("access has changed");
  await expect(view.getByText("DATABASE_URL", { exact: true })).toHaveCount(0);
  assert.ok(!(await frame.locator("body").innerText()).includes("CANARY"));
  await page.evaluate(() => { window.mode = "normal"; });
  await list.click();
  await expect(view.getByText("DATABASE_URL", { exact: true })).toBeVisible();
  record("Denied refetch hides cached references, avoids reflected details and recovers on explicit retry");
  // A sibling shares the host origin but is not the pinned parent window.
  await page.evaluate(() => new Promise(resolve => {
    const sibling = document.createElement("iframe");
    sibling.hidden = true;
    sibling.srcdoc = `<script>parent.document.querySelector('iframe').contentWindow.postMessage({jsonrpc:'2.0',method:'ui/notifications/tool-cancelled',params:{}},'*');<\/script>`;
    sibling.onload = () => { sibling.remove(); resolve(); };
    document.body.appendChild(sibling);
  }));
  await expect(view.getByText("DATABASE_URL", { exact: true })).toBeVisible();
  await page.evaluate(() => window.send({ method: "ui/notifications/host-context-changed", params: { containerDimensions: { maxHeight: 650 }, styles: { css: { fonts: "CANARY-UNTRUSTED-CSS" } } } }));
  await expect.poll(() => frame.evaluate(() => document.documentElement.style.getPropertyValue("--host-max-height"))).toBe("650px");
  assert.ok(!(await frame.content()).includes("CANARY-UNTRUSTED-CSS"));
  await page.evaluate(() => window.send({ id: "teardown-1", method: "ui/resource-teardown", params: {} }));
  await expect(view.getByRole("alert")).toContainText("connection is unavailable");
  await expect(view.getByText("DATABASE_URL", { exact: true })).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.calls.some(m => m.id === "teardown-1" && m.result)));
  await view.getByRole("button", { name: "Retry Connection" }).click();
  await expect(list).toBeEnabled();
  record("Foreign messages ignored, bounded layout hints applied, host CSS excluded, teardown clears data and reconnect works");
  await page.evaluate(() => { window.mode = "hold"; });
  await list.click();
  await expect(view.getByRole("status").filter({ hasText: "Checking access" })).toBeVisible();
  await page.evaluate(() => window.send({ method: "ui/notifications/tool-cancelled", params: { reason: "CANARY" } }));
  await expect(view.getByRole("alert")).toContainText("connection is unavailable");
  await page.evaluate(() => { for (const m of window.pending) window.send({ id: m.id, result: { isError: false, content: [{ type: "text", text: JSON.stringify(window.fixtures[m.params.name]) }] } }); window.mode = "unsupported"; });
  await view.getByRole("button", { name: "Retry Connection" }).click();
  await expect.poll(() => page.evaluate(() => window.lastInitializationMode)).toBe("unsupported");
  await expect(view.getByRole("alert")).toContainText("connection is unavailable");
  await expect(view.getByText("DATABASE_URL", { exact: true })).toHaveCount(0);
  record("Cancellation rejects pending calls; stale replies cannot restore data; unsupported hosts receive recovery guidance");
  await page.evaluate(() => { window.mode = "normal"; });
  await view.getByRole("button", { name: "Retry Connection" }).click();
  await expect(list).toBeEnabled();
  await page.evaluate(() => window.send({ method: "ui/notifications/tool-cancelled", params: { reason: "x".repeat(8 * 1024 * 1024) } }));
  await list.click();
  await expect(view.getByText("DATABASE_URL", { exact: true })).toBeVisible();
  await page.evaluate(() => { window.fixtures["vaultix.secrets.references"].references = []; });
  await list.click();
  await expect(view.getByText("No accessible references on this page.")).toBeVisible();
  await page.evaluate(() => { window.mode = "hold"; });
  await view.getByRole("textbox", { name: "Folder", exact: true }).press("Enter");
  await expect(view.getByRole("alert")).toContainText("access has changed", { timeout: 20000 });
  record("Oversized host message ignored; empty result explained; keyboard submission and request timeout leave recoverable state");
  for (const mode of ["invalidInput", "noInput"]) {
    await page.evaluate(mode => { window.mode = mode; window.send({ method: "ui/notifications/tool-cancelled", params: {} }); }, mode);
    await view.getByRole("button", { name: "Retry Connection" }).click();
    await expect.poll(() => page.evaluate(() => window.lastInitializationMode)).toBe(mode);
    if (mode === "noInput") await expect(view.getByRole("status")).toContainText("Waiting for the selected");
    await expect(view.getByRole("alert")).toContainText("connection is unavailable", { timeout: 20000 });
    assert.ok(!(await frame.locator("body").innerText()).includes("CANARY"));
  }
  record("Invalid complete input is not echoed; absent host input times out instead of hanging indefinitely");
  assert.deepEqual(errors, []);
  assert.ok(requests.every(url => url === `${origin}/` || url === `${origin}/app`), "Embedded view must make no network requests");
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify({ passed: true, artifact: manifest, checks, audits, requests, errors, realClientAcceptance: false }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, evidence }));
} catch (error) {
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify({ passed: false, checks, audits, requests, errors, failure: String(error) }, null, 2));
  console.error(`Inspect ${evidence}`);
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
