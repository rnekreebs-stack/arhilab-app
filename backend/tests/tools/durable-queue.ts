import { open, readFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
export type QueueItem={operationId:string;idempotencyKey:string;entityType:string;entityId:string;operationType:string;baseRevision:number;payload:object;occurredAt:string;createdAt:string;attemptCount:number;nextAttemptAt:string|null;state:'pending'|'sending'|'retry'|'applied'|'conflict'|'permanent_failure'};
type LocalState={entities:Record<string,object>;queue:QueueItem[]};
export class DurableQueue {
  private constructor(private readonly path:string,private state:LocalState) {}
  static async open(path:string) {
    let state:LocalState={entities:{},queue:[]};
    try { state=JSON.parse(await readFile(path,'utf8')) as LocalState; }
    catch(error) { if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error; }
    const queue=new DurableQueue(path,state);
    if(state.queue.some(item=>item.state==='sending')) {
      for(const item of state.queue) if(item.state==='sending') item.state='retry';
      await queue.save();
    }
    return queue;
  }
  private async save() {
    const temp=this.path+'.tmp';
    const file=await open(temp,'w',0o600);
    try { await file.writeFile(JSON.stringify(this.state));await file.sync(); } finally { await file.close(); }
    await rename(temp,this.path);
    const directory=await open(dirname(this.path),'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async localWrite(entityId:string,localState:object,operation:Omit<QueueItem,'createdAt'|'attemptCount'|'nextAttemptAt'|'state'>) {
    this.state.entities[entityId]=localState;
    this.state.queue.push({...operation,createdAt:new Date().toISOString(),attemptCount:0,nextAttemptAt:null,state:'pending'});
    await this.save();
  }
  get queue() { return this.state.queue.map(item=>({...item})); }
  get entities() { return {...this.state.entities}; }
  async mark(operationId:string,state:QueueItem['state']) {
    const item=this.state.queue.find(entry=>entry.operationId===operationId);
    if (!item) throw Error('Unknown operation');
    item.state=state;
    if(state==='sending'||state==='retry') item.attemptCount++;
    await this.save();
  }
}
