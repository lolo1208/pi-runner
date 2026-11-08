import path from 'node:path'

/** 共享项只指向正式版，不回退到开发版旧数据。 */
export function dataPaths(appData: string, home: string, packaged: boolean) {
  return {
    userData: path.join(appData, packaged ? 'pi-runner' : 'pi-runner-dev'),
    models: path.join(appData, 'pi-runner'),
    workspace: path.join(home, packaged ? '.pi-runner' : '.pi-runner-dev')
  }
}
