import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Folder,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { SpaceSet } from '@/lib/types';
import { useStore } from '@/state/store';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function idErrorOf(sets: SpaceSet[], index: number): string | null {
  const id = sets[index].id.trim();
  if (!id) return 'id 必填';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) return '仅字母/数字/-/_，且以字母或数字开头';
  if (sets.findIndex((s, i) => i !== index && s.id.trim() === id) !== -1) return 'id 重复';
  return null;
}

interface SetCardProps {
  set: SpaceSet;
  index: number;
  isActive: boolean;
  idError: string | null;
  onPatch: (index: number, patch: Partial<SpaceSet>) => void;
  onMoveDir: (setIdx: number, dirIdx: number, delta: number) => void;
  onRemoveDir: (setIdx: number, dirIdx: number) => void;
  onAddDir: (setIdx: number, dir: string) => void;
  onRemoveSet: (index: number) => void;
}

function SetCard({
  set,
  index,
  isActive,
  idError,
  onPatch,
  onMoveDir,
  onRemoveDir,
  onAddDir,
  onRemoveSet,
}: SetCardProps) {
  const [dirInput, setDirInput] = useState('');

  function submitDir() {
    const d = dirInput.trim();
    if (!d) return;
    onAddDir(index, d);
    setDirInput('');
  }

  return (
    <div className="mb-2 rounded-lg border bg-card p-2">
      <div className="flex items-center gap-2">
        <Input
          value={set.name}
          onChange={(e) => onPatch(index, { name: e.target.value })}
          placeholder="Set 名称"
          className="h-8 flex-1 text-sm"
        />
        <Button
          variant="ghost"
          size="icon-sm"
          className="h-7 w-7 shrink-0 text-destructive"
          onClick={() => onRemoveSet(index)}
          title="删除 set"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <Input
          value={set.id}
          onChange={(e) => onPatch(index, { id: e.target.value })}
          placeholder="唯一 id（字母/数字/-/_）"
          className={cn('h-7 flex-1 font-mono text-xs', idError && 'border-destructive')}
        />
        {isActive && (
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">当前</span>
        )}
      </div>
      {idError && <div className="mt-0.5 px-0.5 text-xs text-destructive">{idError}</div>}

      <label
        className="mt-1.5 flex cursor-pointer items-center gap-1.5 rounded px-0.5 py-1 hover:bg-accent"
        title="开启后该 set 的文件参与语义（向量）检索；默认关闭"
      >
        <input
          type="checkbox"
          checked={set.embed}
          onChange={(e) => onPatch(index, { embed: e.target.checked })}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="text-xs">参与语义索引</span>
      </label>

      <div className="mt-2 px-0.5 text-xs font-medium text-muted-foreground">目录</div>
      <div className="mt-1 space-y-0.5">
        {set.dirs.length === 0 && <div className="px-0.5 text-xs text-muted-foreground">暂无目录</div>}
        {set.dirs.map((d, di) => (
          <div key={di} className="group flex items-center gap-1 rounded px-0.5 py-0.5 hover:bg-accent">
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{d}</span>
            <button
              type="button"
              disabled={di === 0}
              onClick={() => onMoveDir(index, di, -1)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="上移"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={di === set.dirs.length - 1}
              onClick={() => onMoveDir(index, di, 1)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="下移"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onRemoveDir(index, di)}
              className="rounded p-0.5 text-muted-foreground hover:text-destructive"
              title="移除目录"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-1.5 flex gap-1">
        <Input
          value={dirInput}
          onChange={(e) => setDirInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitDir();
          }}
          placeholder="添加文件夹名"
          className="h-7 flex-1 text-xs"
        />
        <Button variant="outline" size="sm" className="h-7" onClick={submitDir} title="添加目录">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

export function SpacesPanel() {
  const { sets, activeSetId, activeSet, switchSet, saveSets } = useStore();
  const [draft, setDraft] = useState<SpaceSet[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(sets.map((s) => ({ ...s, dirs: [...s.dirs] })));
  }, [sets]);

  function patch(index: number, p: Partial<SpaceSet>) {
    setDraft((cur) => cur.map((s, i) => (i === index ? { ...s, ...p } : s)));
  }

  function moveDir(setIdx: number, dirIdx: number, delta: number) {
    setDraft((cur) =>
      cur.map((s, i) => {
        if (i !== setIdx) return s;
        const dirs = [...s.dirs];
        const j = dirIdx + delta;
        if (j < 0 || j >= dirs.length) return s;
        [dirs[dirIdx], dirs[j]] = [dirs[j], dirs[dirIdx]];
        return { ...s, dirs };
      }),
    );
  }

  function removeDir(setIdx: number, dirIdx: number) {
    setDraft((cur) =>
      cur.map((s, i) => (i === setIdx ? { ...s, dirs: s.dirs.filter((_, d) => d !== dirIdx) } : s)),
    );
  }

  function addDir(setIdx: number, dir: string) {
    const d = dir.trim();
    if (!d) return;
    setDraft((cur) =>
      cur.map((s, i) =>
        i === setIdx ? (s.dirs.includes(d) ? s : { ...s, dirs: [...s.dirs, d] }) : s,
      ),
    );
  }

  function addSet() {
    setDraft((cur) => {
      let n = 1;
      while (cur.some((s) => s.id === `set-${n}`)) n++;
      return [...cur, { id: `set-${n}`, name: '', dirs: [], embed: false }];
    });
  }

  function removeSet(index: number) {
    setDraft((cur) => cur.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMsg(null);
    const r = await saveSets(draft);
    setSaving(false);
    setSaveMsg({ ok: r.ok, text: r.ok ? '已保存' : r.error || '保存失败' });
    if (r.ok) window.setTimeout(() => setSaveMsg(null), 2500);
  }

  return (
    <div className="flex h-full flex-col">
      {/* 切换 set */}
      <div className="shrink-0 border-b px-3 py-2">
        <div className="pb-1 text-xs text-muted-foreground">当前 Set</div>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex h-8 w-full items-center justify-between gap-1 rounded-lg border border-border bg-background px-2.5 text-sm hover:bg-muted hover:text-foreground">
            <span className="min-w-0 flex-1 truncate text-left">
              {activeSet ? activeSet.name : '未选择'}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel>切换 Set</DropdownMenuLabel>
            {sets.length === 0 && (
              <DropdownMenuItem disabled>暂无 set</DropdownMenuItem>
            )}
            {sets.map((s) => (
              <DropdownMenuItem key={s.id} onClick={() => switchSet(s.id)}>
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">{s.id}</span>
                {s.id === activeSetId && <Check className="ml-1 h-4 w-4 shrink-0 text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* set 列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        {draft.map((s, i) => (
          <SetCard
            key={i}
            set={s}
            index={i}
            isActive={s.id === activeSetId}
            idError={idErrorOf(draft, i)}
            onPatch={patch}
            onMoveDir={moveDir}
            onRemoveDir={removeDir}
            onAddDir={addDir}
            onRemoveSet={removeSet}
          />
        ))}
        <Button variant="outline" size="sm" className="h-8 w-full" onClick={addSet}>
          <Plus className="h-4 w-4" /> 新建 Set
        </Button>
      </div>

      {/* 底部：保存 + 提示 */}
      <div className="shrink-0 border-t px-3 py-2">
        <Button size="sm" className="h-8 w-full" onClick={handleSave} disabled={saving}>
          {saving ? '保存中…' : '保存更改'}
        </Button>
        {saveMsg && (
          <div
            className={cn(
              'mt-1 text-center text-xs',
              saveMsg.ok ? 'text-muted-foreground' : 'text-destructive',
            )}
          >
            {saveMsg.text}
          </div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          目录填写挂载根目录下的文件夹名（无需 /data/ 前缀），可用 ↑↓ 调整顺序。
        </div>
      </div>
    </div>
  );
}
