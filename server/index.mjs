// 本地后端：直接引用原文件路径，不复制图片
import express from 'express';
import cors from 'cors';
import { ZipArchive } from 'archiver';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import {
  initStorage, newId, listRecords, getRecord, upsertRecord, removeRecord,
  readSource, writeCropBack, writeCrop2, readCropCache, readCrop2Cache, commitCrop,
} from './storage.mjs';
import { warpPerspective, ID_CARD_WIDTH, ID_CARD_HEIGHT } from './warp.mjs';

const PORT = Number(process.env.PORT || 38421);
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
const PHOTO_BASE = '/openapi/id-card-photos';
const EXT_WHITELIST = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];

function toPublic(rec) { const { absPath, ...rest } = rec; return rest; }
function parseCorners(body) {
  const arr = body?.corners;
  if (!Array.isArray(arr) || arr.length !== 4) return null;
  return arr.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
}

async function cropOne(id, cornersOverride, outW, outH) {
  const rec = getRecord(id);
  if (!rec) { const e = new Error('照片不存在'); e.status = 404; throw e; }
  const corners = cornersOverride || rec.corners;
  if (!corners) { const e = new Error('尚未设置四角'); e.status = 400; throw e; }
  const w = outW || ID_CARD_WIDTH, h = outH || ID_CARD_HEIGHT;
  const ext = path.extname(rec.absPath) || '.jpg';
  let src = readSource(rec);
  const rot = Number(rec.rotation) || 0;
  if (rot) src = await sharp(src).rotate(rot).toBuffer();
  const fmt = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : 'jpeg';
  const out = await warpPerspective(src, corners, w, h, fmt);
  writeCropBack(rec, out);
  if (rec.corners2 && Array.isArray(rec.corners2) && rec.corners2.length === 4) {
    const out2 = await warpPerspective(readSource(rec), rec.corners2, w, h, fmt);
    writeCrop2(rec, out2);
  }
  rec.corners = corners; rec.rotation = rot; rec.hasCrop = true; rec.updatedAt = Date.now();
  upsertRecord(rec);
  return toPublic(rec);
}

app.get('/openapi/health', (_req, res) => res.json({ ok: true, port: PORT }));

app.get('/openapi/pick-folder', (_req, res) => {
  const ps = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = '选择身份证照片文件夹'
if ($dlg.ShowDialog() -eq 'OK') { Write-Output $dlg.SelectedPath }
`;
  execFile('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-STA','-Command',ps], { timeout: 120000, windowsHide: false }, (err, stdout) => {
    if (err) { res.status(500).json({ error: '取消' }); return; }
    const dir = (stdout||'').replace(/^\uFEFF/,'').trim();
    if (!dir) { res.status(400).json({ error: '未选择' }); return; }
    res.json({ dir });
  });
});


app.post('/openapi/open-folder', (req, res) => {
  const id = req.body?.id;
  let rec;
  if (id) { rec = getRecord(id); }
  if (!rec) { const all = listRecords(); rec = all[0]; }
  if (!rec || !rec.absPath) { res.status(404).json({ error: '没有图片' }); return; }
  const dir = path.dirname(rec.absPath);
  execFile('explorer.exe', [dir], () => {});
  res.json({ ok: true });
});

app.get('/openapi/pick-files', (_req, res) => {
  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Title = '选择身份证照片（可多选）'
$dlg.Filter = '图片|*.jpg;*.jpeg;*.png;*.bmp;*.tiff;*.webp'
$dlg.Multiselect = $true
if ($dlg.ShowDialog() -eq 'OK') {
  $dlg.FileNames | ForEach-Object { Write-Output $_ }
}
`;
  execFile('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-STA','-Command',script], { timeout: 120000, windowsHide: false }, (err, stdout) => {
    if (err) { res.status(500).json({ error: '取消' }); return; }
    const files = (stdout||'').replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    res.json({ files });
  });
});

