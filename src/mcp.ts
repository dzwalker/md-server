import express from 'express';
import { createRequire } from 'node:module';
import { resolveUrlPath, toMdFile } from './scanner.js';
import { semanticSearch } from './embed.js';
import { searchFiles, listTags, listTodos, listDueTasks, getFileMeta, backlinks, outlinks, orphans, impact, graphStats } from './index-db.js';
import { ROOTS } from './config.js';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { z } = require('zod');

const MCP_PORT = Number(process.env.MCP_PORT || 3002);
const server = new McpServer({ name: 'md-server', version: '1.0.0' });

server.registerTool('list_allowed_directories', {
  description: '列出可访问的文档目录',
}, async () => ({
  content: [{ type: 'text', text: ROOTS.map((r) => `${r.url} -> ${r.dir}`).join('\n') }],
}));

server.registerTool('search_docs', {
  description: '全文检索 md 文档（支持中文/英文），返回标题、路径与摘要片段',
  inputSchema: { q: z.string().describe('搜索关键词'), tag: z.string().optional(), dir: z.string().optional(), limit: z.number().optional() },
}, async ({ q, tag, dir, limit }) => {
  const results = searchFiles(String(q || ''), { tag, dir, limit: limit || 20 });
  const text = results.length
    ? results.map((r) => `- ${r.title}\n  路径: ${r.path}\n  摘要: ${r.snippet || ''}`).join('\n')
    : '(无结果)';
  return { content: [{ type: 'text', text }] };
});

server.registerTool('read_doc', {
  description: '读取一个 md 文档全文（含 YAML frontmatter）',
  inputSchema: { path: z.string().describe('文档路径，如 /docs/notes/example.md') },
}, async ({ path }) => {
  // 走索引拿元信息（毫秒级），不再全库扫盘。
  const meta = getFileMeta(path);
  const fsPath = resolveUrlPath(path);
  const fallback = !meta && fsPath ? toMdFile(fsPath) : null;
  if ((!meta && !fallback) || !fsPath) return { content: [{ type: 'text', text: `not found: ${path}` }], isError: true };
  const title = meta?.title ?? fallback!.title;
  const frontmatter = meta?.frontmatter ?? fallback!.frontmatter;
  const content = fs.readFileSync(fsPath, 'utf8');
  return { content: [{ type: 'text', text: JSON.stringify({ path, title, frontmatter, content }) }] };
});

server.registerTool('search_semantic', {
  description: '语义(向量)检索：按含义相似度查找文档（不要求关键词精确匹配）',
  inputSchema: { q: z.string().describe('查询描述，可以是自然语言问题'), limit: z.number().optional() },
}, async ({ q, limit }) => {
  const results = await semanticSearch(String(q || ''), limit || 10);
  const text = results.length ? results.map((r: any) => `- ${r.title}\n  路径: ${r.path}\n  相似度: ${r.score}`).join('\n') : '(无结果，或语义索引尚未建立)';
  return { content: [{ type: 'text', text }] };
});

server.registerTool('list_tags', {
  description: '列出所有标签及文档计数',
}, async () => {
  const tags = listTags();
  const text = tags.length ? tags.map((t) => `${t.tag} (${t.cnt})`).join('\n') : '(无标签)';
  return { content: [{ type: 'text', text }] };
});

server.registerTool('list_todos', {
  description: '列出所有 markdown 中的待办（- [ ] 行）',
}, async () => {
  const items = listTodos();
  const text = items.length ? items.map((t) => `- ${t.line.trim()}\n  来源: ${t.path}`).join('\n') : '(无待办)';
  return { content: [{ type: 'text', text }] };
});

server.registerTool('list_due_tasks', {
  description: '列出带截止日期的待办（- [ ] … (due: YYYY-MM-DD)），按截止日升序',
}, async () => {
  const items = listDueTasks();
  const text = items.length ? items.map((t) => `- ${t.task}\n  截止: ${t.due}\n  来源: ${t.source}`).join('\n') : '(无到期任务)';
  return { content: [{ type: 'text', text }] };
});

