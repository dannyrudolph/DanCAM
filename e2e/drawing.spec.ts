import { type Page, expect, test } from '@playwright/test';

/** Number shown in the properties panel row with this label. */
const prop = (page: Page, label: string) => page.locator(`#properties dd[data-prop="${label}"]`);

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Types a value into the input boxes starting from the canvas (no box focused). */
async function typeValues(page: Page, ...values: string[]): Promise<void> {
  for (let i = 0; i < values.length; i++) {
    await page.keyboard.type(values[i]!);
    await page.keyboard.press(i === values.length - 1 ? 'Enter' : 'Tab');
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(prop(page, 'entity-count')).toHaveText('0');
});

test('a line placed with locked length and angle has exact coordinates in the properties panel', async ({ page }) => {
  await page.keyboard.press('l');
  await expect(page.getByTestId('tool-line')).toHaveClass(/active/);
  await expect(page.locator('#status .status-prompt')).toHaveText('Line: pick the first point');

  await typeValues(page, '0', '0'); // first point X, Y
  await typeValues(page, '1.25', '30'); // length, angle
  await expect(prop(page, 'entity-count')).toHaveText('1');

  await page.keyboard.press('Escape'); // leave the tool
  await expect(page.locator('.options-tool')).toHaveText('Select');
  await page.getByTestId('zoom-extents').click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y); // the line's midpoint is at the center after Zoom Extents

  await page.getByTestId('precision').selectOption('8');
  await expect(prop(page, 'Start X')).toHaveText('0.00000000');
  await expect(prop(page, 'End X')).toHaveText('1.08253175');
  await expect(prop(page, 'End Y')).toHaveText('0.62500000');
  await expect(prop(page, 'Length')).toHaveText('1.25000000');
  await expect(prop(page, 'Angle')).toHaveText('30.00000000°');
  // full stored precision on hover
  await expect(prop(page, 'End X')).toHaveAttribute('title', String(1.25 * Math.cos(Math.PI / 6)));
});

test('values accept fractions, arithmetic and unit suffixes', async ({ page }) => {
  await page.keyboard.press('l');
  await typeValues(page, '3/8', '0.375+0.010');
  await typeValues(page, '25.4mm', '90');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await expect(prop(page, 'Start X')).toHaveText('0.3750');
  await expect(prop(page, 'Start Y')).toHaveText('0.3850');
  await expect(prop(page, 'End X')).toHaveText('0.3750');
  await expect(prop(page, 'End Y')).toHaveText('1.3850');
});

test('an invalid value is marked and nothing is placed', async ({ page }) => {
  await page.keyboard.press('l');
  await page.keyboard.type('abc'); // letters don't start typing; "a" is not a value key
  await page.keyboard.type('1+');
  await page.keyboard.press('Tab');
  await expect(page.locator('.input-field input[data-field="x"]')).toHaveClass(/invalid/);
  await page.keyboard.press('Enter');
  await expect(prop(page, 'entity-count')).toHaveText('0');
});

test('clicked points chain, and Close finishes a triangle; Undo and Redo step through it', async ({ page }) => {
  const c = await canvasCenter(page);
  await page.getByTestId('tool-line').click();
  await page.mouse.click(c.x - 100, c.y + 60);
  await expect(page.locator('[data-option="close"]')).toBeDisabled();
  await page.mouse.click(c.x + 100, c.y + 60);
  await page.mouse.click(c.x, c.y - 80);
  await page.locator('[data-option="close"]').click();
  await expect(prop(page, 'entity-count')).toHaveText('3');

  await page.keyboard.press('Escape');
  await page.getByTestId('undo').click();
  await expect(prop(page, 'entity-count')).toHaveText('2');
  await page.keyboard.press('Control+z');
  await expect(prop(page, 'entity-count')).toHaveText('1');
  await page.getByTestId('redo').click();
  await expect(prop(page, 'entity-count')).toHaveText('2');
});

test('Undo during a line chain removes the last segment and keeps drawing', async ({ page }) => {
  const c = await canvasCenter(page);
  await page.keyboard.press('l');
  await page.mouse.click(c.x - 100, c.y);
  await page.mouse.click(c.x, c.y);
  await page.mouse.click(c.x + 100, c.y + 50);
  await expect(prop(page, 'entity-count')).toHaveText('2');
  await page.keyboard.press('Control+z');
  await expect(prop(page, 'entity-count')).toHaveText('1');
  await expect(page.getByTestId('tool-line')).toHaveClass(/active/);
});

test('Esc clears locked values first, then leaves the tool', async ({ page }) => {
  await page.keyboard.press('l');
  await page.keyboard.type('0.5');
  await page.keyboard.press('Tab');
  await expect(page.locator('.input-field input[data-field="x"]')).toHaveClass(/locked/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.input-field input.locked')).toHaveCount(0);
  await expect(page.getByTestId('tool-line')).toHaveClass(/active/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-line')).not.toHaveClass(/active/);
});

test('new lines take the chosen style', async ({ page }) => {
  await page.getByTestId('style').selectOption('hidden');
  await page.keyboard.press('l');
  await typeValues(page, '0', '0');
  await typeValues(page, '1', '0');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await expect(prop(page, 'Style')).toHaveText('Hidden');
});

test('the Point tool places a point at typed coordinates', async ({ page }) => {
  await page.keyboard.press('p');
  await typeValues(page, '0.25', '-0.5');
  await expect(prop(page, 'entity-count')).toHaveText('1');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await expect(prop(page, 'X')).toHaveText('0.2500');
  await expect(prop(page, 'Y')).toHaveText('-0.5000');
});

test('the demo drawing loads and renders without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?demo');
  await expect(prop(page, 'entity-count')).toHaveText('14');
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -2000); // deep zoom
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});

test('a focused box that has not been typed in keeps following the cursor', async ({ page }) => {
  const c = await canvasCenter(page);
  await page.keyboard.press('l');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.type('1');
  await page.keyboard.press('Tab'); // lock length, focus the angle box
  const angle = page.locator('.input-field input[data-field="angle"]');
  await page.mouse.move(c.x + 100, c.y - 100); // 45°
  await expect(angle).toHaveValue('45.0000');
  await page.mouse.move(c.x - 100, c.y - 1); // just above 180°, caught by polar tracking
  await expect(angle).toHaveValue('180.0000');
});
