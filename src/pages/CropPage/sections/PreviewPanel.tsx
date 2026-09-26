// 透视校正实时预览面板
interface PreviewPanelProps {
  dataUrl: string | null;
  outLabel: string;
}

export default function PreviewPanel({ dataUrl, outLabel }: PreviewPanelProps) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-2 text-sm font-medium">透视校正预览</h3>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="透视校正预览"
          className="w-full rounded-lg border bg-muted"
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
          调整四角后显示预览
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">输出尺寸：{outLabel}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        点击「保存裁剪结果」后由本机后端按高清尺寸生成最终图，直接覆盖原文件。
      </p>
    </div>
  );
}
