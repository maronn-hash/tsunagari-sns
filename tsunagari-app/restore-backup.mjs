import {restoreBackup} from './backup-files.mjs';
const [source,destination,...extra]=process.argv.slice(2);
if(!source||!destination||extra.length){console.log('SNSを停止してから実行してください。\nnode restore-backup.mjs "バックアップの世代フォルダー" "存在しない新しい復元先"\n現在のデータは上書きしません。復元後は全員の再ログイン・通知再登録が必要です。');process.exitCode=source==='--help'?0:1}
else try{console.log('復元完了: '+restoreBackup(source,destination))}catch(e){console.error('復元できませんでした: '+e.message);process.exitCode=1}
