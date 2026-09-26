// 自动识别身份证四角：缩放→灰度→Sobel边缘→形态学闭运算→连通域→凸包→四边形逼近。
// 支持一张图里有正反两面：返回最多两组四角。
import type { Point2D } from './types';

export interface DetectResult {
  corners: Point2D[]; // 第一组（主要）
  corners2: Point2D[] | null; // 第二组（反面），没有则 null
  confident: boolean;
}

// ---- 基础图像工具 ----

function sobelEdge(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
         gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
         gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

function thresholdEdges(edge: Float32Array, w: number, h: number): Uint8Array {
  // 自适应阈值：取边缘强度的 70 百分位作为阈值
  const sorted = Array.from(edge).sort((a, b) => a - b);
  const thresh = sorted[Math.floor(sorted.length * 0.75)];
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = edge[i] > thresh ? 1 : 0;
  return mask;
}

function morphClose(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  // 膨胀→腐蚀，连接边缘断裂
  let cur = mask;
  for (let pass = 0; pass < radius; pass++) {
    const dil = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let dy = -1; dy <= 1 && !v; dy++) {
          for (let dx = -1; dx <= 1 && !v; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w && cur[ny * w + nx]) v = 1;
          }
        }
        dil[y * w + x] = v;
      }
    }
    cur = dil;
  }
  // 腐蚀回去
  for (let pass = 0; pass < radius; pass++) {
    const ero = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 1;
        for (let dy = -1; dy <= 1 && v; dy++) {
          for (let dx = -1; dx <= 1 && v; dx++) {
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= h || nx < 0 || nx >= w || !cur[ny * w + nx]) v = 0;
          }
        }
        ero[y * w + x] = v;
      }
    }
    cur = ero;
  }
  return cur;
}

function fillHoles(mask: Uint8Array, w: number, h: number): Uint8Array {
  // 从边缘开始洪水填充背景，未被填充的就是内部孔洞
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;
  for (let x = 0; x < w; x++) {
    if (!mask[x] && !bg[x]) { bg[x] = 1; queue[tail++] = x; }
    const b = (h - 1) * w + x;
    if (!mask[b] && !bg[b]) { bg[b] = 1; queue[tail++] = b; }
  }
  for (let y = 0; y < h; y++) {
    if (!mask[y * w] && !bg[y * w]) { bg[y * w] = 1; queue[tail++] = y * w; }
    const r = y * w + w - 1;
    if (!mask[r] && !bg[r]) { bg[r] = 1; queue[tail++] = r; }
  }
  let head = 0;
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w, y = (idx / w) | 0;
    if (x > 0 && !bg[idx - 1] && !mask[idx - 1]) { bg[idx - 1] = 1; queue[tail++] = idx - 1; }
    if (x < w - 1 && !bg[idx + 1] && !mask[idx + 1]) { bg[idx + 1] = 1; queue[tail++] = idx + 1; }
    if (y > 0 && !bg[idx - w] && !mask[idx - w]) { bg[idx - w] = 1; queue[tail++] = idx - w; }
    if (y < h - 1 && !bg[idx + w] && !mask[idx + w]) { bg[idx + w] = 1; queue[tail++] = idx + w; }
  }
  // 孔洞 = mask=0 且 bg=0
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = mask[i] || !bg[i] ? 1 : 0;
  return filled;
}

// ---- 连通域 ----

function allComponents(mask: Uint8Array, w: number, h: number): Point2D[][] {
  const visited = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  const comps: Point2D[][] = [];
  for (let start = 0; start < w * h; start++) {
    if (visited[start] || !mask[start]) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    const pts: Point2D[] = [];
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % w, y = (idx / w) | 0;
      pts.push({ x, y });
      if (x > 0 && !visited[idx - 1] && mask[idx - 1]) { visited[idx - 1] = 1; queue[tail++] = idx - 1; }
      if (x < w - 1 && !visited[idx + 1] && mask[idx + 1]) { visited[idx + 1] = 1; queue[tail++] = idx + 1; }
      if (y > 0 && !visited[idx - w] && mask[idx - w]) { visited[idx - w] = 1; queue[tail++] = idx - w; }
      if (y < h - 1 && !visited[idx + w] && mask[idx + w]) { visited[idx + w] = 1; queue[tail++] = idx + w; }
    }
    comps.push(pts);
  }
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

