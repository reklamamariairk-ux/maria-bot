#!/usr/bin/env node
// Драйвер Gemini v3: эмулирует активную вкладку (Emulation.setFocusEmulationEnabled +
// Page.setWebLifecycleState active) — иначе фоновая вкладка не декодирует blob-картинки
// и canvas отдаёт 0×0. Без кражи OS-фокуса. Пересъёмка отвалившихся пород.
import fs from 'fs';
import path from 'path';
const PORT = process.env.CDP_PORT || 9223;
const OUT = 'C:/Users/user/AppData/Local/Temp/claude/C--Users-user/073cdf12-ea23-4d0d-a018-a7ee2f0a0702/scratchpad/pigeons-png';
const STYLE = `Generate ONE square 1:1 image. Glossy 3D animated character render in polished Pixar-like feature-film quality: a single plump cute cartoon PIGEON character standing upright on two tiny orange-red feet, facing the camera in a friendly 3/4 pose, big round dark expressive eyes, soft rosy cheek blush, small curved beak, rich feather micro-detail with soft subsurface scattering, soft studio lighting with gentle contact shadow under the feet, PURE SEAMLESS WHITE BACKGROUND (no floor line, no props, no scenery). Character centered, fills about 80% of frame height. NOT photorealistic - a stylized 3D animated mascot. ABSOLUTELY NO text, NO letters, NO watermark. ONE single character only.`;
const BREEDS = {
  vozhak:   `THE BREED (Flock Leader): big broad-chested slate-grey pigeon with a proud commanding stance, chest puffed out, tiny dark-red captain's epaulettes on the shoulders, wise stern eyes.`,
  imeninny: `THE BREED (Birthday Pigeon): cheerful warm-beige pigeon wearing a tiny striped party cone hat, a few colorful confetti pieces resting on its feathers, joyful open-beak smile.`,
  snezhny:  `THE BREED (Snow Pigeon): fluffy snow-white pigeon with frosty ice-blue feather tips, wearing a tiny cozy knitted scarf, cheeks extra rosy from the cold.`,
  zolotoy:  `THE BREED (Golden Pigeon, LEGENDARY): majestic pigeon with radiant METALLIC GOLD plumage, glossy golden sheen over every feather like a polished trophy, a tiny crimson ribbon around the neck, regal sparkling look.`,
  champion: `THE BREED (Champion, LEGENDARY race winner): athletic proud pigeon with sleek silver-grey plumage, a shining GOLD MEDAL on a red ribbon around its neck, a tiny golden laurel sprig tucked above one eye, triumphant chest-out pose.`,
};
async function targets(){ const r=await fetch(`http://127.0.0.1:${PORT}/json`); return (await r.json()).filter(t=>t.type==='page'); }
function connect(ws){ return new Promise((resolve,reject)=>{ const s=new WebSocket(ws); let id=0; const p=new Map();
  s.onopen=()=>resolve({ send(m,pr={}){ return new Promise((res,rej)=>{ const i=++id; p.set(i,{res,rej}); s.send(JSON.stringify({id:i,method:m,params:pr})); }); }, close(){s.close();} });
  s.onerror=()=>reject(new Error('ws')); s.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){ const{res,rej}=p.get(m.id); p.delete(m.id); m.error?rej(new Error(JSON.stringify(m.error))):res(m.result); } }; }); }
async function ev(c,js){ const r=await c.send('Runtime.evaluate',{expression:`(async()=>{ ${js} })()`,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result.value; }
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const only=process.argv.slice(2);
const jobs=Object.entries(BREEDS).filter(([k])=>!only.length||only.includes(k));
fs.mkdirSync(OUT,{recursive:true});
const ts=await targets(); const t=ts.find(t=>(t.url||'').includes('gemini.google.com'));
if(!t){ console.error('нет вкладки gemini'); process.exit(1); }
const c=await connect(t.webSocketDebuggerUrl);
// критично: заставить вкладку считать себя видимой/активной → blob-картинки декодируются
try{ await c.send('Emulation.setFocusEmulationEnabled',{enabled:true}); }catch(e){ console.error('focusEmu:',e.message); }
try{ await c.send('Page.enable'); await c.send('Page.setWebLifecycleState',{state:'active'}); }catch(e){ console.error('lifecycle:',e.message); }

for(const [key,breed] of jobs){
  await c.send('Page.navigate',{url:'https://gemini.google.com/app'}); await sleep(7000);
  await ev(c,`const b=[...document.querySelectorAll('button')].find(x=>/Не сейчас|Not now/i.test(x.textContent)); if(b)b.click(); return 1;`);
  const prompt=(STYLE+' '+breed).replace(/`/g,"'");
  const ins=await ev(c,`const box=document.querySelector('rich-textarea [contenteditable="true"],[contenteditable="true"]'); if(!box)return 'nobox'; box.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,${JSON.stringify(prompt)}); return box.textContent.length;`);
  if(ins==='nobox'){ console.error(key,'нет поля'); continue; }
  await sleep(1200);
  const cl=await ev(c,`const s=[...document.querySelectorAll('button')].find(b=>/^Отправить сообщение|^Send message/i.test(b.getAttribute('aria-label')||'')); if(!s||s.disabled)return 'no'; s.click(); return 'ok';`);
  if(cl!=='ok'){ console.error(key,'кнопка недоступна'); continue; }
  console.log(key,'отправлен ('+ins+'), жду…');
  let ready=false;
  for(let i=0;i<50;i++){ await sleep(6000);
    const w=await ev(c,`const last=[...document.querySelectorAll('message-content')].pop(); const img=last?[...last.querySelectorAll('img')].find(i=>/blob:|googleusercontent/.test(i.src)):null; if(!img)return 0; try{await img.decode();}catch(e){} return img.naturalWidth;`);
    if(w>=512){ ready=true; break; }
  }
  if(!ready){ console.error(key,'нет картинки за 5 мин'); continue; }
  const g=await ev(c,`const last=[...document.querySelectorAll('message-content')].pop(); const img=[...last.querySelectorAll('img')].find(i=>i.naturalWidth>=512); await img.decode().catch(()=>{}); const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight; cv.getContext('2d').drawImage(img,0,0); return cv.toDataURL('image/png').slice(22);`);
  fs.writeFileSync(path.join(OUT,key+'.png'),Buffer.from(g,'base64'));
  console.log(key,'OK →',key+'.png',Math.round(g.length*0.75/1024)+'KB');
}
c.close(); console.log('=== готово ===');
