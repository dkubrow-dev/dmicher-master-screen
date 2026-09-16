import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { workspace, repo, startBrowserFixture, launchFixtureBrowser } from "./browser-fixture-server.mjs";

const fixture = await startBrowserFixture(), browser = await launchFixtureBrowser();
const baseline = process.argv.includes("--baseline");
const baselineRef = "ee6e519285da964ca2f5ac0f33b91fbc258ade41";
const output = path.join(workspace, "artifacts/dmicher-master-screen/0.0.1/object-context-menu-review", baseline ? "baseline" : "fixed");
await fs.mkdir(output, { recursive: true });
const reports = [];
try {
  for (const version of ["13.351", "14.366"]) for (const lang of ["ru", "en"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [];
    page.setDefaultTimeout(5000);
    if (baseline) for (const file of ["scripts/apps/object-context-menu.js", "styles/object-automation.css", "styles/object-tools.css"]) {
      const body = execFileSync("git", ["show", `${baselineRef}:dmicher-master-screen/${file}`], { cwd: repo, encoding: "utf8" });
      await page.route(`**/modules/dmicher-master-screen/${file}`, route => route.fulfill({ body, contentType: file.endsWith(".css") ? "text/css" : "text/javascript" }));
    }
    page.on("pageerror", error => errors.push(error.message));
    const prefix = `${version}-${lang}`;
    try {
      await page.goto(`${fixture.origin}/?version=${version}&lang=${lang}`); await page.waitForFunction(() => globalThis.ready);
      await page.evaluate(async () => {
        const { ObjectContextMenu } = await import("/modules/dmicher-master-screen/scripts/apps/object-context-menu.js");
        globalThis.testObjectMenu = new ObjectContextMenu(); globalThis.menuActions = [];
        const ru = game.i18n.lang === "ru";
        globalThis.menuLabels = { root: ru ? "Диалоги" : "Dialogues", nested: ru ? "Продолжение" : "Continue", second: ru ? "Спросить о дороге" : "Ask for directions", third: ru ? "Узнать подробности" : "Ask for details" };
        const leaf = (label, result) => ({ label, action: () => menuActions.push(result) });
        globalThis.openMenuFixture = ({ x = 520, y = 250, long = false } = {}) => {
          const filler = (prefix, count) => Array.from({ length: count }, (_, index) => leaf(`${prefix} ${index + 1}`, `${prefix}-${index + 1}`));
          const children = [{ label: ru ? "Недоступно" : "Unavailable", disabled: true },
            { label: menuLabels.nested, children: [leaf(menuLabels.third, "third"), ...filler(ru ? "Подробность" : "Detail", long ? 38 : 2)] },
            leaf(menuLabels.second, "second"), ...filler(ru ? "Вопрос" : "Question", long ? 42 : 1)];
          document.getElementById("open-panel").focus();
          return testObjectMenu.open([{ label: menuLabels.root, icon: "💬", children },
            ...filler(ru ? "Действие" : "Action", long ? 44 : 2)], { x, y });
        };
      });
      const labels = await page.evaluate(() => menuLabels);
      const root = page.locator('.ms-object-menu');
      const button = label => root.getByText(label, { exact: true });
      const category = () => root.locator('.ms-object-menu-group > button').filter({ hasText: labels.root }).first();
      const center = async locator => { const rect = await locator.boundingBox(); assert.ok(rect, "menu item has a rectangle"); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; };
      const pointHits = async locator => {
        const point = await center(locator);
        return locator.evaluate((node, point) => node === document.elementFromPoint(point.x, point.y) || node.contains(document.elementFromPoint(point.x, point.y)), point);
      };
      const moveTo = async locator => { const point = await center(locator); await page.mouse.move(point.x, point.y, { steps: 12 }); };
      const crossTo = async (from, to) => {
        const source = await center(from), destination = await center(to);
        await page.mouse.move(destination.x, source.y, { steps: 12 });
        await page.mouse.move(destination.x, destination.y, { steps: 12 });
      };
      const checkBoundsAndScroll = async () => {
        const values = await root.locator(':scope, .ms-object-submenu').evaluateAll(elements => elements.filter(element => !element.closest('[hidden]')).map(element => {
          const rect = element.getBoundingClientRect(); return { className: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, scroll: element.scrollWidth, client: element.clientWidth };
        }));
        for (const value of values) {
          assert.ok(value.left >= 0 && value.top >= 0 && value.right <= 1440.5 && value.bottom <= 1000.5, JSON.stringify(value));
          assert.ok(value.scroll <= value.client + 1, `horizontal overflow: ${JSON.stringify(value)}`);
        }
      };
      const open = async options => { await page.mouse.move(20, 950); await page.evaluate(options => openMenuFixture(options), options); await root.waitFor(); };
      // This is deliberately physical pointer movement, never locator.hover on a
      // flyout: Playwright must not scroll a clipped child into view for the test.
      await open({}); await moveTo(category());
      assert.equal(await button(labels.second).isVisible(), true, "hover opens level two");
      assert.equal(await pointHits(button(labels.second)), true, "level two is hit-testable outside its parent's bounds");
      await checkBoundsAndScroll();
      await category().click();
      assert.equal(await button(labels.second).isVisible(), true, "click after hover keeps the category open");
      await moveTo(button(labels.second)); assert.equal(await pointHits(button(labels.second)), true);
      await page.mouse.click(...Object.values(await center(button(labels.second))));
      await page.waitForFunction(() => menuActions.at(-1) === "second"); assert.equal(await root.count(), 0);

      for (const edge of [{ x: 520, y: 250 }, { x: 1438, y: 998 }]) {
        await open(edge); await moveTo(category()); await category().click();
        await crossTo(category(), button(labels.nested));
        assert.equal(await button(labels.third).isVisible(), true, "hover opens level three");
        assert.equal(await pointHits(button(labels.third)), true, "level three is hit-testable");
        await button(labels.nested).click();
        assert.equal(await button(labels.third).isVisible(), true, "click keeps the third level open");
        await crossTo(button(labels.nested), button(labels.third)); await checkBoundsAndScroll();
        if (edge.x > 1000) {
          const second = await button(labels.nested).evaluate(element => { const box = element.closest('.ms-object-submenu').getBoundingClientRect(); return { left: box.left, right: box.right }; });
          const third = await button(labels.third).evaluate(element => { const box = element.closest('.ms-object-submenu').getBoundingClientRect(); return { left: box.left, right: box.right }; });
          assert.ok(third.left < second.left && third.right <= second.left + 12, `left-opening cascade must continue left instead of covering the root: ${JSON.stringify({ second, third })}`);
        }
        await page.screenshot({ path: path.join(output, `${prefix}-${edge.x > 1000 ? "edge" : "three-level"}.png`) });
        const point = await center(button(labels.third)); await page.mouse.click(point.x, point.y);
        await page.waitForFunction(() => menuActions.at(-1) === "third"); assert.equal(await root.count(), 0);
      }

      await open({ x: 1438, y: 998, long: true }); await moveTo(category()); await crossTo(category(), button(labels.nested));
      await checkBoundsAndScroll();
      const thirdPanel = button(labels.third).locator('xpath=ancestor::*[contains(@class,"ms-object-submenu")][1]');
      const scrollable = await thirdPanel.evaluate(panel => [panel, ...panel.querySelectorAll('*')].filter(element => element.scrollHeight > element.clientHeight + 1 && ['auto','scroll'].includes(getComputedStyle(element).overflowY)).map(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight })));
      assert.ok(scrollable.length > 0, "long submenu owns a vertical scroll area");
      const panelPosition = await center(thirdPanel); await page.mouse.move(panelPosition.x, panelPosition.y); await page.mouse.wheel(0, 800);
      await page.waitForFunction(() => [...document.querySelectorAll('.ms-object-submenu:not([hidden]), .ms-object-submenu:not([hidden]) *')].some(element => element.scrollTop > 0));
      await checkBoundsAndScroll();
      assert.equal(await page.evaluate(() => document.documentElement.scrollLeft), 0);
      await page.screenshot({ path: path.join(output, `${prefix}-long-menu.png`) });
      await page.mouse.click(25, 950); assert.equal(await root.count(), 0, "outside click closes all levels");

      await open({}); await category().focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), labels.nested, "keyboard enters first enabled child");
      await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => document.activeElement.textContent), labels.third);
      await page.keyboard.press('ArrowLeft'); assert.equal(await page.evaluate(() => document.activeElement.textContent), labels.nested);
      assert.equal(await button(labels.third).isVisible(), false);
      await page.keyboard.press('ArrowLeft'); assert.ok((await page.evaluate(() => document.activeElement.textContent)).includes(labels.root));
      assert.equal(await button(labels.second).isVisible(), false);
      await page.keyboard.press('Escape'); assert.equal(await root.count(), 0);
      assert.equal(await page.evaluate(() => document.activeElement.id), "open-panel");
      errors.push(...await page.evaluate(() => globalThis.errors)); assert.deepEqual(errors, []);
      reports.push({ version, lang, checks: "physical pointer crossings and clicks through levels two/three; viewport edges; local vertical scroll without horizontal overflow; outside/Escape dismissal; keyboard return", errors });
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${prefix}-failure.png`) });
      reports.push({ version, lang, failure: error.message, errors });
      await fs.writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(reports, null, 2)); console.log(JSON.stringify(reports, null, 2));
} finally { await browser.close(); await fixture.close(); }
