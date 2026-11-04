// Project panel helpers: ae-compose folders, tagged item lookup, asset import.
import type { Ctx } from './ctx';
import { fail } from './ctx';
import { TAG, tagOf } from './layers';

export function findFolder(parent: FolderItem, name: string): FolderItem | null {
  for (let i = 1; i <= parent.numItems; i++) {
    const it = parent.item(i);
    if (it instanceof FolderItem && it.name === name) return it;
  }
  return null;
}

export function ensureFolder(path: string[]): FolderItem {
  let cur: FolderItem = app.project.rootFolder;
  for (let i = 0; i < path.length; i++) {
    let f = findFolder(cur, path[i]);
    if (!f) {
      f = app.project.items.addFolder(path[i]);
      f.parentFolder = cur;
    }
    cur = f;
  }
  return cur;
}

export function findTaggedComp(id: string): CompItem | null {
  for (let i = 1; i <= app.project.numItems; i++) {
    const it = app.project.item(i);
    if (it instanceof CompItem && tagOf(it) === id) return it;
  }
  return null;
}

export function findItemByName(name: string): Item | null {
  for (let i = 1; i <= app.project.numItems; i++) {
    const it = app.project.item(i);
    if (it.name === name) return it;
  }
  return null;
}

function normPath(p: string): string {
  return String(p).replace(/\\/g, '/').toLowerCase();
}

export function findFootageByPath(path: string): FootageItem | null {
  const want = normPath(new File(path).fsName);
  for (let i = 1; i <= app.project.numItems; i++) {
    const it = app.project.item(i);
    if (it instanceof FootageItem && it.file && normPath(it.file.fsName) === want) return it;
  }
  return null;
}

export interface IrAsset { id: string; path?: string; item?: string; sequence?: boolean }

export function importAsset(ctx: Ctx, a: IrAsset, folder: FolderItem): Item {
  if (a.item) {
    const it = findItemByName(a.item);
    if (!it) fail(ctx, 'project item not found: "' + a.item + '"');
    return it as Item;
  }
  if (!a.path) fail(ctx, 'asset ' + a.id + ' has neither path nor item');
  const existing = findFootageByPath(a.path as string);
  if (existing) return existing;
  const f = new File(a.path as string);
  if (!f.exists) fail(ctx, 'file not found: ' + a.path);
  const io = new ImportOptions(f);
  if (a.sequence) io.sequence = true;
  const item = app.project.importFile(io);
  item.parentFolder = folder;
  item.comment = TAG + 'asset=' + a.id;
  return item;
}
