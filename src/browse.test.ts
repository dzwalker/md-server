import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrowseError, listBrowseDirs, normalizeBrowsePath, resolveBrowseDir } from './browse.js';

let base: string;
let outside: string;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'md-browse-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'md-browse-out-'));
  // notion-archive/{study,hobby,work} + 一个空目录 + 应被跳过的目录/文件
  for (const d of [
    'notion-archive/study/deep',
    'notion-archive/hobby',
    'notion-archive/work',
    'notion-archive/_assets',
    'notion-archive/.hidden',
    'notion-archive/node_modules/x',
    'empty',
  ]) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
  }
  fs.writeFileSync(path.join(base, 'notion-archive/study/a.md'), '# a\n');
  fs.writeFileSync(path.join(base, 'notion-archive/hobby/b.md'), '# b\n');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('目录浏览（/api/browse 的纯逻辑）', () => {
  it('根目录只列一层，跳过隐藏目录与构建产物目录', () => {
    const r = listBrowseDirs({ baseDir: base });
    expect(r.path).toBe('');
    expect(r.parent).toBeNull();
    const top = listBrowseDirs({ baseDir: base, rel: 'notion-archive' });
    expect(top.entries.map((e) => e.name)).toEqual(['_assets', 'hobby', 'study', 'work']);
    expect(r.entries.map((e) => e.name)).toEqual(['empty', 'notion-archive']);
  });

  it('可进入任意深度，parent 指回上一级', () => {
    const r = listBrowseDirs({ baseDir: base, rel: 'notion-archive/study' });
    expect(r.path).toBe('notion-archive/study');
    expect(r.parent).toBe('notion-archive');
    expect(r.entries.map((e) => e.path)).toEqual(['notion-archive/study/deep']);
    expect(r.entries[0].hasChildren).toBe(false);
    expect(listBrowseDirs({ baseDir: base, rel: 'notion-archive' }).parent).toBe('');
  });

  it('mdCount / hasChildren 由注入函数与磁盘决定', () => {
    const r = listBrowseDirs({
      baseDir: base,
      rel: 'notion-archive',
      mdCount: (urlPath) => (urlPath === '/notion-archive/study' ? 1 : 0),
    });
    const study = r.entries.find((e) => e.name === 'study')!;
    expect(study.mdCount).toBe(1);
    expect(study.hasChildren).toBe(true);
    expect(r.entries.find((e) => e.name === 'hobby')!.mdCount).toBe(0);
  });

  it('拒绝 .. / . / 空段 / 反斜杠，以及越界与不存在的目录', () => {
    for (const bad of ['..', 'a/../b', 'a/./b', 'a//b', 'a\\b']) {
      expect(() => normalizeBrowsePath(bad), bad).toThrow(BrowseError);
    }
    expect(() => resolveBrowseDir(base, '../etc')).toThrow(/越界/);
    expect(() => listBrowseDirs({ baseDir: base, rel: 'not-exist' })).toThrow(/不存在/);
  });

  it('软链指向 BASE_DIR 之外时拒绝', () => {
    fs.symlinkSync(outside, path.join(base, 'escape'));
    expect(() => resolveBrowseDir(base, 'escape')).toThrow(/越界/);
    // 软链条目也不出现在列表里（只列真实目录）
    const r = listBrowseDirs({ baseDir: base });
    expect(r.entries.some((e) => e.name === 'escape')).toBe(false);
  });
});