server.registerTool('backlinks', {
  description: '反向链接：列出引用了这篇文档的文档（md 相对链接 + [[双链]] 同口径）',
  inputSchema: { path: z.string().describe('文档路径，如 /neolix-mgmt/ad/README.md') },
}, async ({ path }) => {
  const rows = backlinks(String(path || ''));
  const text = rows.length
    ? rows.map((r: any) => `- ${r.title || r.path}\n  路径: ${r.path}\n  方式: ${r.kind}`).join('\n')
    : '(无反向链接)';
  return { content: [{ type: 'text', text }] };
});

server.registerTool('outlinks', {
  description: '出链：列出这篇文档引用的目标（同一目标聚合，count = 正文出现次数）',
  inputSchema: { path: z.string().describe('文档路径，如 /neolix-mgmt/ad/README.md') },
}, async ({ path }) => {
  const rows = outlinks(String(path || ''));
  const text = rows.length
    ? rows.map((r) => `- ${r.target}${r.count > 1 ? ` ×${r.count}` : ''}`).join('\n')
    : '(无出链)';
  return { content: [{ type: 'text', text }] };
});

server.registerTool('orphans', {
  description: '孤儿文档：没有任何入链的文档（排除 README.md），用于决定补链还是归档',
  inputSchema: { limit: z.number().optional(), dir: z.string().optional().describe('只看某个目录前缀，如 /neolix-mgmt') },
}, async ({ limit, dir }) => {
  const rows = orphans(Number(limit) || 200, dir ? String(dir) : undefined);
  const text = rows.length
    ? rows.map((r) => `- ${r.title || r.path}\n  路径: ${r.path}`).join('\n')
    : '(没有孤儿文档)';
  return { content: [{ type: 'text', text: `共 ${rows.length} 篇\n${text}` }] };
});

server.registerTool('impact', {
  description: '影响面：改动/删除这篇文档会波及哪些文档（沿反链 BFS，depth 1-3）',
  inputSchema: {
    path: z.string().describe('文档路径'),
    depth: z.number().optional().describe('跳数，默认 1（直接引用者），上限 3'),
  },
}, async ({ path, depth }) => {
  const rows = impact(String(path || ''), Number(depth) || 1);
  const text = rows.length
    ? rows.map((r) => `- [d${r.depth}] ${r.title || r.path}\n  路径: ${r.path}`).join('\n')
    : '(没有被任何文档引用，改动安全)';
  return { content: [{ type: 'text', text: `波及 ${rows.length} 篇\n${text}` }] };
});

server.registerTool('graph_stats', {
  description: '图谱体检：边数、悬空链接、入链 Top（最不能写错的文档）、跨分区边矩阵、孤儿数',
  inputSchema: { limit: z.number().optional(), dir: z.string().optional().describe('只看某个目录前缀，如 /neolix-mgmt') },
}, async ({ limit, dir }) => {
  const s: any = graphStats(Number(limit) || 20, dir ? String(dir) : undefined);
  const lines: string[] = [
    `文档数: ${s.files} ｜ md 链接边: ${s.mdEdges} ｜ 双链行: ${s.wikilinkRows} ｜ 悬空目标: ${s.danglingTargets} ｜ 孤儿: ${s.orphanCount}`,
    '',
    '入链 Top（改动影响最大 / 最该保持准确）:',
    ...s.topInbound.map((r: any) => `  ${String(r.inbound).padStart(3)} ← ${r.path}`),
    '',
    '跨分区引用（活跃区依赖谁）:',
    ...s.crossSection.map((r: any) => `  ${String(r.count).padStart(3)}  ${r.from} -> ${r.to}`),
  ];
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

const app = express();
const transports: Record<string, any> = {};
app.get('/sse', async (req, res) => {
  const t = new SSEServerTransport('/messages', res);
  transports[t.sessionId] = t;
  res.on('close', () => { delete transports[t.sessionId]; });
  await server.connect(t);
});
app.post('/messages', async (req, res) => {
  const t = transports[String(req.query.sessionId)];
  if (!t) { res.status(400).send('no session'); return; }
  await t.handlePostMessage(req, res, req.body);
});
app.get('/healthz', (_req, res) => res.json({ status: 'ok', port: MCP_PORT }));

export function startMcp() {
  app.listen(MCP_PORT, '0.0.0.0', () => console.log(`md-server MCP listening on :${MCP_PORT}`));
}
