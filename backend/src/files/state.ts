export type FileState='pending'|'uploaded'|'available'|'failed'|'deleted';
const allowed:Record<FileState,readonly FileState[]>={pending:['uploaded','failed'],uploaded:['available','failed'],available:['deleted'],failed:['uploaded'],deleted:[]};
export function transition(from:FileState,to:FileState) {
  if(!allowed[from].includes(to)) throw Error(`Invalid file state transition: ${from} -> ${to}`);
  return to;
}
