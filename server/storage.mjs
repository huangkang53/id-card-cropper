// 本地文件存储：引用原文件路径，裁剪结果先存缓存，确认后再写回
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

function resolveDataDir() {
  if (process.env.CROPPER_DATA_DIR) {
    return process.env.CROPPER_DATA_DIR;
  }
  if (process.resourcesPath || process.env.APP_RESOURCES_PATH) {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'IdCardCropper', 'data');
  }
  return path.join(import.meta.dirname, 'data');
}

const DATA_DIR = resolveDataDir();
const CACHE_DIR = path.join(path.dirname(DATA_DIR), 'cache');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

let records = [];

export function initStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (fs.existsSync(INDEX_FILE)) {
    try {
      records = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    } catch {
      records = [];
    }
  }
  return { dataDir: DATA_DIR, cacheDir: CACHE_DIR };
}

function persist() {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(records, null, 2));
}

export function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

export function listRecords() {
  return [...records];
}

export function getRecord(id) {
  return records.find((r) => r.id === id) || null;
}

export function upsertRecord(rec) {
  const idx = records.findIndex((r) => r.id === rec.id);
  if (idx >= 0) records[idx] = rec;
  else records.push(rec);
  persist();
  return rec;
}

export function removeRecord(id) {
  const idx = records.findIndex((r) => r.id === id);
  if (idx >= 0) {
    const [rec] = records.splice(idx, 1);
    // 清理缓存文件
    try {
      const cp = cropCachePath(rec); if (fs.existsSync(cp)) fs.unlinkSync(cp);
      const cp2 = crop2CachePath(rec); if (fs.existsSync(cp2)) fs.unlinkSync(cp2);
    } catch {}
    persist();
    return rec;
  }
  return null;
}

/** 读取原图：直接读 absPath */
export function readSource(rec) {
  return fs.readFileSync(rec.absPath);
}

/** 裁剪结果缓存路径（第一面） */
export function cropCachePath(rec) {
  return path.join(CACHE_DIR, `${rec.id}.jpg`);
}

/** 裁剪结果缓存路径（第二面） */
export function crop2CachePath(rec) {
  return path.join(CACHE_DIR, `${rec.id}_2.jpg`);
}

/** 写裁剪结果到缓存（不覆盖原文件） */
export function writeCropBack(rec, buffer) {
  fs.writeFileSync(cropCachePath(rec), buffer);
}

export function writeCrop2(rec, buffer) {
  fs.writeFileSync(crop2CachePath(rec), buffer);
}

/** 从缓存读取裁剪结果 */
export function readCropCache(rec) {
  const p = cropCachePath(rec);
  return fs.existsSync(p) ? p : null;
}

/** 从缓存读取第二面裁剪结果 */
export function readCrop2Cache(rec) {
  const p = crop2CachePath(rec);
  return fs.existsSync(p) ? p : null;
}

/** 确认写回：把缓存中的裁剪结果覆盖到原文件位置 */
export function commitCrop(rec) {
  const src = cropCachePath(rec);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, rec.absPath);
  }
  const src2 = crop2CachePath(rec);
  if (fs.existsSync(src2)) {
    const ext = path.extname(rec.absPath);
    const dir = path.dirname(rec.absPath);
    const base = path.basename(rec.absPath, ext);
    const dst2 = path.join(dir, `${base}_2${ext}`);
    fs.copyFileSync(src2, dst2);
  }
}
