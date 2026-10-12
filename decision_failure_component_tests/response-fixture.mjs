import assert from 'node:assert/strict';
import https from 'node:https';

/** Wrap only the owner's already-intercepted response callback; never native I/O. */
export function wrapResponse(t,owners,options) {
  const wire=owners.fixture.intercept(t,{body:options.body});
  const intercepted=https.request;assert.ok(intercepted.mock);
  let captured;let complete;let delivered=0;let referenceAbsence;const ready=new Promise(resolve=>{complete=resolve;});
  https.request=(requestOptions,callback)=>intercepted(requestOptions,response=>{
    if(options.mode==='missing-reference') {
      delete response.headers['x-typesafe-request-id'];
      response.rawHeaders=response.rawHeaders.flatMap((value,index,all)=>index%2===0&&value.toLowerCase()!=='x-typesafe-request-id'?[value,all[index+1]]:[]);
      referenceAbsence={headers_has_reference:Object.hasOwn(response.headers,'x-typesafe-request-id'),raw_headers_has_reference:response.rawHeaders.some((value,index)=>index%2===0&&value.toLowerCase()==='x-typesafe-request-id')};
      callback(response);complete();return;
    }
    const chunks=[];let bytes=0;
    const capture=chunk=>{bytes+=chunk.length;assert.ok(bytes<65536);chunks.push(Buffer.from(chunk));};
    response.on('data',capture);
    response.once('end',()=>{response.off('data',capture);captured={callback,response,chunks};complete();if(options.mode==='late-cancel')options.controller.abort();});
  });
  return {wire,referenceAbsence:()=>referenceAbsence,restore:()=>{https.request=intercepted;},
    async deliver(){await ready;assert.ok(captured);delivered++;captured.callback(captured.response);for(const bytes of captured.chunks)captured.response.emit('data',bytes);captured.response.emit('end');await new Promise(resolve=>setImmediate(resolve));return {delivered,bytes:captured.chunks.reduce((sum,chunk)=>sum+chunk.length,0)};}};
}

export function deferPermit(input,controller) {
  const original=input.revalidateDispatch;
  let entered;let release;let resumed;let resolutions=0;
  const entry=new Promise(resolve=>{entered=resolve;});const pending=new Promise(resolve=>{release=resolve;});const resolution=new Promise(resolve=>{resumed=resolve;});
  input.revalidateDispatch=async binding=>{const permit=await original(binding);entered();await pending;resolutions++;resumed();return permit;};
  return {async cancelWhenEntered(){await entry;controller.abort();},async deliver(){release();await resolution;await new Promise(resolve=>setImmediate(resolve));return {resolutions};}};
}
