import { memo, useMemo, useRef, type ComponentType } from 'react'

/** 回调始终读取最新属性，同时让无关会话更新时能命中浅比较缓存。 */
export function memoWithStableCallbacks<Props extends object>(Component: ComponentType<Props>) {
  const View = memo(Component)
  return function StableView(props: Props): React.JSX.Element {
    const latest = useRef(props)
    latest.current = props
    const names = Object.keys(props).filter(name => typeof props[name as keyof Props] === 'function').join(',')
    const callbacks = useMemo(() => Object.fromEntries(names.split(',').filter(Boolean).map(name => [name, (...args: unknown[]) => {
      const callback = latest.current[name as keyof Props] as (...values: unknown[]) => unknown
      return callback(...args)
    }])), [names])
    return <View {...props} {...callbacks} />
  }
}
