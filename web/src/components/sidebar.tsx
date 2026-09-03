import { PanelLeftClose } from 'lucide-react';
import { ACTIVITIES, type ActivityId } from '@/lib/activities';
import { ExplorerPanel } from './sidebar/explorer-panel';
import { OpenedPanel } from './sidebar/opened-panel';
import { TagsPanel } from './sidebar/tags-panel';
import { FavoritesPanel } from './sidebar/favorites-panel';
import { SpacesPanel } from './sidebar/spaces-panel';
import { SettingsPanel } from './sidebar/settings-panel';

interface SidebarProps {
  active: ActivityId;
  onCollapse: () => void;
}

function renderPanel(active: ActivityId) {
  switch (active) {
    case 'opened':
      return <OpenedPanel />;
    case 'tags':
      return <TagsPanel />;
    case 'favorites':
      return <FavoritesPanel />;
    case 'spaces':
      return <SpacesPanel />;
    case 'settings':
      return <SettingsPanel />;
    case 'explorer':
    default:
      return <ExplorerPanel />;
  }
}

export function Sidebar({ active, onCollapse }: SidebarProps) {
  const current = ACTIVITIES.find((a) => a.id === active);
  const Icon = current?.icon;

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className="flex shrink-0 items-center gap-2 px-3 pb-1.5 pt-2.5">
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{current?.label}</span>
        <button
          type="button"
          onClick={onCollapse}
          title="收起侧栏"
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1">{renderPanel(active)}</div>
    </div>
  );
}
