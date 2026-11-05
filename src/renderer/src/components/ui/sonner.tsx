import { CircleCheck, CircleAlert, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/** 全局操作反馈入口，主题颜色直接跟随应用语义变量。 */
export function Toaster(props: ToasterProps): React.JSX.Element {
  return <Sonner position="bottom-right" closeButton visibleToasts={3} gap={8}
    duration={4500} offset={20} className="app-toaster" icons={{
      success: <CircleCheck size={17} />, info: <Info size={17} />,
      warning: <TriangleAlert size={17} />, error: <CircleAlert size={17} />,
      loading: <LoaderCircle size={17} className="animate-spin" />,
    }} toastOptions={{ classNames: { toast: 'app-toast', title: 'app-toast-title', description: 'app-toast-description', closeButton: 'app-toast-close' } }}
    {...props} />
}
