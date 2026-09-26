// 照片列表主页：批量上传、状态筛选、多选批量操作、导出
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  batchCrop, batchQuality, commitCrops, cropOne, downloadUrl, exportUrl,
  getStats, listCards, openFolder, originalUrl, pickFiles, pickFolder,
  removeCards, scanFiles, scanFolder, setCorners,
} from '@/lib/api';
import { detectCardCorners } from '@/lib/detect';
import type { ICardRecord, IStats } from '@/lib/types';
import type { IListParams } from '@/lib/api';
import { ArrowUpDown, Download, FolderOpen, FolderOutput, FolderSearch, Scan, Search, Save, Upload } from 'lucide-react';
import UploadDropzone from './sections/UploadDropzone';
import ImageCard from './sections/ImageCard';
import BatchBar from './sections/BatchBar';

type FilterKey = 'all' | 'pending' | 'cropped' | 'poor' | 'good';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待裁剪' },
  { key: 'cropped', label: '已裁剪' },
  { key: 'poor', label: '质量差' },
  { key: 'good', label: '合格' },
];

export default function GalleryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ICardRecord[]>([]);
  const [stats, setStats] = useState<IStats>({
    total: 0,
    pending: 0,
    cropped: 0,
    good: 0,
    poor: 0,
  });
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [autoProgress, setAutoProgress] = useState('');
  const [sortAsc, setSortAsc] = useState(false);

  const buildParams = useCallback((): IListParams => {
    return {
      status:
        filter === 'all' ? undefined : filter === 'pending' ? 'pending' : filter === 'cropped' ? 'cropped' : undefined,
      quality:
        filter === 'poor' ? 'poor' : filter === 'good' ? 'good' : undefined,
      search: search || undefined,
    };
  }, [filter, search]);

  useEffect(() => {
    let active = true;
    listCards(buildParams())
      .then((res) => {
        if (active) setItems(res.items);
      })
      .catch((err) => {
        toast.error(String(err));
      });
    return () => {
      active = false;
    };
  }, [buildParams]);

  useEffect(() => {
    let active = true;
    getStats()
      .then((s) => {
        if (active) setStats(s);
      })
      .catch(() => {
        /* 统计失败不阻塞 */
      });
    return () => {
      active = false;
    };
  }, []);

  /** 操作后刷新列表与统计（事件回调中使用） */
  const refresh = async () => {
    try {
      const [listRes, statsRes] = await Promise.all([
        listCards(buildParams()),
        getStats(),
      ]);
      setItems(listRes.items);
      setStats(statsRes);
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handlePickFolder = async () => {
    setUploading(true);
    try {
      let dir: string | null = null;
      const w = window as any;
      if (w.electronAPI?.pickFolder) {
        dir = await w.electronAPI.pickFolder();
      } else if (w.__TAURI__) {
        const r = await w.__TAURI__.dialog.open({ directory: true });
        dir = r as string | null;
      } else {
        const r = await pickFolder();
        dir = r.dir;
      }
      if (!dir) return;
      const res = await scanFolder(dir);
      if (res.created > 0) toast.success(`已导入 ${res.created} 张照片`);
      else toast.info('该文件夹中没有新的图片');
      await refresh();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleOpenFolder = async () => {
    try { await openFolder(); } catch (err) { toast.error(String(err)); }
  };

  const handleImportFiles = async () => {
    setUploading(true);
    try {
      let files: string[] = [];
      const w = window as any;
      if (w.electronAPI?.pickFiles) {
        files = await w.electronAPI.pickFiles();
      } else if (w.__TAURI__) {
        const r = await w.__TAURI__.dialog.open({ multiple: true, filters: [{name:'图片',extensions:['jpg','jpeg','png','bmp','webp']}] });
        files = (r as string[]) || [];
      } else {
        const r = await pickFiles();
        files = r.files;
      }
      if (!files.length) return;
      const r = await scanFiles(files);
      if (r.created > 0) toast.success(`已导入 ${r.created} 张图片`);
      await refresh();
    } catch (err) { toast.error(String(err)); }
    finally { setUploading(false); }
  };

  const handleCommit = async () => {
    if (selected.size === 0) { toast.info("请先勾选要覆盖的图片"); return; }
    if (!window.confirm(`覆盖原文件将导致原始图片丢失，是否确认覆盖 ${selected.size} 张？`)) return;
    try {
      const r = await commitCrops([...selected]);
      toast.success(`已覆盖原文件：${r.ok} 张` + (r.failed ? `，失败 ${r.failed} 张` : ""));
    } catch (err) { toast.error(String(err)); }
  };


  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = () => {
    setSelected((prev) =>
      prev.size === items.length && items.length > 0 ? new Set() : new Set(sortedItems.map((r) => r.id)),
    );
  };

  const handleToggleQuality = async (record: ICardRecord) => {
    try {
      const q = record.quality === 'poor' ? 'good' : 'poor';
      await batchQuality([record.id], q);
      await refresh();
      toast.success(q === 'poor' ? '已标记为质量差' : '已标记为合格');
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleDelete = async (record: ICardRecord) => {
    if (!window.confirm(`确认删除「${record.name}」？原图与裁剪结果将一并删除。`)) return;
    try {
      await removeCards([record.id]);
      toast.success('已删除');
      await refresh();
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleAutoCropAll = async () => {
    const targets = items.filter((r) => !r.hasCrop);
    if (!targets.length) {
      toast.info('当前列表没有待裁剪的照片');
      return;
    }
    setBatchBusy(true);
    let ok = 0;
    let confident = 0;
    const failed: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const r = targets[i];
      setAutoProgress(`自动识别并裁剪 ${i + 1}/${targets.length}：${r.name}`);
      try {
        const blob = await fetch(originalUrl(r.id)).then((res) => res.blob());
        const result = await detectCardCorners(blob);
        await setCorners(r.id, result.corners);
        await cropOne(r.id);
        ok++;
        if (result.confident) confident++;
      } catch {
        failed.push(r.name);
      }
    }
    setBatchBusy(false);
    setAutoProgress('');
    await refresh();
    toast.success(
      `批量自动裁剪完成：成功 ${ok} 张（其中高置信 ${confident} 张）` +
        (failed.length ? `，失败 ${failed.length} 张需手动处理` : ''),
    );
  };

  const handleBatchCrop = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setBatchBusy(true);
    try {
      const res = await batchCrop(ids);
      toast.success(`批量裁剪完成：成功 ${res.ok.length} 张` + (res.failed.length ? `，失败 ${res.failed.length} 张（多为未设四角）` : ''));
      await refresh();
      setSelected(new Set());
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchQuality = async (q: 'good' | 'poor') => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      await batchQuality(ids, q);
      toast.success(q === 'poor' ? '已批量标记质量差' : '已批量标记合格');
      await refresh();
      setSelected(new Set());
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleBatchDelete = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!window.confirm(`确认删除选中的 ${ids.length} 张照片？此操作不可恢复。`)) return;
    try {
      const res = await removeCards(ids);
      toast.success(`已删除 ${res.removed.length} 张`);
      await refresh();
      setSelected(new Set());
    } catch (err) {
      toast.error(String(err));
    }
  };

  const handleExportZip = () => {
    if (stats.cropped === 0) {
      toast.info('还没有可导出的裁剪结果');
      return;
    }
    downloadUrl(exportUrl(), 'id-card-crops.zip');
  };


  const countOf = (key: FilterKey) => {
    if (key === 'all') return stats.total;
    if (key === 'pending') return stats.pending;
    if (key === 'cropped') return stats.cropped;
    if (key === 'poor') return stats.poor;
    return stats.good;
  };

  const sortedItems = sortAsc ? [...items].sort((a,b) => a.name.localeCompare(b.name, 'zh')) : [...items].sort((a,b) => b.name.localeCompare(a.name, 'zh'));

  return (
    <div className="mx-auto w-full px-4 py-6 sm:px-6">
      <header className="sticky top-0 z-30 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">工作台</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            身份证照片批量透视裁剪与质检 · 数据仅保存在本机
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索文件名"
              className="w-48 pl-8"
            />
          </form>
          <Button variant="outline" onClick={() => setSortAsc((v) => !v)} title="按文件名排序">
            <ArrowUpDown className="h-4 w-4" />
            {sortAsc ? '文件名↑' : '文件名↓'}
          </Button>
          <Button variant="outline" onClick={handleExportZip} disabled={stats.cropped === 0}>
            <Download className="h-4 w-4" />
            导出全部(ZIP)
          </Button>
          <Button variant="outline" onClick={selectAll} disabled={items.length === 0}>
            {selected.size === items.length && items.length > 0 ? '取消全选' : '全选'}
          </Button>
          <Button variant="outline" onClick={handleAutoCropAll} disabled={batchBusy || stats.pending === 0}>
            <Scan className="h-4 w-4" />
            批量自动裁剪
          </Button>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button onClick={handleImportFiles} disabled={uploading}>
            <Upload className="mr-2 h-4 w-4" />
            导入图片
          </Button>
          <Button onClick={handlePickFolder} disabled={uploading}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {uploading ? '扫描中…' : '选择文件夹'}
          </Button>
          <div className="mx-1 h-6 w-px bg-border" />
          <Button onClick={handleCommit} disabled={stats.cropped === 0}>
            <Save className="mr-2 h-4 w-4" />
            覆盖原文件
          </Button>
          <Button variant="outline" onClick={handleOpenFolder} disabled={items.length === 0}>
            <FolderSearch className="mr-2 h-4 w-4" />
            打开图片文件夹
          </Button>
        </div>
      </header>


      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              filter === f.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:bg-accent',
            )}
          >
            {f.label} <span className="opacity-70">{countOf(f.key)}</span>
          </button>
        ))}
        {selected.size > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            已选 {selected.size} 张
          </span>
        )}
      </div>

      {autoProgress && (
        <div className="mb-3 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground">
          处理中：{autoProgress}
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-24 text-center">
          <p className="text-lg font-medium">还没有照片</p>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            点击上方按钮选择身份证照片所在文件夹，直接导入，不复制文件。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {sortedItems.map((record) => (
            <ImageCard
              key={record.id}
              record={record}
              selected={selected.has(record.id)}
              onToggleSelect={() => toggleSelect(record.id)}
              onOpen={() => navigate(`/crop/${record.id}`)}
              onToggleQuality={() => handleToggleQuality(record)}
              onDelete={() => handleDelete(record)}
            />
          ))}
        </div>
      )}

      {selected.size > 0 && (
        <BatchBar
          count={selected.size}
          busy={batchBusy}
          onCrop={handleBatchCrop}
          onMarkGood={() => handleBatchQuality('good')}
          onMarkPoor={() => handleBatchQuality('poor')}
          onDelete={handleBatchDelete}
          onClear={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}
