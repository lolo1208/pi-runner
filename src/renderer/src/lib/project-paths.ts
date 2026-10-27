/** 忽略大小写与末尾分隔符的项目路径比较。 */
export function sameProjectPath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() === right.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
}
