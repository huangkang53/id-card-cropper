// 身份证四角点检测（ONNX 模型）
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 模型输入尺寸（W=544, H=768）
const TW = 544, TH = 768;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let session = null;
let sessionLoading = null;

async function getSession() {
  if (session) return session;
  if (sessionLoading) return sessionLoading;
  sessionLoading = (async () => {
    const modelPath = path.join(__dirname, 'idcorner.onnx');
    session = await ort.InferenceSession.create(modelPath, {
      executionProviders: ['cpu'],
    });
    console.log('[detect] ONNX model loaded, input:', session.inputNames, 'output:', session.outputNames);
    return session;
  })();
  return sessionLoading;
}

// order4: 把4点规范成 TL→TR→BR→BL
function order4(pts) {
  const sums = pts.map(p => p[0] + p[1]);
  const diffs = pts.map(p => p[1] - p[0]);
  const tl = sums.indexOf(Math.min(...sums));
  const br = sums.indexOf(Math.max(...sums));
  const remaining = [0,1,2,3].filter(i => i !== tl && i !== br);
  const tr = diffs[remaining[0]] < diffs[remaining[1]] ? remaining[0] : remaining[1];
  const bl = remaining[0] === tr ? remaining[1] : remaining[0];
  return [pts[tl], pts[tr], pts[br], pts[bl]];
}

async function detectCorners(imagePath) {
  const sess = await getSession();

  // 1. 读原图尺寸
  const meta = await sharp(imagePath).metadata();
  const W = meta.width, H = meta.height;

  // 2. letterbox: 计算 scale 和 padding
  const scale = Math.min(TW / W, TH / H);
  const newW = Math.round(W * scale);
  const newH = Math.round(H * scale);
  const padX = Math.floor((TW - newW) / 2);
  const padY = Math.floor((TH - newH) / 2);

  // 3. 用一条 sharp 链完成：resize + extend padding + raw RGB
  // 先取四边4像素的中值色作为填充色
  const { data: borderData, info: borderInfo } = await sharp(imagePath)
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bw = borderInfo.width, bh = borderInfo.height, bc = borderInfo.channels;
  const borderR = [], borderG = [], borderB = [];
  const edge = 4;
  for (let x = 0; x < bw; x++) {
    for (let dy = 0; dy < edge; dy++) {
      const i1 = (dy * bw + x) * bc;
      const i2 = ((bh-1-dy) * bw + x) * bc;
      borderR.push(borderData[i1], borderData[i2]);
      borderG.push(borderData[i1+1], borderData[i2+1]);
      borderB.push(borderData[i1+2], borderData[i2+2]);
    }
  }
  for (let y = 0; y < bh; y++) {
    for (let dx = 0; dx < edge; dx++) {
      const i1 = (y * bw + dx) * bc;
      const i2 = (y * bw + (bw-1-dx)) * bc;
      borderR.push(borderData[i1], borderData[i2]);
      borderG.push(borderData[i1+1], borderData[i2+1]);
      borderB.push(borderData[i1+2], borderData[i2+2]);
    }
  }
  const sorted = (arr) => [...arr].sort((a,b)=>a-b)[Math.floor(arr.length/2)];
  const padColor = { r: sorted(borderR), g: sorted(borderG), b: sorted(borderB) };
  console.log('[detect]', { W, H, newW, newH, padX, padY, scale, padColor });

  // resize 然后用 extend 加 padding
  const paddedBuf = await sharp(imagePath)
    .resize(newW, newH, { kernel: 'lanczos3' })
    .removeAlpha()
    .toColourspace('srgb')
    .extend({
      top: padY, bottom: TH - newH - padY,
      left: padX, right: TW - newW - padX,
      background: padColor,
    })
    .raw()
    .toBuffer();

  // 4. HWC -> CHW, normalize
  const chw = new Float32Array(3 * TH * TW);
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const idx = (y * TW + x) * 3;
      for (let c = 0; c < 3; c++) {
        chw[c * TH * TW + y * TW + x] = (paddedBuf[idx + c] / 255.0 - MEAN[c]) / STD[c];
      }
    }
  }

  // 5. 推理
  const inputName = sess.inputNames[0];
  const feeds = {};
  feeds[inputName] = new ort.Tensor('float32', chw, [1, 3, TH, TW]);
  const results = await sess.run(feeds);

  const coords = results['coords'].data;
  const slotLogit = results['slot_logit'].data;
  for (let k = 0; k < 2; k++) {
    const p = 1 / (1 + Math.exp(-slotLogit[k]));
    console.log(`[detect] slot${k} prob=${p.toFixed(4)}`);
  }

  // 6. 后处理
  const cards = [];
  for (let k = 0; k < 2; k++) {
    const prob = 1 / (1 + Math.exp(-slotLogit[k]));
    const threshold = k === 0 ? 0.5 : 0.15;
    if (prob < threshold) continue;

    let pts = [];
    for (let c = 0; c < 4; c++) {
      const nx = coords[(k * 4 + c) * 2 + 0];
      const ny = coords[(k * 4 + c) * 2 + 1];
      let qx = nx * TW;
      let qy = ny * TH;
      qx = (qx - padX) / scale;
      qy = (qy - padY) / scale;
      pts.push([qx, qy]);
    }
    pts = order4(pts);
    cards.push({
      prob: Number(prob.toFixed(4)),
      corners: pts.map(p => ({ x: Math.round(p[0]), y: Math.round(p[1]) })),
    });
  }

  // 去重
  if (cards.length === 2) {
    const area = (c) => {
      const xs = c.corners.map(p => p.x), ys = c.corners.map(p => p.y);
      return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    };
    const bbox = (c) => {
      const xs = c.corners.map(p => p.x), ys = c.corners.map(p => p.y);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    };
    const a1 = area(cards[0]), a2 = area(cards[1]);
    const [x1,y1,x2,y2] = bbox(cards[0]);
    const [x3,y3,x4,y4] = bbox(cards[1]);
    const ix = Math.max(0, Math.min(x2,x4) - Math.max(x1,x3));
    const iy = Math.max(0, Math.min(y2,y4) - Math.max(y1,y3));
    const inter = ix * iy;
    const iou = inter / (a1 + a2 - inter + 1e-6);
    if (iou > 0.75) cards.sort((a,b) => b.prob - a.prob).pop();
  }

  return { cards, origW: W, origH: H };
}

export { detectCorners };
