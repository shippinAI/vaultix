// Real early-access workflow on a disposable instance; no mocked API responses.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function testEarlyAccess({ browser, expect, AxeBuilder, origin, adminEmail, token, password, evidence }) {
  const report = { passed: false, checks: [], violations: {} };
  const save = () => writeFileSync(resolve(evidence, "early-access.json"), JSON.stringify(report, null, 2));
  const check = name => { report.checks.push(name); save(); };
  const call = async (path, { method = "GET", body, auth = token } = {}) => {
    const response = await fetch(origin + path, { method,
      headers: { ...(auth ? { Authorization: auth.startsWith("Bearer ") ? auth : `Bearer ${auth}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
  };
  // The public endpoint has a low per-client limit, so earlier steps can legitimately use it up.
  const untilAllowed = async attempt => {
    for (;;) {
      const result = await attempt();
      if (result.status !== 429) return result;
      await new Promise(done => setTimeout(done, (Number(result.headers.get("retry-after")) || 10) * 1000 + 1000));
    }
  };
  const submit = body => untilAllowed(() => call("/api/v1/early-access/requests", { method: "POST", body, auth: null }));
  const status = async () => (await call("/api/v1/early-access/status", { auth: null })).body.acceptingRequests;
  const list = async query => {
    const result = await call(`/api/v1/early-access/requests?${new URLSearchParams(query)}`);
    assert.equal(result.status, 200, "An administrator must be able to list requests");
    return result.body;
  };
  const organizationCount = async () => (await call("/api/v1/admin/organization-management/organizations?limit=100")).body.organizations.length;
  const audit = async (page, state) => {
    await page.waitForTimeout(300);
    const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    report.violations[state] = result.violations.map(rule => ({ id: rule.id, nodes: rule.nodes.map(node => node.target) }));
    assert.equal(result.violations.length, 0, `Accessibility failure on ${state}`);
  };
  const session = async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    return { context, page: await context.newPage() };
  };
  const contexts = [];
  const open = async () => { const created = await session(); contexts.push(created.context); return created.page; };
  const unique = label => `${label}-${randomBytes(6).toString("hex")}@vaultix.invalid`;
  const row = (page, email) => page.getByRole("row").filter({ hasText: email });
  const rowAction = async (page, email, action) => {
    await page.getByRole("button", { name: `Options for ${email}`, exact: true }).click();
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    // A closing menu is still in the DOM, fading, and a dialog can hide it from role queries.
    await expect(page.locator("[role=menu]")).toHaveCount(0);
  };
  let admin;
  try {
    assert.equal(await status(), false, "A new instance must not collect requests until an administrator allows it");
    assert.equal((await call("/api/v1/early-access/requests", { method: "POST", body: { email: unique("closed") }, auth: null })).status, 403);
    assert.equal((await list({})).totalCount, 0, "A closed form stores nothing");
    const closed = await open();
    await closed.goto(origin);
    await expect(closed.getByRole("heading", { level: 1 })).toContainText("Build boldly.");
    const statusRead = closed.waitForResponse(response => response.url().endsWith("/api/v1/early-access/status")).catch(() => null);
    await closed.reload();
    await statusRead;
    assert.equal(await closed.locator("#early-access").count(), 0, "A closed form is not shown");
    assert.equal(await closed.getByRole("link", { name: "Early access", exact: true }).count(), 0);
    check("a new instance is closed: no form, no stored request");

    const anonymous = await call("/api/v1/early-access/requests", { auth: null });
    assert.equal(anonymous.status, 401, "Requests hold contact details and need an administrator");
    for (const [path, method] of [["/api/v1/early-access/requests/00000000-0000-4000-8000-000000000000/invite", "POST"], ["/api/v1/early-access/requests/00000000-0000-4000-8000-000000000000/decline", "POST"], ["/api/v1/early-access/requests/00000000-0000-4000-8000-000000000000", "DELETE"]])
      assert.equal((await call(path, { method, body: method === "POST" ? { organizationName: "Denied" } : undefined, auth: null })).status, 401);
    check("listing and reviewing requires sign-in");

    admin = await open();
    await admin.goto(`${origin}/login`);
    await admin.getByLabel("Email", { exact: true }).fill(adminEmail);
    await admin.getByLabel("Password", { exact: true }).fill(password);
    await admin.getByRole("button", { name: "Continue with Email" }).click();
    await admin.waitForURL(url => /^\/organizations\/[^/]+\/projects/.test(new URL(url).pathname), { timeout: 30000 });
    await admin.goto(`${origin}/admin/early-access`);
    await expect(admin.getByRole("heading", { name: "Early Access", exact: true })).toBeVisible({ timeout: 30000 });
    const toggle = admin.getByRole("switch", { name: "Accept early access requests" });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect.poll(status, { timeout: 15000 }).toBe(true);
    await audit(admin, "admin-empty");
    check("an administrator opens the form from the admin console");

    const visitor = await open();
    await visitor.goto(origin);
    const form = visitor.getByRole("form", { name: "Request early access" });
    await expect(form).toBeVisible({ timeout: 15000 });
    await expect(visitor.getByRole("link", { name: "Early access", exact: true })).toBeVisible();
    await form.scrollIntoViewIfNeeded();
    await audit(visitor, "landing-form");
    await form.getByRole("button", { name: "Request early access" }).click();
    await expect(form.getByRole("alert").filter({ hasText: "Enter your email address." })).toBeVisible();
    await expect(form.getByLabel("Email", { exact: true })).toBeFocused();
    await form.getByLabel("Email", { exact: true }).fill("not-an-address");
    await form.getByRole("button", { name: "Request early access" }).click();
    await expect(form.getByRole("alert").filter({ hasText: "Enter a valid email address." })).toBeVisible();
    await audit(visitor, "landing-form-errors");
    await form.screenshot({ path: resolve(evidence, "early-access-form.png") });
    assert.equal((await list({})).totalCount, 0, "Invalid input must not reach the store");

    const requester = unique("requester");
    const markup = `<img src=x onerror="document.body.dataset.injected='1'">`;
    await form.getByLabel("Email", { exact: true }).fill(requester.toUpperCase());
    await form.getByLabel("Name (optional)").fill("Early Requester");
    await form.getByLabel("Organization (optional)").fill("Requester Labs");
    await form.getByLabel("What would you use Vaultix for? (optional)").fill(markup);
    await form.getByRole("button", { name: "Request early access" }).click();
    const done = visitor.getByRole("heading", { name: "Thanks. We've got your request." });
    await expect(done).toBeVisible();
    await expect(done).toBeFocused();
    await audit(visitor, "landing-confirmation");
    await visitor.screenshot({ path: resolve(evidence, "early-access-landing.png"), fullPage: true });
    check("the landing form validates, submits and confirms by keyboard focus");

    await visitor.setViewportSize({ width: 320, height: 800 });
    await visitor.goto(origin);
    await expect(visitor.getByRole("form", { name: "Request early access" })).toBeVisible({ timeout: 15000 });
    await visitor.getByRole("form", { name: "Request early access" }).scrollIntoViewIfNeeded();
    const overflow = await visitor.evaluate(() => {
      const scroller = document.querySelector(".vaultix-public");
      return scroller.scrollWidth - scroller.clientWidth;
    });
    assert.ok(overflow <= 1, "The form must reflow at 320 pixels");
    check("the form reflows at 320 pixels");

    const stored = await list({ search: requester });
    assert.equal(stored.totalCount, 1, "The address is stored once, in lower case");
    assert.equal(stored.requests[0].email, requester);
    const repeat = await submit({ email: requester, name: "Changed" });
    assert.equal(repeat.status, 200);
    assert.deepEqual(repeat.body, { received: true });
    const afterRepeat = await list({ search: requester });
    assert.equal(afterRepeat.totalCount, 1, "A repeat must not add a row");
    assert.equal(afterRepeat.requests[0].name, "Early Requester", "A repeat must not change the original request");
    const trap = unique("trap");
    assert.equal((await submit({ email: trap, website: "https://spam.invalid" })).status, 200);
    assert.equal((await list({ search: trap })).totalCount, 0, "A filled hidden field stores nothing");
    assert.equal((await submit({ email: "someone@mailinator.com" })).status, 400, "The deployed disposable list applies");
    assert.equal((await submit({ email: unique("extra"), status: "invited" })).status, 400, "Callers cannot set review fields");
    const oversized = await submit({ email: unique("big"), useCase: "x".repeat(20 * 1024) });
    assert.ok([400, 413].includes(oversized.status), "An oversized body is refused");
    const failure = await submit({ email: "not-an-address" });
    assert.equal(failure.status, 400);
    assert.equal(typeof failure.body.error, "string", "Expected failures carry a plain error string");
    check("repeats, automated submissions and invalid input add nothing");

    const tag = randomBytes(6).toString("hex");
    const hostile = [`\u202emoc.${tag}@eoj.invalid`, `per\u200bson${tag}@vaultix.invalid`, `nul\u0000${tag}@vaultix.invalid`, `<img>${tag}@vaultix.invalid`];
    for (const email of hostile) {
      const refused = await submit({ email });
      assert.equal(refused.status, 400, "A hostile address is an invalid request, not a server failure");
      assert.equal(typeof refused.body.error, "string");
    }
    assert.equal((await submit({ email: unique("bidi"), name: `a\u202eb` })).status, 400, "Directional overrides stay out of stored text");
    assert.equal((await list({ search: tag })).totalCount, 0, "No hostile address reaches the store");
    const formAddress = unique("form");
    const formPost = await untilAllowed(async () => {
      const response = await fetch(`${origin}/api/v1/early-access/requests`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email: formAddress }), signal: AbortSignal.timeout(20000) });
      return { status: response.status, headers: response.headers };
    });
    assert.equal(formPost.status, 400, "A page on another site must not be able to post a form here");
    assert.equal((await list({ search: formAddress })).totalCount, 0);
    const foreign = await fetch(`${origin}/api/v1/early-access/requests`, { method: "OPTIONS", headers: { Origin: "https://elsewhere.invalid", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }, signal: AbortSignal.timeout(20000) });
    assert.notEqual(foreign.headers.get("access-control-allow-origin"), "https://elsewhere.invalid", "Another site's JSON post must fail its preflight");
    check("hostile addresses and text, and form posts from other sites, are refused");

    await admin.reload();
    await expect(row(admin, requester)).toBeVisible({ timeout: 15000 });
    await expect(row(admin, requester).getByText(markup, { exact: true })).toBeVisible();
    assert.equal(await admin.evaluate(() => document.body.dataset.injected ?? ""), "", "Submitted markup must stay text");
    assert.equal(await row(admin, requester).locator("img").count(), 0);
    await expect(admin.getByText("1 request waiting for review.", { exact: true })).toBeVisible();
    await audit(admin, "admin-requests");
    check("an administrator sees the request, with submitted markup left inert");

    const organizationsBefore = await organizationCount();
    await rowAction(admin, requester, "Invite");
    const inviteDialog = admin.getByRole("dialog", { name: "Invite to Vaultix" });
    await expect(inviteDialog.getByLabel("New organization name")).toHaveValue("Requester Labs");
    await audit(admin, "admin-invite-dialog");
    await inviteDialog.getByRole("button", { name: "Create and invite" }).click();
    const linkDialog = admin.getByRole("dialog", { name: "Share this invitation" });
    await expect(linkDialog).toBeVisible({ timeout: 30000 });
    const invitation = new URL(await linkDialog.getByLabel("Invitation link").inputValue());
    assert.equal(invitation.pathname, "/signupinvite");
    assert.equal(invitation.searchParams.get("to"), requester);
    await audit(admin, "admin-invite-link");
    await admin.screenshot({ path: resolve(evidence, "early-access-admin.png"), fullPage: true });
    await linkDialog.getByRole("button", { name: "Done" }).click();
    assert.equal(await organizationCount(), organizationsBefore + 1);
    const invited = (await list({ search: requester })).requests[0];
    assert.equal(invited.status, "invited");
    assert.ok(invited.invitedOrgId, "The decision records the organization");
    const adminOrganizations = (await call("/api/v1/organization")).body.organizations.map(organization => organization.id);
    assert.ok(!adminOrganizations.includes(invited.invitedOrgId), "The administrator is not made a member of the new organization");
    assert.ok(!JSON.stringify(await list({ search: requester })).includes("signupinvite"), "Listing never returns the invitation link");
    check("inviting creates one organization and hands back a link");

    const retried = await call(`/api/v1/early-access/requests/${invited.id}/invite`, { method: "POST", body: { organizationName: "Second Attempt" } });
    assert.equal(retried.status, 400, "A request can only be invited once");
    assert.equal(await organizationCount(), organizationsBefore + 1, "A refused invite leaves no organization behind");
    const concurrentTarget = unique("concurrent");
    assert.equal((await submit({ email: concurrentTarget })).status, 200);
    const concurrent = (await list({ search: concurrentTarget })).requests[0];
    const race = await Promise.all(["Race One", "Race Two", "Race Three"].map(organizationName =>
      call(`/api/v1/early-access/requests/${concurrent.id}/invite`, { method: "POST", body: { organizationName } })));
    assert.equal(race.filter(result => result.status === 200).length, 1, "Exactly one concurrent invite wins");
    assert.equal(race.filter(result => result.status === 400).length, 2, "A concurrent loser is told so, not given a server failure");
    assert.equal(await organizationCount(), organizationsBefore + 2, "Losing invites roll back their organizations");
    check("repeated and concurrent invites leave exactly one organization");

    const elsewhere = unique("elsewhere");
    const existing = await call("/api/v1/admin/organization-management/organizations", { method: "POST", body: { name: "Existing Organization", inviteAdminEmails: [elsewhere] } });
    assert.equal(existing.status, 200, "An organization with a pending invitation is the case under test");
    assert.equal((await submit({ email: elsewhere })).status, 200);
    const elsewhereRequest = (await list({ search: elsewhere })).requests[0];
    const organizationsWithExisting = await organizationCount();
    const refusedInvite = await call(`/api/v1/early-access/requests/${elsewhereRequest.id}/invite`, { method: "POST", body: { organizationName: "Not Created" } });
    assert.equal(refusedInvite.status, 400, "An invitation link could open the other organization");
    assert.equal(typeof refusedInvite.body.error, "string");
    assert.ok(!JSON.stringify(refusedInvite.body).includes("signupinvite"), "A refusal must not carry a link");
    assert.equal(await organizationCount(), organizationsWithExisting, "A refused invite creates nothing");
    assert.equal((await list({ search: elsewhere })).requests[0].status, "pending", "The request is still there to handle another way");
    check("an address with a pending invitation elsewhere gets no invitation link from here");

    const firstLink = new URL(race.find(result => result.status === 200).body.invitation.link);
    await admin.getByRole("combobox", { name: "Filter requests by status" }).click();
    await admin.getByRole("option", { name: "Invited", exact: true }).click();
    await rowAction(admin, concurrentTarget, "Send a new invitation");
    const reissueDialog = admin.getByRole("dialog", { name: "Share this invitation" });
    await expect(reissueDialog).toBeVisible({ timeout: 30000 });
    await expect(reissueDialog.getByText("72 hours")).toBeVisible();
    await audit(admin, "admin-reissue-link");
    const secondLink = new URL(await reissueDialog.getByLabel("Invitation link").inputValue());
    await reissueDialog.getByRole("button", { name: "Done" }).click();
    assert.notEqual(secondLink.searchParams.get("token"), firstLink.searchParams.get("token"), "A replacement link has a new token");
    const verifyInvite = link => call("/api/v1/invite-org/verify", { method: "POST", auth: null, body: { email: link.searchParams.get("to"), organizationId: link.searchParams.get("organization_id"), code: link.searchParams.get("token") } });
    assert.notEqual((await verifyInvite(firstLink)).status, 200, "A replaced link stops working");
    assert.equal((await verifyInvite(secondLink)).status, 200, "The replacement link works");
    const pendingMembership = (await call(`/api/v1/admin/organization-management/organizations?limit=100`)).body.organizations.find(organization => organization.id === existing.body.organization.id).members.find(member => member.user.email === elsewhere);
    const resent = await call(`/api/v1/admin/organization-management/organizations/${existing.body.organization.id}/memberships/${pendingMembership.membershipId}/resend-invite`, { method: "POST" });
    assert.equal(resent.status, 400, "Without mail, resending would only cancel a link already shared");
    await admin.getByRole("combobox", { name: "Filter requests by status" }).click();
    await admin.getByRole("option", { name: "Pending", exact: true }).click();
    check("a lost link can be replaced, the old one stops working, and resending without mail refuses");

    const invitedVisitor = await session();
    contexts.push(invitedVisitor.context);
    const authHeaders = [];
    invitedVisitor.page.on("request", request => {
      const value = request.headers().authorization;
      if (value && new URL(request.url()).pathname.startsWith("/api/")) authHeaders.push(value);
    });
    await invitedVisitor.page.goto(origin + invitation.pathname + invitation.search);
    await invitedVisitor.page.getByLabel("First Name", { exact: true }).fill("Early");
    await invitedVisitor.page.getByLabel("Last Name", { exact: true }).fill("Requester");
    await invitedVisitor.page.getByLabel("Password", { exact: true }).fill(password);
    // Confirmation stays inert until the password check settles; filling it earlier types into Password.
    const confirmation = invitedVisitor.page.getByLabel("Confirm Password", { exact: true });
    await expect.poll(() => confirmation.evaluate(element => element.closest("[inert]") === null), { timeout: 15000 }).toBe(true);
    await confirmation.fill(password);
    await invitedVisitor.page.getByRole("button", { name: "Sign Up", exact: true }).click();
    await invitedVisitor.page.waitForURL(`${origin}/organizations/${invited.invitedOrgId}/projects`, { timeout: 30000 });
    await expect(invitedVisitor.page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible({ timeout: 30000 });
    const { users } = await call(`/api/v1/admin/user-management/users?limit=100&searchTerm=${encodeURIComponent(requester)}`).then(result => result.body);
    assert.equal(users.filter(user => user.email === requester).length, 1, "The requester holds one account");
    check("the requester follows the link and lands in their new organization");

    const requesterAuth = authHeaders.at(-1);
    assert.ok(requesterAuth, "The application must authenticate the invited session");
    assert.equal((await call("/api/v1/early-access/requests", { auth: requesterAuth })).status, 403, "An organization admin is not an instance admin");
    assert.equal((await call(`/api/v1/early-access/requests/${concurrent.id}`, { method: "DELETE", auth: requesterAuth })).status, 403);
    assert.equal((await call(`/api/v1/early-access/requests/${elsewhereRequest.id}/invite`, { method: "POST", body: { organizationName: "Denied" }, auth: requesterAuth })).status, 403);
    assert.equal((await call(`/api/v1/early-access/requests/${elsewhereRequest.id}/decline`, { method: "POST", auth: requesterAuth })).status, 403);
    assert.equal((await call(`/api/v1/early-access/requests/${concurrent.id}/reissue-invitation`, { method: "POST", auth: requesterAuth })).status, 403);
    assert.equal((await call("/api/v1/early-access/requests/delete-matching", { method: "POST", body: { status: "pending" }, auth: requesterAuth })).status, 403);
    assert.equal((await list({ search: elsewhere })).totalCount, 1, "A denied bulk delete removes nothing");
    assert.equal((await call(`/api/v1/early-access/requests/${invited.id}/reissue-invitation`, { method: "POST" })).status, 400, "An accepted invitation has nothing to replace");
    assert.equal((await call("/api/v1/admin/config", { method: "PATCH", body: { earlyAccessRequestsEnabled: false }, auth: requesterAuth })).status, 403);
    await invitedVisitor.page.goto(`${origin}/admin/early-access`);
    await invitedVisitor.page.waitForURL(url => new URL(url).pathname.startsWith("/organizations/"), { timeout: 30000 });
    check("a non-administrator cannot read, invite, decline, reissue or delete requests, change the setting or open the page");

    const declined = unique("declined");
    const removed = unique("removed");
    assert.equal((await submit({ email: declined })).status, 200);
    assert.equal((await submit({ email: removed })).status, 200);
    await admin.reload();
    await rowAction(admin, declined, "Decline");
    await expect(row(admin, declined)).toHaveCount(0, { timeout: 15000 });
    assert.equal((await list({ search: declined })).requests[0].status, "declined");
    assert.equal((await submit({ email: declined })).status, 200);
    assert.equal((await list({ search: declined })).requests[0].status, "declined", "Asking again does not reopen a decision");
    await rowAction(admin, removed, "Delete");
    const deleteDialog = admin.getByRole("alertdialog");
    await deleteDialog.getByRole("textbox").fill("delete");
    await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
    // An open dialog hides the table from role queries, so the row only counts once it has closed.
    await expect(deleteDialog).toHaveCount(0, { timeout: 15000 });
    await expect(row(admin, removed)).toHaveCount(0, { timeout: 15000 });
    assert.equal((await list({ search: removed })).totalCount, 0, "Deleting removes the personal data");
    check("an administrator can decline and delete requests");

    const floodTag = randomBytes(6).toString("hex");
    const floodAddresses = [`flood-${floodTag}-a@vaultix.invalid`, `flood-${floodTag}-b@vaultix.invalid`];
    for (const email of floodAddresses) assert.equal((await submit({ email })).status, 200);
    const survivor = (await list({ search: elsewhere })).totalCount;
    await admin.reload();
    await admin.getByRole("textbox", { name: "Search early access requests" }).fill(floodTag);
    const bulk = admin.getByRole("button", { name: "Delete all 2 matching", exact: true });
    await expect(bulk).toBeEnabled({ timeout: 15000 });
    // While a filter not seen yet loads, the screen still shows this one's rows and count.
    // A filter already loaded shows its own at once, so it would not reach this state.
    const slowList = async route => { await new Promise(done => setTimeout(done, 4000)); await route.continue(); };
    await admin.route("**/api/v1/early-access/requests?*", slowList);
    await admin.getByRole("textbox", { name: "Search early access requests" }).fill(floodTag.slice(0, 8));
    await admin.waitForTimeout(1500);
    await expect(bulk).toBeDisabled();
    await admin.unrouteAll({ behavior: "wait" });
    await admin.getByRole("textbox", { name: "Search early access requests" }).fill(floodTag);
    await expect(bulk).toBeEnabled({ timeout: 15000 });
    await bulk.click();
    const bulkDialog = admin.getByRole("alertdialog");
    await expect(bulkDialog.getByText(`Delete all 2 pending requests matching "${floodTag}"?`)).toBeVisible();
    await bulkDialog.getByRole("textbox").fill("delete");
    await bulkDialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(bulkDialog).toHaveCount(0, { timeout: 15000 });
    assert.equal((await list({ search: floodTag })).totalCount, 0, "Bulk delete removes what the filter shows");
    assert.equal((await list({ search: elsewhere })).totalCount, survivor, "Bulk delete leaves what the filter does not show");
    assert.equal((await call("/api/v1/early-access/requests/delete-matching", { method: "POST", body: { status: "invited" } })).status, 400, "Invited requests do not go in bulk");
    assert.ok((await list({ search: requester })).totalCount === 1, "An invited request survives");
    assert.equal((await call("/api/v1/early-access/requests/delete-matching", { method: "POST", body: { status: "pending" }, auth: null })).status, 401);
    await admin.getByRole("textbox", { name: "Search early access requests" }).fill("");
    check("an administrator can recover from a flood by deleting what a filter shows, and nothing else");

    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect.poll(status, { timeout: 15000 }).toBe(false);
    assert.equal((await submit({ email: unique("late") })).status, 403);
    const after = await open();
    await after.goto(origin);
    const statusAfter = after.waitForResponse(response => response.url().endsWith("/api/v1/early-access/status")).catch(() => null);
    await after.reload();
    await statusAfter;
    await expect(after.getByRole("heading", { level: 1 })).toContainText("Build boldly.");
    assert.equal(await after.locator("#early-access").count(), 0, "Closing removes the form");
    check("closing the form removes it and stops new requests");

    let limited;
    for (let attempt = 0; attempt < 15 && !limited; attempt += 1) {
      const result = await call("/api/v1/early-access/requests", { method: "POST", body: { email: unique("limit") }, auth: null });
      if (result.status === 429) limited = result;
    }
    assert.ok(limited, "The public endpoint must be rate limited");
    assert.equal(typeof limited.body.error, "string");
    check("the public endpoint is rate limited per client");
    report.passed = true;
    save();
  } catch (error) {
    await admin?.screenshot({ path: resolve(evidence, "early-access-failure.png"), fullPage: true }).catch(() => {});
    save();
    throw error;
  } finally {
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
  }
}
