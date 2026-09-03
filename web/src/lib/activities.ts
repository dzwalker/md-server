import {
  FolderOpen,
  FileText,
  Tag,
  Star,
  Layers,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export type ActivityId = 'explorer' | 'opened' | 'tags' | 'favorites' | 'spaces' | 'settings';

export interface Activity {
  id: ActivityId;
  label: string;
  icon: LucideIcon;
}

export const ACTIVITIES: Activity[] = [
  { id: 'explorer', label: '资源管理器', icon: FolderOpen },
  { id: 'opened', label: '已打开的文档', icon: FileText },
  { id: 'tags', label: '标签', icon: Tag },
  { id: 'favorites', label: '收藏', icon: Star },
  { id: 'spaces', label: '空间管理', icon: Layers },
  { id: 'settings', label: '设置', icon: Settings },
];
