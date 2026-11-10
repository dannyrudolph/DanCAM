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
  await expect(prop(page, 'Style').locator('select')).toHaveValue('hidden');
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
  await expect(prop(page, 'entity-count')).toHaveText('26');
  await page.mouse.move(400, 300);
  await page.mouse.wheel(0, -2000); // deep zoom
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});

test('circles, arcs, xlines and dimensions in the demo can be picked and show their values', async ({ page }) => {
  await page.goto('/?demo');
  await page.getByTestId('zoom-extents').click();
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('canvas has no box');
  // Demo extents (xlines excluded): X from the end view's diameter text to the corner leader's
  // text, Y from the aligned dimension's arrows to the overall-length extension lines.
  const toScreen = await extentsMapper(page, { minX: -1.637764623955432, maxX: 3.314839832869081, minY: -0.5037935372909058, maxY: 0.775 });
  const at = (deg: number, r: number) => toScreen(-0.6 + r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180));

  let p = at(45, 0.2505); // outside-diameter circle
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#properties h2')).toHaveText(/^Circle /);
  await expect(prop(page, 'Diameter')).toHaveText('0.5010');

  p = at(60, 0.15); // bolt-circle arc, 30° to 150°
  await page.keyboard.press('Escape'); // clicks add to the selection; start afresh
  await page.mouse.click(p.x, p.y);
  await expect(prop(page, 'Included angle')).toHaveText('120.0000°');

  p = toScreen(-0.6, 0);
  await page.keyboard.press('Escape');
  await page.mouse.click(p.x, box.y + 5); // the vertical xline, well beyond the drawing's extents
  await expect(page.locator('#properties h2')).toHaveText(/^Xline /);
  await expect(prop(page, 'Angle')).toHaveText('90.0000°');

  p = toScreen(1, 0.65); // the overall-length dimension's text, where its line is broken
  await page.keyboard.press('Escape');
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#properties h2')).toHaveText(/^Dimension /);
  await expect(prop(page, 'Text')).toHaveText('2.000');
  await expect(prop(page, 'Measured')).toHaveText('2.0000');
  await expect(prop(page, 'Style')).toHaveCount(0); // dimensions draw thin whatever the line style
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

test.describe('layers panel', () => {
  const row = (page: Page, name: string) => page.locator(`.layer-row[data-layer="${name}"]`);

  test('a new layer is named, made current, and takes new lines; hiding it hides them from picks', async ({ page }) => {
    await page.getByTestId('new-layer').click();
    const nameBox = page.locator('[data-role="name-input"]');
    await expect(nameBox).toBeFocused();
    await nameBox.fill('Profile');
    await nameBox.press('Enter');
    await expect(row(page, 'Profile')).toBeVisible();

    await row(page, 'Profile').locator('[data-role="current"]').check();
    await expect(row(page, 'Profile')).toHaveClass(/current/);

    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(row(page, 'Profile').locator('.layer-count')).toHaveText('1');

    await page.getByTestId('zoom-extents').click();
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y);
    await expect(prop(page, 'Layer').locator('select')).toHaveValue('Profile');

    await page.keyboard.press('Escape'); // clear the selection
    await row(page, 'Profile').locator('[data-role="visible"]').click();
    await expect(row(page, 'Profile')).toHaveClass(/hidden-layer/);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('#properties h2')).toHaveText('Drawing'); // nothing picked
  });

  test('deleting a layer with objects is refused; undo takes back a new layer', async ({ page }) => {
    await page.goto('/?demo');
    await row(page, 'CENTER').locator('[data-role="delete"]').click();
    await expect(page.locator('#status .status-prompt')).toHaveText('CENTER still has 3 objects on it.');
    await expect(row(page, 'CENTER')).toBeVisible();

    await page.getByTestId('new-layer').click();
    await page.locator('[data-role="name-input"]').press('Enter'); // keep the name Layer1
    await expect(row(page, 'Layer1')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(row(page, 'Layer1')).toHaveCount(0);
  });

  test('renaming a layer moves its objects with it', async ({ page }) => {
    await page.goto('/?demo');
    await row(page, 'CENTER').locator('[data-role="name"]').dblclick();
    const nameBox = page.locator('[data-role="name-input"]');
    await nameBox.fill('CL');
    await nameBox.press('Enter');
    await expect(row(page, 'CL').locator('.layer-count')).toHaveText('3');
    await expect(row(page, 'CENTER')).toHaveCount(0);
  });
});

test('the sidebar hides and shows, and stays hidden after a reload', async ({ page }) => {
  const side = page.locator('#side');
  await expect(side).toBeVisible();
  const before = (await page.locator('#canvas').boundingBox())!.width;

  await page.getByTestId('side-panel').click();
  await expect(side).toBeHidden();
  await expect.poll(async () => (await page.locator('#canvas').boundingBox())!.width).toBeGreaterThan(before);

  await page.reload();
  await expect(side).toBeHidden();
  await page.getByTestId('side-panel').click();
  await expect(side).toBeVisible();
});

test('Shift+X starts the Ray tool and X still starts Xline', async ({ page }) => {
  await page.keyboard.press('Shift+X');
  await expect(page.getByTestId('tool-ray')).toHaveClass(/active/);
  await expect(page.getByTestId('tool-ray')).toHaveAttribute('title', 'Ray (Shift+X)');
  await page.keyboard.press('x');
  await expect(page.getByTestId('tool-xline')).toHaveClass(/active/);
});

test('a click near a midpoint snaps to it exactly; F3 turns snaps off', async ({ page }) => {
  await page.keyboard.press('l');
  await typeValues(page, '0', '0');
  await typeValues(page, '1', '0');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const c = await canvasCenter(page); // the line's midpoint (0.5, 0)

  await page.keyboard.press('l');
  await page.mouse.move(c.x + 4, c.y + 3);
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'mid');
  await page.mouse.click(c.x + 4, c.y + 3);
  await typeValues(page, '0.1', '90');
  await page.keyboard.press('Escape');

  await page.mouse.click(c.x, c.y - 30); // on the new vertical line, well off the first
  await page.getByTestId('precision').selectOption('8');
  await expect(prop(page, 'Start X')).toHaveText('0.50000000');
  await expect(prop(page, 'Start Y')).toHaveText('0.00000000');

  await page.keyboard.press('l');
  await page.mouse.move(c.x + 4, c.y + 3);
  // the new line starts there too, and Endpoint wins a tie with Midpoint
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'end');
  await page.keyboard.press('F3');
  await expect(page.getByTestId('osnap')).not.toHaveClass(/\bon\b/);
  await page.mouse.move(c.x + 5, c.y + 3);
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', '');
});

test('a one-time Endpoint snap from the right-click menu ignores the midpoint under the cursor', async ({ page }) => {
  await page.keyboard.press('l');
  await typeValues(page, '0', '0');
  await typeValues(page, '1', '0');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const c = await canvasCenter(page);

  await page.keyboard.press('l');
  await page.mouse.click(c.x, c.y + 3, { button: 'right' });
  await page.locator('.context-menu button', { hasText: 'Snap once…' }).click();
  await page.locator('.context-menu button', { hasText: 'Endpoint' }).click();
  await page.mouse.move(c.x + 4, c.y + 3);
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', '');
  await page.mouse.click(c.x + 4, c.y + 3); // no endpoint here: nothing placed
  await expect(page.locator('#status .status-prompt')).toContainText('No Endpoint point here');
  await page.keyboard.press('Escape'); // drops the one-time snap; the running Midpoint is back
  await page.mouse.move(c.x + 5, c.y + 3);
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'mid');
});

test('a line started with a one-time Tangent on a circle ends up tangent to it', async ({ page }) => {
  await page.keyboard.press('c'); // circle R1 at the origin
  await typeValues(page, '0', '0');
  await typeValues(page, '1');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const box = (await page.locator('#canvas').boundingBox())!;
  const c = await canvasCenter(page);
  const scale = (Math.min(box.width, box.height) * 0.9) / 2; // px per inch after Zoom Extents (5% margins)

  await page.keyboard.press('l');
  await page.mouse.click(c.x, c.y - scale, { button: 'right' });
  await page.locator('.context-menu button', { hasText: 'Snap once…' }).click();
  await page.locator('.context-menu button', { hasText: 'Tangent' }).click();
  await page.mouse.move(c.x + 2, c.y - scale + 1); // on the top of the circle
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'tan');
  await page.mouse.click(c.x + 2, c.y - scale + 1);
  await typeValues(page, '1.2', '0.3'); // the end, as X and Y
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // The start is the upper tangent point from (1.2, 0.3); click the line's middle.
  const e = { x: 1.2, y: 0.3 };
  const d = Math.hypot(e.x, e.y);
  const [ux, uy] = [e.x / d, e.y / d];
  const [a, h] = [1 / d, Math.sqrt(1 - 1 / (d * d))];
  const s = { x: ux * a - uy * h, y: uy * a + ux * h };
  await page.mouse.click(c.x + ((s.x + e.x) / 2) * scale, c.y - ((s.y + e.y) / 2) * scale);
  await page.getByTestId('precision').selectOption('8');
  await expect(prop(page, 'End X')).toHaveText('1.20000000');
  await expect(prop(page, 'Length')).toHaveText(Math.sqrt(d * d - 1).toFixed(8)); // tangent length √(d² − r²)
  await expect(prop(page, 'Start X')).toHaveText(s.x.toFixed(8));
  await expect(prop(page, 'Start Y')).toHaveText(s.y.toFixed(8));
});

