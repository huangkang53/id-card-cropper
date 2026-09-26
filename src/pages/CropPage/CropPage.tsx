// 四角透视裁剪编辑器：拖拽四角→实时预览→保存（本机后端生成高清图）
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { cropOne, getCard, originalUrl, setCorners } from '@/lib/api';
import { detectCardCorners } from '@/lib/detect';
import { warpToCanvas } from '@/lib/warp';
import type { ICardRecord, Point2D } from '@/lib/types';
import { Check, ChevronLeft, RefreshCw, RotateCw, Save, Scan } from 'lucide-react';
import CornerEditor from './sections/CornerEditor';
import PreviewPanel from './sections/PreviewPanel';

function defaultCorners(w: number, h: number): Point2D[] {
  const m = 0.08;
  return [
    { x: w * m, y: h * m },
    { x: w * (1 - m), y: h * m },
    { x: w * (1 - m), y: h * (1 - m) },
    { x: w * m, y: h * (1 - m) },
  ];
}

/** 旋转后的有效尺寸（90/270 时宽高互换） */
function effectiveSize(ow: number, oh: number, rotation: number) {
  return rotation % 180 === 0 ? { w: ow, h: oh } : { w: oh, h: ow };
}

/** 把四角坐标顺时针转 90°：原图 ow×oh → 新图 oh×ow */
function rotateCornersOnce(corners: Point2D[], ow: number, oh: number): Point2D[] {
  const t = (p: Point2D) => ({ x: oh - p.y, y: p.x });
  const [tl, tr, br, bl] = corners;
  return [t(bl), t(tl), t(tr), t(br)];
}

/** 按 rotation（0/90/180/270 顺时针）把原图绘到离屏画布上，供编辑器显示与预览 */
function buildWorkCanvas(bitmap: ImageBitmap, rotation: number, maxDim = 1000) {
  const ow = bitmap.width;
  const oh = bitmap.height;
  const eff = effectiveSize(ow, oh, rotation);
  const scale = Math.min(1, maxDim / Math.max(eff.w, eff.h));
  const w = Math.round(eff.w * scale);
  const h = Math.round(eff.h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bitmap, (-ow * scale) / 2, -oh * scale / 2, ow * scale, oh * scale);
  return { canvas, w, h };
}

