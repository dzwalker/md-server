import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { SearchResult, SemanticResult } from '@/lib/types';
import { useStore } from '@/state/store';
import { Input } from '@/components/ui/input';
import { ResultItem } from '@/components/result-item';
import { TreeView } from './tree-view';

type AnyResult = SearchResult | SemanticResult;

export function ExplorerPanel() {
  const { openDoc } = useStore();
  const [query, setQuery] = useState('');
  const [semantic, setSemantic] = useState(false);
  const [results, setResults] = useState<AnyResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = semantic ? await api.searchSemantic(q) : await api.search(q);
        setResults(r);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, semantic]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        资源管理器
      </div>
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索全文 / 标题…"
          className="h-8"
        />
        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={semantic}
            onChange={(e) => setSemantic(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          语义
        </label>
      </div>

      {query.trim() ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="p-3 text-xs text-muted-foreground">搜索中…</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">无结果</div>
          ) : (
            results.map((r) => (
              <ResultItem
                key={r.path}
                path={r.path}
                title={r.title}
                subtitle={'score' in r ? `相似度 ${r.score}` : r.snippet}
                onClick={() => openDoc(r.path, r.title, semantic ? null : query)}
              />
            ))
          )}
        </div>
      ) : (
        <TreeView />
      )}
    </div>
  );
}
