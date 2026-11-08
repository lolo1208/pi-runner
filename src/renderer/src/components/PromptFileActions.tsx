import { Button } from '@/components/ui/button'

export function PromptFileActions({ error, reload, retry, overwrite }: { error: string; reload(): Promise<unknown>; retry(): Promise<unknown>; overwrite(): Promise<unknown> }): React.JSX.Element | null {
  if (!error) return null
  const run = (action: () => Promise<unknown>): void => { void action().catch(() => {}) }
  return <div role="alert"><p className="error">{error}</p><div className="flex gap-2">
    <Button variant="outline" onClick={() => run(reload)}>重新加载（丢弃草稿）</Button>
    <Button variant="outline" onClick={() => run(retry)}>重试保存</Button>
    <Button variant="outline" onClick={() => { if (window.confirm('确认用当前草稿覆盖磁盘中的提示词？')) run(overwrite) }}>确认覆盖</Button>
  </div></div>
}