// ---- 凸包 & 多边形逼近 ----

function convexHull(pts: Point2D[]): Point2D[] {
  pts = [...pts].sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (pts.length <= 2) return pts;
  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point2D[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function douglasPeucker(poly: Point2D[], tol: number): Point2D[] {
  if (poly.length <= 3) return poly;
  // 找最远点
  let maxD = -1, maxIdx = 0;
  const a = poly[0], b = poly[poly.length - 1];
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  for (let i = 1; i < poly.length - 1; i++) {
    const p = poly[i];
    const d = dist < 1e-6
      ? Math.hypot(p.x - a.x, p.y - a.y)
      : Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - p.y)) / dist;
    if (d > maxD) { maxD = d; maxIdx = i; }
  }
  if (maxD > tol) {
    const left = douglasPeucker(poly.slice(0, maxIdx + 1), tol);
    const right = douglasPeucker(poly.slice(maxIdx), tol);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

function simplifyToQuad(hull: Point2D[], w: number, h: number): Point2D[] {
  const minDim = Math.min(w, h);
  // 用 DP 逐步放宽容差直到收敛到 4-6 个点
  for (const tol of [minDim * 0.02, minDim * 0.04, minDim * 0.06, minDim * 0.08, minDim * 0.12]) {
    let poly = douglasPeucker(hull, tol);
    // DP 是开路径，闭合它
    if (poly[0] !== hull[0]) poly = [hull[0], ...poly];
    if (poly[poly.length - 1] !== hull[0]) poly.push(hull[0]);
    if (poly.length >= 4 && poly.length <= 8) {
      // 如果是 5-8 个点，取最极端的 4 个（左上、右上、右下、左下）
      if (poly.length > 4) {
        const sums = poly.map(p => p.x + p.y);
        const diffs = poly.map(p => p.x - p.y);
        const tlIdx = sums.indexOf(Math.min(...sums));
        const brIdx = sums.indexOf(Math.max(...sums));
        const trIdx = diffs.indexOf(Math.max(...diffs));
        const blIdx = diffs.indexOf(Math.min(...diffs));
        return [poly[tlIdx], poly[trIdx], poly[brIdx], poly[blIdx]];
      }
      return poly;
    }
  }
  // 兜底：用包围盒
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of hull) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  return [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }];
}

function orderCorners(corners: Point2D[], scale: number): Point2D[] {
  const scaled = corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  if (scaled.length !== 4) return scaled;
  const sortedY = [...scaled].sort((a, b) => a.y - b.y);
  const top = [sortedY[0], sortedY[1]].sort((a, b) => a.x - b.x);
  const bottom = [sortedY[2], sortedY[3]].sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
}

// 身份证标准宽高比 85.6:54 ≈ 1.586
const ID_RATIO = 85.6 / 54;

function extractQuad(comp: Point2D[], w: number, h: number, scale: number): Point2D[] | null {
  const hull = convexHull(comp);
  let quad = simplifyToQuad(hull, w, h);
  const corners = orderCorners(quad, scale);
  // 内缩 3%，避免边缘切到背景
  const inset = 0.03;
  const cx = (corners[0].x + corners[2].x) / 2;
  const cy = (corners[0].y + corners[2].y) / 2;
  corners.forEach((p) => { p.x = cx + (p.x - cx) * (1 - inset); p.y = cy + (p.y - cy) * (1 - inset); });
  return corners;
}

function bbox(pts: Point2D[]) {
  let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
  for (const p of pts) {
    if (p.x<minX) minX=p.x; if (p.y<minY) minY=p.y;
    if (p.x>maxX) maxX=p.x; if (p.y>maxY) maxY=p.y;
  }
  return { minX, minY, maxX, maxY };
}
function overlapArea(a: ReturnType<typeof bbox>, b: ReturnType<typeof bbox>) {
  const x = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
  const y = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY));
  return x * y;
}

