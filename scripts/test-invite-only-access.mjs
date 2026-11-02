// Real invite link and removal on a disposable instance; no mocked API responses.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testInviteOnlyAccess({ browser, expect, AxeBuilder, origin, organizationId, token, password, evidence }) {
  const report = { passed: false, fixtures: false, checks: [], invitedCreateRequests: [], removedCreateRequests: [], violations: [] };
  const save = () => writeFileSync(resolve(evidence, "invite-only-access.json"), JSON.stringify(report, null, 2));
  const check = name => { report.checks.push(name); save(); };
  const api = async (path, { method = "GET", body } = {}) => {
    const response = await fetch(origin + path, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, "Unexpected invite workflow API status");
    return response.json();
  };
  const session = async requests => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on("response", response => {
      if (new URL(response.url()).pathname === "/api/v2/organizations" && response.request().method() === "POST") requests.push(response.status());
    });
    return { context, page };
  };
  const email = `invited-${randomBytes(8).toString("hex")}@vaultix.invalid`;
  let current;
  try {
    const { config } = await api("/api/v1/admin/config");
    assert.equal(config.allowSignUp, false, "This proof requires closed signup");
    const { completeInviteLinks } = await api("/api/v1/invite-org/signup", { method: "POST", body: { inviteeEmails: [email], organizationId } });
    const link = new URL(completeInviteLinks.find(entry => entry.email === email).link);

    current = await session(report.invitedCreateRequests);
    await current.page.goto(origin + link.pathname + link.search);
    await current.page.getByLabel("First Name", { exact: true }).fill("Invited");
    await current.page.getByLabel("Last Name", { exact: true }).fill("Member");
    await current.page.getByLabel("Password", { exact: true }).fill(password);
    // Confirmation stays inert until the password check settles; filling it earlier types into Password.
    const confirmation = current.page.getByLabel("Confirm Password", { exact: true });
    await expect.poll(() => confirmation.evaluate(element => element.closest("[inert]") === null), { timeout: 15000 }).toBe(true);
    await confirmation.fill(password);
    assert.equal(await current.page.getByLabel("Password", { exact: true }).evaluate(element => element.value.length), password.length);
    await current.page.getByRole("button", { name: "Sign Up", exact: true }).click();
    await current.page.waitForURL(`${origin}/organizations/${organizationId}/projects`, { timeout: 30000 });
    await expect(current.page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible({ timeout: 30000 });
    assert.deepEqual(report.invitedCreateRequests, [], "An invited user must not create an organization");
    await current.page.screenshot({ path: resolve(evidence, "invite-only-invited.png"), fullPage: true });
    await current.context.close();
    current = undefined;
    check("real invite link with closed signup lands in the inviting organization without creating one");

    const { users } = await api(`/api/v2/organizations/${organizationId}/memberships`);
    const membership = users.find(member => member.user.email === email);
    assert.ok(membership, "Invited user must be a member before removal");
    assert.equal(membership.status, "accepted", "Landing in the organization must accept the invitation");
    await api(`/api/v2/organizations/${organizationId}/memberships/${membership.id}`, { method: "DELETE" });
    check("the invitation was accepted and the member was removed from their only organization");

    current = await session(report.removedCreateRequests);
    const { page } = current;
    await page.goto(`${origin}/login`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue with Email" }).click();
    await expect(page.getByRole("heading", { name: "You're not in an organization yet", exact: true })).toBeVisible({ timeout: 30000 });
    assert.equal(new URL(page.url()).pathname, "/organizations/none");
    await expect(page.getByRole("status").filter({ hasText: "invite-only" })).toBeVisible();
    assert.equal(await page.getByRole("dialog").count(), 0, "A create form cannot succeed here");
    await expect(page.getByText("Bad Request", { exact: true }), "The page already explains this denial").toHaveCount(0);
    assert.deepEqual(report.removedCreateRequests, [403], "Expect exactly one denied creation request");
    check("sign-in reaches the invite-only explanation after one denied creation request");

    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    report.violations = result.violations.map(rule => ({ id: rule.id, nodes: rule.nodes.map(node => node.target) }));
    assert.equal(result.violations.length, 0, "Accessibility failure on invite-only state");
    check("invite-only state has no automated accessibility violations");
    await page.screenshot({ path: resolve(evidence, "invite-only-no-org.png"), fullPage: true });

    await page.getByRole("button", { name: "Log Out", exact: true }).focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(`${origin}/login`, { timeout: 15000 });
    await page.goto(`${origin}/organizations/none`);
    await page.waitForURL(`${origin}/login`, { timeout: 15000 });
    assert.deepEqual(report.removedCreateRequests, [403], "Signing out must not retry creation");
    check("keyboard sign-out ends the session without retrying creation");
    report.passed = true;
    save();
  } catch (error) {
    await current?.page.screenshot({ path: resolve(evidence, "invite-only-failure.png"), fullPage: true }).catch(() => {});
    save();
    throw error;
  } finally {
    await current?.context.close();
  }
}
