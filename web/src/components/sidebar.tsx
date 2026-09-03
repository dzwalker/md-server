import type { ActivityId } from '@/lib/activities';
import { ExplorerPanel } from './sidebar/explorer-panel';
import { OpenedPanel } from './sidebar/opened-panel';
import { TagsPanel } from './sidebar/tags-panel';
import { FavoritesPanel } from './sidebar/favorites-panel';
import { SpacesPanel } from './sidebar/spaces-panel';

export function Sidebar({ active }: { active: ActivityId }) {
  switch (active) {
    case 'opened':
      return <OpenedPanel />;
    case 'tags':
      return <TagsPanel />;
    case 'favorites':
      return <FavoritesPanel />;
    case 'spaces':
      return <SpacesPanel />;
    case 'explorer':
    default:
      return <ExplorerPanel />;
  }
}
