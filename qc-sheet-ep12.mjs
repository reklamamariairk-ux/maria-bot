import sharp from 'sharp';
const dir = 'C:/Users/user/cartoon-studio/assets/clips/shorts-ep12/qc';
for (let c = 1; c <= 6; c++) {
  const imgs = [1,3,5,7,9].map(s => `${dir}/c${c}_s${s}.jpg`);
  const comps = imgs.map((f, i) => ({ input: f, left: i * 270, top: 0 }));
  await sharp({ create: { width: 270*5, height: 482, channels: 3, background: '#000' } })
    .composite(comps).jpeg({ quality: 82 }).toFile(`${dir}/sheet_c${c}.jpg`);
  console.log('sheet_c' + c);
}
