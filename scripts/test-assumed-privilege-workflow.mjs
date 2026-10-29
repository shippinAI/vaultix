// Real packaged privilege switching; injected transport failures are labelled.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testAssumedPrivilegeWorkflow({ page, expect, AxeBuilder, origin, orgId, projectId, token, evidence, expectedFailures }) {
  const report = { passed: false, checks: [], fixtures: ["held request", "503 after real switch/exit", "malformed /api cookie"], accessibility: [], api: [] };
  const save = () => writeFileSync(resolve(evidence, "assumed-privilege-workflow.json"), JSON.stringify(report, null, 2));
  const path = `/api/v1/projects/${projectId}/assume-privileges`;
  const base = `${origin}/organizations/${orgId}/projects/secret-management/${projectId}`;
  const cookieName = "vaultix-project-assume-privileges";
  const api = async (url, method = "GET", body, cookie, status = 200) => {
    const response = await fetch(origin + url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const failure = response.status >= 400 ? await response.clone().json() : null;
    if (failure) assert.equal(typeof failure.error, "string");
    report.api.push({ path: url, method, status: response.status }); save();
    assert.equal(response.status, status, "Unexpected disposable privilege API status");
    return response;
  };
  const issuedCookie = response => {
    const header = response.headers.getSetCookie().find(value => value.startsWith(cookieName + "="));
    assert.ok(header, "Issuer must set a grant cookie");
    assert.match(header, /Path=\/api(?:;|$)/i); assert.match(header, /HttpOnly/i);
    return header.split(";")[0];
  };
  const audit = async (state, selector) => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
    });
    const result = await new AxeBuilder({ page }).include(selector).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summarize = rules => rules.map(rule => ({ id: rule.id, nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    report.accessibility.push({ state, engine: result.testEngine, violations: summarize(result.violations), manualReview: summarize(result.incomplete) }); save();
    assert.equal(result.violations.length, 0, `Scoped accessibility failure: ${state}`);
  };
  const check = name => { report.checks.push(name); save(); };
  let routeHandler;
  const match = url => url.origin === origin && url.pathname === path;
  expectedFailures.add(path);
  try {
    const { identity } = await (await api("/api/v1/identities", "POST", { name: "Vaultix Workflow Identity With A Deliberately Long Name", organizationId: orgId, role: "member" })).json();
    await api(`/api/v1/projects/${projectId}/memberships/identities/${identity.id}`, "POST", { roles: [{ role: "admin", isTemporary: false }] });
    await api(path, "DELETE"); await api(path, "DELETE");
    const invalidExit = await api(path, "DELETE", undefined, `${cookieName}=malformed-fixture`);
    issuedCookie(invalidExit);
    const denied = await fetch(origin + path, { method: "DELETE" }); assert.equal(denied.status, 401);
    const granted = issuedCookie(await api(path, "POST", { actorId: identity.id, actorType: "identity" }));
    const wrong = await api(`/api/v1/projects/${randomUUID()}/assume-privileges`, "DELETE", undefined, granted, 400);
    assert.equal(wrong.headers.getSetCookie().length, 0);
    issuedCookie(await api(path, "DELETE", undefined, granted));
    check("real issuance, matching exit, absent/invalid grant idempotence, cross-project refusal and anonymous denial");

    await page.goto(`${base}/identities/${identity.id}`);
    const open = async () => {
      await page.getByRole("button", { name: "Options", exact: true }).click();
      await page.getByRole("menuitem", { name: "Assume Privileges", exact: true }).click();
    };
    await open();
    let dialog = page.getByRole("dialog", { name: "Assume Machine Identity Privileges", exact: true });
    const inputName = "Type assume to perform this action";
    await expect(dialog.getByLabel(inputName, { exact: true })).toBeFocused();
    await expect(dialog.getByRole("button", { name: "Assume Privileges", exact: true })).toBeDisabled();
    await dialog.getByLabel(inputName, { exact: true }).fill("incorrect");
    await expect(dialog.getByRole("button", { name: "Assume Privileges", exact: true })).toBeDisabled();
    await audit("confirmation", '[role="dialog"]');
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Options", exact: true })).toBeFocused();
    await open();
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dialog.getByLabel(inputName, { exact: true })).toHaveValue("");
    await dialog.getByLabel(inputName, { exact: true }).fill("assume");
    await audit("confirmation-narrow-reduced-motion", '[role="dialog"]');
    const fits = await dialog.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && el.scrollWidth <= el.clientWidth; }); assert.equal(fits, true);
    await page.screenshot({ path: resolve(evidence, "assumed-confirmation-narrow.png"), fullPage: true });
    let release; const held = new Promise(done => { release = done; }); let starts = 0;
    routeHandler = async route => {
      if (route.request().method() !== "POST") return route.continue();
      starts++; await held; await route.continue();
    };
    await page.route(match, routeHandler);
    await dialog.getByLabel(inputName, { exact: true }).press("Enter");
    await expect.poll(() => starts).toBe(1);
    await dialog.getByLabel(inputName, { exact: true }).press("Enter");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
    report.phase="pending-status"; save();
    await expect(dialog.getByRole("status", { name: "Privilege status", exact: true })).toContainText("Switching privileges");
    await page.waitForTimeout(200); assert.equal(starts, 1);
    release();
    const banner = page.getByRole("region", { name: "Assumed privileges", exact: true });
    await expect(banner).toBeVisible({ timeout: 20000 });
    await page.unroute(match, routeHandler); routeHandler = undefined;
    report.phase="banner-identity"; save();
    await expect(banner).toContainText(identity.name);
    const grantCookie = (await page.context().cookies(origin + "/api")).find(cookie => cookie.name === cookieName);
    assert.ok(grantCookie?.httpOnly && grantCookie.path === "/api");
    assert.ok(grantCookie.expires > Date.now() / 1000 + 3500 && grantCookie.expires <= Date.now() / 1000 + 3600);
    await audit("active-privileges-narrow", 'section[aria-label="Assumed privileges"]');
    const exit = banner.getByRole("button", { name: "Exit Assumed Privileges", exact: true });
    await expect(exit).toBeVisible();
    const inside = await exit.evaluate(el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.height>=44; }); assert.equal(inside,true);
    await page.screenshot({ path: resolve(evidence, "assumed-banner-narrow.png"), fullPage: true });
    check("labelled confirmation, invalid input, keyboard focus restoration, one pending submission, real grant and narrow banner");

    let exits = 0;
    routeHandler = async route => {
      if (route.request().method() !== "DELETE") return route.continue();
      exits++;
      const response = await route.fetch(); assert.equal(response.status(), 200);
      // The actual server clears its cookie; only the response status/body is replaced.
      await route.fulfill({ response, status: 503, json: { error: "Unavailable", message: "Disposable response failure after exit" } });
    };
    await page.route(match, routeHandler);
    await exit.press("Enter");
    report.phase="exit-reconciliation"; save();
    await expect(banner.getByRole("status", { name: "Privilege status", exact: true })).toContainText("could not confirm the exit");
    await expect(banner.getByRole("button", { name: "Exit Assumed Privileges", exact: true })).toHaveCount(0);
    await audit("exit-reconciliation", 'section[aria-label="Assumed privileges"]');
    assert.equal(exits, 1);
    await page.unroute(match, routeHandler); routeHandler = undefined;
    await banner.getByRole("button", { name: "Reload Project", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project Overview", exact: true })).toBeVisible();
    await expect(banner).toHaveCount(0);
    assert.equal((await page.context().cookies(origin + "/api")).some(cookie => cookie.name === cookieName), false);
    check("real exit followed by injected 503 requires reload and reconciles cleared authority");

    await page.context().addCookies([{ name: cookieName, value: "malformed-fixture", domain: "127.0.0.1", path: "/api", httpOnly: true, sameSite: "Strict" }]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Project Overview", exact: true })).toBeVisible();
    await expect.poll(async () => (await page.context().cookies(origin + "/api")).some(cookie => cookie.name === cookieName)).toBe(false);
    check("real middleware rejection removes the invalid /api browser cookie");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/identities/${identity.id}`); await open();
    routeHandler = async route => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch(); assert.equal(response.status(), 200);
      await route.fulfill({ response, status: 503, json: { error: "Unavailable", message: "Disposable response failure after switch" } });
    };
    await page.route(match, routeHandler);
    dialog = page.getByRole("dialog", { name: "Assume Machine Identity Privileges", exact: true });
    await dialog.getByLabel(inputName, { exact: true }).fill("assume");
    await dialog.getByRole("button", { name: "Assume Privileges", exact: true }).click();
    report.phase="switch-reconciliation"; save();
    await expect(dialog.getByRole("status", { name: "Privilege status", exact: true })).toContainText("could not confirm the switch");
    await expect(dialog.getByRole("button", { name: "Assume Privileges", exact: true })).toBeDisabled();
    await audit("switch-reconciliation", '[role="dialog"]');
    await page.unroute(match, routeHandler); routeHandler = undefined;
    await dialog.getByRole("button", { name: "Reload Project", exact: true }).click();
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Exit Assumed Privileges", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project Overview", exact: true })).toBeVisible();
    await expect(banner).toHaveCount(0);
    check("real switch followed by injected 503 reconciles active authority, then normal exit succeeds");
    // SMTP is absent in the disposable image; this creates an invited member
    // fixture, not an email delivery or a second user's sign-in proof.
    const memberEmail = `assumed-member-${randomUUID()}@vaultix.invalid`;
    await api("/api/v1/invite-org/signup", "POST", { inviteeEmails: [memberEmail], organizationId: orgId });
    await api(`/api/v1/projects/${projectId}/memberships`, "POST", { usernames: [memberEmail], roleSlugs: ["admin"] });
    const { memberships } = await (await api(`/api/v1/projects/${projectId}/memberships`)).json();
    const member = memberships.find(item => item.user.email === memberEmail || item.user.username === memberEmail);
    assert.ok(member, "Invited member must belong to this project");
    await page.goto(`${base}/members/${member.id}`); await open();
    const userDialog = page.getByRole("dialog", { name: "Assume User Privileges", exact: true });
    await userDialog.getByLabel(inputName, { exact: true }).fill("assume");
    await userDialog.getByRole("button", { name: "Assume Privileges", exact: true }).click();
    await expect(banner).toBeVisible(); await expect(banner).toContainText("privileges of user");
    await banner.getByRole("button", { name: "Exit Assumed Privileges", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Project Overview", exact: true })).toBeVisible();
    await expect(banner).toHaveCount(0);
    check("API-created invited member confirmation, real user-target grant and exit; no second-user sign-in or email delivery");
    report.passed = true; save();
  } finally {
    if (routeHandler) await page.unroute(match, routeHandler);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expectedFailures.delete(path); save();
  }
}
