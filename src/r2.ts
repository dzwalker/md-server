import { randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { WriteError } from './file-write.js';

/**
 * Cloudflare R2 图片存储（S3 兼容 API）。
 *
 * 分工：
 * - 上传（写）走 `POST /api/asset/upload` → 本模块 `uploadImageToR2`；
 * - 读取（读）走 `GET /api/asset/r2/*` → 本模块 `getR2Object`，
 *   **桶保持私有**，图片与笔记共用同一道登录门（见 specs/doc-editing/）。
 *
 * 配置全部来自环境变量（`.env`，仓库已 gitignore；容器里由 compose `env_file` 注入）：
 *   R2_ENDPOINT            默认本账号 endpoint
 *   R2_BUCKET              默认 pics
 *   R2_ACCESS_KEY_ID       —— 由用户在 .env 里填，代码不打印
 *   R2_SECRET_ACCESS_KEY   —— 同上
 *   R2_PREFIX              对象前缀，默认 md（key 形如 md/2026/11/<uuid>.png）
 *   R2_PUBLIC_BASE_URL     可选；设了就让 markdown 写绝对 URL（需要公网可访问），
 *                          不设则写站内代理路径 /api/asset/r2/<key>
 */
export const DEFAULT_R2_ENDPOINT = 'https://e26bfa01ae45cfe2797c1565437d3442.r2.cloudflarestorage.com';
export const DEFAULT_R2_BUCKET = 'pics';
export const DEFAULT_R2_PREFIX = 'md';

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  prefix: string;
  /** 可选：公开基址（不带结尾斜杠）。为空表示走站内代理。 */
  publicBaseUrl: string;
}

/** 从环境变量解析配置；缺少凭证时返回 null（= 未启用，回落本地上传）。 */
export function r2ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): R2Config | null {
  const accessKeyId = String(env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY || '').trim();
  if (!accessKeyId || !secretAccessKey) return null;
  return {
    endpoint: String(env.R2_ENDPOINT || DEFAULT_R2_ENDPOINT).replace(/\/+$/, ''),
    bucket: String(env.R2_BUCKET || DEFAULT_R2_BUCKET).trim(),
    accessKeyId,
    secretAccessKey,
    prefix: String(env.R2_PREFIX || DEFAULT_R2_PREFIX).replace(/^\/+|\/+$/g, '') || DEFAULT_R2_PREFIX,
    publicBaseUrl: String(env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, ''),
  };
}

/** R2 是否已配置（没有凭证就当没启用）。 */
export function isR2Configured(env: NodeJS.ProcessEnv = process.env): boolean {
  return r2ConfigFromEnv(env) !== null;
}

let cachedClient: { key: string; client: S3Client } | null = null;

function clientFor(cfg: R2Config): S3Client {
  const cacheKey = `${cfg.endpoint}|${cfg.accessKeyId}`;
  if (cachedClient && cachedClient.key === cacheKey) return cachedClient.client;
  const client = new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  cachedClient = { key: cacheKey, client };
  return client;
}

/** 测试用：清掉缓存的 client（改了 env 之后要重置）。 */
export function resetR2ClientCache(): void {
  cachedClient = null;
}

/** 生成对象 key：`md/2026/11/<uuid>.png`（日期分段，便于以后做生命周期规则）。 */
export function buildImageKey(prefix: string, ext: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const safeExt = /^\.[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : '.png';
  return `${prefix}/${y}/${m}/${randomUUID()}${safeExt}`;
}

/** 站内代理 key 的合法性：必须在配置的前缀下，且不含 `..`、不以 `/` 开头。 */
export function isSafeR2Key(key: string, prefix = DEFAULT_R2_PREFIX): boolean {
  if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) return false;
  return key.startsWith(prefix + '/');
}

function publicUrlFor(cfg: R2Config, key: string): string {
  return cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/${key}` : `/api/asset/r2/${key}`;
}

export interface R2UploadResult {
  key: string;
  /** 写进 markdown 的地址：默认站内 `/api/asset/r2/<key>`，配了公开基址则是绝对 URL。 */
  url: string;
}

/** 上传一张图片到 R2（私有桶 + 长缓存；key 唯一所以可以 immutable）。 */
export async function uploadImageToR2(
  cfg: R2Config,
  data: Buffer,
  contentType: string,
  ext: string,
): Promise<R2UploadResult> {
  const key = buildImageKey(cfg.prefix, ext);
  try {
    await clientFor(cfg).send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } catch (e) {
    throw new WriteError(`R2 上传失败：${e instanceof Error ? e.message : String(e)}`, 502);
  }
  return { key, url: publicUrlFor(cfg, key) };
}

export interface R2ObjectResult {
  body: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
}

/** 从 R2 取一个对象（代理读）；不存在时抛 404。 */
export async function getR2Object(cfg: R2Config, key: string): Promise<R2ObjectResult> {
  try {
    const out = await clientFor(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    if (!out.Body) throw new WriteError('R2 返回空对象', 502);
    return {
      body: out.Body as unknown as NodeJS.ReadableStream,
      contentType: out.ContentType,
      contentLength: typeof out.ContentLength === 'number' ? out.ContentLength : undefined,
    };
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (status === 404) throw new WriteError('图片不存在', 404);
    if (e instanceof WriteError) throw e;
    throw new WriteError(`R2 读取失败：${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
