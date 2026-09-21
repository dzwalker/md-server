import { describe, expect, it } from 'vitest';
import { deriveRoots, validateSets } from './config.js';

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
