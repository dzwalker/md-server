import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { ROOTS, PORT, ROOTS_FILE, reloadRoots } from './config.js';
import { scanAll, buildTree } from './scanner.js';
import type { MdFile } from './scanner.js';
import { renderMarkdown } from './render.js';
import { rebuildIndex, searchFiles, listTags, indexStats, backlinks, outlinks, graph, listFavorites, setFavorite, removeFavorite, listTodos, listDueTasks } from './index-db.js';
import { startMcp } from './mcp.js';
import { buildEmbeddings, embedFiles, deleteEmbeddings, semanticSearch, embeddingsStatus } from './embed.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const chokidar = require('chokidar');

const app = Fastify({ logger: false });
// 静态媒体资源（katex / mermaid / highlight）——始终可用
app.register(fastifyStatic, { root: path.join(process.cwd(), 'public', 'media'), prefix: '/media/', decorateReply: false });
// 前端构建产物（web/dist）——生产环境
const webDist = path.join(process.cwd(), 'web', 'dist');
const webDistIndex = path.join(webDist, 'index.html');
if (fs.existsSync(webDistIndex)) {
  app.register(fastifyStatic, { root: webDist, decorateReply: false });
}

app.get('/healthz', async () => ({ status: 'ok', roots: ROOTS, fileCount: scanAll().length, index: indexStats() }));

// 旧 SilverBullet 部署在浏览器里遗留了 service worker（注册在 /service_worker.js）。
// 重写后的应用不再需要它；这里返回一个“自卸载”脚本，浏览器更新 SW 时即自动注销，
// 从而清除陈旧缓存，让新版应用正常加载。
app.get('/service_worker.js', async (_req, reply) => {
  reply.header('Content-Type', 'application/javascript; charset=utf-8');
  reply.header('Cache-Control', 'no-cache');
  return [
    "self.addEventListener('install', () => self.skipWaiting());",
    "self.addEventListener('activate', () => self.registration.unregister());",
  ].join('\n');
});

app.get('/api/tree', async () => buildTree(scanAll()));

app.get('/api/files', async () => scanAll());

app.get('/api/files/*', async (req, reply) => {
  const p = '/' + ((req.params as any)['*'] as string);
  const f = scanAll().find((x) => x.urlPath === p);
  if (!f) return reply.code(404).send({ error: 'not found', path: p });
  return { ...f, content: fs.readFileSync(f.fsPath, 'utf8') };
});

app.get('/api/render/*', async (req, reply) => {
  const p = '/' + ((req.params as any)['*'] as string);
  const f = scanAll().find((x) => x.urlPath === p);
  if (!f) return reply.code(404).send({ error: 'not found', path: p });
  const { html, headings } = renderMarkdown(fs.readFileSync(f.fsPath, 'utf8'), f.dir);
  return { ...f, html, headings };
});

app.get('/api/search', async (req) => {
  const { q = '', tag, dir, limit } = (req.query as any) || {};
  return searchFiles(String(q), {
    tag: tag ? String(tag) : undefined,
    dir: dir ? String(dir) : undefined,
    limit: Number(limit) || 30,
  });
});

app.get('/api/tags', async () => listTags());

app.get('/api/backlinks/*', async (req) => {
  const p = '/' + ((req.params as any)['*'] as string);
  return backlinks(p);
});

app.get('/api/outlinks/*', async (req) => {
  const p = '/' + ((req.params as any)['*'] as string);
  return outlinks(p);
});

app.get('/api/graph', async () => graph());

const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.pdf': 'application/pdf',
};
app.get('/api/asset/*', async (req, reply) => {
  const p = ((req.params as any)['*'] as string) || '';
  const seg = p.split('/')[0];
  const root = ROOTS.find((r) => r.url === '/' + seg);
  if (!root) return reply.code(404).send('not found');
  const rel = p.slice(seg.length); // "/xxx/images/foo.png"
  const fsPath = path.resolve(root.dir, '.' + rel);
  if (fsPath !== root.dir && !fsPath.startsWith(root.dir + path.sep)) return reply.code(403).send('forbidden');
  const mime = ASSET_MIME[path.extname(fsPath).toLowerCase()];
  if (!mime) return reply.code(415).send('unsupported type');
  if (!fs.existsSync(fsPath) || !fs.statSync(fsPath).isFile()) return reply.code(404).send('not found');
  return reply.type(mime).send(fs.readFileSync(fsPath));
});

app.post('/api/reindex', async () => rebuildIndex());

app.get('/api/search-semantic', async (req) => {
  const { q = '', limit } = (req.query as any) || {};
  return semanticSearch(String(q), Number(limit) || 10);
});

app.get('/api/embeddings/status', async () => embeddingsStatus());

app.post('/api/reindex-embeddings', async () => { buildEmbeddings().catch(() => {}); return { started: true }; });

// ---------- 收藏 / 置顶 ----------
app.get('/api/favorites', async () => listFavorites());
app.post('/api/favorites', async (req, reply) => {
  const b = (req.body as any) || {};
  const p = String(b.path || '');
  if (!p) return reply.code(400).send({ error: 'path required' });
  return setFavorite(p, !!b.pinned);
});
app.delete('/api/favorites/*', async (req) => {
  const p = '/' + ((req.params as any)['*'] as string);
  return removeFavorite(p);
});

