import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {saveConfig,validateOrigin} from './fixed-url-config.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback()}});
const rl=createInterface({input:process.stdin,output,terminal:true,historySize:0});
rl.on('SIGINT',()=>{rl.close();process.exitCode=1});
try{
 console.log('固定URLの設定（初回のみ）\nngrokの無料アカウントを作成し、次の画面を開いてください。\nURL: https://dashboard.ngrok.com/domains\nAuthtoken: https://dashboard.ngrok.com/get-started/your-authtoken\nトークンはこのPCに保存します。チャットやGitHubには貼り付けないでください。\n');
 const origin=validateOrigin(await rl.question('Domainsに表示されたHTTPS URL: '));
 process.stdout.write('Authtoken（入力内容は表示されません）: ');muted=true;
 const authtoken=await rl.question('');muted=false;console.log();
 saveConfig(root,{origin,authtoken});
 console.log('設定を保存しました。固定URL: '+origin+'\nstart-sns.cmd を開くと起動します。');
}catch(error){muted=false;console.error('\n設定できませんでした: '+error.message);process.exitCode=1}finally{rl.close()}