test.describe('selection', () => {
  /** Lines A (0,0)-(1,0), B (0,1)-(1,1), C (2,0)-(2,1), fitted to the view; returns world → page coordinates. */
  async function draw(page: Page): Promise<(x: number, y: number) => { x: number; y: number }> {
    for (const pts of [
      ['0', '0', '1', '0'],
      ['0', '1', '1', '1'],
      ['2', '0', '2', '1'],
    ]) {
      await page.keyboard.press('l');
      await typeValues(page, pts[0]!, pts[1]!);
      // the second point in polar entry: length and angle from the first
      const [dx, dy] = [Number(pts[2]) - Number(pts[0]), Number(pts[3]) - Number(pts[1])];
      await typeValues(page, String(Math.hypot(dx, dy)), String((Math.atan2(dy, dx) * 180) / Math.PI));
      await page.keyboard.press('Escape');
    }
    await expect(prop(page, 'entity-count')).toHaveText('3');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    const scale = Math.min((box.width * 0.9) / 2, box.height * 0.9);
    const c = await canvasCenter(page);
    return (x, y) => ({ x: c.x + (x - 1) * scale, y: c.y - (y - 0.5) * scale });
  }

  async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, shift = false) {
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
    await page.mouse.move(to.x, to.y);
    await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  }

  test('a window takes what is fully inside; the same box dragged right to left also takes what it touches', async ({ page }) => {
    const at = await draw(page);
    // x 0.5..1.2, y 0.5..1.2: B pokes in, A and C don't, nothing is fully inside
    await drag(page, at(0.5, 1.2), at(1.2, 0.5));
    await expect(prop(page, 'entity-count')).toHaveText('3'); // still the drawing summary: nothing selected
    await drag(page, at(1.2, 0.5), at(0.5, 1.2));
    await expect(page.locator('#properties h2')).toHaveText(/^Line /);
    await expect(prop(page, 'Start Y')).toHaveText('1.0000');

    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('3');
    await drag(page, at(-0.1, 1.1), at(1.1, -0.1)); // window around A and B
    await expect(prop(page, 'selection-count')).toHaveText('2');
  });

  test('clicks add to the selection, Shift-click and Shift-window remove, Esc clears', async ({ page }) => {
    const at = await draw(page);
    const a = at(0.5, 0);
    const b = at(0.5, 1);
    const c = at(2, 0.5);
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.mouse.click(c.x, c.y);
    await expect(prop(page, 'selection-count')).toHaveText('3');

    await page.keyboard.down('Shift');
    await page.mouse.click(c.x, c.y);
    await page.keyboard.up('Shift');
    await expect(prop(page, 'selection-count')).toHaveText('2');

    await drag(page, at(-0.1, 1.1), at(1.1, 0.5), true); // Shift-window around B only
    await expect(page.locator('#properties h2')).toHaveText(/^Line /);
    await expect(prop(page, 'Start Y')).toHaveText('0.0000');

    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('3');
  });
});

test('the Select arrow is on with no tool, and clicking it leaves a tool', async ({ page }) => {
  const select = page.getByTestId('tool-select');
  await expect(select).toHaveClass(/active/);
  await expect(page.locator('#canvas')).toHaveClass(/selecting/);
  await page.keyboard.press('l');
  await expect(select).not.toHaveClass(/active/);
  await expect(page.locator('#canvas')).not.toHaveClass(/selecting/); // crosshairs while drawing
  await select.click();
  await expect(select).toHaveClass(/active/);
  await expect(page.getByTestId('tool-line')).not.toHaveClass(/active/);
  await expect(page.locator('.options-tool')).toHaveText('Select');
  await page.getByTestId('pan').click();
  await expect(select).not.toHaveClass(/active/);
  await select.click();
  await expect(page.getByTestId('pan')).not.toHaveClass(/active/);
});

test.describe('editing', () => {
  /** A line typed in, Zoom Extents, and selected by clicking its middle. */
  async function selectedLine(page: Page, x1: string, y1: string, length: string, angle: string) {
    await page.keyboard.press('l');
    await typeValues(page, x1, y1);
    await typeValues(page, length, angle);
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Line /);
  }

  test('a value typed into the properties panel changes the line exactly, as one undo step', async ({ page }) => {
    await selectedLine(page, '0', '0', '1', '0');
    await prop(page, 'Length').click();
    await page.keyboard.type('3/8');
    await page.keyboard.press('Enter');
    await page.getByTestId('precision').selectOption('8');
    await expect(prop(page, 'Length')).toHaveText('0.37500000');
    await expect(prop(page, 'End X')).toHaveAttribute('title', '0.375');

    await page.keyboard.press('Control+z');
    await expect(prop(page, 'Length')).toHaveText('1.00000000');
  });

  test('Esc or bad text leaves the value alone; tabbing through without typing never rounds it', async ({ page }) => {
    await selectedLine(page, '0', '0', '1', '30'); // End X = cos 30°, not exact at 4 places
    await prop(page, 'End X').click();
    await page.keyboard.type('9');
    await page.keyboard.press('Escape');
    await expect(prop(page, 'End X')).toHaveText('0.8660');

    await prop(page, 'End X').click();
    await page.keyboard.type('1+');
    await page.keyboard.press('Enter');
    await expect(prop(page, 'End X')).toHaveText('0.8660');

    await prop(page, 'End X').click();
    await page.keyboard.press('Enter'); // unchanged text: nothing stored
    await expect(prop(page, 'End X')).toHaveAttribute('title', String(Math.cos(Math.PI / 6)));
  });

  test('the Style dropdown restyles every selected object at once', async ({ page }) => {
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0');
    await typeValues(page, '1', '90');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5);
    await page.mouse.up();
    await expect(prop(page, 'selection-count')).toHaveText('2');
    await prop(page, 'Style').locator('select').selectOption('center');
    await expect(prop(page, 'Style').locator('select')).toHaveValue('center');
    await page.keyboard.press('Control+z');
    await expect(prop(page, 'Style').locator('select')).toHaveValue('');
  });

  test('dragging a line end grip onto another line endpoint snaps it there exactly', async ({ page }) => {
    // A (0,0)-(1,0) and B (0,1)-(1,1); select A and drag its right end up to B's right end
    for (const y of ['0', '1']) {
      await page.keyboard.press('l');
      await typeValues(page, '0', y);
      await typeValues(page, '1', '0');
      await page.keyboard.press('Escape');
    }
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    const scale = Math.min(box.width * 0.9, box.height * 0.9);
    const c = await canvasCenter(page);
    const at = (x: number, y: number) => ({ x: c.x + (x - 0.5) * scale, y: c.y - (y - 0.5) * scale });

    const a = at(0.5, 0);
    await page.mouse.click(a.x, a.y);
    const grip = at(1, 0);
    const target = at(1, 1);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 3, (grip.y + target.y) / 2);
    await page.mouse.move(target.x + 4, target.y + 3);
    await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'end');
    await page.mouse.up();

    await page.getByTestId('precision').selectOption('8');
    await expect(prop(page, 'Start X')).toHaveText('0.00000000');
    await expect(prop(page, 'Start Y')).toHaveText('0.00000000');
    await expect(prop(page, 'End X')).toHaveText('1.00000000');
    await expect(prop(page, 'End Y')).toHaveText('1.00000000');
    await page.keyboard.press('Control+z');
    await expect(prop(page, 'End Y')).toHaveText('0.00000000');
  });
});

test.describe('edit tools', () => {
  /** One line (0,0)-(1,0), fitted and selected; returns the canvas center (its midpoint). */
  async function oneSelectedLine(page: Page) {
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const c = await canvasCenter(page);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Line /);
    return c;
  }

  test('Move with typed points moves the selection exactly and returns to selecting', async ({ page }) => {
    await oneSelectedLine(page);
    await page.keyboard.press('m');
    await expect(page.locator('#status .status-prompt')).toHaveText('Move: pick the base point');
    await typeValues(page, '0', '0');
    await typeValues(page, '0.5', '90'); // up 0.5
    await expect(page.getByTestId('tool-select')).toHaveClass(/active/);
    await expect(prop(page, 'Start X')).toHaveText('0.0000');
    await expect(prop(page, 'Start Y')).toHaveText('0.5000');
    await expect(prop(page, 'End Y')).toHaveText('0.5000');
  });

  test('Delete erases the selection; Undo brings it back', async ({ page }) => {
    await oneSelectedLine(page);
    await page.keyboard.press('Delete');
    await expect(prop(page, 'entity-count')).toHaveText('0');
    await page.keyboard.press('Control+z');
    await expect(prop(page, 'entity-count')).toHaveText('1');
  });

  test('with nothing selected, a tool asks for objects; a window and Enter give them', async ({ page }) => {
    await oneSelectedLine(page);
    await page.keyboard.press('Escape'); // clear the selection
    await page.getByTestId('tool-erase').click();
    await expect(page.locator('#status .status-prompt')).toHaveText('Erase: select objects, then press Enter');
    await expect(page.locator('#canvas')).toHaveClass(/selecting/);
    const box = (await page.locator('#canvas').boundingBox())!;
    await page.mouse.move(box.x + 5, box.y + 5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5);
    await page.mouse.up();
    await expect(page.locator('#properties h2')).toHaveText(/^Line /); // selected, not erased until Enter
    await page.keyboard.press('Enter');
    await expect(prop(page, 'entity-count')).toHaveText('0');
  });

  test('Copy places a copy at each point until Enter', async ({ page }) => {
    await oneSelectedLine(page);
    await page.keyboard.press('Shift+C');
    await typeValues(page, '0', '0');
    await typeValues(page, '0.25', '90');
    await typeValues(page, '0.5', '90');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('3');
  });
});

