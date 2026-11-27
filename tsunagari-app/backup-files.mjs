import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const mediaKey=/^[a-f0-9-]+\/\d+\.(jpg|png|webp|mp4)$/;
export function inside(root,relative){if(typeof relative!=='string'||relative.includes('\\')||relative.startsWith('/')||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe backup path');const full=path.resolve(root,relative);if(!full.startsWith(path.resolve(root)+path.sep))throw Error('Unsafe backup path');let current=path.resolve(root);if(fs.lstatSync(current).isSymbolicLink())throw Error('Symlink not allowed');for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('Symlink not allowed')}return full}
export function digestFile(file){const hash=createHash('sha256'),fd=fs.openSync(file,'r'),buf=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buf,0,buf.length,null)))hash.update(buf.subarray(0,n));return hash.digest('hex')}finally{fs.closeSync(fd)}}
export function referencedFiles(database){const db=new DatabaseSync(database,{readOnly:true});try{if(Object.values(db.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw Error('Database integrity failure');if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database reference failure');const keys=new Set();for(const p of db.prepare('SELECT images FROM posts').all())for(const k of JSON.parse(p.images)){if(!mediaKey.test(k))throw Error('Invalid media reference');keys.add('media/'+k)}for(const p of db.prepare('SELECT avatar_key,header_key FROM profiles').all())for(const k of [p.avatar_key,p.header_key].filter(Boolean)){if(!mediaKey.test(k))throw Error('Invalid profile reference');keys.add('media/'+k)}return [...keys]}finally{db.close()}}
export function verifyBackup(directory){
 const root=path.resolve(directory),manifest=JSON.parse(fs.readFileSync(inside(root,'manifest.json'),'utf8'));
 if(manifest.version!==1||!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Invalid backup manifest');const names=new Set();
 for(const item of manifest.files){if(names.has(item.path)||!(item.path==='sns.sqlite'||item.path==='push-keys.json'||(item.path.startsWith('media/')&&mediaKey.test(item.path.slice(6)))))throw Error('Invalid backup file');names.add(item.path);const file=inside(root,item.path);if(!fs.statSync(file).isFile()||fs.statSync(file).size!==item.bytes||digestFile(file)!==item.sha256)throw Error('Backup checksum mismatch')}
 if(!names.has('sns.sqlite'))throw Error('Database missing');for(const name of referencedFiles(inside(root,'sns.sqlite')))if(!names.has(name))throw Error('Referenced attachment missing');return manifest;
}
// Synchronous snapshot/copy prevents JS database/media mutations from interleaving.
export function writeBackup(env,directory,destination){
 const root=path.resolve(destination);fs.mkdirSync(root,{recursive:false,mode:0o700});
 env.snapshot(path.join(root,'sns.sqlite'));const files=['sns.sqlite',...referencedFiles(path.join(root,'sns.sqlite'))];
 if(fs.existsSync(path.join(directory,'push-keys.json')))files.push('push-keys.json');
 for(const name of files){const to=inside(root,name);if(name!=='sns.sqlite'){fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o700});fs.copyFileSync(inside(directory,name),to,fs.constants.COPYFILE_EXCL)}fs.chmodSync(to,0o600)}
 const manifest={version:1,created:Date.now(),files:files.map(name=>{const f=inside(root,name);return {path:name,bytes:fs.statSync(f).size,sha256:digestFile(f)}})};
 fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});verifyBackup(root);return manifest;
}
export function restoreBackup(source,destination){
 const root=path.resolve(destination);if(fs.existsSync(root))throw Error('復元先は存在しない新しいフォルダーを指定してください。');const manifest=verifyBackup(source);
 fs.mkdirSync(root,{recursive:false,mode:0o700});
 try{for(const item of manifest.files){const to=inside(root,item.path);fs.mkdirSync(path.dirname(to),{recursive:true,mode:0o700});fs.copyFileSync(inside(source,item.path),to,fs.constants.COPYFILE_EXCL);fs.chmodSync(to,0o600)}
 // Verify the copied files before invalidating sessions in the recovered database.
 fs.copyFileSync(inside(source,'manifest.json'),path.join(root,'manifest.json'));verifyBackup(root);
 const db=new DatabaseSync(path.join(root,'sns.sqlite'));try{db.exec('BEGIN; DELETE FROM sessions; DELETE FROM push_jobs; DELETE FROM push_subscriptions; UPDATE invitations SET expires=0; DELETE FROM invitations WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE invitation_hash=invitations.code_hash); DELETE FROM auth_attempts; COMMIT;')}finally{db.close()}
 fs.unlinkSync(path.join(root,'manifest.json'));fs.writeFileSync(path.join(root,'RESTORED.txt'),'復元済み。全員の再ログインと通知の再登録が必要です。未使用の招待コードは再発行してください。\n',{mode:0o600});return root;
 }catch(e){fs.writeFileSync(path.join(root,'RESTORE_FAILED.txt'),'復元未完了。このフォルダーでは起動しないでください。\n');throw e}
}
