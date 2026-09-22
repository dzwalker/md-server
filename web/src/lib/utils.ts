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
