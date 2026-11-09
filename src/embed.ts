import fs from 'node:fs';
import { createRequire } from 'node:module';
import { scanAll, MdFile } from './scanner.js';
import { isEmbedEnabled } from './config.js';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

// ---------- 向量后端 ----------
// provider=local：Transformers.js 在进程内跑 ONNX（零外部依赖，但会阻塞事件循环，见 specs/... 的历史教训）
// provider=openai：任意 OpenAI 兼容的 /embeddings 端点（本机默认指向内网网关 claude.neolix.ai，
//   模型 text-embedding-v4，与 OpenViking 同一套，见 2026-11-09 决策）
const PROVIDER = (process.env.EMBED_PROVIDER || 'local').toLowerCase();
const BASE_URL = (process.env.EMBED_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.EMBED_API_KEY || '';
const LOCAL_MODEL = process.env.EMBED_MODEL_LOCAL || 'Xenova/multilingual-e5-small';
const REMOTE_MODEL = process.env.EMBED_MODEL || 'text-embedding-v4';
const DIM = Number(process.env.EMBED_DIM || 0);
// 远端网关的单批上限普遍更小（DashScope text-embedding-v4 = 10），默认值按 provider 区分。
const BATCH = Math.max(1, Math.min(Number(process.env.EMBED_BATCH || (PROVIDER === 'openai' ? 10 : 16)), 32));
const DB_PATH = process.env.MD_INDEX_DB || '/data/index/md-index.db';

/** 模型指纹：变了就必须清空重建，否则不同维度/空间的向量会混在一起算相似度。 */
const SIGNATURE = PROVIDER === 'openai' ? `openai|${BASE_URL}|${REMOTE_MODEL}|${DIM || 'auto'}` : `local|${LOCAL_MODEL}`;

let extractor: any = null;
let extractorPromise: Promise<any> | null = null;
async function getExtractor() {
  if (extractor) return extractor;
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const t = await import('@huggingface/transformers');
      extractor = await t.pipeline('feature-extraction', LOCAL_MODEL);
      console.log('embed model loaded:', LOCAL_MODEL);
      return extractor;
    })();
  }
  return extractorPromise;
}

function tensorToMatrix(out: any, n: number): number[][] {
  const dims = out.dims;
  const dim = dims[dims.length - 1];
  const flat = Array.from(out.data as Float32Array);
  const rows: number[][] = [];
  for (let i = 0; i < n; i++) rows.push(flat.slice(i * dim, (i + 1) * dim));
  return rows;
}

async function embedRemote(texts: string[], kind: 'passage' | 'query'): Promise<number[][]> {
  if (!BASE_URL) throw new Error('EMBED_BASE_URL 未配置');
  // 注意：网关（litellm）对 text-embedding 系列拒绝 dimensions 参数，维度只能取端点默认值；
  // EMBED_DIM 只作「期望值」校验用（不符直接报错，避免不同维度的向量混进同一张表）。
  const body: Record<string, unknown> = { model: REMOTE_MODEL, input: texts, encoding_format: 'float' };
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j: any = await res.json();
      const rows = (j.data || []).map((d: any) => d.embedding as number[]);
      if (rows.length !== texts.length) throw new Error(`返回条数不符 ${rows.length}/${texts.length}`);
      if (DIM && rows[0] && rows[0].length !== DIM) {
        throw new Error(`维度不符：期望 ${DIM}，实际 ${rows[0].length}（改 EMBED_DIM 或换模型后需重建）`);
      }
      return rows;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// e5 系列要求 query:/passage: 前缀；远端 OpenAI 兼容模型不需要（加了反而掉分）。
async function embedBatch(texts: string[]): Promise<number[][]> {
  if (PROVIDER === 'openai') return embedRemote(texts, 'passage');
  const ex = await getExtractor();
  const out = await ex(texts.map((t) => 'passage: ' + t), { pooling: 'mean', normalize: true });
  return tensorToMatrix(out, texts.length);
}

async function embedQuery(text: string): Promise<number[]> {
  if (PROVIDER === 'openai') {
    const rows = await embedRemote([text], 'query');
    return rows[0] || [];
  }
  const ex = await getExtractor();
  const out = await ex('query: ' + text, { pooling: 'mean', normalize: true });
  return Array.from(out.data as Float32Array);
}

// ---------- 向量存取（Float32 BLOB；兼容旧的 JSON 文本行） ----------
function packVector(v: number[]): Buffer {
  return Buffer.from(new Float32Array(v).buffer);
}
function unpackVector(v: any): number[] {
  if (v == null) return [];
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return []; }
  }
  const buf: Buffer = Buffer.isBuffer(v) ? v : Buffer.from(v);
  const f = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < f.length; i++) f[i] = buf.readFloatLE(i * 4);
  return Array.from(f);
}
function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}
function norm(a: number[]): number[] { const l = Math.sqrt(dot(a, a)) || 1; return a.map((x) => x / l); }

function fileText(f: MdFile): string {
  try { return (f.title || '') + '\n' + fs.readFileSync(f.fsPath, 'utf8').slice(0, 3000); }
  catch { return f.title || f.urlPath; }
}

function ensureTable(d: any) {
  d.exec('CREATE TABLE IF NOT EXISTS embeddings (path TEXT PRIMARY KEY, vector BLOB, mtime_ms INTEGER, sig TEXT)');
  d.exec('CREATE TABLE IF NOT EXISTS embed_meta (key TEXT PRIMARY KEY, value TEXT)');
  const cols = (d.prepare('PRAGMA table_info(embeddings)').all() as any[]).map((c) => c.name);
  if (!cols.includes('mtime_ms')) d.exec('ALTER TABLE embeddings ADD COLUMN mtime_ms INTEGER');
  if (!cols.includes('sig')) d.exec('ALTER TABLE embeddings ADD COLUMN sig TEXT');
}