/** 判断连通域是否像身份证：面积足够、宽高比接近 1.586 */
function looksLikeCard(comp: Point2D[], w: number, h: number): boolean {
  const area = comp.length;
  if (area < w * h * 0.03) return false;
  const b = bbox(comp);
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  if (bw < 5 || bh < 5) return false;
  const ratio = bw / bh;
  // 允许旋转：宽高比在 0.63 到 1.59 之间（横版和竖版）
  if (ratio < 0.55 || ratio > 1.8) return false;
  return true;
}

export async function detectCardCorners(blob: Blob): Promise<DetectResult> {
  const bitmap = await createImageBitmap(blob);
  // 提高分辨率到 480px 以获得更精确的角点
  const maxDim = 480;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(2, Math.round(bitmap.width * scale));
  const h = Math.max(2, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) { bitmap.close(); throw new Error('无法创建画布'); }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;

  // 方法1：Sobel 边缘 + 形态学闭运算 + 填洞
  const edge = sobelEdge(gray, w, h);
  const edgeMask = thresholdEdges(edge, w, h);
  const closed = morphClose(edgeMask, w, h, 2);
  const filled = fillHoles(closed, w, h);

  // 同时准备 Otsu 二值化结果作为备选
  // Otsu
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[Math.round(v)]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, otsuT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue;
    const wF = total - wB; if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; otsuT = t; }
  }
  const otsuMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) otsuMask[i] = gray[i] > otsuT ? 1 : 0;
  const otsuFilled = fillHoles(otsuMask, w, h);

  // 两种方法都跑连通域，选最好的
  const back = 1 / scale;

  function tryMask(mask: Uint8Array): { corners: Point2D[]; corners2: Point2D[] | null; score: number } | null {
    const comps = allComponents(mask, w, h);
    // 找所有像身份证的连通域，按"宽高比接近1.586"和"面积足够"综合评分
    const candidates: { comp: Point2D[]; score: number }[] = [];
    for (const c of comps) {
      if (!looksLikeCard(c, w, h)) continue;
      const b = bbox(c);
      const bw = b.maxX - b.minX;
      const bh = b.maxY - b.minY;
      if (bw < 10 || bh < 10) continue;
      const ratio = bw / bh;
      // 宽高比得分：越接近身份证比例越好（横版1.586或竖版0.63）
      const bestRatio = Math.max(ratio, 1 / ratio); // 统一到 >=1
      const ratioErr = Math.abs(bestRatio - ID_RATIO) / ID_RATIO;
      // 面积得分：占图比例
      const areaRatio = c.length / (w * h);
      // 综合分：比例权重高
      const score = areaRatio * (1 - ratioErr * 2);
      candidates.push({ comp: c, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length) return null;
    const best = candidates[0].comp;
    const corners = extractQuad(best, w, h, back);

    // 找第二面
    let corners2: Point2D[] | null = null;
    const b1 = bbox(best);
    const b1Area = (b1.maxX - b1.minX) * (b1.maxY - b1.minY);
    for (let i = 1; i < candidates.length && !corners2; i++) {
      const c = candidates[i].comp;
      const b = bbox(c);
      const overlap = overlapArea(b1, b);
      if (overlap < b1Area * 0.3) {
        corners2 = extractQuad(c, w, h, back);
      }
    }
    return { corners, corners2, score: candidates[0].score };
  }

  const r1 = tryMask(filled);
  const r2 = tryMask(otsuFilled);

  const best = (r1 && r2) ? (r1.score >= r2.score ? r1 : r2) : (r1 || r2);

  if (best) {
    return { corners: best.corners, corners2: best.corners2, confident: true };
  }

  // 兜底：全图
  const fallback: Point2D[] = [{x:0,y:0},{x:w,y:0},{x:w,y:h},{x:0,y:h}];
  return { corners: orderCorners(fallback, back), corners2: null, confident: false };
}
