// 四角拖拽编辑器：深色取景台 + 琥珀色角点，支持缩放平移
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Point2D } from '@/lib/types';
import { Minus, Plus, ScanLine } from 'lucide-react';

interface CornerEditorProps {
  imageUrl: string;
  width: number;
  height: number;
  corners: Point2D[];
  onChange: (corners: Point2D[]) => void;
}

interface ViewSize {
  cw: number;
  ch: number;
  fitW: number;
  fitH: number;
}

type DragState =
  | { kind: 'handle'; index: number }
  | { kind: 'pan'; startX: number; startY: number; panX: number; panY: number };

export default function CornerEditor({
  imageUrl,
  width,
  height,
  corners,
  onChange,
}: CornerEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [view, setView] = useState<ViewSize>({ cw: 0, ch: 0, fitW: 0, fitH: 0 });
  const [zoom, setZoomState] = useState(1);
  const [pan, setPanState] = useState({ x: 0, y: 0 });
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const setZoom = (v: number | ((z: number) => number)) => {
    const nz = typeof v === 'function' ? v(zoomRef.current) : v;
    zoomRef.current = nz;
    setZoomState(nz);
  };
  const setPan = (v: { x: number; y: number } | ((p: { x: number; y: number }) => { x: number; y: number })) => {
    const np = typeof v === 'function' ? v(panRef.current) : v;
    panRef.current = np;
    setPanState(np);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const scale = Math.min(cw / width, ch / height);
      setView({ cw, ch, fitW: width * scale, fitH: height * scale });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width, height]);

  // 原生 wheel 监听（passive:false 才能 preventDefault，阻止页面滚动）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const z = zoomRef.current;
      const p = panRef.current;
      const nz = Math.max(0.4, Math.min(5, z * factor));
      const stageLeft = Math.max(0, (view.cw - view.fitW) / 2);
      const stageTop = Math.max(0, (view.ch - view.fitH) / 2);
      // 鼠标指向的图面坐标在缩放前后保持不变
      const sx = (mx - stageLeft - p.x) / z;
      const sy = (my - stageTop - p.y) / z;
      setPan({ x: mx - stageLeft - sx * nz, y: my - stageTop - sy * nz });
      setZoom(nz);
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [view.cw, view.ch, view.fitW, view.fitH]);

  const toSource = (clientX: number, clientY: number): Point2D | null => {
    const el = stageRef.current;
    if (!el || view.fitW === 0) return null;
    const rect = el.getBoundingClientRect();
    const lx = (clientX - rect.left) / zoom;
    const ly = (clientY - rect.top) / zoom;
    // 允许角点拖出图片边界（出界部分在裁剪输出中以白色填充）
    return {
      x: (lx / view.fitW) * width,
      y: (ly / view.fitH) * height,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as Element;
    const handleAttr = target.getAttribute?.('data-handle');
    if (handleAttr !== null && handleAttr !== undefined && handleAttr !== '') {
      dragRef.current = { kind: 'handle', index: Number(handleAttr) };
      stageRef.current?.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else {
      dragRef.current = {
        kind: 'pan',
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      stageRef.current?.setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const cont = containerRef.current;
    const drag = dragRef.current;
    let magnifyPt: Point2D | null = null;
    if (drag?.kind === 'handle') {
      const p = toSource(e.clientX, e.clientY);
      if (p) {
        const next = [...corners];
        next[drag.index] = p;
        onChange(next);
        magnifyPt = p;
      }
    } else if (drag) {
      setPan({
        x: drag.panX + (e.clientX - drag.startX),
        y: drag.panY + (e.clientY - drag.startY),
      });
    } else {
      magnifyPt = toSource(e.clientX, e.clientY);
    }
    if (magnifyPt && cont) {
      setMouse({ x: (magnifyPt.x / width) * view.fitW, y: (magnifyPt.y / height) * view.fitH });
      const cr = cont.getBoundingClientRect();
      setMousePos({ x: e.clientX - cr.left, y: e.clientY - cr.top });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const toStage = (p: Point2D) => ({
    x: (p.x / width) * view.fitW,
    y: (p.y / height) * view.fitH,
  });

  return (
    <div className="relative h-full min-h-[420px] w-full select-none overflow-hidden rounded-xl bg-foreground">
      <div
        ref={containerRef}
        className="absolute inset-0" onPointerLeave={() => { setMouse(null); setMousePos(null); }}
      >
        <div
          ref={stageRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="absolute"
          style={{
            left: Math.max(0, (view.cw - view.fitW) / 2),
            top: Math.max(0, (view.ch - view.fitH) / 2),
            width: view.fitW,
            height: view.fitH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            cursor: 'crosshair',
            touchAction: 'none',
          }}
        >
          <img
            src={imageUrl}
            alt="原图"
            draggable={false}
            className="h-full w-full select-none"
            style={{ pointerEvents: 'none' }}
          />
          <svg
            width={view.fitW}
            height={view.fitH}
            className="absolute inset-0" onPointerLeave={() => { setMouse(null); setMousePos(null); }}
            style={{ pointerEvents: 'none', overflow: 'visible' }}
          >
            {/* 框外区域半透明压暗，突出裁剪区域（evenodd：外矩形挖去四边形） */}
            <path
              d={`M0,0 L${view.fitW},0 L${view.fitW},${view.fitH} L0,${view.fitH} Z M${corners
                .map((p) => {
                  const s = toStage(p);
                  return `${s.x},${s.y}`;
                })
                .join(' L')} Z`}
              fill="rgba(0,0,0,0.45)"
              fillRule="evenodd"
            />
            {/* 半透明裁剪框：框内完全透明，不遮挡证件本体；只保留描边与角点 */}
            <polygon
              points={corners.map((p) => {
                const s = toStage(p);
                return `${s.x},${s.y}`;
              }).join(' ')}
              fill="none"
              stroke="hsl(33 70% 47%)"
              strokeWidth={2 / zoom}
              strokeLinejoin="round"
            />
            {corners.map((p, i) => {
              const s = toStage(p);
              return (
                <g key={i}>
                  <circle
                    cx={s.x}
                    cy={s.y}
                    r={11 / zoom}
                    fill="hsl(33 70% 47%)"
                    stroke="white"
                    strokeWidth={2 / zoom}
                    data-handle={i}
                    style={{ pointerEvents: 'all', cursor: 'move' }}
                  />
                  <text
                    x={s.x}
                    y={s.y - 14 / zoom}
                    textAnchor="middle"
                    fontSize={12 / zoom}
                    fontWeight={700}
                    fill="white"
                    style={{ pointerEvents: 'none' }}
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* 缩放控制 */}
      <div className="absolute right-3 top-3 z-20 flex items-center gap-1 rounded-lg border bg-background/95 p-1">
        <Button
          size="sm"
          variant="ghost"
          className="!h-7 !w-7 !p-0"
          title="缩小"
          onClick={() => setZoom((z) => Math.max(0.4, z / 1.2))}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <span className="min-w-10 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="!h-7 !w-7 !p-0"
          title="放大"
          onClick={() => setZoom((z) => Math.min(5, z * 1.2))}
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="!h-7 !w-7 !p-0"
          title="重置视图"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
        >
          <ScanLine className="h-4 w-4" />
        </Button>
      </div>

      {/* 放大镜：跟随鼠标，靠近边缘时自动翻转位置 */}
      {mouse && mousePos && (() => {
        const S = 120, GAP = 20;
        const nearRight = mousePos.x > view.cw / 2;
        const nearTop = mousePos.y < view.ch / 2;
        const left = nearRight ? mousePos.x - S - GAP : mousePos.x + GAP;
        const top = nearTop ? mousePos.y + GAP : mousePos.y - S - GAP;
        return (
          <div
            className="pointer-events-none absolute z-30 h-[120px] w-[120px] overflow-hidden rounded-full border-2 border-amber-400 shadow-lg"
            style={{
              left, top,
              backgroundImage: `url(${imageUrl})`,
              backgroundSize: `${view.fitW * 4}px ${view.fitH * 4}px`,
              backgroundPosition: `${-(mouse.x * 4 - 60)}px ${-(mouse.y * 4 - 60)}px`,
            }}
          >
            <div className="absolute left-1/2 top-1/2 h-px w-3 -translate-x-1/2 -translate-y-1/2 bg-red-500" />
            <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-red-500" />
          </div>
        );
      })()}

      <div className="absolute bottom-3 left-3 z-20 rounded-md bg-background/85 px-2.5 py-1 text-xs text-muted-foreground">
        拖拽 1-2-3-4 四个角点对准身份证四角 · 拖拽空白处平移 · 滚轮缩放
      </div>
    </div>
  );
}
