// 批量操作条：多选后悬浮在底部
import { Button } from '@/components/ui/button';
import { Check, Crop, Flag, Trash2, X } from 'lucide-react';

interface BatchBarProps {
  count: number;
  busy: boolean;
  onCrop: () => void;
  onMarkGood: () => void;
  onMarkPoor: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export default function BatchBar({
  count,
  busy,
  onCrop,
  onMarkGood,
  onMarkPoor,
  onDelete,
  onClear,
}: BatchBarProps) {
  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-xl border bg-popover px-4 py-3 shadow-lg">
        <span className="mr-1 text-sm font-medium">已选 {count} 张</span>
        <Button size="sm" variant="secondary" onClick={onCrop} disabled={busy}>
          <Crop className="mr-1 h-4 w-4" />
          批量裁剪
        </Button>
        <Button size="sm" variant="outline" onClick={onMarkGood} disabled={busy}>
          <Check className="mr-1 h-4 w-4" />
          标记合格
        </Button>
        <Button size="sm" variant="outline" onClick={onMarkPoor} disabled={busy}>
          <Flag className="mr-1 h-4 w-4" />
          标记质量差
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 className="mr-1 h-4 w-4" />
          删除
        </Button>
        <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
          <X className="mr-1 h-4 w-4" />
          取消
        </Button>
      </div>
    </div>
  );
}