test.describe('Phase 2 done-when: snaps land exactly, checked with ID', () => {
  /**
   * Arc 1: center (0,0), R1, upper half. Arc 2: center (1.5,0), R1, upper half.
   * Line y = 0.5 from x -2 to 2. Returns world → page coordinates.
   */
  async function drawing(page: Page) {
    await page.keyboard.press('a');
    await page.locator('[data-option="method:sce"]').click();
    for (const startX of ['1', '2.5']) {
      await typeValues(page, startX, '0'); // start
      await typeValues(page, '1', '180'); // center, 1 to the left
      await typeValues(page, '1', '180'); // end direction from the center
    }
    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    await typeValues(page, '-2', '0.5');
    await typeValues(page, '4', '0');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('3');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    const scale = Math.min((box.width * 0.9) / 4.5, box.height * 0.9); // extents 4.5 × 1
    const c = await canvasCenter(page);
    return (x: number, y: number) => ({ x: c.x + (x - 0.25) * scale, y: c.y - (y - 0.5) * scale });
  }

  /** Moves near `p` (a few pixels off), checks the snap, and clicks. */
  async function snapClick(page: Page, p: { x: number; y: number }, snap: string) {
    await page.mouse.move(p.x + 3, p.y - 2);
    await expect(page.locator('#canvas')).toHaveAttribute('data-snap', snap);
    await page.mouse.click(p.x + 3, p.y - 2);
  }

  async function snapOnce(page: Page, kind: string) {
    const box = (await page.locator('#canvas').boundingBox())!;
    await page.mouse.click(box.x + 20, box.y + 20, { button: 'right' });
    await page.locator('.context-menu button', { hasText: 'Snap once…' }).click();
    await page.locator('.context-menu button', { hasText: kind }).click();
  }

  /** ID at a snapped point; returns the full-precision X and Y from the results panel. */
  async function idAt(page: Page, p: { x: number; y: number }, snap: string) {
    await page.getByTestId('tool-id').click();
    await snapClick(page, p, snap);
    await page.keyboard.press('Escape');
    const latest = page.locator('#inquiry .inquiry-result').first();
    const x = Number(await latest.locator('dd[data-prop="X"]').getAttribute('title'));
    const y = Number(await latest.locator('dd[data-prop="Y"]').getAttribute('title'));
    return { x, y };
  }

  const expectAt = (got: { x: number; y: number }, x: number, y: number) => {
    expect(Math.abs(got.x - x)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(got.y - y)).toBeLessThanOrEqual(1e-12);
  };

  test('line–arc and arc–arc intersections', async ({ page }) => {
    const at = await drawing(page);
    expectAt(await idAt(page, at(Math.sqrt(0.75), 0.5), 'int'), Math.sqrt(0.75), 0.5);
    expectAt(await idAt(page, at(1.5 - Math.sqrt(0.75), 0.5), 'int'), 1.5 - Math.sqrt(0.75), 0.5);
    expectAt(await idAt(page, at(0.75, Math.sqrt(0.4375)), 'int'), 0.75, Math.sqrt(0.4375));
  });

  test('a line from a point tangent to an arc', async ({ page }) => {
    const at = await drawing(page);
    await page.keyboard.press('l');
    await typeValues(page, '2', '0'); // from (2, 0): tangent point on arc 1 is (0.5, √0.75)
    await snapOnce(page, 'Tangent');
    await snapClick(page, at(0.5, Math.sqrt(0.75)), 'tan');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expectAt(await idAt(page, at(0.5, Math.sqrt(0.75)), 'end'), 0.5, Math.sqrt(0.75));
  });

  test('a line tangent to two arcs', async ({ page }) => {
    const at = await drawing(page);
    await page.keyboard.press('l');
    await snapOnce(page, 'Tangent');
    await snapClick(page, at(0.05, 1), 'tan'); // deferred on arc 1, near its top
    await snapOnce(page, 'Tangent');
    await snapClick(page, at(1.45, 1), 'tan'); // and on arc 2: the outer tangent y = 1
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('4');
    expectAt(await idAt(page, at(0, 1), 'end'), 0, 1);
    expectAt(await idAt(page, at(1.5, 1), 'end'), 1.5, 1);
  });
});

test.describe('trim and extend', () => {
  test('Enter takes every object as an edge; a click trims and a Shift-click extends', async ({ page }) => {
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '0.5', '0');
    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    await typeValues(page, '1', '-1');
    await typeValues(page, '2', '90');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    const scale = Math.min(box.width * 0.9, (box.height * 0.9) / 2); // extents 1 × 2
    const c = await canvasCenter(page);
    const at = (x: number, y: number) => ({ x: c.x + (x - 0.5) * scale, y: c.y - y * scale });

    await page.keyboard.press('t');
    await expect(page.locator('#status .status-prompt')).toHaveText('Trim: select cutting edges, then Enter (Enter alone: all objects)');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status .status-prompt')).toHaveText(/^Trim: pick the part to remove/);
    const short = at(0.4, 0);
    await page.keyboard.down('Shift');
    await page.mouse.click(short.x, short.y);
    await page.keyboard.up('Shift');
    const upper = at(1, 0.5);
    await page.mouse.click(upper.x, upper.y);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tool-select')).toHaveClass(/active/);

    await page.getByTestId('precision').selectOption('8');
    await page.mouse.click(short.x, short.y);
    await expect(prop(page, 'End X')).toHaveText('1.00000000');
    await page.keyboard.press('Escape');
    const lower = at(1, -0.5);
    await page.mouse.click(lower.x, lower.y);
    await expect(prop(page, 'Start Y')).toHaveText('-1.00000000');
    await expect(prop(page, 'End Y')).toHaveText('0.00000000');
  });
});

test.describe('dimensions', () => {
  test('a linear dimension between two snapped endpoints reads exactly, and Vertical forces its direction', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1300 }); // room above the line for the dimension text at this zoom
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    const scale = box.width * 0.9; // extents 1 × 0
    const c = await canvasCenter(page);
    const at = (x: number, y: number) => ({ x: c.x + (x - 0.5) * scale, y: c.y - y * scale });

    await page.keyboard.press('Shift+D');
    await expect(page.locator('#status .status-prompt')).toHaveText('Linear: pick the first point to measure from');
    const near = (x: number, dx: number, dy: number) => ({ x: at(x, 0).x + dx, y: at(x, 0).y + dy }); // a few pixels off an end
    for (const p of [near(0, 4, -3), near(1, -4, 3), at(0.5, 0.3)]) await page.mouse.click(p.x, p.y); // Endpoint snaps take both
    await expect(prop(page, 'entity-count')).toHaveText('2');
    await page.keyboard.press('Escape');
    const text = at(0.5, 0.3);
    await page.mouse.click(text.x, text.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Dimension /);
    await expect(prop(page, 'Text')).toHaveText('1.000');
    await expect(prop(page, 'Point 2 X')).toHaveText('1.0000');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+D');
    for (const p of [near(0, 4, -3), near(1, -4, 3)]) await page.mouse.click(p.x, p.y);
    await page.locator('[data-option="orient:v"]').click();
    await expect(page.locator('[data-option="orient:v"]')).toHaveClass(/active/);
    const below = at(0.5, -0.3);
    await page.mouse.click(below.x, below.y);
    await expect(prop(page, 'entity-count')).toHaveText('3');
    await page.keyboard.press('Escape');
    // The points are level, so it measures zero; with no room inside, its text sits above the
    // upper arrow: center .24 + .1225 above the line, its top clear of the first dimension's text.
    const zeroText = at(0.5, 0.41);
    await page.mouse.click(zeroText.x, zeroText.y);
    await expect(prop(page, 'Text')).toHaveText('.000');
  });
});

test.describe('dimension overrides in the properties panel', () => {
  test('precision, text and tolerance change one dimension, each as an undo step', async ({ page }) => {
    await page.keyboard.press('Shift+D');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0'); // ΔX, ΔY from the first point
    await typeValues(page, '0.5', '0.3'); // the dimension line's position
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    await page.mouse.move(box.x + 3, box.y + 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3, { steps: 6 });
    await page.mouse.up();
    await expect(prop(page, 'Text')).toHaveText('1.000');

    await prop(page, 'Precision').locator('select').selectOption('4');
    await expect(prop(page, 'Text')).toHaveText('1.0000');

    await prop(page, 'Text').click();
    await page.locator('input[data-edit="Text"]').fill('2X <> TYP');
    await page.keyboard.press('Enter');
    await expect(prop(page, 'Text')).toHaveText('2X 1.0000 TYP');

    await prop(page, 'Tolerance').locator('select').selectOption('symmetric');
    await prop(page, 'Tol ±').click();
    await page.locator('input[data-edit="Tol ±"]').fill('.0005');
    await page.keyboard.press('Enter');
    await expect(prop(page, 'Text')).toHaveText('2X 1.0000 TYP ±.0005');

    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(prop(page, 'Text')).toHaveText('2X 1.0000 TYP');
    await prop(page, 'Precision').locator('select').selectOption('');
    await expect(prop(page, 'Text')).toHaveText('2X 1.000 TYP');
  });
});

test('the sheet scale is chosen in the status bar or typed as Custom, and Undo takes it back', async ({ page }) => {
  const scale = page.getByTestId('sheet-scale');
  await expect(scale).toHaveValue('1');
  await scale.selectOption('10');
  await expect(scale).toHaveValue('10');
  await scale.selectOption('custom');
  const custom = page.getByTestId('sheet-scale-custom');
  await expect(custom).toBeFocused();
  await custom.fill('1:2');
  await page.keyboard.press('Enter');
  await expect(scale).toHaveValue('0.5');
  await expect(scale.locator('option:checked')).toHaveText('Scale 1:2');
  await page.keyboard.press('Control+z');
  await expect(scale).toHaveValue('10');
  await scale.selectOption('custom');
  await page.keyboard.press('Escape'); // cancels, leaving the scale alone
  await expect(scale).toHaveValue('10');
});

test('lathe mode names the axes Z and X; with Ø on, a typed diameter stores the radius', async ({ page }) => {
  await expect(page.getByTestId('diameter')).toBeDisabled(); // Ø needs lathe mode
  await page.getByTestId('lathe').click();
  await page.getByTestId('diameter').click();
  await expect(page.getByTestId('diameter')).toHaveAttribute('aria-pressed', 'true');

  await page.keyboard.press('l');
  const names = page.locator('.input-boxes .input-field span');
  await expect(names).toHaveText(['Z', 'Ø']);
  await typeValues(page, '0.5', '0.25'); // first point: Z .5, Ø .25
  const box = (await page.locator('#canvas').boundingBox())!;
  for (const shown of ['ΔZX', 'ZX']) {
    await page.mouse.move(box.x + 40, box.y + 40); // the boxes show beside the cursor
    await page.locator('.input-mode').click();
    await expect(page.locator('.input-mode')).toHaveText(shown);
  }
  await expect(names).toHaveText(['Z', 'Ø']);
  await typeValues(page, '1.5', '0.375');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const c = await canvasCenter(page);
  await page.mouse.click(c.x, c.y);
  await expect(prop(page, 'Start Z')).toHaveText('0.5000');
  await expect(prop(page, 'Start Ø')).toHaveText('0.2500');
  await expect(prop(page, 'End Ø')).toHaveText('0.3750');
  await expect(page.locator('#status .status-coords')).toHaveText(/^Z -?\d+\.\d{4} {2}Ø -?\d+\.\d{4}$/);

  // The stored point is the radius: Ø off shows it as X .125.
  await page.getByTestId('diameter').click();
  await expect(prop(page, 'Start X')).toHaveText('0.1250');
  // A diameter typed in the panel sets the radius.
  await page.getByTestId('diameter').click();
  await prop(page, 'End Ø').click();
  await page.keyboard.type('0.5');
  await page.keyboard.press('Enter');
  await page.getByTestId('diameter').click();
  await expect(prop(page, 'End X')).toHaveText('0.2500');

  await page.getByTestId('lathe').click(); // off again: plain X and Y
  await expect(prop(page, 'End Y')).toHaveText('0.2500');
  await expect(page.getByTestId('diameter')).toBeDisabled();
});