// ---------- 待办 / 到期任务 ----------
app.get('/api/todos', async (req) => {
  const { root } = (req.query as any) || {};
  return listTodos(root ? String(root) : undefined);
});
app.get('/api/todos/due', async (req) => {
  const { root } = (req.query as any) || {};
  return listDueTasks(root ? String(root) : undefined);
});

// ---------- 多空间管理（热加载 + UI） ----------
app.get('/api/roots', async () => ({ roots: ROOTS, file: ROOTS_FILE, exists: fs.existsSync(ROOTS_FILE) }));
app.post('/api/roots', async (req, reply) => {
  const body = (req.body as any);
  const list = Array.isArray(body) ? body : (body && body.roots);
  if (!Array.isArray(list) || !list.length) return reply.code(400).send({ error: 'expected non-empty array of {url, dir}' });
  for (const r of list) {
    if (!r || typeof r.url !== 'string' || !r.url.startsWith('/') || typeof r.dir !== 'string' || !r.dir) {
      return reply.code(400).send({ error: 'each root needs url (starting with /) and dir' });
    }
  }
  writingRoots = true;
  try {
    fs.mkdirSync(path.dirname(ROOTS_FILE), { recursive: true });
    fs.writeFileSync(ROOTS_FILE, JSON.stringify(list, null, 2));
  } catch (e) {
    writingRoots = false;
    return reply.code(500).send({ error: 'write failed', detail: String(e) });
  }
  setTimeout(() => { writingRoots = false; }, 1200);
  reloadRoots();
  setupDirWatcher();
  rebuildIndex();
  buildEmbeddings().catch(() => {});
  return { roots: ROOTS };
});

app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-cache'); });

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
  if (fs.existsSync(webDistIndex)) {
    return reply.type('text/html').send(fs.readFileSync(webDistIndex, 'utf8'));
  }
  // 未构建前端时回退旧 public/index.html（开发直连后端）
  const legacy = path.join(process.cwd(), 'public', 'index.html');
  if (fs.existsSync(legacy)) return reply.type('text/html').send(fs.readFileSync(legacy, 'utf8'));
  return reply.code(404).send('not found');
});

// 启动时建索引
try { rebuildIndex(); console.log('index ready:', JSON.stringify(indexStats())); } catch (e) { console.error('index failed:', e); }
// 异步建立语义向量索引（不阻塞启动）
buildEmbeddings().then(() => console.log('embeddings ready')).catch((e) => console.error('embeddings failed:', e.message));

// ---------- 实时索引 + 增量向量 ----------
let reindexTimer: any = null;
let reloadTimer: any = null;
let watcher: any = null;
let rootsWatcher: any = null;
let writingRoots = false;
let changedPaths = new Set<string>();
let pendingFull = false;

function fsPathToUrl(fp: string): string | null {
  const resolved = path.resolve(fp);
  for (const r of ROOTS) {
    const rd = path.resolve(r.dir);
    if (resolved === rd || resolved.startsWith(rd + path.sep)) {
      return r.url + '/' + path.relative(rd, resolved).split(path.sep).join('/');
    }
  }
  return null;
}

async function flushChanges() {
  try {
    rebuildIndex();
    if (pendingFull) {
      pendingFull = false;
      changedPaths.clear();
      await buildEmbeddings();
    } else if (changedPaths.size) {
      const paths = [...changedPaths];
      changedPaths.clear();
      const scan = scanAll();
      const byFs = new Map(scan.map((f) => [path.resolve(f.fsPath), f]));
      const toEmbed: MdFile[] = [];
      const toDelete: string[] = [];
      for (const p of paths) {
        if (!/\.(md|markdown)$/i.test(p)) continue;
        const fp = path.resolve(p);
        const f = byFs.get(fp);
        if (f) toEmbed.push(f);
        else { const u = fsPathToUrl(fp); if (u) toDelete.push(u); }
      }
      if (toEmbed.length) await embedFiles(toEmbed);
      if (toDelete.length) deleteEmbeddings(toDelete);
    }
    console.log('index updated on file change');
  } catch (e) { console.error('reindex failed:', e); }
}

function onDirChange(event: string, p: string) {
  if (event === 'addDir' || event === 'unlinkDir') pendingFull = true;
  else changedPaths.add(p);
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(flushChanges, 1500);
}

function setupDirWatcher() {
  if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
  watcher = chokidar.watch(ROOTS.map((r) => r.dir), { ignoreInitial: true, ignored: /(^|[/\\])\./ });
  watcher.on('all', onDirChange);
}

function setupRootsWatcher() {
  if (rootsWatcher) { try { rootsWatcher.close(); } catch { /* ignore */ } }
  if (!fs.existsSync(ROOTS_FILE)) return;
  rootsWatcher = chokidar.watch(ROOTS_FILE, { ignoreInitial: true });
  rootsWatcher.on('all', () => {
    if (writingRoots) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const before = JSON.stringify(ROOTS);
      reloadRoots();
      const after = JSON.stringify(ROOTS);
      if (before !== after) {
        setupDirWatcher();
        rebuildIndex();
        buildEmbeddings().catch(() => {});
        console.log('roots reloaded:', JSON.stringify(ROOTS));
      }
    }, 500);
  });
}

setupDirWatcher();
setupRootsWatcher();

app.listen({ host: '0.0.0.0', port: PORT }).then(() => console.log(`md-server listening on :${PORT}`));
startMcp();
