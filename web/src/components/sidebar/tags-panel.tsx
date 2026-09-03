import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { SearchResult, TagInfo } from '@/lib/types';
import { useStore } from '@/state/store';
import { Badge } from '@/components/ui/badge';
import { ResultItem } from '@/components/result-item';

export function TagsPanel() {
  const { dataVersion, openDoc } = useStore();
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .tags()
      .then((t) => {
        if (alive) setTags(t);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  useEffect(() => {
    if (!activeTag) {
      setResults([]);
      return;
    }
    let alive = true;
    api
      .search('', { tag: activeTag })
      .then((r) => {
        if (alive) setResults(r);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      alive = false;
    };
  }, [activeTag]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-2 pt-1">
        {tags.map((t) => (
          <Badge
            key={t.tag}
            variant={activeTag === t.tag ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setActiveTag(activeTag === t.tag ? null : t.tag)}
          >
            {t.tag} ({t.cnt})
          </Badge>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {!activeTag ? (
          <div className="p-3 text-xs text-muted-foreground">选择一个标签筛选文档</div>
        ) : results.length === 0 ? (
          <div className="p-3 text-xs text-muted-foreground">无结果</div>
        ) : (
          results.map((r) => (
            <ResultItem
              key={r.path}
              path={r.path}
              title={r.title}
              subtitle={r.snippet}
              onClick={() => openDoc(r.path, r.title)}
            />
          ))
        )}
      </div>
    </div>
  );
}
