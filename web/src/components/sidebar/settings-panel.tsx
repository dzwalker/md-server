import { Check } from 'lucide-react';
import { useStore } from '@/state/store';
import { MD_THEMES } from '@/lib/md-themes';
import { cn } from '@/lib/utils';

export function SettingsPanel() {
  const { mdTheme, setMdTheme } = useStore();

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
    </div>
  );
}
