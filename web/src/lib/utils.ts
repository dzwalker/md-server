import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 去掉 markdown 文件扩展名（foo.md -> foo）
export function stripMdExt(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}

// 相对时间（「最近更新」列表显示新鲜度）。now 可注入，便于测试。
export function relativeTime(ms: number, now: number = Date.now()): string {
  if (!ms) return ''
  const diff = now - ms
  if (diff < 60_000) return '刚刚'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} 分钟前`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

// 已打开文档所在的一级目录（与「已打开的文档」侧栏、⌘O 看板分列口径一致）。
export function topDirOf(path: string): string {
  return path.split('/').filter(Boolean)[0] || ''
}

// 空间 set 的目录条目（下称「作用域」）可以是一级目录名，也可以是挂载根下的子路径，
// 例如 notion-archive/学习成长。侧栏树/笔记/已打开面板都按作用域展示，显示名取最后一段。

/** 作用域条目的路径段（去掉首尾 `/`）。 */
export function scopeSegs(dir: string): string[] {
  return dir.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
}

/** 作用域条目在侧栏显示的名字（如 notion-archive/学习成长 → 学习成长）。 */
export function scopeLabel(dir: string): string {
  const segs = scopeSegs(dir)
  return segs[segs.length - 1] || dir
}

/** urlPath 是否落在某个作用域条目下（与后端 config.inScope 同口径）。 */
export function inScope(path: string, dir: string): boolean {
  const d = dir.replace(/^\/+|\/+$/g, '')
  if (!d) return false
  const p = path.startsWith('/') ? path : `/${path}`
  return p === `/${d}` || p.startsWith(`/${d}/`)
}

/** 命中的第一个作用域条目；没命中返回 null。同一 set 内条目互不包含，因此命中唯一。 */
export function scopeDirOf(path: string, dirs: string[]): string | null {
  return dirs.find((d) => inScope(path, d)) ?? null
}

/** 条目的显示名；同名条目（如两个「学习成长」）用「上一级/名字」区分。 */
export function scopeLabels(dirs: string[]): Map<string, string> {
  const labels = new Map<string, string>()
  const last = dirs.map((d) => scopeLabel(d))
  const count = new Map<string, number>()
  for (const l of last) count.set(l, (count.get(l) || 0) + 1)
  dirs.forEach((d, i) => {
    if ((count.get(last[i]) || 0) > 1) {
      const segs = scopeSegs(d)
      labels.set(d, segs.length > 1 ? segs.slice(-2).join('/') : last[i])
    } else {
      labels.set(d, last[i])
    }
  })
  return labels
}
