import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DocNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 标题，如「新建 Markdown 文件」。 */
  title: string;
  /** 说明文字（可选）。 */
  description?: ReactNode;
  /** 打开时预填的基名（重命名时传原文件去掉 .md 的名字）。 */
  initialName?: string;
  /** 确认按钮文案，如「创建」/「重命名」。 */
  confirmText: string;
  /** 确认按钮上方的附加提醒（如「有 N 篇文档引用了它…」）。 */
  hint?: ReactNode;
  /** 提交：抛错时把 message 显示为红字并保持对话框打开。 */
  onSubmit: (name: string) => Promise<void>;
}

// 新建 / 重命名共用的「文档命名对话框」：只管基名，扩展名固定显示为 .md。
export function DocNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName = '',
  confirmText,
  hint,
  onSubmit,
}: DocNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // busy 的同步副本：Dialog 的 onOpenChange 闭包可能拿到旧值，用它兜住「提交中不许关」。
  const busyRef = useRef(false);
  // Input 是不带 forwardRef 的函数组件，聚焦/全选只能从容器里取 DOM。
  const boxRef = useRef<HTMLDivElement>(null);

  // 开/关切换时重置输入与错误。这里用渲染期同步 state（React 官方推荐的 props→state 写法），
  // 保证对话框挂载那一刻输入框里已经是 initialName（否则 onOpenAutoFocus 时还是旧值）。
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setName(open ? initialName : '');
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const v = name.trim();
    if (!v) {
      setError('名称不能为空');
      return;
    }
    setError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      await onSubmit(v);
      // 成功由本组件关闭；失败停在原地，红字显示后端给的原因。
      busyRef.current = false;
      setBusy(false);
      onOpenChange(false);
    } catch (err) {
      busyRef.current = false;
      setBusy(false);
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // 提交中不允许 Esc / 点遮罩关闭，避免请求半途丢掉
        if (!o && busyRef.current) return;
        onOpenChange(o);
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onOpenAutoFocus={(e) => {
          // 打开即聚焦并全选基名，直接打字即可覆盖
          e.preventDefault();
          const el = boxRef.current?.querySelector('input');
          el?.focus();
          el?.select();
        }}
      >
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div ref={boxRef} className="relative">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // 中文输入法组字过程中的 Enter（确认候选词）不提交
                if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                  e.preventDefault();
                }
              }}
              placeholder="文件名（不含 .md）"
              className="pr-11"
              aria-invalid={error ? true : undefined}
              disabled={busy}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-xs text-muted-foreground">
              .md
            </span>
          </div>
          {error && <p className="text-destructive text-xs">{error}</p>}
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? '处理中…' : confirmText}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
