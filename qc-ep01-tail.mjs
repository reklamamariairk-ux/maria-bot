import sharp from 'sharp';
const dir = 'C:/Users/user/AppData/Local/Temp/claude/C--Users-user/a34c7709-73da-43e1-b14b-af99c6180ca0/scratchpad/ep01qc';
const secs = [41,43,45,47,49,51,53,55,57];
const comps = secs.map((s, i) => ({ input: `${dir}/s${s}.jpg`, left: i * 216, top: 0 }));
await sharp({ create: { width: 216*9, height: 386, channels: 3, background: '#000' } })
  .composite(comps).jpeg({ quality: 82 }).toFile(`${dir}/tail_sheet.jpg`);
console.log('ok');
