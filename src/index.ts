import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCompress from '@fastify/compress';
import path from 'node:path';
import fs from 'node:fs';
import { ROOTS, PORT, SETS_FILE, SETS, reloadSets, validateSets, isEmbedEnabled, BASE_DIR, EXCLUDES } from './config.js';
import { scanAll, buildTree, scanDirs, scanRoot, toMdFile, resolveUrlPath, fsPathToUrlPath } from './scanner.js';
import type { MdFile } from './scanner.js';
import type { Root } from './config.js';
import { renderMarkdown } from './render.js';
import { rebuildIndex, syncIndex, removeIndexPrefixInBatches, searchFiles, listTags, indexStats, backlinks, outlinks, graph, listFavorites, setFavorite, removeFavorite, listTodos, listDueTasks, indexFiles, indexFilesInBatches, removeIndexPaths, removeIndexPrefix, listFileSummaries, listFilesMeta, getFileMeta, listRecentFiles, truncateWal } from './index-db.js';
import { startMcp } from './mcp.js';
import { buildEmbeddings, embedFiles, deleteEmbeddings, deleteEmbeddingsByPrefix, semanticSearch, embeddingsStatus } from './embed.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const chokidar = require('chokidar');

const app = Fastify({ logger: false });
// 响应压缩：/api/tree 431KB→~64KB、/api/render 233KB→~44KB、前端 bundle 569KB→~150KB。
// 注意：必须 await，否则插件挂到各路由上的 onSend 钩子来不及生效（压缩会静默失效）。
await app.register(fastifyCompress, { global: true, encodings: ['br', 'gzip'], threshold: 1024 });
// 静态媒体资源（katex / mermaid / highlight）——始终可用
await app.register(fastifyStatic, { root: path.join(process.cwd(), 'public', 'media'), prefix: '/media/', decorateReply: false, maxAge: '7d' });
// 前端构建产物（web/dist）——生产环境
const webDist = path.join(process.cwd(), 'web', 'dist');
const webDistIndex = path.join(webDist, 'index.html');
if (fs.existsSync(webDistIndex)) {
  // 文件名带 hash，可长期缓存
  await app.register(fastifyStatic, { root: webDist, decorateReply: false, maxAge: '365d', immutable: true });
}

app.get('/healthz', async () => ({ status: 'ok', roots: ROOTS, sets: SETS.length, baseDir: BASE_DIR, fileCount: indexStats().files, index: indexStats() }));

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

app.get('/api/tree', async () => buildTree(listFileSummaries(), scanDirs()));

app.get('/api/files', async () => listFilesMeta().map((m) => ({ ...m, fsPath: resolveUrlPath(m.urlPath) })));

// 单文件元信息：优先读索引（毫秒级），索引里还没有时回退到磁盘上的单文件探测。
function metaOf(p: string) {
  const meta = getFileMeta(p) || (() => {
    const fsPath = resolveUrlPath(p);
    const f = fsPath ? toMdFile(fsPath) : null;
    return f ? { urlPath: f.urlPath, title: f.title, name: f.name, dir: f.dir, frontmatter: f.frontmatter, mtimeMs: f.mtimeMs, size: f.size } : null;
  })();
  if (!meta) return null;
  return { ...meta, fsPath: resolveUrlPath(p) };
}

app.get('/api/files/*', async (req, reply) => {
  const p = '/' + ((req.params as any)['*'] as string);
  const f = metaOf(p);
  if (!f || !f.fsPath) return reply.code(404).send({ error: 'not found', path: p });
  return { ...f, content: fs.readFileSync(f.fsPath, 'utf8') };
});

// 轻量文档状态：供前端判断「当前打开的文档是否真的变了」，避免 dataVersion 变化就重注入整篇正文。
app.get('/api/stat', async (req) => {
  const p = String((req.query as any)?.path || '');
  if (!p) return { exists: false, path: p };
  const f = metaOf(p);
  if (!f) return { exists: false, path: p };
  return { exists: true, path: p, mtimeMs: f.mtimeMs, size: f.size };
});

