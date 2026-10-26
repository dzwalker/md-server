import fs from 'node:fs';
import { createRequire } from 'node:module';
import { SETS } from './config.js';
import { listFileSummaries } from './index-db.js';
import { resolveUrlPath } from './scanner.js';

const require = createRequire(import.meta.url);
const matter = require('gray-matter');

/**
 * 术语表（见 specs/glossary/spec.md）。
 *
 * 约定：文件名包含「术语表」或「glossary」（不区分大小写）的 md 文件是术语表；
 * 文件里 `## 术语名` 开一个术语块，`别名：…` 声明其它名字，其余行是定义正文。
 *
 * 这里只做「读 + 解析 + 聚合 + 匹配器」，不写任何文件，也不碰索引表。
 */

/** 一个术语块（来自某个术语表文件）。 */
export interface ParsedGlossaryTerm {
  /** 主名称：`##` 标题文本（已去掉行内 markdown）。 */
  name: string;
  /** 其它名字（别名），不含主名称。 */
  aliases: string[];
  /** 定义正文：Markdown 原文（多段保留）。 */
  definition: string;
  /** 术语表文件 urlPath，如 `/neolix-mgmt/术语表.md`。 */
  sourcePath: string;
}

/** 一条定义：浮层里单独一块。 */
export interface GlossaryDef {
  /** 文件名（浮层标注来源用）。 */
  source: string;
  /** 来源 urlPath（以后可做跳转）。 */
  sourcePath: string;
  /** 定义 Markdown 原文。 */
  raw: string;
}

/** 某个名字背后的术语信息（主名称 + 别名 + 多条定义）。 */
export interface GlossaryNameEntry {
  /** 展示用主名称（第一次命中该名字时所属术语的主名称）。 */
  display: string;
  /** 该名字涉及的所有名字（主名称 + 别名），去重并保持首次出现顺序。 */
  names: string[];
  /** 定义：按术语表文件路径字典序 + 文件内顺序，已按定义原文去重。 */
  defs: GlossaryDef[];
}

/** 一个空间作用域下聚合好的术语索引。 */
export interface GlossaryIndex {
  /** 术语表文件集合签名（目录 + 每个文件 mtime），用于判断是否需要重渲染。 */
  version: string;
  /** 规范化名字 → 术语信息。 */
  names: Map<string, GlossaryNameEntry>;
  /** 所有名字合并成的匹配器：长词优先、英文全词边界，带 `g` / `i`。 */
  matcher: RegExp;
}

/** 术语表文件判定：basename（去扩展名）包含「术语表」或「glossary」。 */
const GLOSSARY_FILE_RE = /(术语表|glossary)/i;

export function isGlossaryFileName(name: string): boolean {
  if (!/\.(md|markdown)$/i.test(name)) return false; // 只对 md 文档生效
  return GLOSSARY_FILE_RE.test(name.replace(/\.(md|markdown)$/i, ''));
}

/**
 * 名字的规范化键：trim、压缩空白、英文小写。
 * 匹配到的文本与索引键都用它对齐（英文大小写不敏感；中文原样）。
 */
export function normalizeGlossaryName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---------- 解析 ----------

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const ALIAS_RE = /^(?:\*\*|__)?\s*(?:别名|又名|alias(?:es)?)\s*(?:\*\*|__)?\s*[：:]\s*(.+)$/i;
// 别名分隔符：顿号/中文逗号/英文逗号/分号/竖线；`/` 只有两侧带空格时才当分隔符，
// 否则 `TCP/IP` 这类别名会被拆成两个过于宽泛的词。
const ALIAS_SEPARATOR_RE = /[、，,;；|]|\s+\/\s+/;

/** 去掉名字里的行内 markdown（链接/反引号/加粗/删除线/HTML 标签），得到可匹配的纯文本。 */
function cleanTermName(raw: string): string {
  return raw
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|~~|\*)([^*_~]*?)\1/g, '$2')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function splitAliases(raw: string): string[] {
  return raw
    .replace(/\*\*|__/g, '')
    .split(ALIAS_SEPARATOR_RE)
    .map((s) => cleanTermName(s))
    .filter(Boolean);
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  return lines.slice(start, end);
}

/**
 * 解析术语表 Markdown → 术语块列表（纯函数，便于单测）。
 *
 * 规则：
 * - frontmatter 先剥掉；代码围栏内的 `##` / `别名:` 不当结构；
 * - `#` 一级标题结束当前术语块；`##` 开启新术语块；`###+` 算定义正文；
 * - 别名行可多行，分隔符 `、，,;；/|`；
 * - 没有定义正文的术语块直接丢弃（避免出现「有下划线但浮层是空的」）。
 */
