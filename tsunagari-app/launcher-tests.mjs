import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {needsInitialSetup,isTrialURL} from './launcher-utils.mjs';

test('startup detects stored accounts without creating or changing account data',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tsunagari-launcher-'));
 try{
  assert.equal(needsInitialSetup(directory),true);
  assert.equal(fs.existsSync(path.join(directory,'sns.sqlite')),false);
  const db=new DatabaseSync(path.join(directory,'sns.sqlite'));
  db.exec('CREATE TABLE accounts (id TEXT, enabled INTEGER)');
  assert.equal(needsInitialSetup(directory),true);
  db.exec("INSERT INTO accounts VALUES ('test-account',0)");
  // A disabled account must not be treated as a fresh installation.
  assert.equal(needsInitialSetup(directory),false);
  assert.deepEqual({...db.prepare('SELECT * FROM accounts').get()},{id:'test-account',enabled:0});
  db.close();
 }finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true})}
});

test('an unreadable database is not silently replaced',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'tsunagari-launcher-'));
 try{
  const file=path.join(directory,'sns.sqlite');fs.writeFileSync(file,'not a database');
  assert.throws(()=>needsInitialSetup(directory));
  assert.equal(fs.readFileSync(file,'utf8'),'not a database');
 }finally{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true})}
});

test('automatic browser opening accepts only the trial HTTPS origin',()=>{
 assert.equal(isTrialURL('https://test-sns.trycloudflare.com'),true);
 for(const url of ['http://test.trycloudflare.com','https://test.trycloudflare.com.evil.example','https://test.trycloudflare.com&calc','https://test.trycloudflare.com/path','file:///C:/test','https://user@test.trycloudflare.com'])assert.equal(isTrialURL(url),false);
});
