import { Moon, Sun } from 'lucide-react';
import { ACTIVITIES, type ActivityId } from '@/lib/activities';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { Theme } from '@/hooks/use-theme';

interface ActivityBarProps {
  active: ActivityId;
  onChange: (id: ActivityId) => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function ActivityBar({ active, onChange, theme, onToggleTheme }: ActivityBarProps) {
  return (
    <div className="flex h-full w-full flex-col items-center gap-1 border-r bg-muted/40 py-2">
      {ACTIVITIES.map((a) => {
        const Icon = a.icon;
        const isActive = a.id === active;
        return (
          <Tooltip key={a.id}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={a.label}
                className={cn('h-9 w-9 text-muted-foreground', isActive && 'bg-accent text-accent-foreground')}
                onClick={() => onChange(a.id)}
              >
                <Icon className="h-5 w-5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{a.label}</TooltipContent>
          </Tooltip>
        );
      })}

      <div className="mt-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="切换主题"
              className="h-9 w-9 text-muted-foreground"
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">切换主题</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
