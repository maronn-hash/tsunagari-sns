import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {readConfig,cleanEnvironment} from './fixed-url-config.mjs';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
try{
 if(Number(process.versions.node.split('.')[0])<24)throw Error('Node.js 24 or later is required.');
 const {needsInitialSetup}=await import('./launcher-utils.mjs');
 const directory=path.resolve(process.env.DATA_DIRECTORY||'data-external-trial');
 if(needsInitialSetup(directory))throw Error('No account is registered in this data folder. Use start-external.ps1 for the first setup. If you already registered, run this file from the original SNS folder containing data-external-trial.');
 readConfig(process.cwd());
 const executable=fs.existsSync('ngrok.exe')?path.resolve('ngrok.exe'):'ngrok';
 const check=spawnSync(executable,['version'],{env:cleanEnvironment(),windowsHide:true,stdio:'ignore',timeout:10000});
 if(check.error||check.status!==0)throw Error('ngrokが見つかりません。FIXED_URL.md に従って導入してください。');
 console.log('固定URLでつながりSNSを起動しています。\n接続確認が終わるまで、この画面を開いたままにしてください。停止: Ctrl+C');
 await import('./build.mjs');
 delete process.env.ADMIN_SETUP_TOKEN;
 process.env.OPEN_BROWSER='1';
 await import('./fixed-tunnel.mjs');
}catch(e){console.error('\nCould not start: '+e.message);process.exitCode=1}