app.post('/openapi/scan-files', async (req, res) => {
  const files = (req.body?.files||[]).filter(Boolean);
  if (!files.length) { res.json({ created: 0 }); return; }
  const existing = new Set(listRecords().map((r) => r.absPath));
  let created = 0;
  for (const abs of files) {
    if (existing.has(abs) || !fs.existsSync(abs)) continue;
    const id = newId();
    const name = path.basename(abs);
    try {
      const info = await sharp(abs).metadata();
      const rec = { id, name, absPath: abs, width: info.width||0, height: info.height||0,
        corners: null, corners2: null, rotation: 0, hasCrop: false, quality: null,
        createdAt: Date.now(), updatedAt: Date.now() };
      upsertRecord(rec);
      created++;
    } catch {}
  }
  res.json({ created });
});
app.post('/openapi/scan-folder', async (req, res) => {
  const dir = (req.body?.dir||'').trim();
  if (!dir || !fs.existsSync(dir)) { res.status(400).json({ error: '目录不存在' }); return; }
  const files = fs.readdirSync(dir).filter((f) => EXT_WHITELIST.includes(path.extname(f).toLowerCase()));
  const existing = new Set(listRecords().map((r) => r.absPath));
  const created = [];
  for (const f of files) {
    const abs = path.join(dir, f);
    if (existing.has(abs)) continue;
    const id = newId();
    try {
      const info = await sharp(abs).metadata();
      const rec = { id, name: f, absPath: abs, width: info.width||0, height: info.height||0,
        corners: null, corners2: null, rotation: 0, hasCrop: false, quality: null,
        createdAt: Date.now(), updatedAt: Date.now() };
      upsertRecord(rec);
      created.push(toPublic(rec));
    } catch {}
  }
  res.json({ created: created.length, items: created });
});

app.get(PHOTO_BASE, (req, res) => {
  const { status, quality, search } = req.query;
  let items = listRecords();
  if (status === 'pending') items = items.filter((r) => !r.hasCrop);
  if (status === 'cropped') items = items.filter((r) => r.hasCrop);
  if (quality === 'good') items = items.filter((r) => r.quality === 'good');
  if (quality === 'poor') items = items.filter((r) => r.quality === 'poor');
  if (search) { const kw = String(search).toLowerCase(); items = items.filter((r) => r.name.toLowerCase().includes(kw)); }
  items.sort((a,b) => b.createdAt - a.createdAt);
  res.json({ items: items.map(toPublic), total: items.length });
});

app.get(`${PHOTO_BASE}/stats`, (_req, res) => {
  const all = listRecords();
  res.json({ total: all.length, pending: all.filter(r=>!r.hasCrop).length, cropped: all.filter(r=>r.hasCrop).length });
});

app.get(`${PHOTO_BASE}/export`, (req, res) => {
  const items = listRecords().filter((r) => r.hasCrop);
  if (!items.length) { res.status(400).json({ error: '无可导出' }); return; }
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition','attachment; filename="id-crops.zip"');
  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.on('error', (err) => res.status(500).end(String(err)));
  archive.pipe(res);
  for (const rec of items) {
    try {
      const cp = readCropCache(rec); if (cp) archive.append(fs.readFileSync(cp), { name: rec.name });
      const ext = path.extname(rec.absPath);
      const dir = path.dirname(rec.absPath);
      const base = path.basename(rec.absPath, ext);
      const p2 = path.join(dir, base + '_2' + ext);
      if (fs.existsSync(p2)) archive.append(fs.readFileSync(p2), { name: base + '_2' + ext });
    } catch {}
  }
  archive.finalize();
});

app.post('/openapi/writeback', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  const items = listRecords().filter((r) => r.hasCrop && (!ids || ids.includes(r.id)));
  res.json({ ok: items.length, failed: 0, note: '已直接写回原文件' });
});

app.post(`${PHOTO_BASE}/batch/crop`, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ok = [], failed = [];
  for (const id of ids) { try { ok.push(await cropOne(id, null)); } catch(e) { failed.push({id, error:e.message}); } }
  res.json({ ok, failed });
});

