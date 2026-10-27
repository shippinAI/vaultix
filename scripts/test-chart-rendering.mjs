// Nonempty chart fixtures, separate from real certificate/provider evidence.
import assert from "node:assert/strict";
import { resolve } from "node:path";

export async function testChartRendering({ page, expect, origin, dashboardUrl, evidence }) {
  const match = url => url.origin === origin && /\/certificates\/dashboard-stats$/.test(url.pathname);
  await page.route(match, async route => {
    const response = await route.fetch();
    assert.equal(response.status(), 200, "Chart fixture requires an authorized real dashboard response");
    const stats = await response.json();
    await route.fulfill({ response, json: { ...stats,
      distributions: {
        byEnrollmentMethod: [{ label: "api", count: 2 }, { label: "acme", count: 1 }],
        byAlgorithm: [{ label: "Fixture algorithm", count: 3 }],
        byCA: [{ label: "Fixture CA", count: 3 }]
      },
      expirationBuckets: [{ bucket: "0-7d", count: 1 }, { bucket: "90d+", count: 2 }]
    } });
  });
  try {
    await page.goto(dashboardUrl);
    await expect(page.getByRole("heading", { name: "Certificate Dashboard", exact: true })).toBeVisible();
    await expect(page.locator(".recharts-pie-sector")).toHaveCount(6);
    // Recharts animates SVG path data with requestAnimationFrame, not the Web
    // Animations API. Mounted sectors alone can still be tiny opening slivers.
    await page.waitForFunction(() => {
      const charts = [...document.querySelectorAll(".recharts-pie")];
      return charts.length === 4 && charts.every(chart => {
        const bounds = chart.getBBox();
        return bounds.width > 100 && bounds.height > 100;
      });
    });
    await expect(page.locator(".recharts-pie-sector path, path.recharts-pie-sector")).toHaveCount(6);
    await page.evaluate(() => new Promise((resolveStable, reject) => {
      let previous = "";
      let stableSince = performance.now();
      let frame;
      const deadline = setTimeout(() => {
        cancelAnimationFrame(frame);
        reject(new Error("Certificate chart geometry did not settle"));
      }, 5000);
      const sample = () => {
        const signature = [...document.querySelectorAll(".recharts-pie-sector path, path.recharts-pie-sector")]
          .map(path => path.getAttribute("d")).join("|");
        if (signature !== previous) {
          previous = signature;
          stableSince = performance.now();
        }
        if (performance.now() - stableSince >= 200) {
          clearTimeout(deadline);
          resolveStable();
        } else frame = requestAnimationFrame(sample);
      };
      sample();
    }));
    const legend = page.getByRole("button", { name: "API 67% 2", exact: true });
    await expect(legend).toBeVisible();
    await page.screenshot({ path: resolve(evidence, "fixture-certificate-charts.png"), fullPage: true });
    await legend.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(url => url.pathname.endsWith("/inventory") && url.searchParams.get("filterEnrollmentType") === "api");
    return { fixtures: true, checks: ["six nonempty SVG chart sectors render with full-size settled geometry", "distribution legend reports fixture counts", "keyboard legend activation navigates to filtered inventory"] };
  } finally {
    await page.unroute(match);
  }
}
