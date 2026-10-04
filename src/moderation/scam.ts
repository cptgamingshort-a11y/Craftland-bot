/** High-confidence filter for unsolicited financial promotion, not general finance chat. */
export function scamPromotionReason(value: string): string | null {
  const text = value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ');
  if (/\b(beware|warning|reporting|reported|scam alert|fake ad|do not click|don't click)\b/.test(text))
    return null;

  const finance = /\b(crypto|cryptocurrency|bitcoin|btc|usdt|casino|betting|wager|withdrawal|withdraw|deposit)\b/.test(text);
  const lure = /\b(promo\s*code|bonus|giveaway|free\s+(?:money|cash|coins)|claim\s+(?:your\s+)?reward|activate\s+code|cashback|withdrawal\s+success(?:ful)?)\b/.test(text);
  const conversion = /\b(sign\s*up|register\s+now|enter\s+(?:the\s+)?code|activate|join\s+now|visit|claim|follow\s+me)\b/.test(text);
  const destination = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|bet|vip)\b)/.test(text);
  if (finance && lure && (conversion || destination))
    return 'Unsolicited crypto or gambling promotion';
  return null;
}
