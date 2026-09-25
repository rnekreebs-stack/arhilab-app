export type Failure = {httpStatus?:number;errorClass?:string;retryAfterSeconds?:number};
export function classifyFailure(failure:Failure):'retry'|'conflict'|'auth_required'|'permanent' {
  if (failure.errorClass==='conflict') return 'conflict';
  if (failure.httpStatus===401) return 'auth_required';
  if (failure.httpStatus===429 || failure.httpStatus===undefined || (failure.httpStatus>=500 && failure.httpStatus<=599) || failure.errorClass==='retryable') return 'retry';
  return 'permanent';
}
export function retryDelayMs(attempt:number,random:number,retryAfterSeconds?:number) {
  if (!Number.isInteger(attempt) || attempt<1 || random<0 || random>=1) throw Error('Invalid retry parameters');
  const cap=Math.min(60_000,Math.min(1000*2**Math.min(attempt-1,16),60_000));
  return Math.max(Math.floor(cap*(0.5+random*0.5)),Math.min((retryAfterSeconds ?? 0)*1000,300_000));
}