test('the Dimension Styles panel edits a style its dimensions follow, adds, renames and refuses to delete one in use', async ({ page }) => {
  await page.keyboard.press('Shift+D');
  await typeValues(page, '0', '0');
  await typeValues(page, '1', '0');
  await typeValues(page, '0.5', '0.3');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const box = (await page.locator('#canvas').boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3, { steps: 6 });
  await page.mouse.up();
  await expect(prop(page, 'Text')).toHaveText('1.000');

  const panel = page.locator('#dimstyles');
  const row = (name: string) => panel.locator(`li[data-dim-style="${name}"]`);
  await expect(row('INCH-3PL').locator('.layer-count')).toHaveText('1');
  await page.getByTestId('dim-style-settings').click();
  await panel.locator('select[data-setting="precision"]').selectOption('4');
  await expect(prop(page, 'Text')).toHaveText('1.0000');
  await panel.locator('input[data-setting="suffix"]').fill(' TYP');
  await page.keyboard.press('Enter');
  await expect(prop(page, 'Text')).toHaveText('1.0000 TYP');
  await panel.locator('input[data-setting="textHeight"]').fill('0');
  await page.keyboard.press('Enter');
  await expect(page.locator('#status .status-prompt')).toHaveText('The text height must be more than zero.');
  await expect(panel.locator('input[data-setting="textHeight"]')).toHaveValue('0.12');

  await page.getByTestId('new-dim-style').click();
  await panel.locator('input[data-role="name-input"]').fill('DETAIL');
  await page.keyboard.press('Enter');
  await expect(row('DETAIL')).toHaveClass(/editing/);
  await expect(page.getByTestId('dim-style-settings')).toHaveText('Settings: DETAIL');
  await expect(panel.locator('select[data-setting="precision"]')).toHaveValue('4'); // a copy

  await row('INCH-3PL').locator('[data-role="delete"]').click();
  await expect(page.locator('#status .status-prompt')).toHaveText('INCH-3PL is the current style; make another current first.');
  await row('DETAIL').locator('[data-role="current"]').check();
  await row('INCH-3PL').locator('[data-role="delete"]').click();
  await expect(page.locator('#status .status-prompt')).toHaveText('1 dimension uses INCH-3PL.');

  await row('INCH-3PL').locator('[data-role="name"]').dblclick();
  await panel.locator('input[data-role="name-input"]').fill('PART');
  await page.keyboard.press('Enter');
  await expect(prop(page, 'Dim style').locator('select')).toHaveValue('PART');
  await expect(row('PART').locator('.layer-count')).toHaveText('1');
  await page.keyboard.press('Control+z');
  await expect(prop(page, 'Dim style').locator('select')).toHaveValue('INCH-3PL');
});

test('dimension grips: a measured point snaps onto a line end; the text slides out past it and the line snaps to .375', async ({ page }) => {
  await page.keyboard.press('l');
  await typeValues(page, '0', '0');
  await typeValues(page, '2', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await typeValues(page, '2', '2'); // with the line, makes the extents 2 × 2
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+D');
  await typeValues(page, '0', '0');
  await typeValues(page, '1', '0');
  await typeValues(page, '0.5', '0.3');
  await page.keyboard.press('Escape');
  await page.keyboard.press('F10'); // polar off, so the text drops exactly where it is let go
  await page.getByTestId('zoom-extents').click();
  const box = (await page.locator('#canvas').boundingBox())!;
  const scale = Math.min(box.width, box.height) * 0.45;
  const c = await canvasCenter(page);
  const at = (x: number, y: number) => ({ x: c.x + (x - 1) * scale, y: c.y - (y - 1) * scale });
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2);
    await page.mouse.move(to.x, to.y);
  };

  let p = at(0.5, 0.3);
  await page.mouse.click(p.x, p.y);
  await expect(prop(page, 'Measured')).toHaveText('1.0000');
  await drag(at(1, 0), { x: at(2, 0).x - 4, y: at(2, 0).y + 3 });
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'end');
  await page.mouse.up();
  await expect(prop(page, 'Measured')).toHaveText('2.0000');

  await drag(at(1, 0.3), at(2.6, 0.42)); // the text, now centered over the longer span, out past its end
  await page.mouse.up();
  await page.keyboard.press('Escape');
  p = at(1, 0.3);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#properties h2')).toHaveText('Drawing'); // nothing left where it was
  p = at(2.6, 0.375); // past the extension line: only the moved text is here
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#properties h2')).toHaveText(/^Dimension /);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Escape');
  p = at(1, 0.3);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#properties h2')).toHaveText(/^Dimension /); // undone: back in the middle
});

test('a dimension snapped to a line follows when the line is edited, and is erased with it; one undo brings both back', async ({ page }) => {
  await page.keyboard.press('l');
  await typeValues(page, '0', '0');
  await typeValues(page, '2', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await typeValues(page, '2', '2'); // with the line, makes the extents 2 × 2
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const box = (await page.locator('#canvas').boundingBox())!;
  const scale = Math.min(box.width, box.height) * 0.45;
  const c = await canvasCenter(page);
  const at = (x: number, y: number) => ({ x: c.x + (x - 1) * scale, y: c.y - (y - 1) * scale });
  const clickAt = async (x: number, y: number, snap?: string) => {
    const p = at(x, y);
    await page.mouse.move(p.x + 3, p.y - 2);
    if (snap) await expect(page.locator('#canvas')).toHaveAttribute('data-snap', snap);
    await page.mouse.click(p.x + 3, p.y - 2);
  };

  await page.keyboard.press('Shift+D');
  await clickAt(0, 0, 'end');
  await clickAt(2, 0, 'end');
  await clickAt(1, 0.5);
  await page.keyboard.press('Escape');
  await expect(prop(page, 'entity-count')).toHaveText('3');

  await clickAt(0.5, 0); // the line
  await expect(page.locator('#properties h2')).toHaveText(/^Line /);
  await prop(page, 'End X').click();
  await page.keyboard.type('2.5');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await clickAt(0.6, 0.5); // the dimension line
  await expect(prop(page, 'Measured')).toHaveText('2.5000');

  await page.keyboard.press('Escape');
  await clickAt(0.5, 0);
  await page.keyboard.press('Delete');
  await expect(prop(page, 'entity-count')).toHaveText('1'); // the point is all that is left
  await page.keyboard.press('Control+z');
  await expect(prop(page, 'entity-count')).toHaveText('3');
  await clickAt(0.6, 0.5);
  await expect(prop(page, 'Measured')).toHaveText('2.5000');
});

test('Symmetric diameter in lathe mode: a snapped shoulder reads Ø twice its height, and follows the profile', async ({ page }) => {
  await page.getByTestId('lathe').click();
  await page.keyboard.press('l');
  await typeValues(page, '0', '0.5');
  await typeValues(page, '1', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await typeValues(page, '0', '-0.5'); // with the line, makes the extents 1 × 1
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const at = await extentsMapper(page, { minX: 0, maxX: 1, minY: -0.5, maxY: 0.5 });

  await expect(page.getByTestId('tool-dimSymmetric')).toBeVisible();
  await page.keyboard.press('Shift+M');
  await expect(page.getByTestId('tool-dimSymmetric')).toHaveClass(/active/);
  let p = at(1, 0.5);
  await page.mouse.move(p.x - 2, p.y + 2);
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'end');
  await page.mouse.click(p.x - 2, p.y + 2);
  p = at(1.3, 0.2);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(prop(page, 'entity-count')).toHaveText('3');

  const dim = at(1.3, 0.45); // on the dimension line, between the arrow and the text
  await page.mouse.click(dim.x, dim.y);
  await expect(prop(page, 'Type')).toHaveText('Symmetric diameter');
  await expect(prop(page, 'Text')).toHaveText('Ø1.000');

  await page.keyboard.press('Escape');
  p = at(0.5, 0.5);
  await page.mouse.click(p.x, p.y);
  await prop(page, 'End X').click(); // lathe mode: Y is named X
  await page.keyboard.type('0.625');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.mouse.click(dim.x, dim.y);
  await expect(prop(page, 'Text')).toHaveText('Ø1.250');
});

test('Baseline stacks dimensions from one start, a spacing apart; Enter finishes; Continue chains from the end', async ({ page }) => {
  await page.keyboard.press('Shift+D');
  await typeValues(page, '0', '0');
  await typeValues(page, '1', '0');
  await typeValues(page, '0.5', '-0.4');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await typeValues(page, '3', '1');
  await typeValues(page, '-1', '-2'); // two points set the extents, clear of the dimension
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const at = await extentsMapper(page, { minX: -1, maxX: 3, minY: -2, maxY: 1 });

  await page.getByTestId('tool-dimBaseline').click();
  let p = at(0.1, -0.4); // the dimension line, near its first extension line
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('#status .status-prompt')).toHaveText('Baseline: pick the next point (Enter to finish)');
  await typeValues(page, '2', '0'); // length 2, angle 0 from the start
  await typeValues(page, '3', '0');
  await page.keyboard.press('Enter'); // finished: the tool starts again
  await expect(page.locator('#status .status-prompt')).toHaveText('Baseline: pick a linear dimension near the extension line to start from');
  await expect(prop(page, 'entity-count')).toHaveText('5');

  await page.keyboard.press('Shift+K');
  p = at(0.9, -0.4); // near the second extension line
  await page.mouse.click(p.x, p.y);
  await typeValues(page, '0.5', '0');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(prop(page, 'entity-count')).toHaveText('6');
  p = at(1.25, -0.4); // the chained dimension, on the first one's line
  await page.mouse.click(p.x, p.y);
  await expect(prop(page, 'Measured')).toHaveText('0.5000');
});

