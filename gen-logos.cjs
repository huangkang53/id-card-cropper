const sharp = require('sharp');
const fs = require('fs');
const out = 'C:/pack/store-logos';
fs.mkdirSync(out, { recursive: true });

const svg = `<svg width='300' height='300' xmlns='http://www.w3.org/2000/svg'>
<rect width='300' height='300' rx='50' fill='#3B82F6'/>
<g stroke='white' stroke-width='8' fill='none' stroke-linecap='round'>
<path d='M60 100 V60 H100'/>
<path d='M200 60 H240 V100'/>
<path d='M240 200 V240 H200'/>
<path d='M100 240 H60 V200'/>
</g>
<g stroke='rgba(255,255,255,0.5)' stroke-width='3'>
<line x1='60' y1='60' x2='200' y2='240'/>
<line x1='240' y1='60' x2='100' y2='240'/>
</g>
</svg>`;

sharp(Buffer.from(svg)).png().toFile(out + '/StoreLogo_300.png').then(() => {
  sharp(out + '/StoreLogo_300.png').resize(150,150).png().toFile(out + '/StoreLogo_150.png');
  sharp(out + '/StoreLogo_300.png').resize(71,71).png().toFile(out + '/StoreLogo_71.png');
  console.log('done');
});
