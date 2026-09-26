import { randomUUID,createHash } from 'node:crypto';
import { open,readFile,rename,mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { classifyFailure,retryDelayMs,type Failure } from './retry.js';
import { TransportFailure } from './http-transport.js';

export type SyncState='offline'|'idle'|'syncing'|'pending_changes'|'retry_wait'|'conflict'|'auth_required'|'error';
export type UploadState='waiting_for_network'|'uploading'|'uploaded'|'failed'|'completed';
export type BusinessJob={operationId:string;idempotencyKey:string;entityType:string;entityId:string;operationType:string;baseRevision:number;
  payload:Record<string,unknown>;occurredAt:string;state:'pending'|'retry'|'conflict'|'applied'|'failed';attempts:number;nextAttemptAt:number};
export type UploadJob={localId:string;kind:'photos'|'documents';projectId:string;localPath:string;filename:string;mimeType:string;
  byteSize:number;sha256:string;idempotencyKey:string;remoteId:string|null;state:UploadState;attempts:number;nextAttemptAt:number};
export type ClientState={cursor:string;entities:Record<string,Record<string,unknown>>;operations:BusinessJob[];uploads:UploadJob[];
  conflicts:string[];lastSuccessfulSync:string|null;lastErrorCategory:string|null;syncState:SyncState};
const empty=():ClientState=>({cursor:'0',entities:{},operations:[],uploads:[],conflicts:[],lastSuccessfulSync:null,lastErrorCategory:null,syncState:'idle'});
export interface SyncStore {read():Promise<ClientState>;write(state:ClientState):Promise<void>}
export class JsonFileSyncStore implements SyncStore {
  constructor(private readonly path:string) {}
  async read() {try {return JSON.parse(await readFile(this.path,'utf8')) as ClientState;}
    catch(error) {if(error instanceof Error&&'code' in error&&error.code==='ENOENT') return empty();throw error;}}
  async write(state:ClientState) {
    await mkdir(dirname(this.path),{recursive:true});const temp=this.path+'.'+randomUUID()+'.tmp';
    const file=await open(temp,'wx',0o600);
    try {await file.writeFile(JSON.stringify(state));await file.sync();} finally {await file.close();}
    await rename(temp,this.path);const directory=await open(dirname(this.path),'r');
    try {await directory.sync();} finally {await directory.close();}
  }
}
export type ClientChange={entityType:string;entityId:string;revision:number;snapshot:Record<string,unknown>};
export interface SyncTransport {
  snapshot():Promise<{cursor:string;entities:ClientChange[]}>;
  push(operations:BusinessJob[]):Promise<{results:Array<{operationId:string;status:string;originalStatus?:string;errorClass?:string}>}>;
  pull(cursor:string):Promise<{changes:ClientChange[];nextCursor:string;hasMore:boolean}>;
  createIntent(job:UploadJob):Promise<{id:string}>;
  upload(job:UploadJob,bytes:Buffer):Promise<void>;
  finalize(job:UploadJob):Promise<void>;
  download(kind:UploadJob['kind'],id:string):Promise<Buffer>;
  refresh():Promise<boolean>;
}
export type SyncSummary={state:SyncState;online:boolean;pendingOperations:number;pendingUploads:number;conflicts:number;
  lastSuccessfulSync:string|null;lastErrorCategory:string|null};
export class SyncCoordinator {
  private constructor(private readonly store:SyncStore,private readonly transport:SyncTransport,private readonly state:ClientState,
    private readonly online:()=>boolean,private readonly now:()=>number,private readonly random:()=>number) {}
  static async open(store:SyncStore,transport:SyncTransport,online:()=>boolean,now=Date.now,random=Math.random) {
    const state=await store.read();
    for(const job of state.uploads) if(job.state==='uploading') job.state='waiting_for_network';
    if(state.syncState==='syncing') state.syncState='pending_changes';
    await store.write(state);return new SyncCoordinator(store,transport,state,online,now,random);
  }
  summary():SyncSummary {return {state:this.online()?this.state.syncState:'offline',online:this.online(),
    pendingOperations:this.state.operations.filter(x=>x.state==='pending'||x.state==='retry').length,
    pendingUploads:this.state.uploads.filter(x=>x.state!=='completed').length,conflicts:this.state.conflicts.length,
    lastSuccessfulSync:this.state.lastSuccessfulSync,lastErrorCategory:this.state.lastErrorCategory};}
  get cursor() {return this.state.cursor;}
  get entities() {return structuredClone(this.state.entities);}
  get uploadJobs() {return structuredClone(this.state.uploads);}
  async localWrite(entityId:string,entity:Record<string,unknown>,operation:Omit<BusinessJob,'state'|'attempts'|'nextAttemptAt'>) {
    this.state.entities[entityId]=entity;this.state.operations.push({...operation,state:'pending',attempts:0,nextAttemptAt:0});
    this.state.syncState='pending_changes';await this.store.write(this.state);
  }
  async enqueueFile(job:Omit<UploadJob,'remoteId'|'state'|'attempts'|'nextAttemptAt'>) {
    if(this.state.uploads.some(x=>x.localId===job.localId)) throw Error('Duplicate local file ID');
    this.state.uploads.push({...job,remoteId:null,state:'waiting_for_network',attempts:0,nextAttemptAt:0});
    this.state.syncState='pending_changes';await this.store.write(this.state);
  }
  private async authorized<T>(fn:()=>Promise<T>) {
    try {return await fn();} catch(error) {
      if((error as Failure).httpStatus===401 && await this.transport.refresh()) return fn();
      throw error;
    }
  }
  private retry(job:{attempts:number;nextAttemptAt:number},failure:Failure) {
    job.attempts++;job.nextAttemptAt=this.now()+retryDelayMs(job.attempts,this.random(),failure.retryAfterSeconds);
  }
  async syncNow():Promise<SyncSummary> {
    if(!this.online()) {this.state.syncState='offline';await this.store.write(this.state);return this.summary();}
    this.state.syncState='syncing';await this.store.write(this.state);
    try {
      if(this.state.cursor==='0'&&Object.keys(this.state.entities).length===0) {
        const initial=await this.authorized(()=>this.transport.snapshot());
        for(const change of initial.entities)this.state.entities[change.entityId]=change.snapshot;
        this.state.cursor=initial.cursor;await this.store.write(this.state);
      }
      for(const job of this.state.operations.filter(x=>['pending','retry'].includes(x.state)&&x.nextAttemptAt<=this.now())) {
        try {
          const response=await this.authorized(()=>this.transport.push([job]));
          const result=response.results.find(x=>x.operationId===job.operationId);
          if(result?.status==='conflict'||result?.status==='duplicate'&&result.originalStatus==='conflict')
            {job.state='conflict';if(!this.state.conflicts.includes(job.operationId)) this.state.conflicts.push(job.operationId);}
          else if(result?.status==='applied'||result?.status==='duplicate'&&result.originalStatus==='applied') job.state='applied';
          else {job.state='failed';this.state.lastErrorCategory=result?.errorClass??'validation';}
        } catch(error) {
          const failure=error as Failure,classification=classifyFailure(failure);
          if(classification==='auth_required') {this.state.syncState='auth_required';await this.store.write(this.state);return this.summary();}
          if(classification==='retry') {this.retry(job,failure);job.state='retry';this.state.lastErrorCategory='network';}
          else {job.state='failed';this.state.lastErrorCategory=classification;}
        }
        await this.store.write(this.state);
      }
      for(const job of this.state.uploads.filter(x=>x.state!=='completed'&&x.nextAttemptAt<=this.now())) {
        try {
          if(!job.remoteId) {job.remoteId=(await this.authorized(()=>this.transport.createIntent(job))).id;await this.store.write(this.state);}
          if(job.state!=='uploaded') {
            const bytes=await readFile(job.localPath);
            if(bytes.length!==job.byteSize||createHash('sha256').update(bytes).digest('hex')!==job.sha256) throw new TransportFailure(400);
            job.state='uploading';await this.store.write(this.state);
            await this.authorized(()=>this.transport.upload(job,bytes));job.state='uploaded';await this.store.write(this.state);
          }
          await this.authorized(()=>this.transport.finalize(job));job.state='completed';
        } catch(error) {
          const failure=error as Failure,classification=classifyFailure(failure);
          if(classification==='auth_required') {this.state.syncState='auth_required';await this.store.write(this.state);return this.summary();}
          if(classification==='retry') {this.retry(job,failure);job.state=job.state==='uploaded'?'uploaded':'waiting_for_network';this.state.lastErrorCategory='storage';}
          else {job.state='failed';job.nextAttemptAt=Number.MAX_SAFE_INTEGER;this.state.lastErrorCategory=classification;}
        }
        await this.store.write(this.state);
      }
      let more=true;while(more) {
        const page=await this.authorized(()=>this.transport.pull(this.state.cursor));
        for(const change of page.changes)this.state.entities[change.entityId]=change.snapshot;
        this.state.cursor=page.nextCursor;more=page.hasMore;await this.store.write(this.state);
      }
      this.state.lastSuccessfulSync=new Date(this.now()).toISOString();
      this.state.syncState=this.state.conflicts.length?'conflict':this.summary().pendingOperations||this.summary().pendingUploads?'retry_wait':'idle';
      await this.store.write(this.state);return this.summary();
    } catch(error) {
      const classification=classifyFailure(error as Failure);this.state.syncState=classification==='auth_required'?'auth_required':classification==='retry'?'retry_wait':'error';
      this.state.lastErrorCategory=classification;await this.store.write(this.state);return this.summary();
    }
  }
}

export async function atomicVerifiedCache(path:string,bytes:Buffer,expectedHash:string) {
  if(createHash('sha256').update(bytes).digest('hex')!==expectedHash) throw Error('Download checksum mismatch');
  await mkdir(dirname(path),{recursive:true});const tmp=path+'.'+randomUUID()+'.tmp';const file=await open(tmp,'wx',0o600);
  try {await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  await rename(tmp,path);
}
