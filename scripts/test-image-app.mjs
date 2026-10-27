// Real browser sign-in against a disposable smoke-test image, never the operator's instance.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { testDashboardRecovery } from "./test-dashboard-recovery.mjs";
import { testChartRendering } from "./test-chart-rendering.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.argv[2];
assert.equal(process.env.VAULTIX_IMAGE_APP_PROOF, "1", "Only run with a disposable smoke instance.");
assert.match(origin ?? "", /^http:\/\/127\.0\.0\.1:\d+$/);
const require = createRequire(resolve(root, "core/e2e/package.json"));
const { chromium, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const config = await (await fetch(`${origin}/api/v1/admin/config`)).json();
assert.equal(config.config.initialized, false, "Refusing to change an initialized instance.");
const password = `Vx9!${randomBytes(24).toString("hex")}`;
const email = `image-proof-${randomBytes(6).toString("hex")}@vaultix.invalid`;
const signup = await fetch(`${origin}/api/v1/admin/signup`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, firstName: "Image", lastName: "Proof", organizationName: "Vaultix Image Proof" })
});
assert.equal(signup.status, 200, "Disposable instance bootstrap failed.");
const bootstrap = await signup.json();
const selection = await fetch(`${origin}/api/v3/auth/select-organization`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bootstrap.token}` },
  body: JSON.stringify({ organizationId: bootstrap.organization.id })
});
assert.equal(selection.status, 200, "Disposable organization selection failed.");
const selected = await selection.json();
const setup = await fetch(`${origin}/api/v1/admin/config`, {
  method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${selected.token}` },
  body: JSON.stringify({ onboardingCompleted: true, enabledLoginMethods: ["email"] })
});
assert.equal(setup.status, 200, "Disposable instance setup failed.");
mkdirSync(resolve(root, ".cache"), { recursive: true });
const evidence = mkdtempSync(resolve(root, ".cache/app-image-proof-"));
const browser = await chromium.launch({ headless: true, ...(process.env.VAULTIX_BROWSER_CHANNEL ? { channel: process.env.VAULTIX_BROWSER_CHANNEL } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  // External integrations are outside this local acceptance test. No API/auth responses are mocked.
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
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
  await expect(page.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Vaultix home", exact: true })).toBeVisible();
  assert.equal(await page.getByText("Free Pro Trial", { exact: true }).count(), 0);
  for (const product of ["Secrets Management", "Certificate Manager", "KMS", "Secret Scanning", "Privileged Access Manager"]) {
    await expect(page.getByText(product, { exact: true })).toBeVisible({ timeout: 15000 });
  }
  await page.screenshot({ path: resolve(evidence, "authenticated-projects.png"), fullPage: true });
  await audit("authenticated-dashboard");
  // Native buttons must retain both keyboard activation paths.
  await page.getByRole("button", { name: "Secrets Management", exact: true }).press("Space");
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects/secret-management`);
  await expect(page.getByRole("heading", { name: "Secrets Management", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create Project", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "secrets-projects.png"), fullPage: true });
  await page.getByRole("button", { name: "Create Project", exact: true }).click();
  const createProject = page.getByRole("dialog", { name: "Create a New Secrets Management Project" });
  await createProject.getByLabel("Project Name", { exact: true }).fill("Vaultix Lifecycle Proof");
  const projectResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/projects" && response.request().method() === "POST");
  await createProject.getByRole("button", { name: "Create Project", exact: true }).click();
  const createdResponse = await projectResponse;
  assert.equal(createdResponse.status(), 200, "Real project creation failed.");
  const { project } = await createdResponse.json();
  assert.ok(project.id);
  await page.waitForURL(`${origin}/organizations/${bootstrap.organization.id}/projects/secret-management/${project.id}/overview`);
  await expect(page.getByRole("heading", { name: "Project Overview", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "created-secrets-project.png"), fullPage: true });
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
    passed: true, fixtures: false, checks: ["root opens login", "real email sign-in", "five loaded product categories", "secrets project navigation with Space", "real project creation and overview loading", "anonymous project API denied", "KMS and scanning navigation with Enter", "certificate dashboard navigation with Space", "PAM accounts navigation", "PAM access tabs: valid deep links, invalid fallback, keyboard selection and refresh", "Vaultix application branding", "authenticated root resumes app", "anonymous project access redirects to login", "no unexpected application API failures"]
  }, null, 2));
  const recovery = await testDashboardRecovery({ page, expect, origin, orgId: bootstrap.organization.id, evidence, expectedFailures, audit });
  assert.deepEqual(errors, []);
  writeFileSync(resolve(evidence, "dashboard-recovery.json"), JSON.stringify({ passed: true, ...recovery }, null, 2));
  const charts = await testChartRendering({ page, expect, AxeBuilder, origin, dashboardUrl: certificateDashboardUrl, evidence });
  assert.deepEqual(errors, []);
  writeFileSync(resolve(evidence, "chart-rendering.json"), JSON.stringify({ passed: true, ...charts }, null, 2));
  console.log(`Real image application checks passed. Evidence: ${evidence}`);
} catch (error) {
  console.error(`Application proof failed. Evidence directory: ${evidence}`);
  throw error;
} finally {
  await browser.close();
}
