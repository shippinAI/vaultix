// Real browser sign-in against a disposable smoke-test image, never the operator's instance.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testAssumedPrivilegeWorkflow } from "./test-assumed-privilege-workflow.mjs";
import { testProjectRoleRefresh } from "./test-project-role-refresh.mjs";
import { testOrgMfaWorkflow } from "./test-org-mfa-workflow.mjs";
import { testLoginRecovery } from "./test-login-recovery.mjs";
import { testFirstRunSetup } from "./test-first-run-setup.mjs";
import { testDashboardRecovery } from "./test-dashboard-recovery.mjs";
import { testChartRendering } from "./test-chart-rendering.mjs";
import { testEnvironmentWorkflow } from "./test-environment-workflow.mjs";
import { testCreateSecretWorkflow } from "./test-create-secret-workflow.mjs";
import { testCreateSecretRecovery } from "./test-create-secret-recovery.mjs";
import { testDashboardSecretPaste } from "./test-dashboard-secret-paste.mjs";
import { testDashboardSecretReferences } from "./test-dashboard-secret-references.mjs";
import { testDashboardCreateWorkflow } from "./test-dashboard-create-workflow.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.argv[2];
assert.equal(process.env.VAULTIX_IMAGE_APP_PROOF, "1", "Only run with a disposable smoke instance.");
assert.match(origin ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const config = await (await fetch(`${origin}/api/v1/admin/config`)).json();
assert.equal(config.config.initialized, false, "Refusing to change an initialized instance.");
// Separate random byte pairs so credentials cannot violate the repeated-character policy.
const password = `Vx9!${[...randomBytes(24)].map(byte => byte.toString(16).padStart(2, "0")).join("-")}`;
const email = `image-proof-${randomBytes(6).toString("hex")}@vaultix.invalid`;
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/app-image-proof-"));
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
const authEvents = [];
let phase = "entry";
try {
  const { bootstrap, selected } = await testFirstRunSetup({ browser, expect, AxeBuilder, origin, email, password, evidence });
  phase = "login-recovery";
  await testLoginRecovery({ browser, expect, AxeBuilder, origin, email, password, organizationId: bootstrap.organization.id, evidence });
  phase = "entry";
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // External integrations are outside this local acceptance test. No API/auth responses are mocked.
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on("requestfailed", request => {
    if (new URL(request.url()).pathname === "/api/v1/auth/token") authEvents.push({ phase, event: "request-failed" });
  });
  page.on("response", async response => {
    if (new URL(response.url()).pathname !== "/api/v1/auth/token") return;
    const event = { phase, status: response.status() };
    authEvents.push(event);
    event.cookieSet = Boolean((await response.allHeaders().catch(() => ({})))["set-cookie"]);
    if (response.status() >= 400) {
      const body = await response.json().catch(() => ({}));
      const known = new Set(["TokenReuse", "InvalidToken", "RotationFailed", "UnauthorizedError", "Unauthorized", "RateLimitError", "Too Many Requests"]);
      event.error = known.has(body.error) ? body.error : "other";
    }
  });
  const accessibility = [];
  const audit = async state => {
    await page.evaluate(async () => {
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summarize = rules => rules.map(rule => ({ id: rule.id, impact: rule.impact,
      nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    accessibility.push({ state, engine: report.testEngine, violations: summarize(report.violations), manualReview: summarize(report.incomplete) });
    writeFileSync(resolve(evidence, "accessibility.json"), JSON.stringify(accessibility, null, 2));
    assert.equal(report.violations.length, 0, `Accessibility violations in ${state}; inspect accessibility.json.`);
  };
  const errors = [];
  const chartRequests = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/\/assets\/recharts-.*\.js$/.test(path)) chartRequests.push(path);
  });
  const expectedFailures = new Set();
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/") && response.status() >= 400 && path !== "/api/v1/auth/token" && !expectedFailures.has(path)) {
      errors.push(`HTTP ${response.status()} ${path}`);
    }
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  assert.equal(new URL(page.url()).pathname, "/login");
  assert.equal(chartRequests.length, 0, "Real image login must not load the chart renderer");
  await page.screenshot({ path: resolve(evidence, "login.png"), fullPage: true });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Continue with Email" }).click();
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects`, { timeout: 30000 });
  phase = "authenticated-navigation";
  await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vaultix home", exact: true })).toBeVisible();
  assert.equal(await page.getByText("Free Pro Trial", { exact: true }).count(), 0);
  for (const product of ["Secrets Management", "Certificate Manager", "KMS", "Secret Scanning", "Privileged Access Manager"]) {
    await expect(page.getByText(product, { exact: true })).toBeVisible({ timeout: 15000 });
  }
  await page.screenshot({ path: resolve(evidence, "authenticated-projects.png"), fullPage: true });
  await audit("authenticated-dashboard");
  phase = "refresh-recovery";
  const originalCookie = (await context.cookies(`${origin}/api/v1/auth/token`)).find(cookie => cookie.name === "jid");
  assert.ok(originalCookie, "Real login must establish a refresh cookie");
  // Rotate on the real server while deliberately withholding its response from the browser.
  const lostRotation = await fetch(`${origin}/api/v1/auth/token`, {
    method: "POST", headers: { Cookie: `jid=${originalCookie.value}` }
  });
  assert.equal(lostRotation.status, 200);
  await lostRotation.body?.cancel();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
  const recoveredCookie = (await context.cookies(`${origin}/api/v1/auth/token`)).find(cookie => cookie.name === "jid");
  assert.equal(Boolean(recoveredCookie && recoveredCookie.value !== originalCookie.value), true,
    "A grace response must replace the stranded browser cookie");
  // The current compatibility grace is 10 seconds. Verify recovery beyond that window.
  await new Promise(resolveDelay => setTimeout(resolveDelay, 11000));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
  authEvents.push({ phase, event: "recovered-cookie-survives-grace-expiry" });
  phase = "authenticated-navigation";
  phase = "organization-mfa";
  await testOrgMfaWorkflow({ page, expect, AxeBuilder, origin, orgId: bootstrap.organization.id, evidence, expectedFailures });
  assert.deepEqual(errors, []);
  await page.goto(`${origin}/organizations/${bootstrap.organization.id}/projects`);
  phase = "authenticated-navigation";
  // Native buttons must retain both keyboard activation paths.
  await page.getByRole("button", { name: "Secrets Management", exact: true }).press("Space");
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects/secret-management`);
  await expect(page.getByRole("heading", { name: "Secrets Management", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Project", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "secrets-projects.png"), fullPage: true });
  phase = "project-creation";
  await page.getByRole("button", { name: "Create Project", exact: true }).click();
  const createProject = page.getByRole("dialog", { name: "Create a New Secrets Management Project" });
  await createProject.getByLabel("Project Name", { exact: true }).fill("Vaultix Lifecycle Proof");
  const projectResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/projects" && response.request().method() === "POST");
  const overviewResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/dashboard/secrets-overview" && response.request().method() === "GET");
  // Observe cleanup rejection even when an earlier assertion fails before these awaits.
  // The original promises still reject at their awaited assertions.
  void projectResponse.catch(() => {});
  void overviewResponse.catch(() => {});
  await createProject.getByRole("button", { name: "Create Project", exact: true }).click();
  const createdResponse = await projectResponse;
  assert.equal(createdResponse.status(), 200, "Real project creation failed.");
  const { project } = await createdResponse.json();
  assert.ok(project.id);
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects/secret-management/${project.id}/overview`);
  await expect(page.getByRole("heading", { name: "Project Overview", exact: true })).toBeVisible();
  const loadedOverview = await overviewResponse;
  assert.equal(loadedOverview.status(), 200, "The created project's overview must finish loading.");
  assert.equal(new URL(loadedOverview.url()).searchParams.get("projectId"), project.id);
  const overview = await loadedOverview.json();
  assert.equal(overview.totalCount, 0, "The new project must return an empty resource list.");
  await expect(page.getByText("Upload your secrets", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Add a New Secret", exact: true })).toBeEnabled();
  await expect(page.getByRole("table")).toHaveCount(0);
  writeFileSync(resolve(evidence, "project-overview.json"), JSON.stringify({
    passed: true, fixtures: false, responseStatus: loadedOverview.status(),
    projectMatched: true, resourceCount: overview.totalCount,
    emptyStateRendered: true, addSecretEnabled: true, loadingTableRemoved: true
  }, null, 2));
  await page.screenshot({ path: resolve(evidence, "created-secrets-project.png"), fullPage: true });
  await testCreateSecretWorkflow({ page, expect, AxeBuilder, evidence });
  await testCreateSecretRecovery({ page, expect, origin, evidence, expectedFailures,
    readMetadata: async (key, environment) => {
      const query = new URLSearchParams({ projectId: project.id, environment, secretPath: "/", viewSecretValue: "false", expandSecretReferences: "false" });
      const response = await fetch(`${origin}/api/v4/secrets/${encodeURIComponent(key)}?${query}`, {
        headers: { Authorization: `Bearer ${selected.token}` }
      });
      const body = await response.json();
      return { status: response.status, valueHidden: body.secret?.secretValueHidden === true,
        encryptedMetadataPresent: body.secret?.secretMetadata?.some(item => item.key === "PUBLIC_EMPTY_METADATA" && item.isEncrypted === true) === true };
    }
  });
  await testDashboardSecretPaste({ page, expect, origin, orgId: bootstrap.organization.id, projectId: project.id, evidence });
  await testDashboardSecretReferences({ page, expect, evidence });
  await testDashboardCreateWorkflow({ page, expect, AxeBuilder, origin, projectId: project.id, autoCapitalization: project.autoCapitalization, evidence, expectedFailures,
    readMetadata: async (key, environment, tagId) => {
      const query = new URLSearchParams({ projectId: project.id, environment, secretPath: "/", viewSecretValue: "false", expandSecretReferences: "false" });
      const response = await fetch(`${origin}/api/v4/secrets/${encodeURIComponent(key)}?${query}`, { headers: { Authorization: `Bearer ${selected.token}` } });
      const body = await response.json();
      return { status: response.status, valueHidden: body.secret?.secretValueHidden === true, tagPresent: body.secret?.tags?.some(tag => tag.id === tagId) === true };
    }
  });
  const unauthenticatedProject = await fetch(`${origin}/api/v1/projects/${project.id}`);
  assert.equal(unauthenticatedProject.status, 401, "Project API must deny unauthenticated reads.");
  await page.goto(origin);
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects`);
  await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
  for (const [name, slug] of [["KMS", "kms"], ["Secret Scanning", "secret-scanning"]]) {
    await page.getByRole("button", { name, exact: true }).press("Enter");
    await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects/${slug}`);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.goto(origin);
    await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects`);
  }
  const certificateTile = page.getByRole("button", { name: "Certificate Manager", exact: true });
  await expect(certificateTile).toHaveAttribute("aria-disabled", "false");
  await certificateTile.press("Space");
  await page.waitForURL(url => url.pathname.startsWith(`/organizations/${bootstrap.organization.id}/projects/cert-manager/`) && url.pathname.endsWith("/overview"));
  await expect(page.getByRole("heading", { name: "Certificate Dashboard", exact: true })).toBeVisible();
  const certificateDashboardUrl = page.url();
  assert.ok(chartRequests.length > 0, "Certificate dashboard must load the deferred chart renderer");
  await page.screenshot({ path: resolve(evidence, "certificate-dashboard.png"), fullPage: true });
  await page.goto(origin);
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects`);
  await page.getByRole("button", { name: "Privileged Access Manager", exact: true }).press("Enter");
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/pam/accounts`);
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "pam-accounts.png"), fullPage: true });
  const pamAccessUrl = `${origin}/organizations/${bootstrap.organization.id}/pam/access-management`;
  for (const [value, name] of [["members", "Members"], ["groups", "Groups"], ["identities", "Identities"], ["invalid-tab", "Members"]]) {
    await page.goto(`${pamAccessUrl}?selectedTab=${value}`);
    await expect(page.getByRole("heading", { name: "Access Control", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: new RegExp(`^${name}`) })).toHaveAttribute("aria-selected", "true");
  }
  await page.getByRole("tab", { name: /^Members/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: /^Groups/ })).toHaveAttribute("aria-selected", "true");
  await page.waitForURL(url => url.searchParams.get("selectedTab") === "groups");
  await page.reload();
  await expect(page.getByRole("tab", { name: /^Groups/ })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: resolve(evidence, "pam-access-groups.png"), fullPage: true });
  const anonymous = await browser.newContext();
  const denied = await anonymous.newPage();
  await denied.goto(`${origin}/organizations/${bootstrap.organization.id}/projects`);
  await denied.waitForURL(`${origin}/login`);
  await expect(denied.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  writeFileSync(resolve(evidence, "result.json"), JSON.stringify({
    passed: true, fixtures: false, checks: ["root opens login", "real email sign-in", "five loaded product categories", "secrets project navigation with Space", "real project creation and completed overview response with rendered empty state", "anonymous project API denied", "KMS and scanning navigation with Enter", "certificate dashboard navigation with Space", "PAM accounts navigation", "PAM access tabs: valid deep links, invalid fallback, keyboard selection and refresh", "Vaultix application branding", "authenticated root resumes app", "anonymous project access redirects to login", "no unexpected application API failures"]
  }, null, 2));
  phase = "dashboard-recovery";
  const recovery = await testDashboardRecovery({ page, expect, origin, orgId: bootstrap.organization.id, evidence, expectedFailures, audit });
  assert.deepEqual(errors, []);
  writeFileSync(resolve(evidence, "dashboard-recovery.json"), JSON.stringify({ passed: true, ...recovery }, null, 2));
  phase = "charts";
  const charts = await testChartRendering({ page, expect, AxeBuilder, origin, dashboardUrl: certificateDashboardUrl, evidence });
  assert.deepEqual(errors, []);
  writeFileSync(resolve(evidence, "chart-rendering.json"), JSON.stringify({ passed: true, ...charts }, null, 2));
  phase = "environments";
  await testEnvironmentWorkflow({ page, expect, AxeBuilder, origin, orgId: bootstrap.organization.id, projectId: project.id, evidence, expectedFailures });
  assert.deepEqual(errors, []);
  phase = "assumed-privileges";
  await testAssumedPrivilegeWorkflow({ page, expect, AxeBuilder, origin, orgId: bootstrap.organization.id, projectId: project.id, token: selected.token, evidence, expectedFailures });
  assert.deepEqual(errors, []);
  phase = "project-role-refresh";
  await testProjectRoleRefresh({ page, expect, origin, orgId: bootstrap.organization.id, projectId: project.id, token: selected.token, evidence });
  assert.deepEqual(errors, []);
  writeFileSync(resolve(evidence, "workflow-result.json"), JSON.stringify({
    passed: true,
    scope: "This disposable packaged-application run; real operations and injected fixtures remain separately labelled. Organization MFA evidence is in org-mfa-workflow.json.",
    reports: ["org-mfa-workflow.json", "project-role-refresh.json", "assumed-privilege-workflow.json", "login-recovery.json", "onboarding-result.json", "onboarding-accessibility.json", "result.json", "project-overview.json", "auth-navigation.json", "dashboard-recovery.json", "chart-rendering.json", "environment-lifecycle.json", "environment-recovery.json", "environment-accessibility.json", "create-secret-workflow.json", "create-secret-accessibility.json", "create-secret-recovery.json", "dashboard-secret-paste.json", "dashboard-secret-references.json", "dashboard-reference-semantics.json", "dashboard-create-workflow.json", "dashboard-create-accessibility.json", "dashboard-create-semantics.json", "dashboard-create-attempts.json"]
  }, null, 2));
  console.log(`Real image application checks passed. Evidence: ${evidence}`);
} catch (error) {
  writeFileSync(resolve(evidence, "failure.json"), JSON.stringify({ passed: false, phase,
    errorType: error.name, ...(typeof error.actual === "number" ? { actual: error.actual } : {}),
    ...(typeof error.expected === "number" ? { expected: error.expected } : {})
  }, null, 2));
  console.error(`Application proof failed. Evidence directory: ${evidence}`);
  throw error;
} finally {
  writeFileSync(resolve(evidence, "auth-navigation.json"), JSON.stringify(authEvents, null, 2));
  await browser.close();
}
