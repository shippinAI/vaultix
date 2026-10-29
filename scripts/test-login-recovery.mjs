// Called only by the disposable image harness. Fixture failures and real rate
// enforcement are recorded separately; no operator accounts or stored credentials.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testLoginRecovery({ browser, expect, AxeBuilder, origin, email, password, organizationId, evidence }) {
  const report = { passed: false, fixtures: [], realChecks: [], accessibility: [] };
  let phase = "fixture setup";
  let context;
  let credentialLogged = false;
  const consoleChecks = [];
  const save = () => writeFileSync(resolve(evidence, "login-recovery.json"), JSON.stringify(report, null, 2));
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on("console", event => consoleChecks.push(Promise.all(event.args().map(async arg => {
      const text = await arg.evaluate(value => { try { return JSON.stringify(value); } catch { return String(value); } }).catch(() => "");
      if (typeof text === "string" && (text.includes(email) || text.includes(password))) credentialLogged = true;
    }))));
    let count = 0, status = 429, retry = "60", code, message;
    let delayed;
    await page.route("**/api/v3/auth/login", async route => {
      count++;
      if (delayed) await delayed;
      if (status === 0) return route.abort("failed");
      return route.fulfill({ status, contentType: "application/json", headers: retry === undefined ? {} : { "Retry-After": retry },
        body: JSON.stringify({ error: code ?? "unsafe-provider-diagnostic", message: message ?? "unsafe-provider-diagnostic" }) });
    });
    await page.goto(`${origin}/login`);
    const submit = page.getByRole("button", { name: "Continue with Email", exact: true });
    const emailInput = page.getByLabel("Email", { exact: true });
    const passwordInput = page.getByLabel("Password", { exact: true });
    await emailInput.fill(email);
    await passwordInput.fill(password);
    await page.clock.install();
    const preserved = async () => {
      // Compare in memory; never put credentials in an assertion diff or receipt.
      assert.ok((await emailInput.inputValue()) === email && (await passwordInput.inputValue()) === password, "Login entries must survive recoverable failures");
      assert.ok(!(await page.locator("body").innerText()).includes("unsafe-provider-diagnostic"));
    };
    const audit = async state => {
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const summarize = rules => rules.map(rule => ({ id: rule.id, impact: rule.impact, targets: rule.nodes.map(node => node.target) }));
      report.accessibility.push({ state, violations: summarize(result.violations), manualReview: summarize(result.incomplete) });
      save();
      assert.equal(result.violations.length, 0, "Login recovery accessibility failed");
    };
    phase = "rate-limit fixture";
    await submit.click();
    await expect(page.getByText("Sign-in Temporarily Limited", { exact: true })).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(passwordInput).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByRole("timer")).toHaveAttribute("aria-live", "off");
    await preserved();
    await audit("rate-limited-desktop");
    await page.screenshot({ path: resolve(evidence, "login-rate-limited.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await audit("rate-limited-320");
    await page.screenshot({ path: resolve(evidence, "login-rate-limited-mobile.png"), fullPage: true });
    await passwordInput.press("Enter");
    await page.locator("form").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(count, 1);
    await page.clock.fastForward(61000);
    await expect(submit).toBeEnabled();
    await expect(page.getByRole("status")).toContainText("You can try again now");
    assert.equal(count, 1, "Expiry must not resubmit credentials");
    report.fixtures.push("numeric Retry-After, stable announcement, narrow reflow, no resubmit during or after cooldown");

    phase = "service and network fixtures";
    status = 503; retry = undefined;
    await submit.click();
    await expect(page.getByText("Sign-in Temporarily Unavailable", { exact: true })).toBeVisible();
    await expect(passwordInput).toHaveAttribute("aria-invalid", "false");
    await preserved();
    await audit("service-unavailable-320");
    status = 0;
    await submit.click();
    await expect(page.getByText("Connection Interrupted", { exact: true })).toBeVisible();
    await preserved();
    report.fixtures.push("503 and transport failures preserve inputs without reporting bad credentials or echoing diagnostics");

    phase = "credential and lock fixtures";
    status = 400; message = "Invalid credentials";
    await submit.click();
    await expect(page.getByText("Check Your Sign-in Details", { exact: true })).toBeVisible();
    await expect(passwordInput).toHaveAttribute("aria-invalid", "true");
    await expect(passwordInput).toHaveAttribute("aria-describedby", "login-feedback-message");
    await passwordInput.fill(`${password}x`);
    await expect(passwordInput).toHaveAttribute("aria-invalid", "false");
    await passwordInput.fill(password);
    code = "User Locked"; message = "unsafe-provider-diagnostic";
    await submit.click();
    await expect(page.getByText("Account Temporarily Locked", { exact: true })).toBeVisible();
    await preserved();
    report.fixtures.push("credential errors are associated with fields; account locks retain safe guidance");

    phase = "header and duplicate-submit fixtures";
    status = 429; code = undefined; retry = "invalid";
    await submit.click();
    await expect(page.getByRole("timer")).toContainText("60 seconds");
    await page.clock.fastForward(61000);
    await expect(submit).toBeEnabled();
    retry = new Date((await page.evaluate(() => Date.now())) + 7000).toUTCString();
    await submit.click();
    await expect(submit).toBeDisabled();
    await page.clock.fastForward(8000);
    await expect(submit).toBeEnabled();
    const beforePending = count;
    let release;
    delayed = new Promise(resolveDelay => { release = resolveDelay; });
    status = 503; retry = undefined;
    await submit.click();
    await expect.poll(() => count).toBe(beforePending + 1);
    await page.locator("form").evaluate(form => {
      for (let i = 0; i < 3; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    release(); delayed = undefined;
    await expect(page.getByText("Sign-in Temporarily Unavailable", { exact: true })).toBeVisible();
    assert.equal(count, beforePending + 1, "Pending submissions must be deduplicated");
    await preserved();
    report.fixtures.push("invalid/date Retry-After handling and one in-flight login request");

    code = "Captcha Required"; status = 400;
    await submit.click();
    await expect(page.getByText("Verification Unavailable", { exact: true })).toBeVisible();
    await expect(submit).toBeDisabled();
    report.fixtures.push("missing CAPTCHA configuration gives administrator recovery guidance");
    await Promise.all(consoleChecks);
    assert.equal(credentialLogged, false, "Login failures must not log submitted credentials");
    report.credentialLoggingAbsent = true;
    await context.close(); context = undefined;

    phase = "real rate-limit recovery";
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const real = await context.newPage();
    await real.goto(`${origin}/login`);
    await real.getByLabel("Email", { exact: true }).fill(email);
    await real.getByLabel("Password", { exact: true }).fill(password);
    // Invalid input consumes admission without making password attempts against an account.
    for (let i = 0; i < 60; i++) {
      const response = await context.request.post(`${origin}/api/v3/auth/login`, { data: {} });
      assert.ok([422, 429].includes(response.status()), "Unexpected login admission response");
    }
    let attempts = 0;
    real.on("request", request => { if (new URL(request.url()).pathname === "/api/v3/auth/login") attempts++; });
    const realSubmit = real.getByRole("button", { name: "Continue with Email", exact: true });
    const rejected = real.waitForResponse(response => new URL(response.url()).pathname === "/api/v3/auth/login");
    void rejected.catch(() => {});
    await realSubmit.click();
    assert.equal((await rejected).status(), 429);
    await expect(real.getByText("Sign-in Temporarily Limited", { exact: true })).toBeVisible();
    await expect(realSubmit).toBeDisabled();
    await expect(realSubmit).toBeEnabled({ timeout: 65000 });
    assert.equal(attempts, 1, "Real cooldown expiry must wait for the user");
    await realSubmit.click();
    await real.waitForURL(`${origin}/organizations/${organizationId}/projects`, { timeout: 30000 });
    await expect(real.getByRole("heading", { name: "Organization Overview", exact: true })).toBeVisible();
    assert.equal(attempts, 2);
    report.realChecks.push("production 429 reaches the form", "actual server window expires", "manual retry signs in with preserved inputs");
    report.passed = true;
  } catch (error) {
    report.failure = { phase, errorType: error.name };
    throw error;
  } finally {
    await Promise.all(consoleChecks);
    report.credentialLoggingAbsent = !credentialLogged;
    save();
    await context?.close();
  }
}
