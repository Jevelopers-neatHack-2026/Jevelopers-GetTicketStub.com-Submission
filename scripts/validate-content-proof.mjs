#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import content from './suites/content.mjs';
import proof from './suites/proof.mjs';
const args=process.argv.slice(2);
const index=args.indexOf('--mode');
const mode=index<0?'release':args[index+1];
if ((args.length && (args.length!==2 || index!==0)) || !['draft','release'].includes(mode)) {
 console.error('Usage: node scripts/validate-content-proof.mjs [--mode draft|release]'); process.exitCode=2;
} else {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const results=[];
 for (const [name,run] of [['content',content],['proof',proof]]) {
  try{results.push({suite:name,...await run({root,mode})});}
  catch(error){results.push({suite:name,status:'BLOCKED',reason:error.message});process.exitCode=1;}
 }
 console.log(JSON.stringify({mode,results},null,2));
}
