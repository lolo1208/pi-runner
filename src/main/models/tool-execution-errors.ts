import { ModelError } from './model-validation'

/** 已开始产生文件系统副作用，报错不代表未执行，必须先核对现状。 */
export class FileMutationUncertain extends ModelError {}
export class FileSnapshotStopped extends ModelError {}
