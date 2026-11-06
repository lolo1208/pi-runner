/** 工具参数生成进度；只统计实际收到的数据，不以动画模拟进度。 */
export function AgentStatusText({ status, receivedBytes }: { status: string; receivedBytes?: number }): React.JSX.Element {
  const size = receivedBytes === undefined || !Number.isFinite(receivedBytes) || receivedBytes <= 0 ? undefined : receivedBytes < 1024 ? `${receivedBytes.toFixed(1)} B` : receivedBytes < 1024 * 1024 ? `${(receivedBytes / 1024).toFixed(1)} KB` : `${(receivedBytes / (1024 * 1024)).toFixed(1)} MB`
  return <><span>{status}</span>{size !== undefined && <small className="chat-tool-received" title="已接收的工具调用参数大小，不含网络协议开销">{size}</small>}</>
}