app.patch(`${PHOTO_BASE}/batch/quality`, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const updated = [];
  for (const id of ids) { const rec = getRecord(id); if (!rec) continue; rec.quality = req.body?.quality; upsertRecord(rec); updated.push(toPublic(rec)); }
  res.json({ updated });
});

app.delete(`${PHOTO_BASE}/batch`, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const removed = [];
  for (const id of ids) { if (removeRecord(id)) removed.push(id); }
  res.json({ removed });
});

app.get(`${PHOTO_BASE}/:id`, (req, res) => {
  const rec = getRecord(req.params.id);
  if (!rec) { res.status(404).json({ error: '不存在' }); return; }
  res.json(toPublic(rec));
});

app.patch(`${PHOTO_BASE}/:id/corners`, (req, res) => {
  const rec = getRecord(req.params.id);
  if (!rec) { res.status(404).json({ error: '不存在' }); return; }
  const corners = parseCorners(req.body);
  if (!corners) { res.status(400).json({ error: 'corners需4个点' }); return; }
  rec.corners = corners;
  if (Array.isArray(req.body.corners2)) rec.corners2 = req.body.corners2;
  if (typeof req.body.rotation === 'number' && [0,90,180,270].includes(req.body.rotation)) rec.rotation = req.body.rotation;
  rec.updatedAt = Date.now();
  upsertRecord(rec);
  res.json(toPublic(rec));
});

app.post(`${PHOTO_BASE}/:id/crop`, async (req, res) => {
  try {
    const cornersOverride = parseCorners(req.body);
    const outW = Number(req.body?.width) || undefined;
    const outH = Number(req.body?.height) || undefined;
    res.json(await cropOne(req.params.id, cornersOverride, outW, outH));
  } catch (err) { res.status(err.status||500).json({ error: err.message||String(err) }); }
});

app.patch(`${PHOTO_BASE}/:id/quality`, (req, res) => {
  const rec = getRecord(req.params.id);
  if (!rec) { res.status(404).json({ error: '不存在' }); return; }
  rec.quality = req.body?.quality; rec.updatedAt = Date.now(); upsertRecord(rec);
  res.json(toPublic(rec));
});

app.delete(`${PHOTO_BASE}/:id`, (req, res) => { res.json({ ok: !!removeRecord(req.params.id) }); });

app.get(`${PHOTO_BASE}/:id/original`, (req, res) => {
  const rec = getRecord(req.params.id);
  if (!rec) { res.status(404).end(); return; }
  res.sendFile(rec.absPath);
});

app.get(`${PHOTO_BASE}/:id/crop-image`, (req, res) => {
  const rec = getRecord(req.params.id);
  if (!rec || !rec.hasCrop) { res.status(404).end(); return; }
  const cp = readCropCache(rec);
  if (!cp) { res.status(404).end(); return; }
  res.sendFile(cp);
});

app.post(`${PHOTO_BASE}/commit`, (req, res) => {
  const ids = req.body?.ids;
  const list = listRecords().filter((r) => r.hasCrop && (!ids || ids.includes(r.id)));
  let ok = 0, failed = 0;
  for (const rec of list) {
    try { commitCrop(rec); ok++; } catch { failed++; }
  }
  res.json({ ok, failed });
});

initStorage();
const distDir = (process.env.CROPPER_DIST_DIR && fs.existsSync(process.env.CROPPER_DIST_DIR))
  ? process.env.CROPPER_DIST_DIR
  : (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath,'dist'))
  ? path.join(process.resourcesPath,'dist')
  : (fs.existsSync(path.join(process.cwd(),'dist')) ? path.join(process.cwd(),'dist') : null));
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/openapi\/).*/, (req,res) => res.sendFile(path.join(distDir,'index.html')));
}
app.listen(PORT, () => console.log(`[id-card-cropper] 后端: http://localhost:${PORT}/openapi`));