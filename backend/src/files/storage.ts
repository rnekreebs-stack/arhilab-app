import { randomUUID } from 'node:crypto';
import { mkdir,readFile,rename,rm,stat,writeFile } from 'node:fs/promises';
import { dirname,resolve,sep } from 'node:path';
import { DeleteObjectCommand,GetObjectCommand,HeadBucketCommand,HeadObjectCommand,PutObjectCommand,S3Client } from '@aws-sdk/client-s3';
import { config } from '../config/env.js';

export type StoredObject={size:number;sha256:string;mime:string};
export interface ObjectStorage {
  put(key:string,bytes:Buffer,metadata:StoredObject):Promise<void>;
  get(key:string,maxBytes?:number):Promise<Buffer>;
  head(key:string):Promise<StoredObject|null>;
  delete(key:string):Promise<void>;
  ready():Promise<boolean>;
}
const keyPattern=/^organizations\/[0-9a-f-]{36}\/projects\/[0-9a-f-]{36}\/(photos|documents)\/[0-9a-f-]{36}\/v1$/;
export function fileKey(org:string,project:string,kind:'photos'|'documents',id:string) {
  for(const value of [org,project,id]) if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw Error('Invalid storage identifier');
  return `organizations/${org}/projects/${project}/${kind}/${id}/v1`;
}
function safeKey(key:string) { if(!keyPattern.test(key)) throw Error('Invalid storage key');return key; }
export class FilesystemStorage implements ObjectStorage {
  constructor(private readonly root:string) {}
  private path(key:string) {const base=resolve(this.root),path=resolve(base,safeKey(key));if(!path.startsWith(base+sep)) throw Error('Invalid storage path');return path;}
  async put(key:string,bytes:Buffer,metadata:StoredObject) {
    const target=this.path(key),tmp=target+'.'+randomUUID()+'.tmp';await mkdir(dirname(target),{recursive:true});
    try {await writeFile(tmp,bytes,{flag:'wx'});await rename(tmp,target);await writeFile(target+'.json',JSON.stringify(metadata));}
    finally {await rm(tmp,{force:true});}
  }
  async get(key:string,maxBytes?:number) {const path=this.path(key);if(maxBytes!==undefined&&(await stat(path)).size>maxBytes) throw Error('Object exceeds expected size');
    const bytes=await readFile(path);if(maxBytes!==undefined&&bytes.length>maxBytes) throw Error('Object exceeds expected size');return bytes;}
  async head(key:string) {
    try {const target=this.path(key),[info,raw]=await Promise.all([stat(target),readFile(target+'.json','utf8')]);
      const meta=JSON.parse(raw) as StoredObject;return info.size===meta.size?meta:null;
    } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT') return null;throw error;}
  }
  async delete(key:string) {const target=this.path(key);await rm(target,{force:true});await rm(target+'.json',{force:true});}
  async ready() {try {await mkdir(this.root,{recursive:true});await stat(this.root);return true;} catch {return false;}}
}
export class S3ObjectStorage implements ObjectStorage {
  private readonly client:S3Client;
  constructor(private readonly bucket:string,region:string,endpoint:string|undefined,accessKeyId:string,secretAccessKey:string) {
    this.client=new S3Client({region,...(endpoint?{endpoint}:{}),forcePathStyle:!!endpoint,credentials:{accessKeyId,secretAccessKey}});
  }
  async put(key:string,bytes:Buffer,metadata:StoredObject) {
    await this.client.send(new PutObjectCommand({Bucket:this.bucket,Key:safeKey(key),Body:bytes,ContentLength:bytes.length,
      ContentType:metadata.mime,Metadata:{sha256:metadata.sha256}}));
  }
  async get(key:string,maxBytes?:number) {
    const object=await this.client.send(new GetObjectCommand({Bucket:this.bucket,Key:safeKey(key)}));
    if(maxBytes!==undefined&&object.ContentLength!==undefined&&object.ContentLength>maxBytes) throw Error('Object exceeds expected size');
    if(!object.Body) throw Error('Missing object body');const bytes=Buffer.from(await object.Body.transformToByteArray());
    if(maxBytes!==undefined&&bytes.length>maxBytes) throw Error('Object exceeds expected size');return bytes;
  }
  async head(key:string) {
    try {const r=await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:safeKey(key)}));
      return r.ContentLength!==undefined&&r.Metadata?.sha256&&r.ContentType?{size:r.ContentLength,sha256:r.Metadata.sha256,mime:r.ContentType}:null;
    } catch(error) {if(error instanceof Error&&('name' in error)&&['NotFound','NoSuchKey','404'].includes(error.name))return null;throw error;}
  }
  async delete(key:string) {await this.client.send(new DeleteObjectCommand({Bucket:this.bucket,Key:safeKey(key)}));}
  async ready() {try {await this.client.send(new HeadBucketCommand({Bucket:this.bucket}));return true;} catch {return false;}}
}
export const storage:ObjectStorage=config.STORAGE_PROVIDER==='s3'
  ? new S3ObjectStorage(config.STORAGE_BUCKET!,config.STORAGE_REGION,config.STORAGE_ENDPOINT,config.STORAGE_ACCESS_KEY_ID!,config.STORAGE_SECRET_ACCESS_KEY!)
  : new FilesystemStorage(config.STORAGE_ROOT);
