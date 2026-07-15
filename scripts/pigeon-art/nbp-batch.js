// Батч 16 пород (sizar уже готов). Один общий STYLE + породный блок.
const STYLE = `Glossy 3D animated character render in polished Pixar-like feature-film quality: a single plump cute cartoon PIGEON character standing upright on two tiny orange-red feet, facing the camera in a friendly 3/4 pose, big round dark expressive eyes, soft rosy cheek blush, small curved beak, rich feather micro-detail with soft subsurface scattering, soft studio lighting with gentle contact shadow under the feet, PURE SEAMLESS WHITE BACKGROUND (no floor line, no props, no scenery). Square 1:1 composition, character centered, fills about 80% of frame height. NOT photorealistic, NOT a real bird - a stylized 3D animated mascot. ABSOLUTELY NO text, NO letters, NO watermark. ONE single character only.`;

const BREEDS = {
  belobok:  `THE BREED (Белобокий): light grey city pigeon with clean WHITE flanks, white wing patches and a white belly; soft grey head.`,
  ryaboy:   `THE BREED (Рябой): checkered mottled city pigeon - grey and white speckled chess-like pattern across the wings and body, mischievous look.`,
  chubaty:  `THE BREED (Чубатый): grey city pigeon with a distinct upright feather CREST standing on top of its head like a little pompadour, slightly proud expression.`,
  vanil:    `THE BREED (Ванильный, confectionery series): creamy vanilla-ivory plumage with a warm white sheen, a faint dusting of powdered sugar on the wing tops, sweet gentle expression.`,
  shoko:    `THE BREED (Шоколадный, confectionery series): rich glossy chocolate-brown plumage like milk chocolate, darker cocoa-colored wingtips and tail, warm hazel eyes.`,
  karamel:  `THE BREED (Карамельный, confectionery series): golden caramel-amber plumage with a glossy toffee sheen, warm honey-colored highlights.`,
  yagodny:  `THE BREED (Ягодный, confectionery series): soft raspberry-pink and berry-burgundy tinted plumage, like berry mousse, bright cheerful eyes.`,
  pochtar:  `THE BREED (Иркутский почтарь, postal legend): sturdy slate-grey homing pigeon wearing a tiny brown leather mail satchel strapped across the chest with a small wax-sealed envelope peeking out, reliable determined look.`,
  baikal:   `THE BREED (Байкальский гонец, postal legend): steel-blue pigeon with a white wave-like pattern on the wings like lake waves, wearing a tiny white aviator scarf, windswept dynamic look.`,
  kurier:   `THE BREED (Ночной курьер, postal legend): dark charcoal pigeon with a midnight-blue iridescent sheen, tiny round brass night-flight goggles pushed up on its forehead, cool confident look.`,
  vozhak:   `THE BREED (Вожак стаи, postal legend): big broad-chested slate-grey pigeon with a proud commanding stance, chest puffed out, tiny dark-red captain's epaulettes on the shoulders, wise stern eyes.`,
  svadebny: `THE BREED (Свадебный, festive series): elegant snow-white fantail pigeon with a lush fan-shaped tail spread behind like lace, wearing a tiny black bow tie, graceful pose.`,
  imeninny: `THE BREED (Именинный, festive series): cheerful warm-beige pigeon wearing a tiny striped party cone hat, a few colorful confetti pieces resting on its feathers, joyful open-beak smile.`,
  snezhny:  `THE BREED (Снежный, festive series): fluffy snow-white pigeon with frosty ice-blue feather tips, wearing a tiny cozy knitted scarf, cheeks extra rosy from the cold.`,
  zolotoy:  `THE BREED (Золотой голубь Василия, LEGENDARY): majestic pigeon with radiant METALLIC GOLD plumage, glossy golden sheen over every feather like a polished trophy, a tiny crimson ribbon around the neck, regal sparkling look.`,
  champion: `THE BREED (Чемпион, LEGENDARY race winner): athletic proud pigeon with sleek silver-grey plumage, a shining GOLD MEDAL on a red ribbon around its neck, a tiny golden laurel sprig tucked above one eye, triumphant chest-out pose.`,
};

const t = await window.Clerk.session.getToken();
const outs = {};
for (const [key, breed] of Object.entries(BREEDS)) {
  const r = await fetch('https://fnf-api-gw.higgsfield.ai/fnf/jobs/nano-banana-2', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t },
    body: JSON.stringify({
      params: { prompt: STYLE + '\n' + breed, input_images: [], width: 1024, height: 1024, batch_size: 1, aspect_ratio: '1:1', resolution: '1k', is_storyboard: false, is_zoom_control: false, use_unlim: false },
      use_unlim: false, use_seedream_bonus: false
    })
  });
  const j = await r.json().catch(() => null);
  outs[key] = { status: r.status, set: j && j.job_sets && j.job_sets[0] && j.job_sets[0].id };
  await new Promise(res => setTimeout(res, 800));
}
return JSON.stringify(outs);
