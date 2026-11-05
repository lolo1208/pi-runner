/** 根据服务域名生成简短连接名称；本机地址和 IP 保留主机名。 */
export function compatibleConnectionName(baseUrl: string): string {
  try {
    const host = new URL(baseUrl.trim()).hostname.replace(/\.$/, '')
    if (host === 'localhost' || host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) return host
    const parts = host.split('.')
    // 常见二级国家域名，例如 example.com.cn、example.co.uk。
    const countrySuffix = parts.length >= 3 && parts.at(-1)!.length === 2 && ['com', 'co', 'net', 'org', 'ac', 'gov'].includes(parts.at(-2)!)
    return (parts.at(countrySuffix ? -3 : -2) ?? host).slice(0, 80)
  } catch { return '' }
}
