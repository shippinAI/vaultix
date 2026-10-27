// Chart fixtures are separate from real certificate/provider evidence.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function testChartRendering({ page, expect, AxeBuilder, origin, dashboardUrl, evidence }) {
  const match = url => url.origin === origin && /\/certificates\/dashboard-stats$/.test(url.pathname);
  const longLabel = "Vaultix fixture certificate authority with a deliberately long readable label";
  const caId = "00000000-0000-4000-8000-000000000001";
  let empty = false;
  const viewport = page.viewportSize();
  const accessibility = [];
  const cards = page.locator("[data-vaultix-certificate-chart]");
  const audit = async state => {
    const report = await new AxeBuilder({ page }).include("[data-vaultix-certificate-chart]")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summarize = rules => rules.map(rule => ({ id: rule.id, impact: rule.impact,
      nodes: rule.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }));
    accessibility.push({ state, scope: "Certificate distribution cards only; fixture data", engine: report.testEngine,
      violations: summarize(report.violations), manualReview: summarize(report.incomplete) });
    writeFileSync(resolve(evidence, "chart-accessibility.json"), JSON.stringify(accessibility, null, 2));
    assert.equal(report.violations.length, 0, `Card accessibility violations in ${state}`);
  };
  await page.route(match, async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200, "Chart fixture requires an authorized real dashboard response");
    const stats = await response.json();
    await route.fulfill({ response, json: { ...stats,
      distributions: {
        byEnrollmentMethod: empty ? [] : [{ label: "api", count: 2 }, { label: "acme", count: 1 }],
        byAlgorithm: empty ? [] : [{ label: "RSA_2048", count: 2 }, { label: "Unknown", count: 1 }],
        byCA: empty ? [] : [{ id: caId, label: longLabel, count: 2 }, { label: "CA without an identifier", count: 1 }]
      },
      expirationBuckets: empty ? [] : [{ bucket: "0-7d", count: 1 }, { bucket: "90d+", count: 2 }]
    } });
  });
  const open = async () => {
    await page.goto(dashboardUrl);
    try {
      await expect(page.getByRole("heading", { name: "Certificate Dashboard", exact: true })).toBeVisible({ timeout: 30000 });
    } catch (error) {
      writeFileSync(resolve(evidence, "chart-navigation-failure.json"), JSON.stringify({
        pathname: new URL(page.url()).pathname,
        headings: await page.getByRole("heading").allTextContents()
      }, null, 2));
      await page.screenshot({ path: resolve(evidence, "chart-navigation-failure.png") });
      throw error;
    }
    await expect(cards).toHaveCount(4);
  };
  const checkLayout = async () => {
    await expect.poll(() => cards.evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth)), {
      message: "Certificate card content must fit after responsive layout settles", timeout: 5000
    }).toBe(true);
    const label = cards.getByText(longLabel, { exact: true });
    await expect(label).toBeVisible();
    assert.equal(await label.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight), true,
      "Full CA label must be readable without clipping");
    assert.equal(await cards.locator("button").evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height >= 44)), true,
      "Filter rows must retain 44px targets");
  };
  try {
    await open();
    await expect(page.locator(".recharts-pie-sector")).toHaveCount(8);
    assert.equal(await page.locator(".recharts-pie").evaluateAll(elements => elements.length === 4 && elements.every(element => {
      const bounds = element.getBBox();
      return bounds.width > 100 && bounds.height > 100;
    })), true, "Charts must render full geometry without an entrance animation");
    await expect(cards.getByRole("button", { name: /Unknown|CA without an identifier/ })).toHaveCount(0);
    await expect(cards.getByText("Unknown", { exact: true })).toBeVisible();
    await checkLayout();
    await audit("nonempty desktop");
    await page.screenshot({ path: resolve(evidence, "fixture-certificate-charts.png"), fullPage: true });
    const paths = () => page.locator(".recharts-pie-sector path, path.recharts-pie-sector").evaluateAll(elements => elements.map(element => element.getAttribute("d")));
    const initialPaths = await paths();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
    assert.deepEqual(await paths(), initialPaths, "Reduced motion must retain stable chart geometry");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.getByRole("heading", { name: "Certificate Dashboard", exact: true })
      .evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
    await page.screenshot({ path: resolve(evidence, "fixture-certificate-charts-narrow.png"), fullPage: true });
    writeFileSync(resolve(evidence, "chart-layout.json"), JSON.stringify(await cards.evaluateAll(elements => elements.map(element => ({
      title: element.querySelector("h2")?.textContent,
      width: element.clientWidth, scrollWidth: element.scrollWidth,
      ancestors: Array.from((function* () { let parent = element.parentElement; while (parent) { yield parent; parent = parent.parentElement; } })()).map(parent => ({ tag: parent.tagName, class: parent.className, width: parent.clientWidth, scrollWidth: parent.scrollWidth }))
    }))), null, 2));
    await checkLayout();
    await audit("nonempty narrow reduced motion");
    await page.getByRole("region", { name: "By Issuing CA", exact: true }).screenshot({ path: resolve(evidence, "fixture-certificate-card-narrow.png") });
    await page.setViewportSize(viewport);
    const filters = [
      { label: "API", params: { filterEnrollmentType: "api" }, key: "Enter" },
      { label: "RSA 2048", params: { filterKeyAlgorithm: "RSA_2048" }, key: "Space" },
      { label: longLabel, params: { filterCaId: caId }, key: "Enter" },
      { label: "< 7 days", params: { filterExpiresDays: "7" }, key: "Space" },
      { label: "7-30 days", params: { filterExpiresAfterDays: "7", filterExpiresDays: "30" }, key: "Enter" },
      { label: "> 30 days", params: { filterExpiresAfterDays: "30" }, key: "Space" }
    ];
    for (const filter of filters) {
      await open();
      const button = cards.getByRole("button", { name: `${filter.label} `, exact: false });
      await button.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(button).toBeFocused();
      assert.equal(await button.evaluate(element => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      }), true, "Keyboard focus must have a visible outline");
      await page.keyboard.press(filter.key);
      // TanStack preserves numeric strings with JSON quoting in search parameters.
      await page.waitForURL(url => url.pathname.endsWith("/inventory") && Object.entries(filter.params).every(([key, value]) => {
        const actual = url.searchParams.get(key);
        return actual === value || actual === JSON.stringify(value);
      }), { timeout: 10000 }).catch(error => {
        const current = new URL(page.url());
        writeFileSync(resolve(evidence, "chart-filter-failure.json"), JSON.stringify({
          fixture: filter, pathname: current.pathname, search: Object.fromEntries(current.searchParams)
        }, null, 2));
        throw error;
      });
    }
    empty = true;
    await open();
    await expect(cards.getByText("No data available", { exact: true })).toHaveCount(3);
    await expect(cards.getByText("No expiration data", { exact: true })).toBeVisible();
    await expect(cards.locator("button, .recharts-pie")).toHaveCount(0);
    await audit("empty");
    return { fixtures: true, checks: ["eight full-size vector sectors without entrance animation", "complete long labels and 44px targets at desktop and 390px viewport", "nonactionable data has no inert buttons", "six filter mappings via Enter and Space with visible focus", "stable reduced-motion geometry", "empty cards", "scoped axe rules across three card states"] };
  } finally {
    await page.unroute(match);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
}
