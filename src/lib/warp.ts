// 客户端透视校正（用于裁剪编辑器实时预览，与服务端算法一致）
import type { Point2D } from './types';

function solve8(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('无法求解透视变换');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

function computeHomography(src: Point2D[], dst: Point2D[]): number[] {
  const A: number[][] = [];
  const B: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }
  const h = solve8(A, B);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function invertHomography(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('透视变换不可逆');
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    (f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

function applyH(H: number[], x: number, y: number): Point2D {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

/**
 * 把原图四边形区域校正为输出矩形，返回 canvas。
 * corners 顺序：左上/右上/右下/左下（原图像素坐标）。
 * 为提升拖拽响应速度，输出尺寸通常取较小值（如宽 480）。
 */
export function warpToCanvas(
  img: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  corners: Point2D[],
  outWidth: number,
  outHeight: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');

  const temp = document.createElement('canvas');
  temp.width = srcWidth;
  temp.height = srcHeight;
  const tctx = temp.getContext('2d');
  if (!tctx) throw new Error('无法创建画布上下文');
  tctx.drawImage(img, 0, 0, srcWidth, srcHeight);
  const srcData = tctx.getImageData(0, 0, srcWidth, srcHeight).data;

  const H = computeHomography(corners, [
    { x: 0, y: 0 },
    { x: outWidth, y: 0 },
    { x: outWidth, y: outHeight },
    { x: 0, y: outHeight },
  ]);
  const Hinv = invertHomography(H);

  const out = ctx.createImageData(outWidth, outHeight);
  const ch = 4;
  for (let y = 0; y < outHeight; y++) {
    const rowBase = y * outWidth * ch;
    for (let x = 0; x < outWidth; x++) {
      const p = applyH(Hinv, x + 0.5, y + 0.5);
      const sx = p.x - 0.5;
      const sy = p.y - 0.5;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const o = rowBase + x * ch;
      for (let c = 0; c < 3; c++) {
        // 超出图片范围的采样点按白色填充（允许四角拖出图外）
        const OOB = 255;
        const v00 = x0 >= 0 && y0 >= 0 && x0 < srcWidth && y0 < srcHeight ? srcData[(y0 * srcWidth + x0) * ch + c] : OOB;
        const v10 = x1 >= 0 && y0 >= 0 && x1 < srcWidth && y0 < srcHeight ? srcData[(y0 * srcWidth + x1) * ch + c] : OOB;
        const v01 = x0 >= 0 && y1 >= 0 && x0 < srcWidth && y1 < srcHeight ? srcData[(y1 * srcWidth + x0) * ch + c] : OOB;
        const v11 = x1 >= 0 && y1 >= 0 && x1 < srcWidth && y1 < srcHeight ? srcData[(y1 * srcWidth + x1) * ch + c] : OOB;
        const top = v00 + (v10 - v00) * fx;
        const bottom = v01 + (v11 - v01) * fx;
        out.data[o + c] = Math.max(0, Math.min(255, Math.round(top + (bottom - top) * fy)));
      }
      out.data[o + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}
