import { FILE_EXTENSION } from '../io/nativeFile';

/** The File System Access API (Chrome, Edge); not in TypeScript's DOM types yet. */
type PickerType = { description: string; accept: Record<string, string[]> };
type PickerWindow = Window & {
  showSaveFilePicker?: (o: { suggestedName: string; types: PickerType[] }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (o: { types: PickerType[] }) => Promise<FileSystemFileHandle[]>;
};

const TYPES: PickerType[] = [{ description: 'DanCAM drawing', accept: { 'application/json': [FILE_EXTENSION] } }];
const UNTITLED = `Untitled${FILE_EXTENSION}`;

/** A file the user picked, not yet in use: adopt it only once it has opened cleanly. */
export type PickedFile = { readonly name: string; readonly text: string; readonly handle: FileSystemFileHandle | undefined };

const isCancel = (err: unknown): boolean => err instanceof DOMException && err.name === 'AbortError';

/**
 * Where the open drawing lives on disk. Uses the File System Access API where
 * the browser has it, so Save writes back to the same file; elsewhere Open
 * uses a file input and Save downloads a copy.
 */
export class DrawingFile {
  private handle: FileSystemFileHandle | undefined;
  private fileName = UNTITLED;

  constructor(private readonly win: PickerWindow = window) {}

  get name(): string {
    return this.fileName;
  }

  /** A new, unsaved drawing: the next Save asks where to put it. */
  reset(): void {
    this.handle = undefined;
    this.fileName = UNTITLED;
  }

  /**
   * Asks for a drawing to open. Undefined when the user cancels. The open
   * file doesn't change until `adopt`, so a file that fails to parse is never
   * the target of the next Save.
   */
  async open(): Promise<PickedFile | undefined> {
    if (this.win.showOpenFilePicker) {
      try {
        const [handle] = await this.win.showOpenFilePicker({ types: TYPES });
        if (!handle) return undefined;
        const file = await handle.getFile();
        return { name: file.name, text: await file.text(), handle };
      } catch (err) {
        if (isCancel(err)) return undefined;
        throw err;
      }
    }
    const file = await pickWithInput();
    if (!file) return undefined;
    // Without the API a picked file can't be written back; Save downloads a copy.
    return { name: file.name, text: await file.text(), handle: undefined };
  }

  /** Makes a successfully opened file the one Save writes to. */
  adopt(f: PickedFile): void {
    this.handle = f.handle;
    this.fileName = f.name;
  }

  /**
   * Writes the drawing. Save reuses the open file when there is one; Save As
   * (or a first save) asks where. Returns false when the user cancels.
   */
  async save(text: string, saveAs: boolean): Promise<boolean> {
    if (this.win.showSaveFilePicker) {
      try {
        if (saveAs || !this.handle) {
          this.handle = await this.win.showSaveFilePicker({ suggestedName: this.fileName, types: TYPES });
          this.fileName = this.handle.name;
        }
        const w = await this.handle.createWritable();
        await w.write(text);
        await w.close();
        return true;
      } catch (err) {
        if (isCancel(err)) return false;
        throw err;
      }
    }
    download(this.fileName, text);
    return true;
  }
}

function pickWithInput(): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},.json`;
    input.addEventListener('change', () => resolve(input.files?.[0]));
    input.addEventListener('cancel', () => resolve(undefined));
    input.click();
  });
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
