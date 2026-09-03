import express from 'express';
import { createRequire } from 'node:module';
import { scanAll } from './scanner.js';
import { semanticSearch } from './embed.js';
import { searchFiles, listTags, listTodos, listDueTasks } from './index-db.js';
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
  const f = scanAll().find((x) => x.urlPath === path);
  if (!f) return { content: [{ type: 'text', text: `not found: ${path}` }], isError: true };
  const content = fs.readFileSync(f.fsPath, 'utf8');
  return { content: [{ type: 'text', text: JSON.stringify({ path, title: f.title, frontmatter: f.frontmatter, content }) }] };
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
