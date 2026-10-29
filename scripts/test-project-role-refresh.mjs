// Real membership changes on a disposable project; no mocked permission responses.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testProjectRoleRefresh({ page, expect, origin, orgId, projectId, token, evidence }) {
  const report = { passed: false, fixtures: false, checks: [], refreshes: [], unexpectedResponses: [], browserErrorCount: 0 };
  const save = () => writeFileSync(resolve(evidence, "project-role-refresh.json"), JSON.stringify(report, null, 2));
  const api = async (path, method, body) => {
    const response = await fetch(origin + path, { method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, "Unexpected role-refresh API status");
    return response.json();
  };
  const base = `${origin}/organizations/${orgId}/projects/secret-management/${projectId}`;
  const projectPath = `/api/v1/projects/${projectId}`;
  const permissionPath = projectPath + "/permissions";
  const settings = `${base}/settings?selectedTab=tab-secret-policies`;
  const input = page.getByLabel("Recent versions to keep", { exact: true });
  const form = page.locator("form").filter({ has: input });
  const saveButton = form.getByRole("button", { name: "Save", exact: true });
  let writes = 0;
  let viewerPage;
  let activeAuthorization;
  const onError = () => { report.browserErrorCount++; save(); };
  const onResponse = response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/") && path !== "/api/v1/auth/token" && response.status() >= 400) {
      report.unexpectedResponses.push({ path, status: response.status() }); save();
    }
  };
  const onRequest = request => { if (new URL(request.url()).pathname === projectPath && request.method() === "PATCH") writes++; };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("pageerror", onError);
  try {
    const { identity } = await api("/api/v1/identities", "POST", { name: "Vaultix Role Refresh", organizationId: orgId, role: "member" });
    const membershipPath = `${projectPath}/memberships/identities/${identity.id}`;
    await api(membershipPath, "POST", { roles: [{ role: "admin", isTemporary: false }] });
    await page.goto(`${base}/identities/${identity.id}`);
    await page.getByRole("button", { name: "Options", exact: true }).click();
    await page.getByRole("menuitem", { name: "Assume Privileges", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Assume Machine Identity Privileges", exact: true });
    await dialog.getByLabel("Type assume to perform this action", { exact: true }).fill("assume");
    await dialog.getByRole("button", { name: "Assume Privileges", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assumed privileges", exact: true })).toBeVisible();
    await page.goto(settings);
    await expect(input).toBeEnabled();
    const original = await input.inputValue();
    const next = original === "11" ? "12" : "11";
    await input.fill(next);
    await expect(saveButton).toBeEnabled();
    // Keep this document mounted. Observe the application's existing one-minute
    // refetch, without changing its clock, query cache, hooks or response body.
    const documentId = await page.evaluate(() => performance.timeOrigin);
    const changeRole = async role => {
      report.phase = `refresh-${role}`; save();
      await api(membershipPath, "PATCH", { roles: [{ role, isTemporary: false }] });
      const response = await page.waitForResponse(async item => {
        if (new URL(item.url()).pathname !== permissionPath || item.status() !== 200) return false;
        const payload = await item.json();
        return payload.data.memberships.some(membership => membership.roles.some(entry => entry.role === role));
      }, { timeout: 75000 });
      assert.equal(response.request().method(), "GET");
      activeAuthorization = await response.request().headerValue("authorization");
      assert.ok(activeAuthorization?.startsWith("Bearer "));
      assert.equal(await page.evaluate(() => performance.timeOrigin), documentId, "Role refresh must not reload the document");
      report.refreshes.push({ role, status: response.status(), sameDocument: true }); save();
    };
    await changeRole("viewer");
    await expect(input).toBeDisabled();
    await expect(saveButton).toBeDisabled();
    await expect(input).toHaveValue(next);
    assert.equal(writes, 0, "Role changes must not submit the draft");
    report.checks.push("Revocation disables a dirty form after real permission refetch without reloading or submitting"); save();
    const grant = (await page.context().cookies(origin + "/api")).find(cookie => cookie.name === "vaultix-project-assume-privileges");
    assert.ok(grant);
    // The grant is bound to the browser's session. The bootstrap owner's token
    // is deliberately a different session and cannot exercise this grant.
    const denied = await fetch(origin + projectPath, { method: "PATCH", headers: {
      Authorization: activeAuthorization, Cookie: `${grant.name}=${grant.value}`, "Content-Type": "application/json"
    }, body: JSON.stringify({ pitVersionLimit: Number(next) }), signal: AbortSignal.timeout(20000) });
    report.revokedUpdateStatus = denied.status; save();
    assert.equal(denied.status, 403);
    assert.equal(typeof (await denied.json()).error, "string");
    report.checks.push("Server refuses the revoked identity's direct settings update with a plain error"); save();
    // A separate document starts with viewer memberships. Its callback must also
    // update on promotion, rather than retaining an initially denied role.
    viewerPage = await page.context().newPage();
    viewerPage.on("response", onResponse);
    viewerPage.on("pageerror", onError);
    await viewerPage.goto(settings);
    const viewerInput = viewerPage.getByLabel("Recent versions to keep", { exact: true });
    await expect(viewerInput).toBeDisabled();
    const viewerDocument = await viewerPage.evaluate(() => performance.timeOrigin);
    await changeRole("admin");
    await expect(input).toBeEnabled();
    await expect(saveButton).toBeEnabled();
    await expect(input).toHaveValue(next);
    await expect(viewerInput).toBeEnabled({ timeout: 75000 });
    assert.equal(await viewerPage.evaluate(() => performance.timeOrigin), viewerDocument);
    report.checks.push("A document initially loaded as viewer enables controls after promotion without reloading"); save();
    const responsePromise = page.waitForResponse(item => new URL(item.url()).pathname === projectPath && item.request().method() === "PATCH");
    await saveButton.click();
    assert.equal((await responsePromise).status(), 200);
    await expect(saveButton).toBeDisabled();
    assert.equal(writes, 1);
    report.checks.push("Restored membership enables the retained draft; explicit save succeeds exactly once"); save();
    await page.getByRole("button", { name: "Exit Assumed Privileges", exact: true }).click();
    await expect(page.getByRole("region", { name: "Assumed privileges", exact: true })).toHaveCount(0);
    assert.deepEqual(report.unexpectedResponses, []);
    assert.equal(report.browserErrorCount, 0);
    report.passed = true; delete report.phase; save();
  } finally {
    await viewerPage?.close();
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("pageerror", onError);
  }
}
