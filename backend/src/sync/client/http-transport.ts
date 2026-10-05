import type { SyncTransport,BusinessJob,UploadJob,ClientChange } from './local-first.js';

export interface TokenProvider {accessToken():Promise<string|null>;refresh():Promise<boolean>}
export class TransportFailure extends Error {
  constructor(public readonly httpStatus:number,public readonly errorClass?:string,public readonly retryAfterSeconds?:number) {super('Sync request failed');}
}
export class HttpSyncTransport implements SyncTransport {
  constructor(private readonly baseUrl:string,private readonly tokens:TokenProvider) {}
  private async request(path:string,method='GET',body?:object|Buffer) {
    const access=await this.tokens.accessToken();
    if(!access) throw new TransportFailure(401);
    let response:Response;
    try {response=await fetch(this.baseUrl+path,{method,headers:{Authorization:'Bearer '+access,
      ...(body?{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'}:{})},
      ...(body?{body:Buffer.isBuffer(body)?new Uint8Array(body):JSON.stringify(body)}:{})});}
    catch {throw new TransportFailure(503);}
    if(!response.ok) {
      const detail=await response.json().catch(()=>({})) as {errorClass?:string};
      throw new TransportFailure(response.status,detail.errorClass,Number(response.headers.get('Retry-After')??0));
    }
    return response;
  }
  refresh() {return this.tokens.refresh();}
  async snapshot() {return await (await this.request('/sync/snapshot')).json() as {cursor:string;entities:ClientChange[]};}
  async push(operations:BusinessJob[]) {
    const envelope=operations.map(({operationId,idempotencyKey,entityType,entityId,operationType,baseRevision,payload,occurredAt})=>
      ({operationId,idempotencyKey,entityType,entityId,operationType,baseRevision,payload,occurredAt}));
    return await (await this.request('/sync/push','POST',{operations:envelope})).json() as {results:Array<{operationId:string;status:string;originalStatus?:string;errorClass?:string}>};
  }
  async pull(cursor:string) {return await (await this.request('/sync/pull?cursor='+encodeURIComponent(cursor))).json() as {changes:ClientChange[];nextCursor:string;hasMore:boolean};}
  async createIntent(job:UploadJob) {
    const body={projectId:job.projectId,filename:job.filename,mimeType:job.mimeType,byteSize:job.byteSize,sha256:job.sha256,idempotencyKey:job.idempotencyKey};
    const result=await (await this.request('/files/'+job.kind+'/intents','POST',body)).json() as {file:{id:string}};
    return {id:result.file.id};
  }
  async upload(job:UploadJob,bytes:Buffer) {await this.request(`/files/${job.kind}/${job.remoteId}/content`,'PUT',bytes);}
  async finalize(job:UploadJob) {await this.request(`/files/${job.kind}/${job.remoteId}/finalize`,'POST');}
  async download(kind:UploadJob['kind'],id:string) {return Buffer.from(await (await this.request(`/files/${kind}/${id}/content`)).arrayBuffer());}
}