test('Ordinate in lathe mode: Z by a vertical leader, X as Ø by a sideways one; Set origin moves them all', async ({ page }) => {
  await page.getByTestId('lathe').click();
  await page.getByTestId('diameter').click();
  await page.keyboard.press('l');
  await typeValues(page, '0', '0.25'); // Z 0, Ø .25
  await typeValues(page, '1', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await typeValues(page, '2', '-1');
  await typeValues(page, '-1', '1.5'); // two points set the extents
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const at = await extentsMapper(page, { minX: -1, maxX: 2, minY: -0.5, maxY: 0.75 });
  const option = (name: string) => page.locator('.option-button', { hasText: name });

  await page.keyboard.press('Shift+Z');
  await expect(option('Z ordinate')).toBeVisible();
  let p = at(1, 0.125);
  await page.mouse.move(p.x - 2, p.y + 2);
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'end');
  await page.mouse.click(p.x - 2, p.y + 2);
  p = at(1, 0.6); // straight up: a Z ordinate
  await page.mouse.click(p.x, p.y);
  p = at(1, 0.125);
  await page.mouse.click(p.x - 2, p.y + 2);
  p = at(1.6, 0.125); // sideways: an X ordinate, read as a diameter
  await page.mouse.click(p.x, p.y);
  await option('Set origin').click();
  p = at(0.5, 0.125); // the line's midpoint
  await page.mouse.move(p.x, p.y + 2);
  await expect(page.locator('#canvas')).toHaveAttribute('data-snap', 'mid');
  await page.mouse.click(p.x, p.y + 2);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(prop(page, 'entity-count')).toHaveText('5');

  p = at(1, 0.4); // on the Z ordinate's leader
  await page.mouse.click(p.x, p.y);
  await expect(prop(page, 'Type')).toHaveText('Ordinate');
  await expect(prop(page, 'Text')).toHaveText('.500'); // from Z .5 now
  await page.keyboard.press('Control+z'); // the origin back
  await expect(prop(page, 'Text')).toHaveText('1.000');
  await page.keyboard.press('Escape');
  p = at(1.3, 0.125); // on the X ordinate's leader
  await page.mouse.click(p.x, p.y);
  await expect(prop(page, 'Text')).toHaveText('Ø.250');
});

test('Align ordinates puts the selected ordinates\' leader ends on one level', async ({ page }) => {
  await page.keyboard.press('l');
  await typeValues(page, '0', '0');
  await typeValues(page, '1', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await typeValues(page, '-1', '-1');
  await typeValues(page, '2', '2'); // two points set the extents
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const at = await extentsMapper(page, { minX: -1, maxX: 2, minY: -1, maxY: 2 });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };

  await page.keyboard.press('Shift+Z');
  await click(1, 0); // the line's end
  await click(1, 0.6);
  await click(0.5, 0); // its midpoint
  await click(0.5, 1.2); // too far above the first to snap to its baseline
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(prop(page, 'entity-count')).toHaveText('5');

  const from = at(1.3, 1.5);
  const to = at(0.3, 0.4); // right to left: crossing, catching both leaders but not the line
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('tool-dimAlignOrdinates').click();
  await expect(page.locator('#status .status-prompt')).toHaveText('Align ordinates: pick the level the leaders end at');
  await click(1.6, 0.9);
  await page.keyboard.press('Escape');

  await click(0.5, 1.32); // where the higher one's text was
  await expect(page.locator('#properties h2')).toHaveText('Drawing');
  await click(0.5, 1.02); // just above the new level: its text now
  await expect(prop(page, 'Text')).toHaveText('.500');
});

