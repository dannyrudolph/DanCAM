import { type Drawing, type Layer, newEntityId } from '../model/drawing';
import type { Entity, EntityId } from '../model/entity';
import { freeLayerName } from '../model/layers';
import { type ProfileCurve, type ProfilePlacement, type TurnedProfile, placeProfile } from '../model/profilePlacement';
import type { Change } from '../model/undo';
import type { ToolDef, ToolGen, ToolOption } from './tool';
import { PREVIEW_ID } from './toolSteps';

/**
 * Import STEP's placing step (spec, "STEP import"): the turned profile
 * read from the file, shown in place with Z0 at its right or left end,
 * Flip and Half/Full in the options bar (kept for the session). A click or
 * Enter places it on a new layer named after the file, as one undo step;
 * Esc leaves without importing.
 */
export type StepImportTool = ToolDef & {
  /** The file to place next: its name (for the layer) and its profile. */
  load(fileName: string, profile: TurnedProfile): void;
  /** How the profile is placed now. */
  readonly placement: ProfilePlacement;
};

/** The file name without folders or its .step/.stp extension, for the layer. */
export function layerNameFor(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const name = base.replace(/\.(step|stp)$/i, '').trim();
  return name === '' ? 'STEP' : name;
}

/** The placed profile as drawing entities on `layer`. */
export function profileEntities(curves: readonly ProfileCurve[], layer: string, id: () => EntityId): Entity[] {
  return curves.map((c): Entity => (c.kind === 'line' ? { kind: 'line', id: id(), layer, start: c.start, end: c.end } : { kind: 'arc', id: id(), layer, center: c.center, radius: c.radius, startDeg: c.startDeg, endDeg: c.endDeg }));
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** What was left out, as a sentence, or '' when nothing was. */
export function leftOutMessage(p: TurnedProfile): string {
  const parts: string[] = [];
  if (p.left.notRound > 0) parts.push(`${plural(p.left.notRound, 'face')} not round about the axis (cross holes, flats, slots)`);
  if (p.left.freeform > 0) parts.push(`${plural(p.left.freeform, 'freeform face')}`);
  if (p.left.unreadable > 0) parts.push(`${plural(p.left.unreadable, 'unreadable face')}`);
  return parts.length === 0 ? '' : ` Left out: ${parts.join(', ')}.`;
}

export function createStepImportTool(): StepImportTool {
  let file: { name: string; profile: TurnedProfile } | undefined;
  let placement: ProfilePlacement = { zeroAt: 'right', flip: false, full: false };

  const options = (): ToolOption[] => [
    { key: 'zero:right', label: 'Z0 at right end', enabled: true, active: placement.zeroAt === 'right' },
    { key: 'zero:left', label: 'Z0 at left end', enabled: true, active: placement.zeroAt === 'left' },
    { key: 'flip', label: 'Flip', enabled: true, active: placement.flip },
    { key: 'half', label: 'Half', enabled: true, active: !placement.full },
    { key: 'full', label: 'Full', enabled: true, active: placement.full },
  ];

  function place(d: Drawing, name: string, profile: TurnedProfile): { changes: Change[]; layer: string; count: number } {
    const layer: Layer = { name: freeLayerName(d, layerNameFor(name)), color: '#000000', visible: true, style: 'visible' };
    const entities = profileEntities(placeProfile(profile, placement), layer.name, () => newEntityId(d));
    return { changes: [{ op: 'layer', after: layer }, ...entities.map((entity): Change => ({ op: 'add', entity }))], layer: layer.name, count: entities.length };
  }

  return {
    id: 'importStep',
    label: 'Import STEP',
    shortcut: '',
    repeat: false,
    load(fileName, profile) {
      file = { name: fileName.split(/[\\/]/).pop() ?? fileName, profile };
    },
    get placement() {
      return placement;
    },
    *run(ctx): ToolGen {
      const f = file;
      if (!f) return;
      for (;;) {
        const input = yield {
          kind: 'point',
          prompt: `Import ${f.name}: choose where Z0 goes, Flip and Half or Full, then click or press Enter to place it`,
          shown: () => profileEntities(placeProfile(f.profile, placement), '0', () => PREVIEW_ID),
          options: options(),
          canFinish: true,
        };
        if (input.kind === 'option') {
          if (input.key === 'zero:right' || input.key === 'zero:left') placement = { ...placement, zeroAt: input.key === 'zero:right' ? 'right' : 'left' };
          else if (input.key === 'flip') placement = { ...placement, flip: !placement.flip };
          else if (input.key === 'half' || input.key === 'full') placement = { ...placement, full: input.key === 'full' };
          continue;
        }
        if (input.kind !== 'point' && input.kind !== 'finish') continue;
        const { changes, layer, count } = place(ctx.drawing, f.name, f.profile);
        ctx.undo.commit({ label: `Import ${f.name}`, changes });
        ctx.message(`Imported ${f.name}: ${count} ${count === 1 ? 'line or arc' : 'lines and arcs'} on layer ${layer}.${leftOutMessage(f.profile)}`);
        file = undefined;
        return;
      }
    },
  };
}