export function parseGlossaryMarkdown(content: string, sourcePath: string): ParsedGlossaryTerm[] {
  let body = content;
  try {
    body = matter(content).content;
  } catch {
    /* frontmatter 解析失败：按原文继续 */
  }

  const out: ParsedGlossaryTerm[] = [];
  let current: { name: string; aliases: string[]; def: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    const definition = trimBlankLines(current.def).join('\n').trim();
    const name = current.name;
    const aliases = dedupeNames(current.aliases.filter((a) => normalizeGlossaryName(a) !== normalizeGlossaryName(name)));
    if (name && definition) out.push({ name, aliases, definition, sourcePath });
    current = null;
  };

  for (const line of body.split(/\r?\n/)) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      if (current) current.def.push(line);
      continue;
    }
    if (inFence) {
      if (current) current.def.push(line);
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (level === 2) {
        flush();
        const name = cleanTermName(heading[2]);
        if (name) current = { name, aliases: [], def: [] };
      } else if (level === 1) {
        flush();
      } else if (current) {
        current.def.push(line); // ### 及以下属于定义正文
      }
      continue;
    }

    if (!current) continue;
    const alias = ALIAS_RE.exec(line);
    if (alias) {
      current.aliases.push(...splitAliases(alias[1]));
      continue;
    }
    current.def.push(line);
  }
  flush();
  return out;
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = normalizeGlossaryName(n);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

// ---------- 聚合 + 匹配器 ----------

const ASCII_WORD_RE = /[A-Za-z0-9_]/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 一个名字的正则片段。
 *
 * 英文全词：仅当首/尾字符是 ASCII 字母/数字/下划线时才加 lookaround。
 * 中文（或中英混合以中文结尾）不加边界 —— 中文本来就是子串匹配，且
 * `CLIP模型` 后面跟 `2` 仍应命中整段（尾字符是中文，不要求右边界）。
 */
function namePattern(name: string): string {
  const chars = Array.from(name);
  const first = chars[0] || '';
  const last = chars[chars.length - 1] || '';
  const pre = ASCII_WORD_RE.test(first) ? '(?<![A-Za-z0-9_])' : '';
  const post = ASCII_WORD_RE.test(last) ? '(?![A-Za-z0-9_])' : '';
  return pre + escapeRegExp(name) + post;
}

/**
 * 所有名字合并成一个正则：alternatives 按字符数从长到短，同长度按字典序固定。
 *
 * JS 正则在同一位置按 alternation 顺序尝试、命中即返回，所以「同起点长词优先」
 * 由排序保证：`CLIP模型` 先于 `CLIP` 尝试；长词因空格/标点不匹配时自动回退到短词。
 * 跨起点的重叠是「左优先」（一边扫描一边消费文本），见 spec。
 */
export function buildMatcher(rawNames: string[]): RegExp {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of rawNames) {
    const name = raw.trim();
    if (!name) continue;
    const key = normalizeGlossaryName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  names.sort((a, b) => Array.from(b).length - Array.from(a).length || (a < b ? 1 : -1));
  if (!names.length) return /(?!x)x/g; // 永不命中
  return new RegExp(names.map(namePattern).join('|'), 'gi');
}

/** 纯函数：把若干术语表文件聚合成可渲染的术语索引（版本号由调用方给）。 */
export function buildGlossaryIndex(
  files: { sourcePath: string; terms: ParsedGlossaryTerm[] }[],
  version = '',
): GlossaryIndex {
  const names = new Map<string, GlossaryNameEntry>();
  const allNames: string[] = [];

  for (const file of files) {
    for (const term of file.terms) {
      const termNames = dedupeNames([term.name, ...term.aliases]);
      if (!termNames.length) continue;
      const def: GlossaryDef = {
        source: file.sourcePath.split('/').pop() || file.sourcePath,
        sourcePath: file.sourcePath,
        raw: term.definition,
      };
      for (const name of termNames) {
        const key = normalizeGlossaryName(name);
        if (!key) continue;
        let entry = names.get(key);
        if (!entry) {
          entry = { display: term.name, names: [], defs: [] };
          names.set(key, entry);
          allNames.push(name);
        }
        for (const n of termNames) {
          if (!entry.names.some((existing) => normalizeGlossaryName(existing) === normalizeGlossaryName(n))) {
            entry.names.push(n);
          }
        }
        // 同一术语表里重复出现同名块也算「多次定义」，但完全相同正文去重。
        if (!entry.defs.some((d) => d.raw.trim() === def.raw.trim())) entry.defs.push(def);
      }
    }
  }

  return { version, names, matcher: buildMatcher(allNames) };
}