test('Center mark marks a circle and goes with it; Two lines puts a centerline between them', async ({ page }) => {
  await page.keyboard.press('c');
  await typeValues(page, '0', '0');
  await typeValues(page, '0.5');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await typeValues(page, '1', '-0.5');
  await typeValues(page, '2', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await typeValues(page, '1', '0.5');
  await typeValues(page, '2', '0');
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const at = await extentsMapper(page, { minX: -0.5, maxX: 3, minY: -0.5, maxY: 0.5 });
  const click = async (x: number, y: number) => {
    const p = at(x, y);
    await page.mouse.click(p.x, p.y);
  };

  await page.keyboard.press('Shift+E');
  await click(0, 0.5); // the circle
  await page.locator('[data-option="method:lines"]').click();
  await click(2, -0.5);
  await click(2, 0.5);
  await page.keyboard.press('Escape');
  await expect(prop(page, 'entity-count')).toHaveText('5');

  await click(0.03, 0); // the mark's cross
  await expect(prop(page, 'Type')).toHaveText('Center mark');
  await page.keyboard.press('Escape');
  await click(2.4, 0); // the centerline
  await expect(prop(page, 'Type')).toHaveText('Centerline');
  await page.keyboard.press('Escape');

  await click(0.5 * Math.SQRT1_2, 0.5 * Math.SQRT1_2); // the circle, clear of the mark's arms
  await expect(prop(page, 'Type')).toHaveCount(0);
  await expect(page.locator('#properties h2')).toHaveText(/^Circle /);
  await page.keyboard.press('Delete');
  await expect(prop(page, 'entity-count')).toHaveText('3'); // the circle and its mark
});

test.describe('leader', () => {
  test('the note is typed into a box that has the focus: letters are text, not tool shortcuts; Enter adds it', async ({ page }) => {
    await page.keyboard.press('Shift+N');
    await expect(page.getByTestId('tool-dimLeader')).toHaveClass(/active/);
    await typeValues(page, '0', '0'); // arrow point
    await typeValues(page, '1', '0.5'); // landing, as ΔX, ΔY from the arrow point
    await expect(page.locator('#status .status-prompt')).toHaveText('Leader: type the note, then press Enter (%%d °, %%c Ø, %%p ±)');
    const note = page.locator('.input-boxes input[data-field="text"]');
    await expect(note).toBeFocused();
    await page.keyboard.type('.010 X 45%%d LC');
    await page.keyboard.press('Enter');
    await expect(prop(page, 'entity-count')).toHaveText('1');
    await expect(page.getByTestId('tool-dimLeader')).toHaveClass(/active/); // sticky: L and C above did not start Line or Circle

    // Its text and points in the properties panel.
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    // A window over the whole canvas: Zoom Extents left the leader, text and all, inside it.
    await page.mouse.move(box.x + 3, box.y + 3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#properties h2')).toHaveText(/^Dimension /);
    await expect(prop(page, 'Type')).toHaveText('Leader');
    await expect(prop(page, 'Text')).toHaveText('.010 X 45° LC');
    await expect(prop(page, 'Measured')).toHaveCount(0);
    await expect(prop(page, 'Landing X')).toHaveText('1.0000');
  });

  test('Esc at the note leaves the tool without adding anything', async ({ page }) => {
    await page.keyboard.press('Shift+N');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '1');
    await page.keyboard.type('2X');
    await page.keyboard.press('Escape');
    await expect(page.locator('.options-tool')).toHaveText('Select');
    await expect(prop(page, 'entity-count')).toHaveText('0');
  });
});

test.describe('Phase 3 done-when: a turned profile built from construction lines by trimming alone', () => {
  test('six xlines trimmed to a shaft step, with a .010 x 45° chamfer and an R.020 fillet, exact to 1e-12', async ({ page }) => {
    // Xlines: centerline and two radii (Ø.250, Ø.375), the front face, shoulder at Z .4 and back face at Z 1.
    await page.keyboard.press('x');
    await expect(page.locator('[data-option="method:h"]')).toHaveClass(/active/);
    for (const y of ['0', '0.125', '0.1875']) await typeValues(page, '0', y);
    await page.locator('[data-option="method:v"]').click();
    for (const x of ['0', '0.4', '1']) await typeValues(page, x, '0');
    await page.keyboard.press('Escape');
    // Two points frame the part, since Zoom Extents leaves xlines out.
    await page.keyboard.press('p');
    await typeValues(page, '-0.1', '-0.05');
    await typeValues(page, '1.1', '0.25');
    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('8');
    await page.getByTestId('zoom-extents').click();
    const at = await extentsMapper(page, { minX: -0.1, maxX: 1.1, minY: -0.05, maxY: 0.25 });
    const click = async (x: number, y: number) => {
      const p = at(x, y);
      await page.mouse.click(p.x, p.y);
    };

    await page.keyboard.press('t');
    await page.keyboard.press('Enter'); // every object is a cutting edge
    // Each xline: one far side, then inward from that side, then the other far side.
    const picks: [number, number][] = [
      [-0.05, 0], [1.05, 0], // centerline: Z 0 to 1
      [1.05, 0.125], [0.7, 0.125], [-0.05, 0.125], // Ø.250: Z 0 to .4
      [-0.05, 0.1875], [0.2, 0.1875], [1.05, 0.1875], // Ø.375: Z .4 to 1
      [0, 0.22], [0, -0.03], // front face: centerline to Ø.250
      [0.4, -0.03], [0.4, 0.06], [0.4, 0.22], // shoulder: Ø.250 to Ø.375
      [1, 0.22], [1, -0.03], // back face: Ø.375 to centerline
    ];
    for (const [x, y] of picks) await click(x, y);
    await page.keyboard.press('Enter');
    await expect(prop(page, 'entity-count')).toHaveText('8'); // trimmed in place, nothing split off

    await page.keyboard.press('Shift+F');
    // The size comes first, in the box at the cursor; the method is a button at that step.
    await expect(page.locator('.input-field span')).toHaveText(['D1']);
    await page.locator('[data-option="angle"]').click();
    await typeValues(page, '0.010');
    await typeValues(page, '45');
    await expect(page.locator('#status .status-prompt')).toHaveText('Chamfer 0.01 × 45°: pick the first object');
    await click(0.2, 0.125); // the Ø.250 line, measured along it
    await click(0, 0.06); // the front face
    await page.keyboard.press('Escape');

    await page.keyboard.press('f');
    await expect(page.locator('.input-field span')).toHaveText(['R']);
    await typeValues(page, '0.020');
    await expect(page.locator('[data-option="size"]')).toHaveText('Change size (R 0.02)…');
    await click(0.3, 0.125);
    await click(0.4, 0.17);
    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('10');

    const exact = async (label: string) => Number(await prop(page, label).getAttribute('title'));
    const expectProps = async (x: number, y: number, kind: RegExp, want: Record<string, number>) => {
      await page.keyboard.press('Escape'); // clear the selection
      await click(x, y);
      await expect(page.locator('#properties h2')).toHaveText(kind);
      for (const [label, value] of Object.entries(want)) expect(Math.abs((await exact(label)) - value), label).toBeLessThanOrEqual(1e-12);
    };
    const line = (sx: number, sy: number, ex: number, ey: number) => ({ 'Start X': sx, 'Start Y': sy, 'End X': ex, 'End Y': ey });
    await expectProps(0.5, 0, /^Line /, line(0, 0, 1, 0));
    await expectProps(0, 0.05, /^Line /, line(0, 0.115, 0, 0));
    await expectProps(0.005, 0.12, /^Line /, line(0.01, 0.125, 0, 0.115)); // the chamfer
    await expectProps(0.2, 0.125, /^Line /, line(0.38, 0.125, 0.01, 0.125));
    const m = 0.02 * Math.SQRT1_2;
    await expectProps(0.38 + m, 0.145 - m, /^Arc /, { 'Center X': 0.38, 'Center Y': 0.145, Radius: 0.02, 'Start X': 0.38, 'Start Y': 0.125, 'End X': 0.4, 'End Y': 0.145 });
    await expectProps(0.4, 0.17, /^Line /, line(0.4, 0.145, 0.4, 0.1875));
    await expectProps(0.7, 0.1875, /^Line /, line(0.4, 0.1875, 1, 0.1875));
    await expectProps(1, 0.1, /^Line /, line(1, 0.1875, 1, 0));
  });
});

test.describe('Phase 4 done-when: the reference drawing, checked text by text', () => {
  test('a turned pin at 10:1 with every dimension type, overrides, a dual style and a leader reads exactly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?reference');
    await expect(prop(page, 'entity-count')).toHaveText('19');
    await expect(page.getByTestId('sheet-scale')).toHaveValue('10');
    await expect(page.locator('#dimstyles li[data-dim-style="INCH-DUAL"] .layer-count')).toHaveText('1');
    await page.getByTestId('zoom-extents').click();
    // Extents and text centers from the layout (src/ui/referenceDrawing.test.ts builds the same drawing).
    const at = await extentsMapper(page, { minX: -0.5707068245125347, maxX: 0.6365194986072423, minY: -0.14500000000000002, maxY: 0.20600000000000002 });
    const texts: [string, number, number][] = [
      ['.500 [12.7]', 0.25, -0.0375],
      ['.200 REF', 0.1, 0.1315],
      ['.0940 ±.0005', 0.5875, 0.047],
      ['.014', 0.0245, 0.1065],
      ['45°', 0.0747, 0.0893],
      ['Ø.188 +.000/-.001', -0.5245, -0.13],
      ['R.030', -0.1395, -0.12],
      ['120°', -0.3, 0.15],
      ['.010 X 45°', -0.1374, 0.2],
    ];
    for (const [text, x, y] of texts) {
      await page.keyboard.press('Escape');
      const p = at(x, y);
      await page.mouse.click(p.x, p.y);
      await expect(page.locator('#properties h2'), text).toHaveText(/^Dimension /);
      await expect(prop(page, 'Text'), text).toHaveText(text);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('Phase 5 done-when: a turned pin in lathe mode, checked text by text', () => {
  test('lathe mode with Ø on: symmetric diameters, Z ordinates on one baseline, an X ordinate as a diameter and the notes read exactly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?lathe');
    await expect(prop(page, 'entity-count')).toHaveText('23');
    await expect(page.getByTestId('sheet-scale')).toHaveValue('10');
    await expect(page.getByTestId('lathe')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('diameter')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('zoom-extents').click();
    // Extents and text centers from the layout (src/ui/latheReference.test.ts builds the same drawing).
    const at = await extentsMapper(page, { minX: -0.45649999999999996, maxX: 0.8517764623955432, minY: -0.1065, maxY: 0.14975000000000002 });
    const texts: [string, number, number][] = [
      ['Ø.125', 0.14, 0.03125],
      ['Ø.188', 0.51, 0.047],
      ['Ø.156', 0.829, 0.078],
      ['.000', 0, 0.14375],
      ['.250', 0.25, 0.14375],
      ['.400', 0.4, 0.14375],
      ['.600', 0.6, 0.14375],
      ['.750', 0.75, 0.14375],
      ['Ø.030 THRU', 0.5665, -0.05],
      ['.010 X 45°', -0.1574, 0.09],
    ];
    for (const [text, x, y] of texts) {
      await page.keyboard.press('Escape');
      const p = at(x, y);
      await page.mouse.click(p.x, p.y);
      await expect(page.locator('#properties h2'), text).toHaveText(/^Dimension /);
      await expect(prop(page, 'Text'), text).toHaveText(text);
    }
    expect(errors).toEqual([]);
  });
});

test.describe('blocks', () => {
  /** Ink, paper, or not painted yet, at a world point, after Zoom Extents fitted `extents`. */
  async function prober(page: Page, extents: { minX: number; maxX: number; minY: number; maxY: number }) {
    const at = await extentsMapper(page, extents);
    const probe = async (x: number, y: number): Promise<string> => {
      const p = at(x, y);
      return page.evaluate(([sx, sy]) => {
        const c = document.querySelector<HTMLCanvasElement>('#canvas')!;
        const r = c.getBoundingClientRect();
        const k = c.width / r.width;
        const data = c.getContext('2d')!.getImageData(Math.round((sx! - r.left) * k) - 2, Math.round((sy! - r.top) * k) - 2, 5, 5).data;
        let paper = true;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3]! === 0) return 'not painted';
          if (data[i]! < 128) return 'ink';
          if (data[i]! < 250) paper = false;
        }
        return paper ? 'paper' : 'grey';
      }, [p.x, p.y]);
    };
    return { at, probe };
  }

  /** Draws a line (0,0)-(1,0) and a circle at (1,0) R.25, selects both and makes them block "Tool", described "MGEHR holder". */
  async function makeToolBlock(page: Page): Promise<void> {
    await page.keyboard.press('l');
    await typeValues(page, '0', '0');
    await typeValues(page, '1', '0'); // length 1 at 0°
    await page.keyboard.press('Escape');
    await page.keyboard.press('c');
    await typeValues(page, '1', '0');
    await typeValues(page, '0.25');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const box = (await page.locator('#canvas').boundingBox())!;
    await page.mouse.move(box.x + 3, box.y + 3); // a window over everything
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#properties h2')).toHaveText('2 objects');

    await page.keyboard.press('k');
    await expect(page.getByTestId('tool-createBlock')).toHaveClass(/active/);
    await expect(page.locator('[data-option="after:convert"]')).toHaveClass(/active/);
    await typeValues(page, '0', '0'); // base point: the left end
    await expect(page.locator('.input-boxes input[data-field="text"]')).toBeFocused();
    await page.keyboard.type('Tool'); // letters are text, not shortcuts
    await page.keyboard.press('Enter');
    await expect(page.locator('#status .status-prompt')).toHaveText('Create block Tool: type a description (holder, insert, notes), or press Enter for none');
    await page.keyboard.type('MGEHR holder');
    await page.keyboard.press('Enter');
    await expect(prop(page, 'entity-count')).toHaveText('1');
  }

  test('Create block (K): the selection becomes a block, listed in the Blocks panel and drawn as one instance', async ({ page }) => {
    await expect(page.locator('#blocks .blocks-empty')).toHaveText('None yet. Select geometry and choose Create block (K).');
    await makeToolBlock(page);
    const row = page.locator('#blocks li[data-block="Tool"]');
    await expect(row.locator('.layer-name')).toHaveText('Tool');
    await expect(row.locator('.layer-count')).toHaveText('1');
    await expect(row.locator('.block-description')).toHaveText('MGEHR holder');
    await expect(row.locator('.block-preview svg g > *')).toHaveCount(2);

    // Drawn: ink on the edge line, paper just above it (polled: the canvas repaints on the next frame).
    const { at, probe } = await prober(page, { minX: 0, maxX: 1.25, minY: -0.25, maxY: 0.25 });
    await expect.poll(() => probe(0.5, 0)).toBe('ink');
    await expect.poll(() => probe(0.5, 0.15)).toBe('paper');

    const p = at(0.5, 0);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Block e\d+$/);
    await expect(prop(page, 'Block')).toHaveText('Tool');
    await expect(prop(page, 'Description')).toHaveText('MGEHR holder');
    await expect(prop(page, 'Mirrored').locator('select')).toHaveValue('no');

    await page.keyboard.press('Control+z');
    await expect(prop(page, 'entity-count')).toHaveText('2');
    await expect(page.locator('#blocks .blocks-empty')).toBeVisible();
  });

  test('Insert: clicking the block in the panel places copies, turned and mirrored as asked', async ({ page }) => {
    await makeToolBlock(page);
    await page.locator('#blocks li[data-block="Tool"]').click();
    await expect(page.getByTestId('tool-insertBlock')).toHaveClass(/active/);
    await expect(page.locator('#status .status-prompt')).toHaveText('Insert Tool: pick where its base point goes');
    await expect(page.locator('[data-option="block:Tool"]')).toHaveClass(/active/);
    await typeValues(page, '0', '1'); // base point at (0, 1)
    await expect(page.locator('#status .status-prompt')).toHaveText('Insert Tool: pick or type the rotation, or press Enter for 0°');
    await typeValues(page, '90'); // edge runs straight up
    await expect(prop(page, 'entity-count')).toHaveText('2');
    await expect(page.locator('#blocks li[data-block="Tool"] .layer-count')).toHaveText('2');

    await page.locator('[data-option="mirror"]').click(); // still in Insert: the next copy mirrored
    await expect(page.locator('[data-option="mirror"]')).toHaveClass(/active/);
    await typeValues(page, '2', '0');
    await page.keyboard.press('Enter'); // keeps 90°
    await expect(prop(page, 'entity-count')).toHaveText('3');
    await page.keyboard.press('Escape');

    // The turned copy's edge runs up from (0, 1) to (0, 2); the mirrored one, turned 90°, runs up from (2, 0) too.
    await page.getByTestId('zoom-extents').click();
    const { at, probe } = await prober(page, { minX: -0.25, maxX: 2.25, minY: -0.25, maxY: 2.25 });
    await expect.poll(() => probe(0, 1.5)).toBe('ink');
    await expect.poll(() => probe(2, 0.5)).toBe('ink');
    await expect.poll(() => probe(1, 1.5)).toBe('paper');
    const p = at(2, 0.5);
    await page.mouse.click(p.x, p.y);
    await expect(prop(page, 'Rotation')).toHaveText(/^90/);
    await expect(prop(page, 'Mirrored').locator('select')).toHaveValue('yes');
  });

  test('an instance edited in the properties panel, then exploded back into plain objects (Shift+U)', async ({ page }) => {
    await makeToolBlock(page);
    const { at, probe } = await prober(page, { minX: 0, maxX: 1.25, minY: -0.25, maxY: 0.25 });
    const p = at(0.5, 0);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Block /);

    // Turned 90° about its insertion point: the edge now runs up the Y axis.
    await prop(page, 'Rotation').click();
    await page.keyboard.type('90');
    await page.keyboard.press('Enter');
    await expect(prop(page, 'Rotation')).toHaveText(/^90/);
    await expect.poll(() => probe(0, 0.15)).toBe('ink');
    await expect.poll(() => probe(0.5, 0)).toBe('paper');

    await prop(page, 'Scale').click();
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(page.locator('#status .status-prompt')).toHaveText("Scale can't be 0: the scale needs to be more than zero.");
    await prop(page, 'Mirrored').locator('select').selectOption('yes');
    await expect(prop(page, 'Mirrored').locator('select')).toHaveValue('yes');

    await page.keyboard.press('Shift+U');
    await expect(prop(page, 'entity-count')).toHaveText('2');
    await expect(page.locator('#blocks li[data-block="Tool"] .layer-count')).toHaveText('0');
    await page.keyboard.press('Escape');
    const q = at(0, 0.15); // the edge, now a plain line
    await page.mouse.click(q.x, q.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Line /);
  });

  test('a dimension snapped to the tool in a block follows the tool when it moves', async ({ page }) => {
    await makeToolBlock(page); // the tool's edge (0,0)-(1,0) and nose circle, as one instance
    await page.keyboard.press('l');
    await typeValues(page, '3', '-0.5');
    await typeValues(page, '1', '90'); // a part face at Z 3, from -.5 to .5
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByTestId('zoom-extents').click();
    const { at } = await prober(page, { minX: 0, maxX: 3, minY: -0.5, maxY: 0.5 });
    const click = async (x: number, y: number) => {
      const p = at(x, y);
      await page.mouse.click(p.x, p.y);
    };

    await page.keyboard.press('Shift+D');
    await click(0, 0); // Endpoint snap on the block's edge: its base end
    await click(3, 0.5); // the face's top end
    await click(1.5, 1); // dimension line above
    await expect(prop(page, 'entity-count')).toHaveText('3');
    await page.keyboard.press('Escape');
    await click(2, 1);
    await expect(prop(page, 'Measured')).toHaveText('3.0000');
    await page.keyboard.press('Escape');

    await click(0.5, 0); // the instance
    await expect(page.locator('#properties h2')).toHaveText(/^Block /);
    await prop(page, 'X').click();
    await page.keyboard.type('0.5');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await click(2.7, 1); // the dimension line, clear of the text now centered on the shorter span
    await expect(prop(page, 'Measured')).toHaveText('2.5000');
  });

  test('Edit block: the block opens by itself; Save changes every instance in one undo step', async ({ page }) => {
    await makeToolBlock(page);
    const row = page.locator('#blocks li[data-block="Tool"]');
    await row.locator('.block-preview').click(); // a second copy at (0, 1)
    await typeValues(page, '0', '1');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(row.locator('.layer-count')).toHaveText('2');

    await row.locator('[data-role="edit"]').click();
    await expect(page.locator('#block-edit')).toBeVisible();
    await expect(page.locator('#block-edit')).toContainText('Editing block Tool');
    await expect(page.locator('#blocks .blocks-empty')).toHaveText('Editing Tool. Save block or Cancel in the bar above the drawing.');
    await expect(prop(page, 'entity-count')).toHaveText('2'); // the block's edge and nose circle
    await page.keyboard.press('Control+s');
    await expect(page.locator('#status .status-prompt')).toHaveText('Save or cancel the block Tool first.');

    await page.getByTestId('zoom-extents').click();
    const { at } = await prober(page, { minX: 0, maxX: 1.25, minY: -0.25, maxY: 0.25 });
    const p = at(1.25, 0);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Circle /);
    await page.keyboard.press('Delete');
    await expect(prop(page, 'entity-count')).toHaveText('1');

    await page.getByTestId('block-edit-save').click();
    await expect(page.locator('#block-edit')).toBeHidden();
    await expect(page.locator('#status .status-prompt')).toHaveText('Saved block Tool');
    await expect(prop(page, 'entity-count')).toHaveText('2'); // both instances, back in the drawing
    await expect(row.locator('.block-preview svg g > *')).toHaveCount(1);

    await page.keyboard.press('Control+z'); // one step brings the nose back to both
    await expect(row.locator('.block-preview svg g > *')).toHaveCount(2);
    await expect(prop(page, 'entity-count')).toHaveText('2');
  });

  test('Edit block Cancel, then Rename, Delete and Purge from the Blocks panel', async ({ page }) => {
    await makeToolBlock(page);
    const preview = (name: string) => page.locator(`#blocks li[data-block="${name}"] .block-preview svg g > *`);
    await page.locator('#blocks li[data-block="Tool"] [data-role="edit"]').click();
    await page.getByTestId('zoom-extents').click();
    const extents = { minX: 0, maxX: 1.25, minY: -0.25, maxY: 0.25 };
    let { at } = await prober(page, extents);
    let p = at(1.25, 0);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Delete');
    await expect(prop(page, 'entity-count')).toHaveText('1');
    await page.getByTestId('block-edit-cancel').click();
    await expect(page.locator('#status .status-prompt')).toHaveText('Block edit cancelled');
    await expect(preview('Tool')).toHaveCount(2);
    await page.getByTestId('zoom-extents').click(); // the bar is gone: the canvas is taller again
    ({ at } = await prober(page, extents));

    await page.locator('#blocks li[data-block="Tool"] [data-role="name"]').dblclick();
    const input = page.locator('#blocks input[data-role="name-input"]');
    await expect(input).toBeFocused();
    await input.fill('Boring bar');
    await input.press('Enter');
    await expect(page.locator('#status .status-prompt')).toHaveText('Rename block Tool to Boring bar');
    await expect(preview('Boring bar')).toHaveCount(2);
    await page.keyboard.press('Escape');
    p = at(0.5, 0);
    await page.mouse.click(p.x, p.y);
    await expect(prop(page, 'Block')).toHaveText('Boring bar');

    await page.locator('#blocks li[data-block="Boring bar"] [data-role="delete"]').click();
    await expect(page.locator('#status .status-prompt')).toHaveText('Boring bar has 1 instance in the drawing; erase or explode them first.');
    await page.getByTestId('purge-blocks').click();
    await expect(page.locator('#status .status-prompt')).toHaveText('Every block is in use; nothing to purge.');

    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Delete'); // the only instance gone, the block is unused
    await expect(prop(page, 'entity-count')).toHaveText('0');
    await page.getByTestId('purge-blocks').click();
    await expect(page.locator('#status .status-prompt')).toHaveText('Purge 1 block');
    await expect(page.locator('#blocks .blocks-empty')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(preview('Boring bar')).toHaveCount(2);
  });

  test('Library: a block saved from one drawing goes into a new mm drawing, converted, and outlives a reload', async ({ page }) => {
    const status = page.locator('#status .status-prompt');
    await expect(page.locator('#library .blocks-empty')).toHaveText('Empty. Save a block to the library from the Blocks panel; every drawing can use it.');
    await makeToolBlock(page);
    const toLibrary = page.locator('#blocks li[data-block="Tool"] [data-role="to-library"]');
    await toLibrary.click();
    await expect(status).toHaveText('Saved Tool to the library');
    const libRow = page.locator('#library li[data-library-block="Tool"]');
    await expect(libRow.locator('.layer-count')).toHaveText('in');
    await expect(libRow.locator('.block-description')).toHaveText('MGEHR holder');
    await toLibrary.click();
    await expect(status).toHaveText('Tool is already in the library, unchanged.');

    await page.reload();
    await expect(libRow).toBeVisible();
    await expect(page.locator('#blocks .blocks-empty')).toBeVisible(); // a new drawing: no blocks of its own
    await page.getByTestId('new').click();
    await page.locator('.context-menu').getByRole('button', { name: 'New mm drawing' }).click();
    await expect(page.getByTestId('units')).toHaveText('mm');

    await libRow.locator('.block-preview').click();
    await expect(page.getByTestId('tool-insertBlock')).toHaveClass(/active/);
    await expect(page.locator('#blocks li[data-block="Tool"] .block-description')).toHaveText('MGEHR holder');
    await typeValues(page, '0', '0');
    await page.keyboard.press('Enter'); // rotation 0
    await page.keyboard.press('Escape');
    await expect(prop(page, 'entity-count')).toHaveText('1');

    // Exploded, the edge is 25.4 mm long: the inch block was converted.
    await page.getByTestId('zoom-extents').click();
    const { at } = await prober(page, { minX: 0, maxX: 31.75, minY: -6.35, maxY: 6.35 });
    const p = at(12.7, 0);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Block /);
    await page.keyboard.press('Shift+U');
    await page.keyboard.press('Escape');
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Line /);
    await expect(prop(page, 'End X')).toHaveAttribute('title', '25.4');
  });

  test('Library: clashes are asked about, Update from library, Export, and Import into another browser', async ({ page, browser }) => {
    const status = page.locator('#status .status-prompt');
    const menu = page.locator('.context-menu');
    await makeToolBlock(page);
    const row = page.locator('#blocks li[data-block="Tool"]');
    await row.locator('[data-role="to-library"]').click();
    await expect(page.locator('#library li[data-library-block="Tool"]')).toBeVisible();

    // The drawing's Tool loses its nose: now it differs from the library's.
    await row.locator('[data-role="edit"]').click();
    await page.getByTestId('zoom-extents').click();
    const { at } = await prober(page, { minX: 0, maxX: 1.25, minY: -0.25, maxY: 0.25 });
    const p = at(1.25, 0);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Delete');
    await page.getByTestId('block-edit-save').click();
    await expect(row.locator('.block-preview svg g > *')).toHaveCount(1);
    await expect(row.locator('[data-role="from-library"]')).toBeVisible();

    await row.locator('[data-role="to-library"]').click();
    await expect(menu.locator('.menu-heading')).toHaveText('The library already has a different Tool.');
    await menu.getByRole('button', { name: 'Save it as Tool 2' }).click();
    await expect(status).toHaveText('Saved Tool to the library as Tool 2');
    await expect(page.locator('#library li[data-library-block="Tool 2"] .block-preview svg g > *')).toHaveCount(1);

    await page.locator('#library li[data-library-block="Tool"] .block-preview').click();
    await expect(menu.locator('.menu-heading')).toHaveText("The drawing's Tool isn't the same as the library's.");
    await menu.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#blocks li')).toHaveCount(1); // nothing copied in

    await row.locator('[data-role="from-library"]').click();
    await expect(status).toHaveText('Update block Tool from the library');
    await expect(row.locator('.block-preview svg g > *')).toHaveCount(2);
    await expect(row.locator('[data-role="from-library"]')).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(row.locator('.block-preview svg g > *')).toHaveCount(1);

    const downloading = page.waitForEvent('download');
    await page.getByTestId('export-library').click();
    const file = await downloading;
    expect(file.suggestedFilename()).toBe('DanCAM blocks.cad2d-blocks.json');
    await expect(status).toHaveText('Exported 2 blocks');

    // Another browser: its own, empty library.
    const other = await (await browser.newContext()).newPage();
    await other.goto(page.url());
    await expect(other.locator('#library .blocks-empty')).toBeVisible();
    const choosing = other.waitForEvent('filechooser');
    await other.getByTestId('import-library').click();
    await (await choosing).setFiles((await file.path())!);
    await expect(other.locator('#status .status-prompt')).toHaveText('Imported 2 blocks');
    await expect(other.locator('#library li')).toHaveCount(2);

    const again = other.waitForEvent('filechooser');
    await other.getByTestId('import-library').click();
    await (await again).setFiles((await file.path())!);
    await expect(other.locator('#status .status-prompt')).toHaveText('Imported 0 blocks, 2 already in the library');

    await other.locator('#library li[data-library-block="Tool 2"] [data-role="delete"]').click();
    await other.locator('.context-menu').getByRole('button', { name: 'Delete Tool 2' }).click();
    await expect(other.locator('#library li')).toHaveCount(1);
  });
});

