import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// 去掉 markdown 文件扩展名（foo.md -> foo）
export function stripMdExt(name: string): string {
  return name.replace(/\.(md|markdown)$/i, '')
}
