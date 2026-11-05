import { describe, expect, it } from 'vitest';
import { deriveRoots, validateSets, isEmbedEnabled, inScope, rootNameOf, scopesOverlap } from './config.js';

describe('deriveRoots', () => {
  it('按所有 set 的目录并集派生 url->dir，跨 set 去重并保持首见顺序', () => {
    const roots = deriveRoots(
      [
        { id: 'a', name: 'A', dirs: ['x', 'y'], embed: true },
        { id: 'b', name: 'B', dirs: ['y', 'z'], embed: false },
      ],
      '/base',
    );
    expect(roots).toEqual([
      { url: '/x', dir: '/base/x' },
      { url: '/y', dir: '/base/y' },
      { url: '/z', dir: '/base/z' },
    ]);
  });

  it('清理目录名两侧的斜杠', () => {
    const roots = deriveRoots([{ id: 'a', name: 'A', dirs: ['/x/'], embed: false }], '/base');
    expect(roots).toEqual([{ url: '/x', dir: '/base/x' }]);
  });
});

describe('validateSets', () => {
  it('通过合法 set，目录去重，embed 默认 false', () => {
    const r = validateSets([{ id: 'work-1', name: '工作', dirs: ['a', 'a', 'b'] }]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sets[0].dirs).toEqual(['a', 'b']);
      expect(r.sets[0].embed).toBe(false);
    }
  });

  it('保留 embed=true 标记', () => {
    const r = validateSets([{ id: 'a', name: 'x', dirs: [], embed: true }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sets[0].embed).toBe(true);
  });

  it('拒绝非法 id', () => {
    expect(validateSets([{ id: 'a/b', name: 'x', dirs: [] }]).ok).toBe(false);
    expect(validateSets([{ id: '-x', name: 'x', dirs: [] }]).ok).toBe(false);
    expect(validateSets([{ id: '中文', name: 'x', dirs: [] }]).ok).toBe(false);
    expect(validateSets([{ id: '', name: 'x', dirs: [] }]).ok).toBe(false);
  });

  it('拒绝重复 id', () => {
    const r = validateSets([{ id: 'a', name: 'x', dirs: [] }, { id: 'a', name: 'y', dirs: [] }]);
    expect(r.ok).toBe(false);
  });

  it('拒绝空数组或缺少 name', () => {
    expect(validateSets([]).ok).toBe(false);
    expect(validateSets([{ id: 'a', name: '', dirs: [] }]).ok).toBe(false);
  });
});

describe('作用域条目（set.dirs 允许子路径）', () => {
  it('允许 notion-archive/学习成长 这类子目录，并保持原样', () => {
    const r = validateSets([{ id: 'study', name: '学习', dirs: ['notion-archive/学习成长', 'notion-archive/爱好'] }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.sets[0].dirs).toEqual(['notion-archive/学习成长', 'notion-archive/爱好']);
  });

  it('拒绝 .. / . / 空段 / 反斜杠 / 以 / 开头', () => {
    for (const bad of ['../etc', 'a/../b', 'a/./b', 'a//b', 'a/', '/abs', 'a\\b']) {
      const r = validateSets([{ id: 'a', name: 'x', dirs: [bad] }]);
      expect(r.ok, bad).toBe(false);
    }
  });

  it('同一 set 内条目不允许互相包含（父/子、相等），跨 set 不限制', () => {
    const bad1 = validateSets([{ id: 'a', name: 'x', dirs: ['notion-archive', 'notion-archive/学习成长'] }]);
    expect(bad1.ok).toBe(false);
    const dup = validateSets([{ id: 'a', name: 'x', dirs: ['notion-archive/学习成长', 'notion-archive/学习成长'] }]);
    expect(dup.ok).toBe(true);
    if (dup.ok) expect(dup.sets[0].dirs).toEqual(['notion-archive/学习成长']);
    const ok = validateSets([
      { id: 'a', name: 'x', dirs: ['notion-archive'] },
      { id: 'b', name: 'y', dirs: ['notion-archive/学习成长'] },
    ]);
    expect(ok.ok).toBe(true);
  });
});

describe('root 永远按作用域第一段派生', () => {
  it('子目录条目只派生一级物理 root', () => {
    const roots = deriveRoots(
      [
        { id: 'a', name: 'A', dirs: ['notion-archive/学习成长'], embed: false },
        { id: 'b', name: 'B', dirs: ['notion-archive/爱好', 'notion-archive'], embed: false },
      ],
      '/base',
    );
    expect(roots).toEqual([{ url: '/notion-archive', dir: '/base/notion-archive' }]);
  });

  it('rootNameOf / inScope / scopesOverlap', () => {
    expect(rootNameOf('notion-archive/学习成长')).toBe('notion-archive');
    expect(inScope('/notion-archive/学习成长/a.md', 'notion-archive/学习成长')).toBe(true);
    expect(inScope('/notion-archive/学习成长', 'notion-archive/学习成长')).toBe(true);
    expect(inScope('/notion-archive/学习成长2/a.md', 'notion-archive/学习成长')).toBe(false);
    expect(inScope('/notion-archive/a.md', 'notion-archive/学习成长')).toBe(false);
    expect(scopesOverlap('a', 'a/b')).toBe(true);
    expect(scopesOverlap('a/b', 'a/c')).toBe(false);
  });

  it('isEmbedEnabled 按作用域前缀判定', () => {
    const sets = [
      { id: 'a', name: 'A', dirs: ['notion-archive/学习成长'], embed: true },
      { id: 'b', name: 'B', dirs: ['other'], embed: false },
    ];
    expect(isEmbedEnabled('/notion-archive/学习成长/a.md', sets)).toBe(true);
    expect(isEmbedEnabled('/notion-archive/爱好/a.md', sets)).toBe(false);
    expect(isEmbedEnabled('/other/a.md', sets)).toBe(false);
  });
});
