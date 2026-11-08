/** 与退出时的会话保存共用一次确认，避免防抖中的全局提示词丢失。 */
const pendingSavers = new Set<() => Promise<unknown>>()

export function registerPromptSaver(save: () => Promise<unknown>): () => void {
  pendingSavers.add(save)
  return () => { pendingSavers.delete(save) }
}

export async function flushPromptSaves(): Promise<void> {
  await Promise.all([...pendingSavers].map(save => save()))
}