function computePreview(
  workCanvas: HTMLCanvasElement,
  workSize: { w: number; h: number },
  width: number,
  height: number,
  corners: Point2D[],
  ratio: 'id' | 'free',
): string | null {
  const scale = workSize.w / width;
  const sc = corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  let outW: number;
  let outH: number;
  if (ratio === 'id') {
    outW = 480;
    outH = 303;
  } else {
    const bbW = Math.max(
      10,
      (Math.abs(corners[1].x - corners[0].x) + Math.abs(corners[2].x - corners[3].x)) / 2,
    );
    const bbH = Math.max(
      10,
      (Math.abs(corners[3].y - corners[0].y) + Math.abs(corners[2].y - corners[1].y)) / 2,
    );
    outW = 480;
    outH = Math.round((480 * bbH) / bbW);
  }
  try {
    const canvas = warpToCanvas(workCanvas, workSize.w, workSize.h, sc, outW, outH);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

export default function CropPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState<ICardRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [corners, setCornersState] = useState<Point2D[] | null>(null);
  const [corners2, setCorners2State] = useState<Point2D[] | null>(null);
  const [side, setSide] = useState<1 | 2>(1);
  const [ratio, setRatio] = useState<'id' | 'free'>('id');
  const [workCanvas, setWorkCanvas] = useState<HTMLCanvasElement | null>(null);
  const [workSize, setWorkSize] = useState<{ w: number; h: number } | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [effSize, setEffSize] = useState({ w: 0, h: 0 });
  const [editorImage, setEditorImage] = useState('');
  const bitmapRef = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const rec = await getCard(id);
        if (cancelled) return;
        setRecord(rec);
        const rawRot = Number(rec.rotation) || 0;
        const rot = [0, 90, 180, 270].includes(rawRot) ? rawRot : 0;
        setRotation(rot);
        const eff = effectiveSize(rec.width, rec.height, rot);
        setEffSize(eff);
        setCornersState(rec.corners || defaultCorners(eff.w, eff.h));
        setCorners2State(rec.corners2 || null);
        const blob = await fetch(originalUrl(id)).then((res) => res.blob());
        const bitmap = await createImageBitmap(blob);
        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmapRef.current = bitmap;
        const built = buildWorkCanvas(bitmap, rot);
        setWorkCanvas(built.canvas);
        setWorkSize({ w: built.w, h: built.h });
        setEditorImage(built.canvas.toDataURL('image/jpeg', 0.92));
      } catch (err) {
        if (!cancelled) {
          setNotFound(true);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!record || !workCanvas || !workSize || !corners) return;
    const t = setTimeout(() => {
      setPreviewDataUrl(
        computePreview(workCanvas, workSize, effSize.w, effSize.h, side === 1 ? corners : corners2 || corners, ratio),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [record, workCanvas, workSize, corners, ratio, effSize]);

  if (notFound) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <p className="text-lg font-medium">照片不存在或已被删除</p>
        <Button className="mt-4" onClick={() => navigate('/')}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          返回列表
        </Button>
      </div>
    );
  }

  if (!record || !corners) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        加载中…
      </div>
    );
  }

  const freeOutH = (() => {
    if (ratio !== 'free') return 0;
    const bbW = Math.max(10, (Math.abs(corners[1].x - corners[0].x) + Math.abs(corners[2].x - corners[3].x)) / 2);
    const bbH = Math.max(10, (Math.abs(corners[3].y - corners[0].y) + Math.abs(corners[2].y - corners[1].y)) / 2);
    return Math.max(200, Math.min(1200, Math.round((1011 * bbH) / bbW)));
  })();
  const outLabel =
    ratio === 'id'
      ? '1011 × 638（身份证标准 85.6×54mm @300dpi）'
      : `约 1011 × ${freeOutH}（随四角比例）`;

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const blob = await fetch(originalUrl(id)).then((res) => res.blob());
      const result = await detectCardCorners(blob);
      // 自动识别基于未旋转原图；当前有旋转时把坐标变换到当前朝向
      let detected = result.corners;
      if (rotation) {
        let ow = record.width;
        let oh = record.height;
        for (let i = 0; i < rotation / 90; i++) {
          detected = rotateCornersOnce(detected, ow, oh);
          [ow, oh] = [oh, ow];
        }
      }
      setCornersState(detected);
      if (result.corners2) {
        let d2 = result.corners2;
        if (rotation) {
          let ow2 = record.width, oh2 = record.height;
          for (let i = 0; i < rotation / 90; i++) { d2 = rotateCornersOnce(d2, ow2, oh2); [ow2, oh2] = [oh2, ow2]; }
        }
        setCorners2State(d2);
      }
      toast(result.confident ? '已自动识别四角，可再微调' : '自动识别不够可靠，已用默认框，请手动调整四角');
    } catch (err) {
    } finally {
      setDetecting(false);
    }
  };

  const handleRotate = () => {
    const bitmap = bitmapRef.current;
    if (!bitmap || !record || !corners) return;
    const newRot = (rotation + 90) % 360;
    const oldEff = effectiveSize(record.width, record.height, rotation);
    // 四角跟随画面一起顺时针转 90°
    setCornersState(rotateCornersOnce(corners, oldEff.w, oldEff.h));
    setRotation(newRot);
    const newEff = effectiveSize(record.width, record.height, newRot);
    setEffSize(newEff);
    const built = buildWorkCanvas(bitmap, newRot);
    setWorkCanvas(built.canvas);
    setWorkSize({ w: built.w, h: built.h });
    setEditorImage(built.canvas.toDataURL('image/jpeg', 0.92));
  };

  const handleSave = () => {
    // 立即跳转放最前面，不被任何异步/错误阻断
    window.location.href = '/';
    setSaving(true);
    toast.success('已保存，到列表页点「覆盖原文件」写回');
    try { if (corners) setCorners(id, corners, rotation, corners2).catch(() => {}); } catch {}
    try { cropOne(id).catch(() => {}); } catch {}
  };

  return (
    <div className="mx-auto flex h-screen w-full flex-col px-4 py-4 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            返回列表
          </Button>
          <h1 className="truncate text-lg font-semibold" title={record.name}>
            {record.name}
          </h1>
          {record.hasCrop ? (
            <Badge className="border-success/30 bg-success/15 text-success">已裁剪</Badge>
          ) : (
            <Badge variant="secondary">待裁剪</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <Button size="sm" variant={side === 1 ? "secondary" : "ghost"} onClick={() => setSide(1)}>第1面</Button>
            {corners2 && <Button size="sm" variant={side === 2 ? "secondary" : "ghost"} onClick={() => setSide(2)}>第2面</Button>}
          </div>
          <Button variant="outline" onClick={handleDetect} disabled={detecting}>
            <Scan className={cn('mr-1 h-4 w-4', detecting && 'animate-pulse')} />
            {detecting ? '识别中…' : '自动识别四角'}
          </Button>
          <Button variant="outline" onClick={handleRotate} title="顺时针旋转 90°">
            <RotateCw className="mr-1 h-4 w-4" />
            旋转90°
          </Button>
          <Button
            variant="outline"
            onClick={() => setCornersState(defaultCorners(effSize.w, effSize.h))}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            重置
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-1 h-4 w-4" />
            {saving ? '保存中…' : '保存裁剪结果'}
          </Button>
        </div>
      </header>

      <div className="flex flex-1 flex-row gap-4" style={{ minHeight: 0 }}>
        <div className="min-w-0 flex-1" style={{ minHeight: 0 }}>
          <CornerEditor
            imageUrl={editorImage || originalUrl(id)}
            width={effSize.w}
            height={effSize.h}
            corners={side === 1 ? corners : corners2 || defaultCorners(effSize.w, effSize.h)}
            onChange={(c) => side === 1 ? setCornersState(c) : setCorners2State(c)}
          />
        </div>
        <div className="w-56 shrink-0 sm:w-64 md:w-72 lg:w-80">
          <div className="mb-3">
            <p className="mb-1.5 text-sm font-medium">输出比例</p>
            <Select value={ratio} onValueChange={(v) => setRatio(v as 'id' | 'free')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="id">标准身份证比例（85.6:54）</SelectItem>
                <SelectItem value="free">随四角比例（自由）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PreviewPanel dataUrl={previewDataUrl} outLabel={outLabel} />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            拖拽四个角点使其对准身份证的四个角。保存后裁剪结果会覆盖原文件（文件名不变）。
            并输出为标准尺寸 1011×638 @300dpi（85.6×54mm）。已裁剪的照片再次进入时会保留上次的四角位置。
            <Check className="mr-0.5 inline h-3 w-3" />
          </p>
        </div>
      </div>
    </div>
  );
}

