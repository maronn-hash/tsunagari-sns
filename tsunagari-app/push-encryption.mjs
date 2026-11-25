import {createECDH,createCipheriv,hkdfSync,randomBytes} from 'node:crypto';

// RFC 8291 / RFC 8188: one aes128gcm record, with fresh ECDH keys and salt per send.
// The optional inputs exist for the RFC known-answer test; production omits them.
export function encryptPush(payload,keys,{salt=randomBytes(16),privateKey}={}){
 const receiver=Buffer.from(keys.p256dh,'base64url'),auth=Buffer.from(keys.auth,'base64url');
 if(receiver.length!==65||receiver[0]!==4||auth.length!==16||salt.length!==16)throw Error('Invalid push encryption key');
 const content=Buffer.from(payload);if(content.length>3993)throw Error('Push payload too large');
 const sender=createECDH('prime256v1');if(privateKey)sender.setPrivateKey(privateKey);else sender.generateKeys();
 const publicKey=sender.getPublicKey(),shared=sender.computeSecret(receiver);
 const info=Buffer.concat([Buffer.from('WebPush: info\0'),receiver,publicKey]);
 const ikm=Buffer.from(hkdfSync('sha256',shared,auth,info,32));
 const cek=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16));
 const nonce=Buffer.from(hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12));
 const cipher=createCipheriv('aes-128-gcm',cek,nonce);
 const encrypted=Buffer.concat([cipher.update(Buffer.concat([content,Buffer.from([2])])),cipher.final(),cipher.getAuthTag()]);
 const header=Buffer.alloc(86);salt.copy(header);header.writeUInt32BE(4096,16);header[20]=65;publicKey.copy(header,21);
 return Buffer.concat([header,encrypted]);
}
