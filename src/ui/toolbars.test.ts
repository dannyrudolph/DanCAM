import { describe, expect, it } from 'vitest';
import { DEFAULT_TOOLBAR_PREFS, hideButton, parseToolbarPrefs, resetBar, setBarShown } from './toolbars';

const modify = { id: 'modify', label: 'Modify', items: [{ id: 'trim', label: 'Trim' }, { id: 'extend', label: 'Extend' }] };

describe('toolbar settings', () => {
  it('a fresh or unreadable setting gives the defaults: everything shown but Inquiry', () => {
    expect(parseToolbarPrefs(null)).toEqual({ hiddenBars: ['inquiry'], hiddenButtons: [] });
    expect(parseToolbarPrefs('{not json')).toBe(DEFAULT_TOOLBAR_PREFS);
    expect(parseToolbarPrefs('{"hiddenBars":[3],"hiddenButtons":[]}')).toBe(DEFAULT_TOOLBAR_PREFS);
    expect(parseToolbarPrefs('{"hiddenBars":[],"hiddenButtons":["trim"]}')).toEqual({ hiddenBars: [], hiddenButtons: ['trim'] });
  });

  it('hiding buttons and resetting a bar brings back only that bar\'s buttons', () => {
    let p = hideButton(DEFAULT_TOOLBAR_PREFS, 'trim');
    p = hideButton(p, 'trim');
    p = hideButton(p, 'line');
    expect(p.hiddenButtons).toEqual(['trim', 'line']);
    expect(resetBar(p, modify).hiddenButtons).toEqual(['line']);
  });

  it('a bar is shown and hidden by id, once', () => {
    const p = setBarShown(setBarShown(DEFAULT_TOOLBAR_PREFS, 'draw', false), 'draw', false);
    expect(p.hiddenBars).toEqual(['inquiry', 'draw']);
    expect(setBarShown(p, 'inquiry', true).hiddenBars).toEqual(['draw']);
  });
});
