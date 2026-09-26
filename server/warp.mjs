// 透视校正核心：单应矩阵（DLT 求解）+ 逆映射双线性采样
import sharp from 'sharp';

/** 高斯消元解 8 元线性方程组（增广矩阵），返回 8 个未知数 */
function solve8(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-12) throw new Error('奇异矩阵，无法求解透视变换');
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * 由 4 组对应点计算单应矩阵（src -> dst），返回 3x3 数组（行优先）
 * corners 顺序：左上、右上、右下、左下
 */
export function computeHomography(src, dst) {
  const A = [];
  const B = [];
  for (let i = 0; i < 4; i++) {
    const x = src[i].x;
    const y = src[i].y;
    const u = dst[i].x;
    const v = dst[i].y;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    B.push(v);
  }
  const h = solve8(A, B);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** 3x3 矩阵求逆（行优先） */
export function invertHomography(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det =
    a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('透视变换不可逆');
  const inv = 1 / det;
  return [
    (e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    (f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    (d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

/** 应用单应矩阵 H 到点 (x, y) */
export function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

/**
 * 对图片做透视校正：把原图上的四边形区域校正为输出矩形
 * @param inputBuffer 原始图片 Buffer
 * @param corners 原图像素坐标系下的四个角 [{x,y}×4]，顺序 左上/右上/右下/左下
 * @param outW 输出宽度（像素）
 * @param outH 输出高度（像素）
 * @param outFormat 输出编码：jpeg | png | webp
 * @returns 编码后的 Buffer（带 300 DPI 分辨率元数据，保证物理尺寸为 85.6×54mm）
 */
export async function warpPerspective(inputBuffer, corners, outW, outH, outFormat = 'jpeg') {
  const { data, info } = await sharp(inputBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const srcW = info.width;
  const srcH = info.height;
  const ch = info.channels; // 3 或 4

  const H = computeHomography(
    corners,
    [
      { x: 0, y: 0 },
      { x: outW, y: 0 },
      { x: outW, y: outH },
      { x: 0, y: outH },
    ],
  );
  const Hinv = invertHomography(H);

  const out = Buffer.alloc(outW * outH * ch);
  // 逐输出像素：逆映射回原图 + 双线性采样
  for (let y = 0; y < outH; y++) {
    const rowBase = y * outW * ch;
    for (let x = 0; x < outW; x++) {
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
      for (let c = 0; c < ch; c++) {
        // 超出图片范围的采样点按白色填充（允许四角拖出图外）
        const OOB = 255;
        const v00 = x0 >= 0 && y0 >= 0 && x0 < srcW && y0 < srcH ? data[(y0 * srcW + x0) * ch + c] : OOB;
        const v10 = x1 >= 0 && y0 >= 0 && x1 < srcW && y0 < srcH ? data[(y0 * srcW + x1) * ch + c] : OOB;
        const v01 = x0 >= 0 && y1 >= 0 && x0 < srcW && y1 < srcH ? data[(y1 * srcW + x0) * ch + c] : OOB;
        const v11 = x1 >= 0 && y1 >= 0 && x1 < srcW && y1 < srcH ? data[(y1 * srcW + x1) * ch + c] : OOB;
        const top = v00 + (v10 - v00) * fx;
        const bottom = v01 + (v11 - v01) * fx;
        out[o + c] = Math.max(0, Math.min(255, Math.round(top + (bottom - top) * fy)));
      }
    }
  }

  // 输出：按原文件扩展名选择编码格式，并写入 300 DPI 元数据
  // 1011×638 @300dpi = 85.6mm × 54mm（身份证标准尺寸）
  let outPipeline = sharp(out, { raw: { width: outW, height: outH, channels: ch } })
    .withMetadata({ density: 300 });
  if (outFormat === 'png') outPipeline = outPipeline.png({ compressionLevel: 9 });
  else if (outFormat === 'webp') outPipeline = outPipeline.webp({ quality: 92 });
  else outPipeline = outPipeline.jpeg({ quality: 92 });
  return outPipeline.toBuffer();
}

/** 标准身份证输出尺寸：85.6mm × 54mm @ 300dpi */
export const ID_CARD_WIDTH = 1011;
export const ID_CARD_HEIGHT = 638;
