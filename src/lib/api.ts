// 与本地后端的交互封装。开发环境下 Vite 将 /openapi 代理到后端端口。
import type { ICardRecord, IStats, Point2D, Quality } from './types';

const BASE = `${window.location.origin}/openapi/id-card-photos`;
const isTauri = typeof (window as any).__TAURI__ !== 'undefined';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  if (isTauri) {
    const path = url.startsWith('http') ? url.slice(url.indexOf('/openapi')) : url;
    const method = init?.method || 'GET';
    const body = init?.body ? String(init.body) : undefined;
    const text = await (window as any).__TAURI__.core.invoke('proxy', { path, method, body });
    return JSON.parse(text) as T;
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = String(body.error);
    } catch {
      /* 非 JSON 响应 */
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function originalUrl(id: string): string {
  return `${BASE}/${id}/original`;
}

export function cropUrl(id: string): string {
  return `${BASE}/${id}/crop-image`;
}

export function exportUrl(): string {
  return `${BASE}/export`;
}

export async function openFolder(id?: string): Promise<void> {
  return req(`/openapi/open-folder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(id ? { id } : {}) });
}


export async function commitCrops(ids?: string[]): Promise<{ ok: number; failed: number }> {
  return req(`${BASE}/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids ? { ids } : {}) });
}

export async function pickFiles(): Promise<{ files: string[] }> {
  return req(`/openapi/pick-files`);
}
export async function scanFiles(files: string[]): Promise<{ created: number }> {
  return req(`/openapi/scan-files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
}
export async function pickFolder(): Promise<{ dir: string }> {
  return req(`/openapi/pick-folder`);
}

export async function writeback(dir: string, ids?: string[]): Promise<{ ok: number; failed: number; errors: string[] }> {
  return req(`/openapi/writeback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, ...(ids && ids.length ? { ids } : {}) }),
  });
}

export interface IListParams {
  status?: 'pending' | 'cropped';
  quality?: 'good' | 'poor' | 'none';
  search?: string;
}

export async function listCards(params: IListParams = {}): Promise<{ items: ICardRecord[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  if (params.quality) qs.set('quality', params.quality);
  if (params.search) qs.set('search', params.search);
  return req(`${BASE}?${qs.toString()}`);
}

export async function getStats(): Promise<IStats> {
  return req(`${BASE}/stats`);
}

export async function uploadFiles(files: File[]): Promise<{ created: ICardRecord[]; failed: { name: string; error: string }[] }> {
  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);
  return req(BASE, { method: 'POST', body: form });
}

export async function scanFolder(dir: string): Promise<{ created: number; items: ICardRecord[] }> {
  return req(`/openapi/scan-folder`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir }) });
}

export async function getCard(id: string): Promise<ICardRecord> {
  return req(`${BASE}/${id}`);
}

export async function setCorners(id: string, corners: Point2D[], rotation?: number, corners2?: Point2D[] | null): Promise<ICardRecord> {
  return req(`${BASE}/${id}/corners`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ corners, ...(typeof rotation === 'number' ? { rotation } : {}), ...(corners2 ? { corners2 } : {}) }),
  });
}

export async function cropOne(id: string, corners?: Point2D[]): Promise<ICardRecord> {
  return req(`${BASE}/${id}/crop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corners ? { corners } : {}),
  });
}

export async function batchCrop(ids: string[]): Promise<{ ok: ICardRecord[]; failed: { id: string; error: string }[] }> {
  return req(`${BASE}/batch/crop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export interface AutoDetectResult {
  cards: { prob: number; corners: Point2D[] }[];
  origW: number;
  origH: number;
}

export async function autodetect(id: string): Promise<AutoDetectResult> {
  return req(`${BASE}/${id}/autodetect`, { method: 'POST' });
}

export async function setQuality(id: string, quality: Quality): Promise<ICardRecord> {
  return req(`${BASE}/${id}/quality`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quality }),
  });
}

export async function batchQuality(ids: string[], quality: Quality): Promise<{ updated: ICardRecord[] }> {
  return req(`${BASE}/batch/quality`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, quality }),
  });
}

export async function removeCard(id: string): Promise<void> {
  await req(`${BASE}/${id}`, { method: 'DELETE' });
}

export async function removeCards(ids: string[]): Promise<{ removed: string[] }> {
  return req(`${BASE}/batch`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

/** 触发浏览器下载文件（原图 / 裁剪图 / ZIP） */
export function downloadUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
