import { type Page, expect, test } from '@playwright/test';

/** Node's Buffer, which Playwright runs these tests under; declared here rather than adding @types/node. */
declare const Buffer: { from(text: string): Uint8Array };

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
  await expect(prop(page, 'entity-count')).toHaveText('18');
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -2000); // deep zoom
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});

test('circles, arcs and xlines in the demo end view can be picked and show their values', async ({ page }) => {
  await page.goto('/?demo');
  await page.getByTestId('zoom-extents').click();
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  // Demo extents (xlines excluded): X -0.8505 … 2.1, Y ±0.2505, with a 5% margin each side.
  const extents = { minX: -0.8505, maxX: 2.1, minY: -0.2505, maxY: 0.2505 };
  const scale = Math.min((box.width * 0.9) / (extents.maxX - extents.minX), (box.height * 0.9) / (extents.maxY - extents.minY));
  const cx = (extents.minX + extents.maxX) / 2;
  const toScreen = (x: number, y: number) => ({ x: box.x + box.width / 2 + (x - cx) * scale, y: box.y + box.height / 2 - y * scale });
  const at = (deg: number, r: number) => toScreen(-0.6 + r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180));

  let p = at(45, 0.2505); // outside-diameter circle
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#properties h2')).toHaveText(/^Circle /);
  await expect(prop(page, 'Diameter')).toHaveText('0.5010');

  p = at(60, 0.15); // bolt-circle arc, 30° to 150°
  await page.mouse.click(p.x, p.y);
  await expect(prop(page, 'Included angle')).toHaveText('120.0000°');

  p = toScreen(-0.6, 0);
  await page.mouse.click(p.x, box.y + 5); // the vertical xline, well beyond the drawing's extents
  await expect(page.locator('#properties h2')).toHaveText(/^Xline /);
  await expect(prop(page, 'Angle')).toHaveText('90.0000°');
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

/** Screen position of a world point after Zoom Extents fits `extents` into the canvas. */
async function extentsMapper(page: Page, extents: { minX: number; maxX: number; minY: number; maxY: number }) {
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  const w = extents.maxX - extents.minX;
  const h = extents.maxY - extents.minY;
  const scale = Math.min(w > 0 ? (box.width * 0.9) / w : Infinity, h > 0 ? (box.height * 0.9) / h : Infinity);
  const cx = (extents.minX + extents.maxX) / 2;
  const cy = (extents.minY + extents.maxY) / 2;
  return (x: number, y: number) => ({ x: box.x + box.width / 2 + (x - cx) * scale, y: box.y + box.height / 2 - (y - cy) * scale });
}

test.describe('circle, arc and xline tools', () => {
  test('a circle from a typed center and radius', async ({ page }) => {
    await page.keyboard.press('c');
    await expect(page.locator('[data-option="method:cr"]')).toHaveClass(/active/);
    await typeValues(page, '0.5', '0.5'); // center
    await expect(page.locator('#status .status-prompt')).toHaveText('Circle: pick or type the radius');
    await expect(page.locator('.input-field span')).toHaveText(['R']);
    await typeValues(page, '1/4');
    await expect(prop(page, 'entity-count')).toHaveText('1');

    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const at = await extentsMapper(page, { minX: 0.25, maxX: 0.75, minY: 0.25, maxY: 0.75 });
    const p = at(0.75, 0.5);
    await page.mouse.click(p.x, p.y);
    await expect(prop(page, 'Radius')).toHaveText('0.2500');
    await expect(prop(page, 'Center X')).toHaveText('0.5000');
  });

  test('Arc Continue, chosen in the options bar, starts tangent to the last line', async ({ page }) => {
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0');
    await page.keyboard.press('Escape');

    await page.keyboard.press('a');
    await page.locator('[data-option="method:continue"]').click();
    await expect(page.locator('[data-option="method:continue"]')).toHaveClass(/active/);
    await typeValues(page, '2', '90'); // end point 2 straight up from (1, 0): a half circle
    await expect(prop(page, 'entity-count')).toHaveText('2');

    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const at = await extentsMapper(page, { minX: 0, maxX: 2, minY: 0, maxY: 2 });
    const p = at(2, 1);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Arc /);
    await expect(prop(page, 'Center X')).toHaveText('1.0000');
    await expect(prop(page, 'Center Y')).toHaveText('1.0000');
    await expect(prop(page, 'Included angle')).toHaveText('180.0000°');
  });

  test('an offset xline from a picked line, on the side of the cursor', async ({ page }) => {
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const at = await extentsMapper(page, { minX: 0, maxX: 1, minY: 0, maxY: 0 });

    await page.keyboard.press('x');
    await page.locator('[data-option="method:offset"]').click();
    const onLine = at(0.5, 0);
    await page.mouse.click(onLine.x, onLine.y); // pick the line
    await expect(page.locator('#status .status-prompt')).toHaveText(/offset distance/);
    await page.mouse.move(onLine.x, onLine.y + 80); // below the line
    await typeValues(page, '0.25');
    await expect(prop(page, 'entity-count')).toHaveText('2');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const onXline = at(0.9, -0.25);
    await page.mouse.click(onXline.x, onXline.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Xline /);
    await expect(prop(page, 'Base Y')).toHaveText('-0.2500');
    await expect(prop(page, 'Angle')).toHaveText('0.0000°');
  });
});

