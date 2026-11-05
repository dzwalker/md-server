import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildImageKey, isR2Configured, isSafeR2Key, r2ConfigFromEnv, resetR2ClientCache } from './r2.js';

const baseEnv = { ...process.env };
afterEach(() => {
  process.env = { ...baseEnv };
  resetR2ClientCache();
  vi.restoreAllMocks();
});

describe('R2 配置解析', () => {
  it('没有凭证 = 未启用（回落本地上传）', () => {
    const env = { ...process.env };
    delete env.R2_ACCESS_KEY_ID;
    delete env.R2_SECRET_ACCESS_KEY;
    expect(r2ConfigFromEnv(env)).toBeNull();
    expect(isR2Configured(env)).toBe(false);
  });

  it('有凭证时用默认 endpoint / bucket / 前缀', () => {
    const cfg = r2ConfigFromEnv({ R2_ACCESS_KEY_ID: 'a', R2_SECRET_ACCESS_KEY: 'b' } as NodeJS.ProcessEnv)!;
    expect(cfg.endpoint).toContain('r2.cloudflarestorage.com');
    expect(cfg.bucket).toBe('pics');
    expect(cfg.prefix).toBe('md');
    expect(cfg.publicBaseUrl).toBe('');
  });

  it('去掉基址结尾斜杠、前缀首尾斜杠', () => {
    const cfg = r2ConfigFromEnv({
      R2_ACCESS_KEY_ID: 'a',
      R2_SECRET_ACCESS_KEY: 'b',
      R2_PUBLIC_BASE_URL: 'https://pics.zwalker.me/',
      R2_PREFIX: '/notes/',
      R2_BUCKET: 'pics',
    } as NodeJS.ProcessEnv)!;
    expect(cfg.publicBaseUrl).toBe('https://pics.zwalker.me');
    expect(cfg.prefix).toBe('notes');
  });
});

describe('对象 key 生成', () => {
  it('md/<年>/<月>/<uuid>.<ext>，扩展名归一化', () => {
    const key = buildImageKey('md', '.PNG', new Date('2026-11-05T03:00:00Z'));
    expect(key).toMatch(/^md\/2026\/11\/[0-9a-f-]{36}\.png$/);
  });

  it('非法扩展名兜底成 .png', () => {
    expect(buildImageKey('md', '../x')).toMatch(/\.png$/);
  });
});

describe('代理 key 白名单', () => {
  it('只接受前缀下的路径，拒绝穿越/绝对路径', () => {
    expect(isSafeR2Key('md/2026/11/a.png', 'md')).toBe(true);
    expect(isSafeR2Key('other/2026/a.png', 'md')).toBe(false);
    expect(isSafeR2Key('/md/a.png', 'md')).toBe(false);
    expect(isSafeR2Key('md/../../etc/passwd', 'md')).toBe(false);
    expect(isSafeR2Key('md\\a.png', 'md')).toBe(false);
    expect(isSafeR2Key('', 'md')).toBe(false);
  });
});
