/* E2E: critical user flows through the real UI + engine.
   Run with: npm run e2e (needs `npm run e2e:install` once). */

import { test, expect } from '@playwright/test';

/** Click through the human's setup placements (targets only render on the human's turn). */
async function completeSetup(page: import('@playwright/test').Page) {
  for (let i = 0; i < 16; i++) {
    const target = page.locator('.if-target').first();
    if ((await target.count()) === 0) {
      // No targets: either bots are moving or setup is done.
      if ((await page.getByRole('button', { name: /roll the dice/i }).count()) > 0) return;
      await page.waitForTimeout(600);
      continue;
    }
    await target.click({ timeout: 8000 });
    await page.waitForTimeout(500);
  }
}

test.describe('Isleforge menu', () => {
  test('menu renders and starts a local game', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'ISLEFORGE' })).toBeVisible();
    await page.getByLabel(/captain name/i).fill('Kartik');
    await page.getByRole('button', { name: /set sail/i }).click();
    // Board renders with 19 hexes; human setup targets appear.
    await expect(page.locator('.if-hex').first()).toBeVisible({ timeout: 15000 });
    expect(await page.locator('.if-hex').count()).toBe(19);
    await expect(page.locator('.if-target').first()).toBeVisible({ timeout: 15000 });
  });

  test('rules modal opens from the menu', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /how to play/i }).click();
    await expect(page.getByRole('dialog')).toContainText('victory points');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('Isleforge game flow', () => {
  test('setup → roll dice → log updates → end turn', async ({ page }) => {
    await page.goto('/?quick=1&fast=1&seed=42&name=Kartik');
    await expect(page.locator('.if-hex').first()).toBeVisible({ timeout: 15000 });

    await completeSetup(page);

    // Human (p1) rolls first.
    const rollBtn = page.getByRole('button', { name: /roll the dice/i });
    await expect(rollBtn).toBeVisible({ timeout: 60000 });
    await rollBtn.click();

    // Dice show a real engine result.
    const dice = page.locator('.if-die');
    await expect(dice.first()).not.toHaveText('?', { timeout: 8000 });
    const d1 = Number(await dice.nth(0).textContent());
    const d2 = Number(await dice.nth(1).textContent());
    expect(d1).toBeGreaterThanOrEqual(1);
    expect(d1).toBeLessThanOrEqual(6);
    expect(d2).toBeGreaterThanOrEqual(1);
    expect(d2).toBeLessThanOrEqual(6);

    // Game log narrates the roll.
    await expect(page.locator('.if-log__entry--dice').first()).toContainText(
      new RegExp(`rolled ${d1} \\+ ${d2}`),
      { timeout: 8000 },
    );

    // If we landed in the play phase, open the trade modal and end the turn.
    if ((await page.getByRole('button', { name: /^trade$/i }).isEnabled().catch(() => false))) {
      await page.getByRole('button', { name: /^trade$/i }).click();
      await expect(page.getByRole('dialog')).toContainText('Bank & Harbor');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: /end your turn/i }).click();
      // Turn passes to bots and comes back: turn counter advances.
      await expect(page.getByText('Turn 2')).toBeVisible({ timeout: 90000 });
    }
  });

  test('build menu reflects engine state', async ({ page }) => {
    await page.goto('/?quick=1&fast=1&seed=42&name=Kartik');
    await expect(page.locator('.if-hex').first()).toBeVisible({ timeout: 15000 });
    await completeSetup(page);
    const rollBtn = page.getByRole('button', { name: /roll the dice/i });
    await expect(rollBtn).toBeVisible({ timeout: 60000 });
    await rollBtn.click();

    const tradeBtn = page.getByRole('button', { name: /^trade$/i });
    if (await tradeBtn.isEnabled().catch(() => false)) {
      // Play phase: open the build menu — options show costs and reasons.
      await page.getByRole('button', { name: /build menu/i }).click();
      const menu = page.getByRole('menu', { name: /build options/i });
      await expect(menu).toBeVisible();
      for (const label of ['Road', 'Settlement', 'City', 'Dev Card']) {
        await expect(menu.getByRole('menuitem', { name: new RegExp(label) })).toBeVisible();
      }
    }
  });

  test('player panels show live victory points', async ({ page }) => {
    await page.goto('/?quick=1&fast=1&seed=42&name=Kartik');
    await expect(page.locator('.if-hex').first()).toBeVisible({ timeout: 15000 });
    // Opponent panels render with VP badges.
    const panels = page.locator('.if-player');
    await expect(panels.first()).toBeVisible({ timeout: 15000 });
    expect(await panels.count()).toBe(4);
    await expect(panels.first().getByText(/VP/)).toBeVisible();
  });
});

test.describe('Isleforge autopilot', () => {
  test('AI battle plays a complete game to the victory screen', async ({ page }) => {
    test.setTimeout(300000);
    await page.goto('/?autopilot=1&fast=1&seed=7');
    await expect(page.locator('.if-hex').first()).toBeVisible({ timeout: 15000 });
    // A full game plays out through the real UI dispatch pipeline.
    await expect(page.getByText(/wins!/, { exact: false })).toBeVisible({ timeout: 280000 });
    // Rankings list all four players.
    const ranks = page.locator('.if-end__rank');
    expect(await ranks.count()).toBe(4);
    // Play again resets into a fresh game.
    await page.getByRole('button', { name: /play again/i }).click();
    await expect(page.locator('.if-hex').first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/wins!/)).toHaveCount(0);
  });
});
