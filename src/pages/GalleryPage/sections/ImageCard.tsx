// 照片卡片：缩略图、状态徽标、裁剪/质检/下载/删除操作
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { cropUrl, downloadUrl, originalUrl } from '@/lib/api';
import type { ICardRecord } from '@/lib/types';
import { Check, Crop, Download, Flag, Trash2 } from 'lucide-react';

interface ImageCardProps {
  record: ICardRecord;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onToggleQuality: () => void;
  onDelete: () => void;
}

export default function ImageCard({
  record,
  selected,
  onToggleSelect,
  onOpen,
  onToggleQuality,
  onDelete,
}: ImageCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary',
      )}
    >
      <div className="relative aspect-[4/3] w-full bg-muted">
        <img
          src={record.hasCrop ? cropUrl(record.id) : originalUrl(record.id)}
          alt={record.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain"
        />
        {/* 状态徽标 */}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {record.hasCrop ? (
            <Badge className="border-success/30 bg-success/15 text-success">
              已裁剪
            </Badge>
          ) : (
            <Badge variant="secondary">待裁剪</Badge>
          )}
          {record.quality === 'poor' && (
            <Badge variant="destructive">质量差</Badge>
          )}
          {record.quality === 'good' && (
            <Badge className="border-success/30 bg-success/15 text-success">
              合格
            </Badge>
          )}
        </div>
        {/* 多选框 */}
        <button
          type="button"
          aria-label={selected ? '取消选择' : '选择'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          className={cn(
            'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md border bg-background/90 text-xs transition-colors',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:border-primary',
          )}
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="truncate text-sm font-medium" title={record.name}>
          {record.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {record.width} × {record.height}px
        </p>
        <div className="mt-auto flex items-center gap-1">
          <Button size="sm" variant="secondary" className="flex-1" onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}>
            <Crop className="mr-1 h-3.5 w-3.5" />
            {record.hasCrop ? '重新裁剪' : '裁剪'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="px-2"
            title={record.quality === 'poor' ? '标记为合格' : '标记为质量差'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleQuality();
            }}
          >
            {record.quality === 'poor' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Flag className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="px-2"
            title="下载裁剪结果"
            disabled={!record.hasCrop}
            onClick={(e) => {
              e.stopPropagation();
              // 文件名与上传时保持一致
              downloadUrl(cropUrl(record.id), record.name);
            }}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="px-2 text-destructive hover:text-destructive"
            title="删除"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