// ---------- 空间作用域 / 缓存 / 版本 ----------

function stripDir(dir: string): string {
  return dir.replace(/^\/+|\/+$/g, '');
}

/** 文档一级目录 → 包含它的所有 set 的目录并集（排序，保证索引键稳定）。 */
export function spaceDirsForPath(urlPath: string, sets: { dirs: string[] }[] = SETS): string[] {
  const top = urlPath.split('/').filter(Boolean)[0] || '';
  if (!top) return [];
  const dirs = new Set<string>();
  for (const set of sets) {
    if (!set.dirs.some((d) => stripDir(d) === top)) continue;
    for (const d of set.dirs) {
      const dir = stripDir(d);
      if (dir) dirs.add(dir);
    }
  }
  return [...dirs].sort();
}

interface GlossaryFileRef {
  urlPath: string;
  mtimeMs: number;
}

function glossaryFilesFor(urlPath: string): { dirs: string[]; files: GlossaryFileRef[] } {
  const dirs = spaceDirsForPath(urlPath);
  if (!dirs.length) return { dirs, files: [] };
  const dirSet = new Set(dirs);
  const files: GlossaryFileRef[] = [];
  for (const summary of listFileSummaries()) {
    const top = summary.urlPath.split('/').filter(Boolean)[0] || '';
    if (!dirSet.has(top) || !isGlossaryFileName(summary.name)) continue;
    const fsPath = resolveUrlPath(summary.urlPath);
    if (!fsPath) continue;
    try {
      const st = fs.statSync(fsPath);
      if (!st.isFile()) continue;
      files.push({ urlPath: summary.urlPath, mtimeMs: st.mtimeMs });
    } catch {
      /* 文件刚被删/不可读：这次不生效 */
    }
  }
  files.sort((a, b) => a.urlPath.localeCompare(b.urlPath));
  return { dirs, files };
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

const EMPTY_INDEX: GlossaryIndex = { version: '', names: new Map(), matcher: buildMatcher([]) };

/** 单文件解析缓存：mtime 没变就不重新解析。 */
const parseCache = new Map<string, { mtimeMs: number; terms: ParsedGlossaryTerm[] }>();

function loadGlossaryFile(file: GlossaryFileRef): ParsedGlossaryTerm[] {
  const cached = parseCache.get(file.urlPath);
  if (cached && cached.mtimeMs === file.mtimeMs) return cached.terms;
  const fsPath = resolveUrlPath(file.urlPath);
  if (!fsPath) return [];
  let content: string;
  try {
    content = fs.readFileSync(fsPath, 'utf8');
  } catch {
    return [];
  }
  const terms = parseGlossaryMarkdown(content, file.urlPath);
  if (parseCache.size > 500) parseCache.clear();
  parseCache.set(file.urlPath, { mtimeMs: file.mtimeMs, terms });
  return terms;
}

/** 聚合索引缓存：按空间签名 + 术语表集合版本缓存（LRU 24）。 */
const indexCache = new Map<string, GlossaryIndex>();
const INDEX_CACHE_MAX = 24;

/**
 * 某文档所在空间的术语表版本号：目录集合 + 每张术语表的 mtime。
 *
 * 必须与 glossaryForDoc 返回索引的 version 完全一致（无术语表时都是空串），
 * 否则 `/api/stat` 与 `/api/render` 对不上，前端会每 5s 误判成「术语表变了」而重复拉正文。
 */
export function glossaryVersionForDoc(urlPath: string): string {
  const { dirs, files } = glossaryFilesFor(urlPath);
  if (!dirs.length || !files.length) return '';
  return hashString(dirs.join(',') + '|' + files.map((f) => f.urlPath + ':' + f.mtimeMs).join('|'));
}

/** 某文档所在空间聚合后的术语索引（无术语表时返回空索引）。 */
export function glossaryForDoc(urlPath: string): GlossaryIndex {
  const { dirs, files } = glossaryFilesFor(urlPath);
  if (!dirs.length || !files.length) return EMPTY_INDEX;
  const version = hashString(dirs.join(',') + '|' + files.map((f) => f.urlPath + ':' + f.mtimeMs).join('|'));
  const cached = indexCache.get(version);
  if (cached) return cached;
  const index = buildGlossaryIndex(
    files.map((f) => ({ sourcePath: f.urlPath, terms: loadGlossaryFile(f) })),
    version,
  );
  indexCache.set(version, index);
  if (indexCache.size > INDEX_CACHE_MAX) {
    const oldest = indexCache.keys().next().value;
    if (oldest !== undefined) indexCache.delete(oldest);
  }
  return index;
}