test('lathe mode marks Z0 X0 with a faint center mark, and a click near it starts a line exactly there', async ({ page }) => {
  await page.keyboard.press('c');
  await typeValues(page, '3', '3');
  await typeValues(page, '4'); // something to zoom to, clear of the origin
  await page.keyboard.press('Escape');
  await page.getByTestId('zoom-extents').click();
  const at = await extentsMapper(page, { minX: -1, maxX: 7, minY: -1, maxY: 7 });
  const o = at(0, 0);
  /** The red channel of the pixel `dy` CSS pixels above the origin. */
  const redAbove = (dy: number) =>
    page.evaluate(([sx, sy]) => {
      const c = document.querySelector<HTMLCanvasElement>('#canvas')!;
      const r = c.getBoundingClientRect();
      const k = c.width / r.width;
      return c.getContext('2d')!.getImageData(Math.round((sx! - r.left) * k), Math.round((sy! - r.top) * k), 1, 1).data[0];
    }, [o.x, o.y - dy]);
  await expect.poll(() => redAbove(12)).toBe(255); // lathe mode off: paper
  await page.getByTestId('lathe').click();
  await expect.poll(() => redAbove(12)).toBeLessThan(250); // the mark's upper arm: grey…
  expect(await redAbove(12)).toBeGreaterThan(128); // …and faint, not ink
  expect(await redAbove(6.5)).toBe(255); // the gap between the cross and the arm

  await page.keyboard.press('l');
  await page.mouse.move(o.x + 4, o.y - 3);
  await page.mouse.click(o.x + 4, o.y - 3); // Center snap onto Z0 X0
  await typeValues(page, '1', '0');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const mid = at(0.5, 0);
  await page.mouse.click(mid.x, mid.y);
  await expect(page.locator('#properties h2')).toHaveText(/^Line /);
  await expect(prop(page, 'Start Z')).toHaveAttribute('title', '0');
  await expect(prop(page, 'Start X')).toHaveAttribute('title', '0');
});

