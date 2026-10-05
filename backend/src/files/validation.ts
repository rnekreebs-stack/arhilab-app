import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config/env.js';

export type FileKind='photos'|'documents';
export const intentSchema=z.strictObject({projectId:z.uuid(),filename:z.string().min(1).max(250),mimeType:z.enum(['image/jpeg','image/png','image/webp','application/pdf']),
  byteSize:z.number().int().positive(),sha256:z.string().regex(/^[a-f0-9]{64}$/),idempotencyKey:z.string().regex(/^[A-Za-z0-9_-]{16,100}$/)});
export function kindOf(value:string):FileKind|null {return value==='photos'||value==='documents'?value:null;}
export function displayFilename(value:string) {
  const name=Array.from(value,character=>character==='/'||character==='\\'||character.charCodeAt(0)<32||character.charCodeAt(0)===127?'_':character).join('').replace(/^\.+/,'_').trim();
  if(!name || name.length>250) throw Error('Invalid filename');return name;
}
export function validSize(kind:FileKind,bytes:number) {return bytes>0&&bytes<=(kind==='photos'?config.MAX_PHOTO_BYTES:config.MAX_DOCUMENT_BYTES);}
export function validType(kind:FileKind,mime:string,bytes:Buffer) {
  if(kind==='documents') return mime==='application/pdf'&&bytes.subarray(0,5).toString('ascii')==='%PDF-';
  if(mime==='image/jpeg') return bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  if(mime==='image/png') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(mime==='image/webp') return bytes.length>=12&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP';
  return false;
}
export const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
