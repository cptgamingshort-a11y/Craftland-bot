import sharp from 'sharp';

export async function createLevelUpBanner(
  avatarUrl: string,
  oldLevel: number,
  newLevel: number,
) {
  const width = 360;
  const height = 116;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="${width}" height="${height}" rx="16" fill="#202428"/>
    <circle cx="62" cy="58" r="45" fill="#343b43"/>
    <text x="126" y="55" fill="#ffffff" font-family="Arial,sans-serif" font-size="39" font-weight="700">Level-up!</text>
    <text x="230" y="99" text-anchor="middle" fill="#ffffff" font-family="Arial,sans-serif" font-size="34" font-weight="700">${oldLevel} &#x2022; ${newLevel}</text>
  </svg>`;
  const avatar = await fetch(avatarUrl, { signal: AbortSignal.timeout(5000) })
    .then(async (response) => {
      if (!response.ok) throw new Error('Avatar unavailable');
      return Buffer.from(await response.arrayBuffer());
    })
    .catch(() => null);
  if (!avatar) return sharp(Buffer.from(svg)).png().toBuffer();
  const mask = Buffer.from(
    '<svg width="90" height="90"><circle cx="45" cy="45" r="45" fill="white"/></svg>',
  );
  const roundAvatar = await sharp(avatar)
    .resize(90, 90)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  return sharp(Buffer.from(svg))
    .composite([{ input: roundAvatar, left: 17, top: 13 }])
    .png()
    .toBuffer();
}