test.describe('Import STEP', () => {
  async function importFile(page: Page, path: string) {
    const choosing = page.waitForEvent('filechooser');
    await page.getByTestId('import-step').click();
    const chooser = await choosing;
    // No type filter: Safari greys out .step files when the Mac has no type registered for them.
    expect(await chooser.element().getAttribute('accept')).toBeNull();
    await chooser.setFiles(path);
  }

  test('a turned part from a STEP file is laid along Z with Z0 at its right end, on a layer named after the file', async ({ page }) => {
    const status = page.locator('#status .status-prompt');
    await page.getByTestId('new').click();
    await page.locator('.context-menu').getByRole('button', { name: 'New mm drawing' }).click();
    await importFile(page, 'test-fixtures/step/pin-mm.step');
    await expect(page.getByTestId('lathe')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-option="zero:right"]')).toHaveClass(/active/);
    await expect(status).toHaveText('Import pin-mm.step: choose the profile or three views, where Z0 goes and how it turns, then click or press Enter to place it');
    await page.keyboard.press('Enter');
    await expect(prop(page, 'entity-count')).toHaveText('14');
    await expect(status).toHaveText('Imported pin-mm.step: 14 lines and arcs on layer pin-mm.');
    await expect(page.locator('#layers')).toContainText('pin-mm');

    // The Ø10 body runs from Z-39 (after the 1x45° chamfer) to the shoulder at Z-10.
    await page.getByTestId('zoom-extents').click();
    const at = await extentsMapper(page, { minX: -40, maxX: 0, minY: 0, maxY: 5 });
    const p = at(-25, 5);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Line /);
    await expect(prop(page, 'Start Z')).toHaveText('-39.0000');
    await expect(prop(page, 'End Z')).toHaveText('-10.0000');
    await expect(prop(page, 'Start X')).toHaveText('5.0000');
    await expect(prop(page, 'Style').locator('select')).toHaveValue('');

    // The Ø3 bore, 8 deep from Z0, is inside the part: hidden.
    await page.keyboard.press('Escape');
    const b = at(-4, 1.5);
    await page.mouse.click(b.x, b.y);
    await expect(prop(page, 'Start Z')).toHaveText('-8.0000');
    await expect(prop(page, 'Style').locator('select')).toHaveValue('hidden');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect(prop(page, 'entity-count')).toHaveText('0');
  });

  test('cross holes and flats are reported as left out; a file that isn\'t STEP is refused', async ({ page }) => {
    const status = page.locator('#status .status-prompt');
    await importFile(page, 'test-fixtures/step/cross-hole-flat-mm.step');
    await page.locator('[data-option="zero:left"]').click();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText('Imported cross-hole-flat-mm.step: 3 lines and arcs on layer cross-hole-flat-mm. Left out: 4 faces not round about the axis (cross holes, flats, slots).');

    await importFile(page, 'test-fixtures/step/make_fixtures.py');
    await expect(status).toHaveText("Can't import make_fixtures.py: This is not a STEP file (it should start with ISO-10303-21;).");
    await expect(prop(page, 'entity-count')).toHaveText('3');
  });

  test('3 views: the shaft laid out third-angle, its cross hole a circle in the top view, a layer per view', async ({ page }) => {
    const status = page.locator('#status .status-prompt');
    await page.getByTestId('new').click();
    await page.locator('.context-menu').getByRole('button', { name: 'New mm drawing' }).click();
    await importFile(page, 'test-fixtures/step/shaft.step');
    await expect(page.locator('[data-option="half"]')).toBeEnabled();
    await page.locator('[data-option="mode:views"]').click();
    await expect(page.locator('[data-option="mode:views"]')).toHaveClass(/active/);
    await expect(page.locator('[data-option="half"]')).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(status).toHaveText(
      'Imported shaft.step as three views: 119 lines and arcs on layers shaft front, shaft fitted, shaft top, shaft end. Curves on shaft fitted are fitted with arcs and lines.',
    );
    for (const name of ['shaft front', 'shaft top', 'shaft end', 'shaft fitted']) await expect(page.locator('#layers')).toContainText(name);

    // Front view Z-61.2 to Z0; the top view above it (a gap of 61.2/8); the cross hole 1.8 from the far end, seen down its axis.
    await page.getByTestId('zoom-extents').click();
    const at = await extentsMapper(page, { minX: -61.2, maxX: 11.92, minY: -2.135, maxY: 14.0142779 });
    const p = at(-59.4 + 0.56, 11.8792779);
    await page.mouse.click(p.x, p.y);
    await expect(page.locator('#properties h2')).toHaveText(/^Circle/);
    await expect(prop(page, 'Radius')).toHaveText('0.5600');
    await expect(prop(page, 'Layer').locator('select')).toHaveValue('shaft top');

    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await expect(prop(page, 'entity-count')).toHaveText('0');
  });
});
