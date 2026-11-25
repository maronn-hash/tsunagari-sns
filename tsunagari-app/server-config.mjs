export function serverConfiguration(settings=process.env){
 const port=Number(settings.PORT||5173);
 if(!Number.isInteger(port)||port>65535||(port<1&&!(port===0&&settings.TUNNEL_CHILD==='1')))throw Error('PORT must be between 1 and 65535.');
 const publicOrigin=settings.PUBLIC_ORIGIN||settings.RENDER_EXTERNAL_URL;
 if(publicOrigin&&(new URL(publicOrigin).protocol!=='https:'||new URL(publicOrigin).origin!==publicOrigin))throw Error('Public URL must be an HTTPS origin without a trailing slash.');
 if(settings.NODE_ENV==='production'&&!publicOrigin)throw Error('Set PUBLIC_ORIGIN or RENDER_EXTERNAL_URL before production startup.');
 return {port,origin:publicOrigin||`http://127.0.0.1:${port}`,host:publicOrigin?(settings.HOST||'127.0.0.1'):'127.0.0.1',localDev:!publicOrigin};
}