function getSig(d: any): string | null {
  const r = d.prepare("SELECT value FROM embed_meta WHERE key='signature'").get() as any;
  return r?.value ?? null;
}
function setSig(d: any, sig: string) {
  d.prepare("INSERT INTO embed_meta(key,value) VALUES('signature',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(sig);
}

/** 模型指纹变了：整个向量表作废（维度/语义空间都不可混用）。 */
function ensureSignature(d: any): boolean {
  const cur = getSig(d);
  if (cur === SIGNATURE) return false;
  d.prepare('DELETE FROM embeddings').run();
  setSig(d, SIGNATURE);
  console.log(`embed signature changed: ${cur || '(none)'} -> ${SIGNATURE}，已清空旧向量`);
  return true;
}

export function embeddingsStatus() {
  const d = new Database(DB_PATH);
  ensureTable(d);
  const built = (d.prepare('SELECT COUNT(*) c FROM embeddings').get() as any).c;
  const sig = getSig(d);
  d.close();
  const embedTotal = scanAll().filter((f) => isEmbedEnabled(f.urlPath)).length;
  return { built, total: embedTotal, provider: PROVIDER, model: PROVIDER === 'openai' ? REMOTE_MODEL : LOCAL_MODEL, dim: DIM || null, signature: SIGNATURE, stale: sig !== SIGNATURE };
}

// 全量（重）建向量索引：只索引「参与语义索引」的 set 的文件，并清掉其余文件的旧向量。
// incremental=true 时跳过 mtime 未变的文件（服务重启不重算）。
export async function buildEmbeddings(opts: { force?: boolean } = {}) {
  const d = new Database(DB_PATH);
  ensureTable(d);
  const wiped = ensureSignature(d);
  const files = scanAll().filter((f) => isEmbedEnabled(f.urlPath));
  const keep = new Set(files.map((f) => f.urlPath));
  const existing = d.prepare('SELECT path, mtime_ms FROM embeddings').all() as { path: string; mtime_ms: number }[];
  const stalePaths = existing.filter((r) => !keep.has(r.path)).map((r) => r.path);
  const fresh = new Map(existing.map((r) => [r.path, r.mtime_ms]));
  d.close();
  if (stalePaths.length) deleteEmbeddings(stalePaths);
  const todo = opts.force || wiped ? files : files.filter((f) => fresh.get(f.urlPath) !== f.mtimeMs);
  await embedFiles(todo);
  return { total: files.length, embedded: todo.length, wiped };
}

// 增量：仅对给定文件（重）嵌入，缺失则补。
export async function embedFiles(files: MdFile[]) {
  if (!files.length) return;
  const d = new Database(DB_PATH);
  ensureTable(d);
  ensureSignature(d);
  const ins = d.prepare('INSERT OR REPLACE INTO embeddings(path, vector, mtime_ms, sig) VALUES(?,?,?,?)');
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    const texts = chunk.map(fileText);
    let embs: number[][] = [];
    try {
      embs = await embedBatch(texts);
    } catch (e: any) {
      console.error(`embed batch failed (${i}-${i + chunk.length}):`, e?.message || e);
      continue;
    }
    const tx = d.transaction(() => {
      chunk.forEach((f, k) => { if (embs[k]) ins.run(f.urlPath, packVector(embs[k]), f.mtimeMs, SIGNATURE); });
    });
    tx();
  }
  d.close();
}

// 删除不再存在的文件的向量
export function deleteEmbeddings(paths: string[]) {
  if (!paths.length) return;
  const d = new Database(DB_PATH);
  ensureTable(d);
  const del = d.prepare('DELETE FROM embeddings WHERE path=?');
  const tx = d.transaction(() => paths.forEach((p) => del.run(p)));
  tx();
  d.close();
}

// 按 url 前缀删除向量（某空间/目录被移除时用）
export function deleteEmbeddingsByPrefix(urlPrefix: string) {
  const d = new Database(DB_PATH);
  ensureTable(d);
  const like = urlPrefix.replace(/\/+$/, '') + '/%';
  const info = d.prepare('DELETE FROM embeddings WHERE path LIKE ?').run(like);
  d.close();
  return info.changes;
}

export async function semanticSearch(q: string, limit = 10) {
  const d = new Database(DB_PATH);
  ensureTable(d);
  const sig = getSig(d);
  if (sig !== SIGNATURE) { d.close(); return []; } // 指纹不符时不要给出跨模型的假相似度
  if ((d.prepare('SELECT COUNT(*) c FROM embeddings').get() as any).c === 0) { d.close(); return []; }
  let qv: number[] = [];
  try { qv = await embedQuery(q); } catch (e: any) {
    console.error('embed query failed:', e?.message || e);
    d.close();
    return [];
  }
  if (!qv || qv.length === 0) { d.close(); return []; }
  const qn = norm(qv);
  const rows = d.prepare('SELECT path, vector FROM embeddings').all() as { path: string; vector: any }[];
  const scored = rows
    .map((r) => ({ path: r.path, score: dot(qn, norm(unpackVector(r.vector))) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  const getF = d.prepare('SELECT title FROM files WHERE path=?');
  const res = scored.map((s) => {
    const t = getF.get(s.path) as any;
    return { path: s.path, title: (t && t.title) || s.path, score: Math.round(s.score * 1000) / 1000 };
  });
  d.close();
  return res;
}
