
// ── 写回原文件夹 ─────────────────────────────────────────
import { execFile } from 'node:child_process';

app.get('/openapi/pick-folder', (_req, res) => {
  const ps = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dlg.Description = '选择身份证照片所在的文件夹（裁剪结果将按原文件名覆盖写回此目录）'",
    "if ($dlg.ShowDialog() -eq 'OK') { Write-Output $dlg.SelectedPath }"
  ].join('; ');
  execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { timeout: 120000, windowsHide: true }, (err, stdout) => {
    if (err) { res.status(500).json({ error: '取消或选择失败' }); return; }
    const dir = (stdout || '').trim();
    if (!dir) { res.status(400).json({ error: '未选择文件夹' }); return; }
    res.json({ dir });
  });
});

app.post('/openapi/writeback', (req, res) => {
  const dir = (req.body?.dir || '').trim();
  if (!dir) { res.status(400).json({ error: '缺少 dir 参数' }); return; }
  if (!fs.existsSync(dir)) { res.status(400).json({ error: '目录不存在: ' + dir }); return; }
  const items = listRecords().filter((r) => r.hasCrop);
  let ok = 0, failed = 0;
  const errors = [];
  for (const rec of items) {
    try {
      fs.writeFileSync(path.join(dir, rec.name), readCrop(rec));
      ok++;
    } catch (e) {
      failed++;
      errors.push(rec.name + ': ' + e.message);
    }
  }
  res.json({ ok, failed, errors: errors.slice(0, 10) });
});
