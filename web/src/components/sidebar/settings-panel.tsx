import { Check } from 'lucide-react';
import { useStore } from '@/state/store';
import { MD_THEMES } from '@/lib/md-themes';
import { MERMAID_THEMES } from '@/lib/mermaid-themes';
import { TOC_WIDTH_MAX, TOC_WIDTH_MIN } from '@/lib/toc';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

export function SettingsPanel() {
  const { mdTheme, setMdTheme, mermaidTheme, setMermaidTheme, tocWidth, setTocWidth, hideEmptyDirs, setHideEmptyDirs, showFilename, setShowFilename } = useStore();

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden px-3 pb-3 pt-1">
      <div className="px-1 pb-1 text-xs text-muted-foreground">Markdown 主题</div>
      <div className="flex flex-col gap-0.5">
        {MD_THEMES.map((t) => {
          const active = mdTheme === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setMdTheme(t.id)}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-accent',
                active && 'bg-accent',
              )}
            >
              <span
                className="h-5 w-5 shrink-0 rounded-md border"
                style={{ background: t.swatch }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{t.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{t.description}</span>
              </span>
              {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>

      <div className="mt-4 px-1 pb-1 text-xs text-muted-foreground">Mermaid 图表主题</div>
      <select
        value={mermaidTheme}
        onChange={(e) => setMermaidTheme(e.target.value)}
        className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring"
      >
        {MERMAID_THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} — {t.description}
          </option>
        ))}
      </select>
      <div className="px-1 pb-1 text-xs text-muted-foreground">
        仅影响正文里的 mermaid 图；单篇文档内用 {'%%{init: ...}%%'} 声明的主题仍优先生效。
      </div>

      <div className="mt-4 px-1 pb-1 text-xs text-muted-foreground">目录宽度 (px)</div>
      <div className="flex items-center gap-2 px-1">
        <Input
          type="number"
          value={tocWidth}
          min={TOC_WIDTH_MIN}
          max={TOC_WIDTH_MAX}
          onChange={(e) => setTocWidth(Number(e.target.value))}
          className="h-8"
        />
        <span className="shrink-0 text-xs text-muted-foreground">
          {TOC_WIDTH_MIN}–{TOC_WIDTH_MAX}
        </span>
      </div>

      <div className="mt-4 px-1 pb-1 text-xs text-muted-foreground">资源管理器</div>
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent">
        <input
          type="checkbox"
          checked={hideEmptyDirs}
          onChange={(e) => setHideEmptyDirs(e.target.checked)}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="text-sm">隐藏无文档的文件夹</span>
      </label>
      <div className="px-1 pb-1 text-xs text-muted-foreground">
        在资源管理器里隐藏后代没有任何文档的文件夹（一级目录始终保留）。
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1.5 hover:bg-accent">
        <input
          type="checkbox"
          checked={showFilename}
          onChange={(e) => setShowFilename(e.target.checked)}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="text-sm">显示文件名（而非文档标题）</span>
      </label>
      <div className="px-1 pb-1 text-xs text-muted-foreground">
        开启后，资源管理器与顶部标签页用文件名显示，而非 frontmatter/正文里的标题。
      </div>
    </div>
  );
}
