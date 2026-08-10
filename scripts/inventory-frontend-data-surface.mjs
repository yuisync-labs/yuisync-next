import { readdir, readFile } from 'node:fs/promises'
import { extname } from 'node:path'

const ROOT=new URL('../src/',import.meta.url);const EXT=new Set(['.js','.jsx','.ts','.tsx']);const files=[]
async function walk(url){for(const entry of await readdir(url,{withFileTypes:true})){const child=new URL(`${entry.name}${entry.isDirectory()?'/':''}`,url);if(entry.isDirectory())await walk(child);else if(EXT.has(extname(entry.name)))files.push(child)}}
await walk(ROOT)
const tables=new Set();const rpcs=new Set();const auth=new Set()
for(const file of files){const text=await readFile(file,'utf8');for(const match of text.matchAll(/\.from\(\s*['"]([^'"]+)['"]\s*\)/g))tables.add(match[1]);for(const match of text.matchAll(/\.rpc\(\s*['"]([^'"]+)['"]\s*/g))rpcs.add(match[1]);for(const match of text.matchAll(/\.auth\.([A-Za-z0-9_]+)/g))auth.add(match[1])}
console.log('TABLES');for(const value of [...tables].sort())console.log(value)
console.log('RPCS');for(const value of [...rpcs].sort())console.log(value)
console.log('AUTH');for(const value of [...auth].sort())console.log(value)