test.describe('right-click menu', () => {
  test('closes after choosing an item', async ({ page }) => {
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y, { button: 'right' });
    const menu = page.locator('.context-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Zoom Extents' }).click();
    await expect(menu).toBeHidden();
  });

  test('closes when clicking elsewhere, without placing a point', async ({ page }) => {
    const c = await canvasCenter(page);
    await page.keyboard.press('l');
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await expect(page.locator('.context-menu')).toBeVisible();
    await page.locator('#properties').click();
    await expect(page.locator('.context-menu')).toBeHidden();
  });

  test('Cancel leaves the tool and closes the menu', async ({ page }) => {
    const c = await canvasCenter(page);
    await page.keyboard.press('l');
    await page.mouse.click(c.x, c.y, { button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.context-menu')).toBeHidden();
    await expect(page.getByTestId('tool-line')).not.toHaveClass(/active/);
  });
});

test.describe('panning without a middle button', () => {
  const coordsAt = async (page: Page, x: number, y: number): Promise<string> => {
    await page.mouse.move(x, y);
    return (await page.locator('.status-coords').textContent()) ?? '';
  };

  test('holding Space and dragging with the left button pans the view', async ({ page }) => {
    const c = await canvasCenter(page);
    const before = await coordsAt(page, c.x, c.y);
    await page.keyboard.down(' ');
    await expect(page.locator('#canvas')).toHaveClass(/pan-ready/);
    await page.mouse.down();
    await page.mouse.move(c.x + 200, c.y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up(' ');
    await expect(page.locator('#canvas')).not.toHaveClass(/pan-ready/);
    // The world point that was under the cursor moved 200px right with the drag.
    expect(await coordsAt(page, c.x + 200, c.y)).toBe(before);
  });

  test('the Pan button makes left-drag pan, without placing points, until turned off', async ({ page }) => {
    const c = await canvasCenter(page);
    await page.keyboard.press('l');
    await page.getByTestId('pan').click();
    await expect(page.getByTestId('pan')).toHaveClass(/active/);
    const before = await coordsAt(page, c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 150, { steps: 5 });
    await page.mouse.up();
    expect(await coordsAt(page, c.x, c.y + 150)).toBe(before);
    await expect(page.locator('.options-tool')).toHaveText('Line');
    await expect(page.locator('#status .status-prompt')).toHaveText('Line: pick the first point');

    await page.keyboard.press('Escape'); // first Esc leaves Pan, the Line tool stays
    await expect(page.getByTestId('pan')).not.toHaveClass(/active/);
    await expect(page.getByTestId('tool-line')).toHaveClass(/active/);
  });
});

test.describe('trackpad and wheel', () => {
  const coordsAt = async (page: Page, x: number, y: number): Promise<string> => {
    await page.mouse.move(x, y);
    return (await page.locator('.status-coords').textContent()) ?? '';
  };
  // Synthetic wheel events carry whole-pixel positions, so test at whole pixels.
  const roundedCenter = async (page: Page) => {
    const c = await canvasCenter(page);
    return { x: Math.round(c.x), y: Math.round(c.y) };
  };
  type WheelInit = { deltaX?: number; deltaY?: number; ctrlKey?: boolean };
  const wheel = (page: Page, x: number, y: number, init: WheelInit): Promise<void> =>
    page.evaluate(
      (a: { x: number; y: number; init: WheelInit }) => {
        document.getElementById('canvas')!.dispatchEvent(
          new WheelEvent('wheel', { clientX: a.x, clientY: a.y, bubbles: true, cancelable: true, ...a.init }),
        );
      },
      { x, y, init },
    );

  test('two-finger scroll pans by default', async ({ page }) => {
    const c = await roundedCenter(page);
    const before = await coordsAt(page, c.x, c.y);
    await wheel(page, c.x, c.y, { deltaX: -120, deltaY: -80 });
    // Fingers moved right and down: the drawing follows them.
    expect(await coordsAt(page, c.x + 120, c.y + 80)).toBe(before);
  });

  test('pinch zooms about the cursor', async ({ page }) => {
    const c = await roundedCenter(page);
    const at = await coordsAt(page, c.x, c.y);
    const off = await coordsAt(page, c.x + 200, c.y);
    await wheel(page, c.x, c.y, { deltaY: -50, ctrlKey: true });
    expect(await coordsAt(page, c.x, c.y)).toBe(at);
    expect(await coordsAt(page, c.x + 200, c.y)).not.toBe(off);
  });

  test('Scroll: Zoom makes the wheel zoom instead, and is remembered', async ({ page }) => {
    await page.getByTestId('scroll-mode').selectOption('zoom');
    await page.reload();
    await expect(page.getByTestId('scroll-mode')).toHaveValue('zoom');
    const c = await roundedCenter(page);
    const at = await coordsAt(page, c.x, c.y);
    const off = await coordsAt(page, c.x + 200, c.y);
    await wheel(page, c.x, c.y, { deltaY: -100 });
    expect(await coordsAt(page, c.x, c.y)).toBe(at);
    expect(await coordsAt(page, c.x + 200, c.y)).not.toBe(off);
  });
});

test.describe('files and units', () => {
  // Playwright can't drive the native file pickers, so use the fallbacks: a file input and a download.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
      Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    });
    await page.goto('/');
  });

  async function drawLine(page: Page): Promise<void> {
    await page.keyboard.press('l');
    await typeValues(page, '0.1', '0.2');
    await typeValues(page, '1', '30');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('1');
  }

  async function selectOnlyEntity(page: Page): Promise<void> {
    await page.getByTestId('zoom-extents').click();
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y);
  }

  test('a saved drawing reopens with exactly the same coordinates', async ({ page }, info) => {
    await drawLine(page);
    await expect(page).toHaveTitle('• Untitled.cad2d.json — DanCAM');

    const downloading = page.waitForEvent('download');
    await page.getByTestId('save').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('Untitled.cad2d.json');
    const path = info.outputPath('saved.cad2d.json');
    await download.saveAs(path);
    await expect(page).toHaveTitle('Untitled.cad2d.json — DanCAM');

    await page.getByTestId('new').click();
    await page.locator('.context-menu').getByRole('button', { name: 'New inch drawing' }).click();
    await expect(prop(page, 'entity-count')).toHaveText('0'); // saved, so no question asked

    const choosing = page.waitForEvent('filechooser');
    await page.getByTestId('open').click();
    await (await choosing).setFiles(path);
    await expect(prop(page, 'entity-count')).toHaveText('1');
    await expect(page.locator('#status .status-prompt')).toHaveText('Opened saved.cad2d.json');

    await selectOnlyEntity(page);
    await expect(prop(page, 'End X')).toHaveAttribute('title', String(0.1 + Math.cos(Math.PI / 6)));
    await expect(prop(page, 'End Y')).toHaveAttribute('title', String(0.2 + 0.5));
  });

  test('New asks before discarding unsaved work, and starts in the chosen unit', async ({ page }) => {
    await drawLine(page);
    page.once('dialog', (d) => void d.dismiss());
    await page.getByTestId('new').click();
    await page.locator('.context-menu').getByRole('button', { name: 'New mm drawing' }).click();
    await expect(prop(page, 'entity-count')).toHaveText('1');

    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('new').click();
    await page.locator('.context-menu').getByRole('button', { name: 'New mm drawing' }).click();
    await expect(prop(page, 'entity-count')).toHaveText('0');
    await expect(page.getByTestId('units')).toHaveText('mm');
  });

  test('Convert to mm scales by 25.4; Undo converts back', async ({ page }) => {
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.getByTestId('units').click();
    await page.locator('.context-menu').getByRole('button', { name: /^Convert to mm/ }).click();
    await expect(page.getByTestId('units')).toHaveText('mm');
    await selectOnlyEntity(page);
    await expect(prop(page, 'Length')).toHaveText('25.4000');

    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('units')).toHaveText('in');
    await expect(prop(page, 'Length')).toHaveText('1.0000');
  });

  test('a file that is not a drawing is refused and the open drawing is kept', async ({ page }) => {
    await drawLine(page);
    const choosing = page.waitForEvent('filechooser');
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('open').click();
    await (await choosing).setFiles({ name: 'bad.cad2d.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    await expect(page.locator('#status .status-prompt')).toHaveText("Can't open bad.cad2d.json: This file is not valid JSON.");
    await expect(prop(page, 'entity-count')).toHaveText('1');
  });
});
