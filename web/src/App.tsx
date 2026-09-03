import { useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator, type Layout, type PanelImperativeHandle } from 'react-resizable-panels';
import { StoreProvider } from '@/state/store';
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
import { TocPanel } from '@/components/toc-panel';
import { CommandPalette } from '@/components/command-palette';
import { useTheme } from '@/hooks/use-theme';
import { useIsMobile } from '@/hooks/use-is-mobile';
import type { ActivityId } from '@/lib/activities';

const LAYOUT_KEY = 'md-server-layout';
const DEFAULT_LAYOUT: Layout = { sidebar: 20, main: 62, toc: 18 };

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
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const sidebarRef = useRef<PanelImperativeHandle | null>(null);
  const tocRef = useRef<PanelImperativeHandle | null>(null);
  const { theme, toggle } = useTheme();
  const isMobile = useIsMobile();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function handleLayoutChanged(layout: Layout) {
    saveLayout(layout);
    setSidebarCollapsed((layout.sidebar ?? 0) === 0);
    setTocCollapsed((layout.toc ?? 0) === 0);
  }

  function handleActivityChange(id: ActivityId) {
    setActive(id);
    if (sidebarCollapsed) sidebarRef.current?.expand();
  }

  const layout = isMobile ? (
    <TooltipProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <div className="w-12 shrink-0">
          <ActivityBar
            active={active}
            onChange={(id) => {
              setActive(id);
              setSidebarOpen(true);
            }}
            theme={theme}
            onToggleTheme={toggle}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <DocView tocCollapsed={false} onOpenToc={() => {}} />
        </div>
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>侧栏</SheetTitle>
            </SheetHeader>
            <Sidebar active={active} onCollapse={() => setSidebarOpen(false)} />
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
            <DocView tocCollapsed={tocCollapsed} onOpenToc={() => tocRef.current?.expand()} />
          </Panel>
          <Separator className={HANDLE_CLASS} />
          <Panel
            id="toc"
            minSize="12"
            maxSize="30"
            collapsible
            collapsedSize={0}
            panelRef={tocRef}
          >
            <TocPanel onCollapse={() => tocRef.current?.collapse()} />
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
