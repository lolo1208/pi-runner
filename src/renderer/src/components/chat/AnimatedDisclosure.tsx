import { useState, type ReactNode } from 'react'
import './AnimatedDisclosure.css'

/** 首次展开才挂载内容，之后保留内容以支持收起和快速反向切换。 */
export function AnimatedDisclosure({ open, children }: { open: boolean; children: ReactNode }): React.JSX.Element {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  return <div className="chat-animated-disclosure" data-open={open} aria-hidden={!open} inert={!open}>
    <div className="chat-animated-disclosure-inner">{mounted && children}</div>
  </div>
}
