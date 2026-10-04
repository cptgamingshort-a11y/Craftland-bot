import sharp from 'sharp';
import { classifyScamImage } from '../src/moderation/imageScan.js';

const svg = `<svg width="900" height="500" xmlns="http://www.w3.org/2000/svg">
  <rect width="900" height="500" fill="#172042"/>
  <g fill="white" font-family="Arial" font-size="45">
    <text x="50" y="90">CRYPTO BONUS</text>
    <text x="50" y="180">Visit cryptowins.com</text>
    <text x="50" y="270">Enter promo code BET</text>
    <text x="50" y="360">Withdrawal successful</text>
    <text x="50" y="450">Claim bonus now</text>
  </g>
</svg>`;
const image = await sharp(Buffer.from(svg)).png().toBuffer();
const reason = await classifyScamImage(image);
if (reason !== 'Unsolicited crypto or gambling promotion')
  throw new Error(`Vision check did not flag the synthetic ad: ${reason}`);
console.log('Scam vision check passed.');
