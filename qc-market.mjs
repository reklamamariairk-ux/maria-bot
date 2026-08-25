import sharp from 'sharp';
const dir = 'C:/Users/user/AppData/Local/Temp/claude/C--Users-user/a34c7709-73da-43e1-b14b-af99c6180ca0/scratchpad';
const secs = ['0.5','1.5','11','21','35','41.5','50.5','60.0'];
const comps = secs.map((s, i) => ({ input: `${dir}/mp_${s}.jpg`, left: i * 242, top: 0 }));
await sharp({ create: { width: 242*8, height: 432, channels: 3, background: '#000' } })
  .composite(comps).jpeg({ quality: 85 }).toFile(`${dir}/market_sheet.jpg`);
console.log('ok');
