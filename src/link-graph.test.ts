import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// 临时文档空间 + 临时索引库：必须在 import config/index-db 之前设好环境变量。
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-server-linkgraph-'));
const space = path.join(tmpRoot, 'g');
fs.mkdirSync(path.join(space, 'sub'), { recursive: true });

fs.writeFileSync(path.join(space, 'a.md'), [
  '# Alpha',
  '',
  '[见 b](b.md) 与 [再提一次 b](b.md)',
  '[越级](../g/b.md)',
  '[外链](https://example.com/x.md)',
  '[锚点](#section)',
  '![图片](c.md)',
  '',
  '```',
  '[代码块里的](b.md)',
  '```',
  '行内 `[行内代码](b.md)` 不算',
  '',
].join('\n'));
fs.writeFileSync(path.join(space, 'b.md'), '# Beta\n\n[[c]] 双链\n');
fs.writeFileSync(path.join(space, 'sub', 'c.md'), '# Gamma\n\n[回 Alpha](../a.md)\n');
fs.writeFileSync(path.join(space, 'd.md'), '# Delta\n\n没人引用我\n');
fs.writeFileSync(path.join(space, 'README.md'), '# 索引\n\n[看 a](a.md)\n');

process.env.MD_BASE_DIR = tmpRoot;
process.env.MD_SETS = JSON.stringify([{ id: 'g', name: 'g', dirs: ['g'], embed: false }]);
process.env.MD_SETS_FILE = path.join(tmpRoot, 'sets.json'); // 不存在 -> 走 MD_SETS
process.env.MD_INDEX_DB = path.join(tmpRoot, 'index.db');

const { rebuildIndex, outlinks, backlinks, orphans, impact, graphStats, extractMdLinks } = await import('./index-db.js');

describe('markdown 相对链接进图谱', () => {
  it('相对路径归一化成 urlPath，跳过外链/锚点/图片/代码块', () => {
    const body = [
      '[见 b](b.md)', '[越级](../g/b.md)', '[外链](https://e.com/x.md)',
      '[锚点](#h)', '![图](c.md)', '```\n[代码](b.md)\n```', '`[行内](b.md)`',
    ].join('\n');
    expect(extractMdLinks(body, '/g/a.md')).toEqual(['/g/b.md', '/g/b.md']);
  });

  it('出链按目标聚合，count = 正文出现次数', () => {
    rebuildIndex();
    expect(outlinks('/g/a.md')).toEqual([{ target: '/g/b.md', count: 3 }]);
  });

  it('backlinks 按 urlPath 精确命中（含 ../ 写法）', () => {
    expect(backlinks('/g/b.md').map((r: any) => r.path)).toEqual(['/g/a.md']);
    // README 引用了 a，c 也回了 a
    expect(backlinks('/g/a.md').map((r: any) => r.path).sort()).toEqual(['/g/README.md', '/g/sub/c.md']);
  });

  it('wikilink 仍按目标名兜底（[[c]] -> /g/sub/c.md）', () => {
    const rows = backlinks('/g/sub/c.md').map((r: any) => r.path);
    expect(rows).toEqual(['/g/b.md']);
  });

  it('orphans 排除 README，并点名真正没人引用的文档', () => {
    const paths = orphans().map((r: any) => r.path);
    expect(paths).toEqual(['/g/d.md']);
  });

  it('impact 返回直接引用者，可多跳', () => {
    expect(impact('/g/b.md', 1).map((r: any) => r.path)).toEqual(['/g/a.md']);
    expect(impact('/g/a.md', 1).map((r: any) => r.path).sort()).toEqual(['/g/README.md', '/g/sub/c.md']);
    // b 被 a 引用，a 被 c 引用 -> 从 b 出发 2 跳能摸到 c
    expect(impact('/g/b.md', 2).map((r: any) => r.path)).toContain('/g/sub/c.md');
  });

  it('graphStats 给出边数、入链 Top 与孤儿数', () => {
    const s = graphStats(5);
    expect(s.files).toBe(5);
    expect(s.mdEdges).toBeGreaterThan(0);
    expect(s.orphanCount).toBe(1);
    expect(s.topInbound.map((r: any) => r.path)).toContain('/g/b.md');
  });
});
