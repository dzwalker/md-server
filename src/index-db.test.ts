import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// 临时文档空间 + 临时索引库：必须在 import config/index-db 之前设好环境变量。
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'md-server-index-'));
fs.mkdirSync(path.join(tmpRoot, 't'), { recursive: true });
fs.writeFileSync(path.join(tmpRoot, 't', 'a.md'), '# Alpha\n\nalpha 正文 [[b]]\n');
fs.writeFileSync(path.join(tmpRoot, 't', 'b.md'), '# Beta\n\nbeta 正文\n');
process.env.MD_BASE_DIR = tmpRoot;
process.env.MD_SETS = JSON.stringify([{ id: 't', name: 't', dirs: ['t', 'r1', 'r2'], embed: false }]);
process.env.MD_SETS_FILE = path.join(tmpRoot, 'sets.json'); // 不存在 -> 走 MD_SETS
process.env.MD_INDEX_DB = path.join(tmpRoot, 'index.db');

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const {
  rebuildIndex, indexFiles, indexFilesInBatches, removeIndexPaths, removeIndexPrefix,
  searchFiles, indexStats, listFileSummaries, getFileMeta, outlinks, backlinks,
  listRecentFiles,
} = await import('./index-db.js');
const { toMdFile, scanRoot } = await import('./scanner.js');

function rawCount(sql: string, ...params: unknown[]): number {
  const d = new Database(process.env.MD_INDEX_DB as string);
  const c = (d.prepare(sql).get(...params) as { c: number }).c;
  d.close();
  return c;
}

describe('增量索引 indexFiles / removeIndexPaths', () => {
  it('全量重建后能查到两个文件', () => {
    rebuildIndex();
    expect(indexStats().files).toBe(2);
    expect(listFileSummaries().map((f) => f.urlPath).sort()).toEqual(['/t/a.md', '/t/b.md']);
    expect(getFileMeta('/t/a.md')?.title).toBe('Alpha');
    expect(searchFiles('Beta').map((r) => r.path)).toContain('/t/b.md');
  });

  it('改一个文件只更新它，且不会产生重复行', () => {
    fs.writeFileSync(path.join(tmpRoot, 't', 'b.md'), '# Beta\n\ngammaword 新正文\n');
    indexFiles([toMdFile(path.join(tmpRoot, 't', 'b.md'))!]);

    expect(indexStats().files).toBe(2); // 没有多出行
    expect(rawCount('SELECT COUNT(*) c FROM fts WHERE path=?', '/t/b.md')).toBe(1); // fts 也没有重复
    expect(outlinks('/t/b.md')).toEqual([]);
    expect(searchFiles('gammaword').map((r) => r.path)).toContain('/t/b.md');
  });

  it('连续多次改动同一文件仍只有一行', () => {
    for (let i = 0; i < 3; i++) {
      fs.writeFileSync(path.join(tmpRoot, 't', 'b.md'), `# Beta\n\n版本${i} deltaword\n`);
      indexFiles([toMdFile(path.join(tmpRoot, 't', 'b.md'))!]);
    }
    expect(indexStats().files).toBe(2);
    expect(rawCount('SELECT COUNT(*) c FROM fts WHERE path=?', '/t/b.md')).toBe(1);
    expect((getFileMeta('/t/b.md')?.size || 0) > 0).toBe(true);
  });

  it('新增文件后可检索', () => {
    const p = path.join(tmpRoot, 't', 'c.md');
    fs.writeFileSync(p, '# Gamma\n\nepsilon 新增文档\n');
    indexFiles([toMdFile(p)!]);
    expect(indexStats().files).toBe(3);
    expect(searchFiles('epsilon').map((r) => r.path)).toContain('/t/c.md');
  });

  it('删文件后行/标签/链接一起清掉', () => {
    fs.writeFileSync(path.join(tmpRoot, 't', 'a.md'), '# Alpha\n\nalpha 正文 [[b]]\n');
    indexFiles([toMdFile(path.join(tmpRoot, 't', 'a.md'))!]);
    expect(backlinks('/t/b.md').map((b) => b.path)).toContain('/t/a.md');

    fs.rmSync(path.join(tmpRoot, 't', 'a.md'));
    removeIndexPaths(['/t/a.md']);

    expect(indexStats().files).toBe(2);
    expect(rawCount('SELECT COUNT(*) c FROM fts WHERE path=?', '/t/a.md')).toBe(0);
    expect(rawCount('SELECT COUNT(*) c FROM links WHERE source=?', '/t/a.md')).toBe(0);
    expect(searchFiles('alpha').map((r) => r.path)).not.toContain('/t/a.md');
    expect(backlinks('/t/b.md')).toEqual([]);
  });

  it('目录被删时按前缀清理', () => {
    fs.mkdirSync(path.join(tmpRoot, 't', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 't', 'sub', 'd.md'), '# Delta\n\nzeta 子目录文档\n');
    indexFiles([toMdFile(path.join(tmpRoot, 't', 'sub', 'd.md'))!]);
    expect(indexStats().files).toBe(3);

    fs.rmSync(path.join(tmpRoot, 't', 'sub'), { recursive: true });
    const removed = removeIndexPrefix('/t/sub');
    expect(removed).toBe(1);
    expect(indexStats().files).toBe(2);
    expect(searchFiles('zeta')).toEqual([]);
  });

  it('批量索引（保存空间新增目录）结果与逐个索引一致', async () => {
    fs.mkdirSync(path.join(tmpRoot, 't', 'bulk'), { recursive: true });
    const before = indexStats().files;
    for (let i = 0; i < 25; i++) {
      fs.writeFileSync(path.join(tmpRoot, 't', 'bulk', `b-${i}.md`), `# 批量 ${i}\n\nfoxtrot${i} 正文\n`);
    }
    const files = scanRoot('/t', path.join(tmpRoot, 't')).filter((f) => f.dir === '/t/bulk');
    expect(files.length).toBe(25);
    await indexFilesInBatches(files, 7);
    expect(indexStats().files).toBe(before + 25);
    expect(searchFiles('foxtrot7').map((r) => r.path)).toContain('/t/bulk/b-7.md');

    // 清理：按前缀移除，索引与磁盘一致
    fs.rmSync(path.join(tmpRoot, 't', 'bulk'), { recursive: true });
    expect(removeIndexPrefix('/t/bulk')).toBe(25);
    expect(indexStats().files).toBe(before);
  });
});

