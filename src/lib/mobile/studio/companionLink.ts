/** Decode only pairing links, never navigate the app WebView to supplied content. */
export function parseCompanionLink(raw:string):string {
 let u=new URL(raw.trim());
 if(u.protocol==='ghostarcade:'){
  if(u.hostname!=='pair')throw Error('This is not a desktop pairing link.');
  u=new URL(u.searchParams.get('url')||'');
 }
 if(!['http:','https:'].includes(u.protocol)||!u.hostname||u.username||u.password)throw Error('Use the pairing link from Connect Mobile on your desktop.');
 const token=(u.searchParams.get('pair')||'').replace(/[\s-]/g,'').toUpperCase();
 if(!/^[A-Z0-9]{8,128}$/.test(token))throw Error('The link is missing a valid desktop pairing code.');
 const port=u.searchParams.get('ws');if(port&&(!/^\d+$/.test(port)||+port<1||+port>65535))throw Error('Invalid desktop connection port.');
 u.search='';u.searchParams.set('pair',token);if(port)u.searchParams.set('ws',port);u.pathname='/';u.hash='/mobile';return u.toString();
}
