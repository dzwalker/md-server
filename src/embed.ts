import { createRequire } from 'node:module';
import fs from 'node:fs';
import { scanAll, MdFile } from './scanner.js';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const MODEL = process.env.EMBED_MODEL || 'Xenova/multilingual-e5-small';
const DB_PATH = process.env.MD_INDEX_DB || '/data/index/md-index.db';

let extractor: any = null;
let extractorPromise: Promise<any> | null = null;
async function getExtractor() {
  if (extractor) return extractor;
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const t = await import('@huggingface/transformers');
      extractor = await t.pipeline('feature-extraction', MODEL);
      console.log('embed model loaded:', MODEL);
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

async function embedBatch(texts: string[]): Promise<number[][]> {
  const ex = await getExtractor();
  const out = await ex(texts.map((t) => 'passage: ' + t), { pooling: 'mean', normalize: true });
  return tensorToMatrix(out, texts.length);
}

async function embedQuery(text: string): Promise<number[]> {
  const ex = await getExtractor();
  const out = await ex('query: ' + text, { pooling: 'mean', normalize: true });
  return Array.from(out.data as Float32Array);
}

function dot(a: number[], b: number[]): number { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function norm(a: number[]): number[] { const l = Math.sqrt(dot(a, a)) || 1; return a.map((x) => x / l); }

function fileText(f: MdFile): string {
  try { return (f.title || '') + '\n' + fs.readFileSync(f.fsPath, 'utf8').slice(0, 3000); }
  catch { return f.title || f.urlPath; }
}

export function embeddingsStatus() {
  const d = new Database(DB_PATH);
  const exists = (d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='embeddings'").get() as any).c;
  const built = exists ? (d.prepare('SELECT COUNT(*) c FROM embeddings').get() as any).c : 0;
  d.close();
  return { built, total: scanAll().length, model: MODEL };
}

function ensureTable(d: any) {
  d.exec('CREATE TABLE IF NOT EXISTS embeddings (path TEXT PRIMARY KEY, vector TEXT)');
}

// 全量（重）建向量索引
export async function buildEmbeddings() {
  const d = new Database(DB_PATH);
  ensureTable(d);
  d.close();
  const files = scanAll();
  await embedFiles(files);
  return files.length;
}

// 增量：仅对给定文件（重）嵌入，缺失则补
export async function embedFiles(files: MdFile[]) {
  if (!files.length) return;
  const d = new Database(DB_PATH);
  ensureTable(d);
  const ins = d.prepare('INSERT OR REPLACE INTO embeddings(path, vector) VALUES(?,?)');
  const BATCH = 16;
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    const texts = chunk.map(fileText);
    const embs = await embedBatch(texts);
    const tx = d.transaction(() => { chunk.forEach((f, k) => { if (embs[k]) ins.run(f.urlPath, JSON.stringify(embs[k])); }); });
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

export async function semanticSearch(q: string, limit = 10) {
  const d = new Database(DB_PATH);
  const exists = (d.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='embeddings'").get() as any).c;
  if (!exists) return [];
  if ((d.prepare('SELECT COUNT(*) c FROM embeddings').get() as any).c === 0) return [];
  const qv = await embedQuery(q);
  if (!qv || qv.length === 0) return [];
  const qn = norm(qv);
  const rows = d.prepare('SELECT path, vector FROM embeddings').all();
  const scored = rows
    .map((r: any) => ({ path: r.path, score: dot(qn, norm(JSON.parse(r.vector))) }))
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, limit);
  const getF = d.prepare('SELECT title FROM files WHERE path=?');
  const res = scored.map((s: any) => {
    const t = getF.get(s.path) as any;
    return { path: s.path, title: (t && t.title) || s.path, score: Math.round(s.score * 1000) / 1000 };
  });
  d.close();
  return res;
}
