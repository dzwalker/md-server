import { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator, type Layout, type PanelImperativeHandle } from 'react-resizable-panels';
import { StoreProvider, useStore } from '@/state/store';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ActivityBar } from '@/components/activity-bar';
import { Sidebar } from '@/components/sidebar';
import { DocView } from '@/components/doc-view';
import { CommandPalette } from '@/components/command-palette';
import { useTheme } from '@/hooks/use-theme';
import { useIsMobile } from '@/hooks/use-is-mobile';
import type { ActivityId } from '@/lib/activities';
import { stripMdExt } from '@/lib/utils';

const LAYOUT_KEY = 'md-server-layout';
const DEFAULT_LAYOUT: Layout = { sidebar: 20, main: 80 };

function loadLayout(): Layout {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) return JSON.parse(raw) as Layout;
  } catch {
    /* ignore */
  }
  return DEFAULT_LAYOUT;
}

function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

const HANDLE_CLASS = 'w-px bg-border transition-colors hover:bg-primary/50';

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

function Shell() {
  const [active, setActive] = useState<ActivityId>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const { theme, toggle } = useTheme();
  const isMobile = useIsMobile();
  const { activeDoc, openDocs } = useStore();

  // 浏览器标签标题：未打开文档时「文档专家」；打开时「文档库 - 文件名(不含后缀)」。
  useEffect(() => {
    if (!activeDoc) {
      document.title = '文档专家';
      return;
    }
    const info = openDocs.find((d) => d.path === activeDoc);
    const isTool = activeDoc.startsWith('/__tools__/');
    const name = isTool
      ? info?.title || '工具'
      : stripMdExt(activeDoc.split('/').pop() || '');
    document.title = '文档库 - ' + name;
  }, [activeDoc, openDocs]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setSidebarOpen((v) => !v);
    } else if (sidebarRef.current?.isCollapsed()) {
      sidebarRef.current?.expand();
    } else {
      sidebarRef.current?.collapse();
    }
  }, [isMobile]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  function handleLayoutChanged(layout: Layout) {
    saveLayout(layout);
    setSidebarCollapsed((layout.sidebar ?? 0) === 0);
  }

  function handleActivityChange(id: ActivityId) {
    setActive(id);
    if (sidebarCollapsed) sidebarRef.current?.expand();
  }

  const layout = isMobile ? (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <DocView onOpenSidebar={() => setSidebarOpen(true)} />
        </div>
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>侧栏</SheetTitle>
            </SheetHeader>
            <div className="flex h-full">
              <div className="w-12 shrink-0">
                <ActivityBar
                  active={active}
                  onChange={(id) => setActive(id)}
                  theme={theme}
                  onToggleTheme={toggle}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Sidebar active={active} onCollapse={() => setSidebarOpen(false)} />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </TooltipProvider>
  ) : (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <div className="w-12 shrink-0">
          <ActivityBar active={active} onChange={handleActivityChange} theme={theme} onToggleTheme={toggle} />
        </div>
        <Group
          orientation="horizontal"
          className="min-w-0 flex-1"
          defaultLayout={loadLayout()}
          onLayoutChanged={handleLayoutChanged}
        >
          <Panel
            id="sidebar"
            minSize="15"
            maxSize="40"
            collapsible
            collapsedSize={0}
            panelRef={sidebarRef}
          >
            <Sidebar active={active} onCollapse={() => sidebarRef.current?.collapse()} />
          </Panel>
          <Separator className={HANDLE_CLASS} />
          <Panel id="main" minSize="30">
            <DocView />
          </Panel>
        </Group>
      </div>
    </TooltipProvider>
  );

  return (
    <>
      {layout}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  );
}
