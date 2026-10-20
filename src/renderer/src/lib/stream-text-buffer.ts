/** 后台会话只累计文本；可见会话每 50 毫秒发布一次，避免逐字渲染 Markdown。 */
export class StreamTextBuffer {
  private text = ''
  private chunks: string[] = []
  private timer?: ReturnType<typeof setTimeout>
  private visible: boolean
  constructor(private readonly publish: (text: string) => void, visible: boolean) { this.visible = visible }

  append(text: string, reset = false): void {
    if (reset) { this.cancel(); this.text = ''; this.chunks = [] }
    this.chunks.push(text)
    if (this.visible && this.timer === undefined) this.timer = setTimeout(() => this.flush(), 50)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    if (visible) this.flush()
    else this.cancel()
  }

  clear(): void {
    this.cancel()
    this.text = ''
    this.chunks = []
    this.publish('')
  }

  cancel(): void { clearTimeout(this.timer); this.timer = undefined }

  private flush(): void {
    this.cancel()
    if (this.chunks.length) { this.text += this.chunks.join(''); this.chunks = [] }
    this.publish(this.text)
  }
}
