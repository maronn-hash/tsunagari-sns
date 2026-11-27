import {runContentMaintenance} from './moderation-core.mjs';
export function createContentMaintenance(env,{intervalMs=300000}={}){
 let running=null,closed=false;env.CONTENT_MAINTENANCE=true;
 function run(){if(closed)return Promise.resolve();if(running)return running;running=runContentMaintenance(env).catch(()=>(console.error('Content maintenance failed; it will retry.'),env.OPS?.event('maintenance_failed'))).finally(()=>{running=null});return running}
 const timer=setInterval(()=>void run(),intervalMs);timer.unref();void run();
 return {run,async close(){closed=true;clearInterval(timer);if(running)await running;env.CONTENT_MAINTENANCE=false}};
}
