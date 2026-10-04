import { z } from 'zod';
import { gemini, redactSecrets, type AIContext } from './gemini.js';
export const groundedSchema = z.object({
  overview: z.string().max(1000),
  references: z
    .array(
      z.object({ path: z.string().max(200), comment: z.string().max(200) }),
    )
    .max(8),
});
export function flattenFacts(
  value: unknown,
  prefix = '',
  out: Record<string, string | number | boolean | null> = {},
) {
  if (Array.isArray(value))
    value
      .slice(0, 50)
      .forEach((v, i) =>
        flattenFacts(v, `${prefix}${prefix ? '.' : ''}${i}`, out),
      );
  else if (value && typeof value === 'object')
    Object.entries(value).forEach(([k, v]) =>
      flattenFacts(v, `${prefix}${prefix ? '.' : ''}${k}`, out),
    );
  else if (
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value)
  )
    out[prefix] = value as string | number | boolean | null;
  return out;
}
export function renderGroundedResponse(
  value: unknown,
  facts: Record<string, string | number | boolean | null>,
) {
  const parsed = groundedSchema.parse(value);
  if (
    /\d|<@|https?:\/\//.test(parsed.overview) ||
    parsed.references.some((r) => /\d|<@|https?:\/\//.test(r.comment))
  )
    throw new Error('Ungrounded numerical/member content in AI prose.');
  for (const r of parsed.references)
    if (!Object.hasOwn(facts, r.path))
      throw new Error('AI referenced an unknown fact.');
  return (
    parsed.overview +
    '\n\n' +
    parsed.references
      .map(
        (r) =>
          `• **${r.path}:** ${String(facts[r.path]).slice(0, 150)}${r.comment ? ` — ${r.comment}` : ''}`,
      )
      .join('\n')
  );
}
export async function aiAnswer(
  question: string,
  facts: unknown,
  context: AIContext = { type: 'summary', actorId: 'system', guildId: '' },
): Promise<string> {
  const clean = redactSecrets(facts);
  const flat = flattenFacts(clean);
  const bounded = Object.fromEntries(Object.entries(flat).slice(0, 250));
  const fallback =
    'Verified database facts:\n' +
    Object.entries(bounded)
      .slice(0, 24)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 150)}`)
      .join('\n');
  const request = JSON.stringify({
    task: question.slice(0, 1500),
    instructions:
      'Use only DATA. Return an overview with NO numbers, IDs, mentions or numerical statistics. For statistics and member references, supply exact fact paths from DATA; the server will render values itself. Comments contain no numbers. Never invent facts or decisions. Eligibility is already computed; explain checks only.',
    DATA: bounded,
  });
  const response = await gemini.generate(
    request,
    context,
    z.toJSONSchema(groundedSchema),
  );
  if (!response.success)
    return `${response.error}\n\n${fallback}`.slice(0, 3500);
  try {
    return renderGroundedResponse(JSON.parse(response.text), bounded).slice(
      0,
      3500,
    );
  } catch {
    return (
      'Gemini response failed grounding validation.\n\n' +
      fallback.slice(0, 3200)
    );
  }
}
