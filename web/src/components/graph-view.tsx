import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { GraphData, GraphNode } from '@/lib/types';
import { useStore } from '@/state/store';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function dirHue(p: string): number {
  const seg = p.split('/').filter(Boolean)[0] || 'other';
  let h = 0;
  for (let i = 0; i < seg.length; i++) h = (h * 31 + seg.charCodeAt(i)) % 360;
  return h;
}

interface SimHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

interface GraphViewProps {
  onOpen: (path: string, title?: string) => void;
}

export function GraphView({ onOpen }: GraphViewProps) {
  const { activeDoc } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [empty, setEmpty] = useState(false);
  const [filter, setFilter] = useState('');
  const [legend, setLegend] = useState<string[]>([]);

  const filterRef = useRef('');
  const activeDocRef = useRef(activeDoc);
  const onOpenRef = useRef(onOpen);
  const simRef = useRef<SimHandle | null>(null);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  useEffect(() => {
    activeDocRef.current = activeDoc;
  }, [activeDoc]);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  useEffect(() => {
    api
      .graph()
      .then(setData)
      .catch(() => {
        /* ignore */
      });
  }, []);

  useEffect(() => {
    if (!data) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const nodes = data.nodes || [];
    const edges = data.edges || [];
    const byPath = new Map(nodes.map((n) => [n.path, n]));
    const byName = new Map<string, string>();
    for (const n of nodes) byName.set((n.path.split('/').pop() || '').replace(/\.md$/i, ''), n.path);

    const links: [string, string][] = [];
    const linked = new Set<string>();
    for (const e of edges) {
      const t = byPath.get(e.target)?.path || byName.get(e.target) || byName.get(e.target.replace(/\.md$/i, ''));
      if (byPath.has(e.source) && t) {
        links.push([e.source, t]);
        linked.add(e.source);
        linked.add(t);
      }
    }
    const active = nodes.filter((n) => linked.has(n.path));
    if (!active.length) {
      setEmpty(true);
      return;
    }
    setEmpty(false);
    setLegend([...new Set(active.map((n) => n.path.split('/').filter(Boolean)[0] || 'other'))]);

    const idx = new Map(active.map((n, i) => [n.path, i]));
    const N = active.length;
    const deg = new Array<number>(N).fill(0);
    for (const [a, b] of links) {
      deg[idx.get(a)!]++;
      deg[idx.get(b)!]++;
    }
    const edgeIdx = links.map(([a, b]) => [idx.get(a)!, idx.get(b)!] as [number, number]);
    const colorOf = (n: GraphNode) => 'hsl(' + dirHue(n.path) + ',60%,55%)';

    const W = container.clientWidth || 800;
    const H = container.clientHeight || 600;
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    const pos = active.map(
      () => [W / 2 + (Math.random() - 0.5) * 200, H / 2 + (Math.random() - 0.5) * 200] as [number, number],
    );
    const vel = active.map(() => [0, 0] as [number, number]);
    const ctx = canvas.getContext('2d')!;
    const fg =
      getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim() || '#222';

    let scale = 1;
    let tx = 0;
    let ty = 0;
    let dragNode = -1;
    let panning = false;
    let lastX = 0;
    let lastY = 0;
    let downXY: [number, number] | null = null;
    let hoverNode = -1;
    let raf = 0;
    let disposed = false;

    const tip = document.createElement('div');
    tip.style.cssText =
      'position:absolute;pointer-events:none;background:var(--popover);border:1px solid var(--border);border-radius:6px;padding:5px 9px;font-size:12px;z-index:6;max-width:320px;display:none;';
    container.appendChild(tip);

    const matches = (n: GraphNode) => {
      const q = filterRef.current.toLowerCase();
      if (!q) return true;
      return (n.title || '').toLowerCase().includes(q) || n.path.toLowerCase().includes(q);
    };
    const toWorld = (mx: number, my: number) => [(mx - tx) / scale, (my - ty) / scale] as [number, number];
    const nodeR = (i: number) => 3 + Math.min(12, deg[i] * 1.4);
    const hitTest = (mx: number, my: number) => {
      const [wx, wy] = toWorld(mx, my);
      let best = -1;
      let bd = 14 / scale;
      for (let i = 0; i < N; i++) {
        const r = nodeR(i) + 3;
        const d = Math.hypot(pos[i][0] - wx, pos[i][1] - wy);
        if (d < r && d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };

    const step = () => {
      const cx = (W / 2 - tx) / scale;
      const cy = (H / 2 - ty) / scale;
      for (let i = 0; i < N; i++) {
        if (i === dragNode) continue;
        for (let j = i + 1; j < N; j++) {
          if (j === dragNode) continue;
          let dx = pos[i][0] - pos[j][0];
          let dy = pos[i][1] - pos[j][1];
          const d2 = dx * dx + dy * dy + 0.1;
          const d = Math.sqrt(d2);
          const f = 800 / d2;
          dx /= d;
          dy /= d;
          vel[i][0] += dx * f * 0.03;
          vel[i][1] += dy * f * 0.03;
          vel[j][0] -= dx * f * 0.03;
          vel[j][1] -= dy * f * 0.03;
        }
      }
      for (const [a, b] of edgeIdx) {
        if (a === dragNode || b === dragNode) continue;
        let dx = pos[a][0] - pos[b][0];
        let dy = pos[a][1] - pos[b][1];
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - 70) * 0.015;
        dx /= d;
        dy /= d;
        vel[a][0] -= dx * f;
        vel[a][1] -= dy * f;
        vel[b][0] += dx * f;
        vel[b][1] += dy * f;
      }
      for (let i = 0; i < N; i++) {
        if (i === dragNode) continue;
        vel[i][0] += (cx - pos[i][0]) * 0.004;
        vel[i][1] += (cy - pos[i][1]) * 0.004;
        vel[i][0] *= 0.88;
        vel[i][1] *= 0.88;
        pos[i][0] += vel[i][0];
        pos[i][1] += vel[i][1];
      }
    };

    const draw = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(scale, 0, 0, scale, tx, ty);
      const filtered = filterRef.current !== '';
      ctx.strokeStyle = 'rgba(128,128,128,.35)';
      ctx.lineWidth = 1 / scale;
      for (const [a, b] of edgeIdx) {
        const ma = matches(active[a]);
        const mb = matches(active[b]);
        if (filtered && !ma && !mb) ctx.globalAlpha = 0.04;
        else if (filtered && (!ma || !mb)) ctx.globalAlpha = 0.12;
        else ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(pos[a][0], pos[a][1]);
        ctx.lineTo(pos[b][0], pos[b][1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < N; i++) {
        const n = active[i];
        const r = nodeR(i);
        let alpha = 1;
        if (filtered && !matches(n)) alpha = 0.1;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = n.path === activeDocRef.current ? '#e05555' : colorOf(n);
        ctx.beginPath();
        ctx.arc(pos[i][0], pos[i][1], r, 0, Math.PI * 2);
        ctx.fill();
        if (alpha > 0.1) {
          if (i === hoverNode || n.path === activeDocRef.current) {
            ctx.strokeStyle = n.path === activeDocRef.current ? '#e05555' : '#fff';
            ctx.lineWidth = 2 / scale;
            ctx.stroke();
          }
          if (scale >= 0.55) {
            const label = (n.title || n.path.split('/').pop() || '').slice(0, 14);
            ctx.font = 11 / scale + 'px sans-serif';
            ctx.fillStyle = fg;
            ctx.globalAlpha = alpha;
            ctx.fillText(label, pos[i][0] + r + 3, pos[i][1] + 4 / scale);
          }
        }
        ctx.globalAlpha = 1;
      }
    };

    const loop = () => {
      if (disposed) return;
      for (let k = 0; k < 3; k++) step();
      draw();
      raf = requestAnimationFrame(loop);
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (dragNode >= 0) {
        const [wx, wy] = toWorld(mx, my);
        pos[dragNode][0] = wx;
        pos[dragNode][1] = wy;
        vel[dragNode] = [0, 0];
      } else if (panning) {
        tx += mx - lastX;
        ty += my - lastY;
        lastX = mx;
        lastY = my;
      } else {
        const h = hitTest(mx, my);
        hoverNode = h;
        if (h >= 0) {
          const n = active[h];
          tip.style.display = 'block';
          tip.style.left = Math.min(mx + 14, W - 200) + 'px';
          tip.style.top = Math.min(my + 14, H - 44) + 'px';
          tip.innerHTML = '<b>' + escapeHtml(n.title || n.path) + '</b><br><span style="color:#888">' + escapeHtml(n.path) + '</span>';
          canvas.style.cursor = 'pointer';
        } else {
          tip.style.display = 'none';
          canvas.style.cursor = 'grab';
        }
      }
    };

    const onUp = () => {
      dragNode = -1;
      panning = false;
    };

    const onMouseDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      downXY = [e.clientX, e.clientY];
      const hit = hitTest(mx, my);
      if (hit >= 0) {
        dragNode = hit;
        vel[hit] = [0, 0];
      } else {
        panning = true;
        lastX = mx;
        lastY = my;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const ns = Math.max(0.1, Math.min(6, scale * Math.exp(-e.deltaY * 0.001)));
      const wx = (mx - tx) / scale;
      const wy = (my - ty) / scale;
      tx = mx - wx * ns;
      ty = my - wy * ns;
      scale = ns;
    };

    const onClick = (e: MouseEvent) => {
      if (downXY && Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 5) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = hitTest(mx, my);
      if (hit >= 0) onOpenRef.current(active[hit].path, active[hit].title);
    };

    const zoomTo = (ns: number) => {
      const cx = W / 2;
      const cy = H / 2;
      const wx = (cx - tx) / scale;
      const wy = (cy - ty) / scale;
      tx = cx - wx * ns;
      ty = cy - wy * ns;
      scale = ns;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('click', onClick);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    simRef.current = {
      zoomIn: () => zoomTo(Math.min(6, scale * 1.3)),
      zoomOut: () => zoomTo(Math.max(0.1, scale / 1.3)),
      zoomReset: () => {
        scale = 1;
        tx = 0;
        ty = 0;
      },
    };

    raf = requestAnimationFrame(loop);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      tip.remove();
      simRef.current = null;
    };
  }, [data]);

  if (empty) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        暂无链接数据
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="block" />
      <div className="absolute left-2 top-2 z-10 flex flex-col gap-1.5">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="过滤标题/路径…"
          className="h-8 w-44 text-xs"
        />
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => simRef.current?.zoomIn()}>
            ＋
          </Button>
          <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => simRef.current?.zoomOut()}>
            －
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => simRef.current?.zoomReset()}>
            重置
          </Button>
        </div>
        <div className="flex max-w-52 flex-wrap gap-x-2.5 gap-y-1">
          {legend.map((d) => (
            <span key={d} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: 'hsl(' + dirHue('/' + d) + ',60%,55%)' }}
              />
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
