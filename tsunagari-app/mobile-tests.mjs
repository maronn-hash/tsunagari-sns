import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('mobile topics filter and clear the feed, with a separate floating compose button',()=>{
 const html=fs.readFileSync('public/index.html','utf8'),css=fs.readFileSync('public/mobile-ui.css','utf8');
 const nav=html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)[0];
 assert.match(nav,/id="mobile-topics"/);assert.doesNotMatch(nav,/id="mobile-compose"/);
 assert.equal((html.match(/id="mobile-compose"/g)||[]).length,1);
 assert.match(html,/id="mobile-compose" class="floating-compose"/);
 assert.match(css,/font-size:16px!important/);assert.doesNotMatch(html,/user-scalable=no|maximum-scale=1/);
 const elements=new Map(),listeners={};
 const $=id=>{if(!elements.has(id))elements.set(id,{classList:{toggle(){},add(){},remove(){}},open:false,showModal(){this.open=true},close(){this.open=false}});return elements.get(id)};
 const buttons=['','日々のこと','仕事のヒント','お知らせ','ありがとう'].map(value=>({dataset:{mobileTopic:value},setAttribute(k,v){this[k]=v},classList:{toggle(){}}}));
 let mode='',scrolled=0;
 const ctx={$,$$:()=>buttons,me:{id:'member'},category:'',document:{querySelector:()=>({scrollIntoView(){scrolled++}}),addEventListener:(n,f)=>listeners[n]=f},setMode:m=>mode=m,setTimeout};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('public/mobile-ui.js','utf8'),ctx);
 $('#mobile-topics').onclick();assert.equal($('#topics-dialog').open,true);
 $('#mobile-topic-list').onclick({target:{closest:()=>buttons[2]}});
 assert.equal(ctx.category,'仕事のヒント');assert.equal(mode,'all');assert.equal($('#topics-dialog').open,false);assert.equal(buttons[2]['aria-pressed'],'true');assert.equal(scrolled,1);
 $('#mobile-topic-list').onclick({target:{closest:()=>buttons[0]}});assert.equal(ctx.category,'');assert.equal(buttons[0]['aria-pressed'],'true');
 ctx.me=null;$('#mobile-topics').onclick();assert.equal($('#topics-dialog').open,false);
});
