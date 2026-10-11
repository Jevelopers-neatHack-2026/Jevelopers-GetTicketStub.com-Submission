import { crc32 } from 'node:zlib';
import { calibration,clone,observedFiles } from './production-seeds.mjs';
import { canonicalJson,hashBytes } from '../tooling/runtime.mjs';
import { productionBundleContentHash,productionPayloadSetHash } from '../tooling/production-bundle.mjs';
export function storedZip(entries) {
  const locals=[],centrals=[];let offset=0;
  for(const {filename,bytes} of [...entries].sort((a,b)=>a.filename<b.filename?-1:a.filename>b.filename?1:0)){
    const name=Buffer.from(filename),local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x2821,12);local.writeUInt32LE(crc32(bytes),14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x2821,14);central.writeUInt32LE(crc32(bytes),16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(0x81a40000,38);central.writeUInt32LE(offset,42);
    locals.push(local,name,bytes);centrals.push(central,name);offset+=30+name.length+bytes.length;
  }
  const directory=Buffer.concat(centrals),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,directory,end]);
}
export function maxPayloadProtocol(count=97) {
  const byteMap=Object.fromEntries(observedFiles().map(file=>[file.filename,file.bytes]));
  const bundle=JSON.parse(byteMap['manifest.json']);
  for(let i=bundle.files.length;i<count;i++){
    const filename='payload-'+i.toString().padStart(3,'0')+'.json',bytes=Buffer.from('{}');byteMap[filename]=bytes;
    bundle.files.push({...clone(bundle.files.find(file=>file.role==='profile')),artifact_id:'123e4567-e89b-42d3-a456-'+(1000+i).toString(16).padStart(12,'0'),filename,byte_hash:hashBytes(bytes),byte_size:bytes.length});
  }
  bundle.bundle_hash=productionBundleContentHash(bundle);byteMap['manifest.json']=Buffer.from(canonicalJson(bundle));
  const commitment=clone(calibration.trusted_commitment),metadata=commitment.file_set.filter(file=>['manifest','archive','detached'].includes(file.role));
  const manifest=metadata.find(file=>file.role==='manifest'),archive=metadata.find(file=>file.role==='archive'),detachedFile=metadata.find(file=>file.role==='detached');
  manifest.byte_hash=hashBytes(byteMap['manifest.json']);manifest.byte_size=byteMap['manifest.json'].length;
  byteMap['archive.zip']=storedZip([...bundle.files,manifest].map(file=>({filename:file.filename,bytes:byteMap[file.filename]})));
  archive.byte_hash=hashBytes(byteMap['archive.zip']);archive.byte_size=byteMap['archive.zip'].length;
  commitment.bundle_ref.content_hash=bundle.bundle_hash;
  const detached=JSON.parse(byteMap['detached.json']);detached.bundle_ref=clone(commitment.bundle_ref);detached.manifest=manifest;detached.archive=archive;detached.payload_set_hash=productionPayloadSetHash(bundle.files);
  byteMap['detached.json']=Buffer.from(canonicalJson(detached));detachedFile.byte_hash=hashBytes(byteMap['detached.json']);detachedFile.byte_size=byteMap['detached.json'].length;
  commitment.detached_ref.content_hash=detachedFile.byte_hash;commitment.file_set=[...bundle.files,...metadata];
  return {bundle,files:commitment.file_set.map(file=>({filename:file.filename,bytes:byteMap[file.filename]})),context:{scope:clone(calibration.scope),trusted_commitment:commitment}};
}