// 命令面板空态「最近更新」：一条 SQL 取按修改时间倒序的文档，可限定在若干空间目录内。
describe('最近更新 listRecentFiles', () => {
  // 比其它测试文件的真实 mtime 都新，断言顺序才稳定。
  const BASE = Date.now() + 1_000_000;

  function seed(dirName: string, files: { name: string; offset: number }[]) {
    fs.mkdirSync(path.join(tmpRoot, dirName), { recursive: true });
    const indexed = files.map((f) => {
      const p = path.join(tmpRoot, dirName, f.name);
      fs.writeFileSync(p, `# ${f.name.replace(/\.md$/, '')}\n\n正文\n`);
      return { ...toMdFile(p)!, mtimeMs: BASE + f.offset };
    });
    indexFiles(indexed);
  }

  it('全局按 mtime 倒序，并支持 dirs 过滤与 limit 截断', () => {
    seed('r1', [
      { name: 'a.md', offset: 100 },
      { name: 'b.md', offset: 300 },
      { name: 'c.md', offset: 200 },
    ]);
    seed('r2', [
      { name: 'x.md', offset: 900 },
      { name: 'y.md', offset: 400 },
    ]);

    // 不限目录：全局最近 3 篇
    expect(listRecentFiles({ limit: 3 }).map((r) => r.path)).toEqual([
      '/r2/x.md',
      '/r2/y.md',
      '/r1/b.md',
    ]);

    // 限目录：只返回该空间目录下的文档
    expect(listRecentFiles({ dirs: ['r1'], limit: 10 }).map((r) => r.path)).toEqual([
      '/r1/b.md',
      '/r1/c.md',
      '/r1/a.md',
    ]);

    // 多个目录：合并后仍全局倒序，limit 截断
    expect(listRecentFiles({ dirs: ['r1', 'r2'], limit: 4 }).map((r) => r.path)).toEqual([
      '/r2/x.md',
      '/r2/y.md',
      '/r1/b.md',
      '/r1/c.md',
    ]);

    // 不存在的目录 -> 空
    expect(listRecentFiles({ dirs: ['nope'], limit: 10 })).toEqual([]);

    // 返回字段够前端渲染列表项
    const [top] = listRecentFiles({ dirs: ['r2'], limit: 1 });
    expect(top).toMatchObject({ path: '/r2/x.md', title: 'x', dir: '/r2', name: 'x.md' });
    expect(top.mtimeMs).toBe(BASE + 900);
  });
});
