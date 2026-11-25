import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readConfig,openFixedBrowser} from './fixed-url-config.mjs';
import {createFixedTunnel} from './fixed-tunnel-core.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const executable=fs.existsSync(path.join(root,'ngrok.exe'))?path.join(root,'ngrok.exe'):'ngrok';
const directory=path.resolve(process.env.DATA_DIRECTORY||'data-external-trial');
const runtime=createFixedTunnel({root,directory,config:readConfig(root),executable,onFailure:error=>{console.error(error.message);process.exitCode=1}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>runtime.close());
try{
 const {origin}=await runtime.ready;
 console.log('\n固定URL: '+origin+'\nデータ保存先: '+directory+'\n同じURLをメンバーに共有してください。再起動後もこのURLを使います。\nこの画面とPCを起動したままにしてください。停止: Ctrl+C');
 if(process.env.OPEN_BROWSER==='1')openFixedBrowser(origin);
}catch(error){console.error(error.message);process.exitCode=1}