app.get('/api/render/*', async (req, reply) => {
  const p = '/' + ((req.params as any)['*'] as string);
  const f = metaOf(p);
  if (!f || !f.fsPath) return reply.code(404).send({ error: 'not found', path: p });
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

// 命令面板空态「最近更新」：按修改时间倒序，dirs 为当前空间的目录名（逗号分隔）。
app.get('/api/recent', async (req) => {
  const { dirs, limit } = (req.query as any) || {};
  const list = String(dirs || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
  return listRecentFiles({ dirs: list, limit: Number(limit) || 20 });
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

app.post('/api/reindex', async () => { rebuildIndex(); bumpVersion(); });

app.get('/api/status', async () => ({ dataVersion }));

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

// ---------- 空间 set 管理（热加载 + UI） ----------
app.get('/api/sets', async () => ({ baseDir: BASE_DIR, sets: SETS }));
app.post('/api/sets', async (req, reply) => {
  const body = (req.body as any);
  const list = Array.isArray(body) ? body : (body && body.sets);
  const valid = validateSets(list);
  if (!valid.ok) return reply.code(400).send({ error: valid.error });
  const prevRoots: Root[] = ROOTS.map((r) => ({ ...r }));
  writingSets = true;
  try {
    fs.mkdirSync(path.dirname(SETS_FILE), { recursive: true });
    fs.writeFileSync(SETS_FILE, JSON.stringify(valid.sets, null, 2));
  } catch (e) {
    writingSets = false;
    return reply.code(500).send({ error: 'write failed', detail: String(e) });
  }
  setTimeout(() => { writingSets = false; }, 1200);
  reloadSets();
  setupDirWatcher();
  // 只按「目录差集」增量索引，并在后台分批执行：保存空间立即返回，不再冻结服务。
  void applySetChanges(prevRoots, ROOTS.map((r) => ({ ...r })));
  return { baseDir: BASE_DIR, sets: SETS };
});

// 空间变更的索引作业：同一时刻只跑一个，期间再次保存则排队执行最后一次。
let setsJobRunning = false;
let setsJobPending: { prev: Root[]; next: Root[] } | null = null;

async function applySetChanges(prev: Root[], next: Root[]) {
  if (setsJobRunning) { setsJobPending = { prev, next }; return; }
  setsJobRunning = true;
  // 先让出事件循环，保证「保存空间」的 HTTP 响应先发出去，再在后台干活。
  await new Promise((resolve) => setImmediate(resolve));
  const t0 = Date.now();
  try {
    const nextUrls = new Set(next.map((r) => r.url));
    const prevUrls = new Set(prev.map((r) => r.url));
    const removed = prev.filter((r) => !nextUrls.has(r.url));
    const added = next.filter((r) => !prevUrls.has(r.url));
    if (!removed.length && !added.length) {
      console.log('sets applied: no index change');
      return;
    }
    for (const r of removed) {
      const n = await removeIndexPrefixInBatches(r.url);
      const v = deleteEmbeddingsByPrefix(r.url);
      console.log(`sets applied: removed ${r.url} (index -${n}, vectors -${v})`);
    }
    let indexed = 0;
    for (const r of added) {
      const files = scanRoot(r.url, r.dir);
      if (files.length) await indexFilesInBatches(files);
      indexed += files.length;
      const embeddable = files.filter((f) => isEmbedEnabled(f.urlPath));
      if (embeddable.length) await embedFiles(embeddable);
      console.log(`sets applied: added ${r.url} (index +${files.length})`);
    }
    if (indexed || removed.length) bumpVersion();
    console.log(`sets applied: +${added.length} dirs/-${removed.length} dirs, ${indexed} docs, ${Date.now() - t0}ms`);
  } catch (e) {
    console.error('sets apply failed:', e);
  } finally {
    setsJobRunning = false;
    const p = setsJobPending;
    setsJobPending = null;
    if (p) void applySetChanges(p.prev, p.next);
  }
}

// 缓存策略：接口实时（no-cache）；带 hash 的构建产物长缓存；第三方库(media) 7 天。
app.addHook('onSend', async (req, reply) => {
  const url = req.raw.url || '';
  if (url.startsWith('/assets/')) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
  else if (url.startsWith('/media/')) reply.header('Cache-Control', 'public, max-age=604800');
  else reply.header('Cache-Control', 'no-cache');
});

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

// 数据版本号：每次重建索引后 +1，供前端轻量轮询判断是否需要刷新。
let dataVersion = 0;
function bumpVersion() { dataVersion++; }

// 启动时同步索引：通常只补停机期间改动的文件（毫秒级），首次/异常时才全量重建。
try {
  const t0 = Date.now();
  const r = syncIndex();
  truncateWal();
  bumpVersion();
  console.log(`index ready (${r.mode}, ${r.changed} changed, ${Date.now() - t0}ms):`, JSON.stringify(indexStats()));
} catch (e) { console.error('index failed:', e); }
// 异步建立语义向量索引（不阻塞启动）
buildEmbeddings().then(() => console.log('embeddings ready')).catch((e) => console.error('embeddings failed:', e.message));

// ---------- 实时索引 + 增量向量 ----------
let reindexTimer: any = null;
let reloadTimer: any = null;
let watcher: any = null;
let setsWatcher: any = null;
let writingSets = false;
let changedPaths = new Set<string>();
let removedDirs = new Set<string>();
// 单次批量变更过大（例如整棵目录被替换/批量导入）时，退回全量重建更稳。
const FULL_REBUILD_THRESHOLD = 500;

function fsPathToUrl(fp: string): string | null {
  return fsPathToUrlPath(fp);
}

async function flushChanges() {
  try {
    const dirsToDrop = [...removedDirs];
    removedDirs.clear();
    const paths = [...changedPaths];
    changedPaths.clear();

    if (dirsToDrop.length) {
      for (const dir of dirsToDrop) {
        const u = fsPathToUrl(dir);
        if (u) removeIndexPrefix(u);
      }
    }

    if (paths.length >= FULL_REBUILD_THRESHOLD) {
      rebuildIndex();
      bumpVersion();
      return;
    }

    const toIndex: MdFile[] = [];
    const toDelete: string[] = [];
    for (const p of paths) {
      if (!/\.(md|markdown)$/i.test(p)) continue;
      const f = toMdFile(p);
      if (f) toIndex.push(f);
      else { const u = fsPathToUrl(p); if (u) toDelete.push(u); }
    }

    // 增量更新：只动变更到的这几个文件，不再全库重建（此前每次变更都会卡 40~60s）。
    if (toIndex.length) indexFiles(toIndex);
    if (toDelete.length) removeIndexPaths(toDelete);
    if (toIndex.length || toDelete.length || dirsToDrop.length) bumpVersion();

    // 向量索引：只补/删这批文件（embed 关闭的 set 会自动跳过）。
    const embedTargets = toIndex.filter((f) => isEmbedEnabled(f.urlPath));
    if (embedTargets.length) await embedFiles(embedTargets);
    if (toDelete.length) deleteEmbeddings(toDelete);

    const parts = [];
    if (toIndex.length) parts.push(`+${toIndex.length}`);
    if (toDelete.length) parts.push(`-${toDelete.length}`);
    if (dirsToDrop.length) parts.push(`dir-${dirsToDrop.length}`);
    console.log('index updated (incremental):', parts.join(' ') || 'noop');
  } catch (e) { console.error('reindex failed:', e); }
}

function onDirChange(event: string, p: string) {
  if (event === 'unlinkDir') removedDirs.add(p);
  else if (event === 'addDir') return; // 目录里的文件各自会发 add 事件
  else changedPaths.add(p);
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(flushChanges, 1500);
}

function setupDirWatcher() {
  if (watcher) { try { watcher.close(); } catch { /* ignore */ } }
  watcher = chokidar.watch(ROOTS.map((r) => r.dir), {
    ignoreInitial: true,
    // 忽略隐藏目录 + 构建产物目录（node_modules 等），避免无意义的索引触发。
    ignored: (p: string) => /(^|[/\\])\./.test(p) || p.split(path.sep).some((seg) => EXCLUDES.includes(seg)),
  });
  watcher.on('all', onDirChange);
}

function setupSetsWatcher() {
  if (setsWatcher) { try { setsWatcher.close(); } catch { /* ignore */ } }
  if (!fs.existsSync(SETS_FILE)) return;
  setsWatcher = chokidar.watch(SETS_FILE, { ignoreInitial: true });
  setsWatcher.on('all', () => {
    if (writingSets) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const before = JSON.stringify(SETS);
      reloadSets();
      const after = JSON.stringify(SETS);
      if (before !== after) {
        setupDirWatcher();
        rebuildIndex();
        bumpVersion();
        buildEmbeddings().catch(() => {});
        console.log('sets reloaded:', JSON.stringify(SETS));
      }
    }, 500);
  });
}

setupDirWatcher();
setupSetsWatcher();

app.listen({ host: '0.0.0.0', port: PORT }).then(() => console.log(`md-server listening on :${PORT}`));
startMcp();
