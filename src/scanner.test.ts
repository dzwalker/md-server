import { describe, it, expect } from 'vitest';
import { buildTree } from './scanner.js';
import type { MdFile } from './scanner.js';

describe('buildTree', () => {
  it('按目录/文件构建有序树', () => {
    const files: MdFile[] = [
      { urlPath: '/t/b.md', fsPath: '/x/b.md', name: 'b.md', dir: '/t', title: 'B', mtimeMs: 0, size: 0, frontmatter: {} },
      { urlPath: '/t/sub/a.md', fsPath: '/x/sub/a.md', name: 'a.md', dir: '/t/sub', title: 'A', mtimeMs: 0, size: 0, frontmatter: {} },
    ];
    const tree = buildTree(files);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 't', type: 'dir' });
    expect(tree[0].children![0]).toMatchObject({ name: 'sub', type: 'dir' });
    expect(tree[0].children![1]).toMatchObject({ name: 'b.md', type: 'file' });
  });
});
