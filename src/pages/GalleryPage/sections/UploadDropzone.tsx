// 上传区：点击选择或拖拽批量上传
import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Upload } from 'lucide-react';

interface UploadDropzoneProps {
  onFiles: (files: File[]) => void;
  busy: boolean;
}

export default function UploadDropzone({ onFiles, busy }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const files = Array.from(e.dataTransfer?.files ?? []);
        onFiles(files);
      }}
      className={cn(
        'mb-5 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed py-10 text-center transition-colors',
        drag ? 'border-primary bg-accent' : 'border-border bg-card hover:bg-accent/60',
        busy && 'pointer-events-none opacity-60',
      )}
    >
      <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">{busy ? '上传处理中…' : '点击或拖拽上传身份证照片'}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        支持批量多选（手机拍摄 / 扫描件均可），一次可上传几百张
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            onFiles(Array.from(e.target.files));
            e.target.value = '';
          }
        }}
      />
    </div>
  );
}
