import fs from 'node:fs';

/**
 * md 文件落盘的公共底座（唯一直接写用户文件的模块）。
 *
 * 从 `notes.ts` 抽出，供「笔记行」与「整篇正文保存」共用同一套安全边界：
 *   1. 只允许写 .md / .markdown；
 *   2. 临时文件 + rename 原子替换（不留半截文件、不留 .tmp 残留）；
 *   3. **显式保持原文件的属主 / 属组 / 权限位**——容器以 root 跑时，rename 会把
 *      新文件的身份一起换成 root:root，用户的编辑器随即读写被拒；
 *   4. mtime 乐观锁：客户端渲染时看到的 mtime 与磁盘不一致就拒绝写入（409），
 *      绝不静默覆盖别处的改动。
 *
 * 业务错误统一用 `WriteError`（带 HTTP status），路由只做参数解析与错误码映射。
 */
export class WriteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WriteError';
    this.status = status;
  }
}

export interface WriteResult {
  mtimeMs: number;
  size: number;
}

/** 只允许 md 文件被写；文件不存在 404、目标不是文件 400。 */
export function statMdFile(fsPath: string): fs.Stats {
  if (!/\.(md|markdown)$/i.test(fsPath)) throw new WriteError('只允许对 .md 文件写入', 400);
  let st: fs.Stats;
  try {
    st = fs.statSync(fsPath);
  } catch {
    throw new WriteError('文件不存在', 404);
  }
  if (!st.isFile()) throw new WriteError('目标不是文件', 400);
  return st;
}

/**
 * 乐观锁：客户端 mtime 只在显式传入时校验。容差 0.5ms —— 不同文件系统的 mtime
 * 精度不同（ext4 纳秒 / 部分网络盘毫秒），直接相等会误判。
 */
export function checkMtimeLock(before: fs.Stats, expectMtimeMs?: number): void {
  if (typeof expectMtimeMs !== 'number' || !(expectMtimeMs > 0)) return;
  if (Math.abs(before.mtimeMs - expectMtimeMs) > 0.5) {
    throw new WriteError('文件已被外部修改，请刷新后再编辑', 409);
  }
}

/**
 * 原子落盘：写临时文件 → 搬属主/权限 → rename 覆盖目标。
 *
 * `tmpTag` 只用于临时文件名（便于排查是谁留下的临时文件，测试也据此断言无残留）。
 * 失败时清理临时文件，并保留原始错误的可读信息。
 */
export function writeFileAtomic(fsPath: string, content: string, before: fs.Stats, tmpTag = 'mdwrite'): WriteResult {
  const tmp = `${fsPath}.${tmpTag}-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    // 新文件的属主默认是「当前进程」：与源文件不一致时必须显式改回去。
    // 进程身份已经等于源文件属主时（普通用户自托管运行）不必、也无法 chown。
    const sameOwner = currentUid() === before.uid && currentGid() === before.gid;
    if (!sameOwner) {
      try {
        fs.chownSync(tmp, before.uid, before.gid);
      } catch (e) {
        throw new WriteError(
          `无法保持文件属主（当前进程 ${currentUid()}:${currentGid()}，文件 ${before.uid}:${before.gid}）：` +
            `${e instanceof Error ? e.message : String(e)}。拒绝写入以免把文件变成别的属主。`,
          500,
        );
      }
    }
    fs.chmodSync(tmp, before.mode & 0o777);
    fs.renameSync(tmp, fsPath);
  } catch (e) {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (e instanceof WriteError) throw e;
    throw new WriteError(`写入失败：${e instanceof Error ? e.message : String(e)}`, 500);
  }
  const after = fs.statSync(fsPath);
  return { mtimeMs: after.mtimeMs, size: after.size };
}

/** 当前进程的 uid/gid（Windows 上没有这两个 API，返回 -1 表示不参与属主比较）。 */
function currentUid(): number {
  return typeof process.getuid === 'function' ? process.getuid() : -1;
}
function currentGid(): number {
  return typeof process.getgid === 'function' ? process.getgid() : -1;
}
