import { writeFile } from 'node:fs/promises';

const origin = 'https://ffcraftland.garena.com';
const indexUrl = `${origin}/en/docs/api-31-791/`;
const outputPath = new URL('../CRAFTLAND_GARENA_API_PAGES.md', import.meta.url);
const moduleNames = new Map([
  [1, 'STD Library'], [2, 'List'], [3, 'Map'], [4, 'Math'], [5, 'Strings'],
  [6, 'Convert'], [7, 'Football'], [8, 'Camera'], [9, 'AI'], [11, 'Player'],
  [13, 'Scene'], [15, 'Items'], [16, 'Combat'], [17, 'Collection'],
  [18, 'Workflow'], [19, 'Game Results'], [20, 'Safe Zone'], [22, 'HUD'],
  [24, 'Property Formula'], [25, 'Economy'], [26, 'Level Object'], [27, 'Morph'],
  [28, 'Chat Channel'], [29, 'Team'], [30, 'Playable'], [31, 'Data Storage'],
  [32, 'Dyeing'], [33, 'Physics'], [34, 'Minimap'], [35, 'Animation'],
  [36, 'Behavior Tree'], [37, 'Avatar'], [40, 'Input System'], [41, 'Airdrop'],
  [43, 'Read Table Content'], [44, 'Game Time'], [50, 'Social'],
]);
// The default catalog payload omits some obsolete entries. This list comes
// from the official catalog after enabling its "Obsolete article visible" toggle.
const obsoleteEntries = [
  ['api-1-36', 'Create visual effects [Obsolete]'], ['api-1-37', 'Create visual effects [Obsolete]'],
  ['api-1-38', 'Delete visual effects [Obsolete]'], ['api-1-39', 'Create text [Obsolete]'],
  ['api-1-40', 'Create text [Obsolete]'], ['api-1-41', 'Remove text [Obsolete]'],
  ['api-1-42', 'Create Icon [Obsolete]'], ['api-1-43', 'Create Icon [Obsolete]'],
  ['api-1-44', 'Remove icon [Obsolete]'], ['api-1-53', 'Notify Play Sound [Obsolete]'],
  ['api-1-117', 'Teleport [Obsolete]'], ['api-1-120', "Obtain nearby teammates' locations [Obsolete]"],
  ['api-1-373', 'Play sound effect [Obsolete]'], ['api-1-460', 'Pause sound effect [Obsolete]'],
  ['api-1-461', 'Play sound effect [Obsolete]'], ['api-1-543', 'Create visual effects [Obsolete]'],
  ['api-1-545', 'Create visual effects [Obsolete]'], ['api-1-632', 'Create Sound Effect [Obsolete]'],
  ['api-1-633', 'Pause sound effect [Obsolete]'], ['api-1-634', 'Play sound effect [Obsolete]'],
  ['api-1-917', 'Play One-Shot Sound [Obsolete]'], ['api-4-177', 'Create a direction point [Obsolete]'],
  ['api-4-178', 'Get coordinates [Obsolete]'], ['api-4-179', 'Get direction coordinates [Obsolete]'],
  ['api-5-681', 'Format [Obsolete]'], ['api-13-519', 'Switch Area [Obsolete]'],
  ['api-13-531', 'Get Scene Skybox [Obsolete]'], ['api-15-199', 'Destroy player item [Obsolete]'],
  ['api-15-405', 'Clear Residual Level Objects [Obsolete]'], ['api-16-372', 'Eliminate [Obsolete]'],
  ['api-26-50', 'Remove object [Obsolete]'], ['api-30-429', 'Create Interpolation Motion [Obsolete]'],
  ['api-30-430', 'Custom Curve [Obsolete]'], ['api-35-8016', 'Stop Animation [Obsolete]'],
  ['api-11-103', 'Get random spawn coordinates [Obsolete]'], ['api-11-123', 'Revive [Obsolete]'],
  ['api-11-483', 'Skeleton scale [Obsolete]'], ['api-11-586', 'Quit Game [Obsolete]'],
  ['api-29-318', 'Create Faction [Obsolete]'], ['api-29-319', 'Join Faction [Obsolete]'],
  ['api-29-320', 'Get Attackable Factions [Obsolete]'], ['api-29-321', 'Set Attackable Faction [Obsolete]'],
  ['api-29-322', 'Player attack setting [Obsolete]'], ['api-29-324', 'Get attackable player [Obsolete]'],
  ['api-29-359', 'Quit Faction [Obsolete]'], ['api-29-746', 'Get Faction [Obsolete]'],
  ['api-29-747', 'Is AttackAble [Obsolete]'], ['api-33-736', 'Move CCT [Obsolete]'],
  ['api-19-104', 'Get player score [Obsolete]'], ['api-19-105', "Set player's round score [Obsolete]"],
  ['api-19-106', 'Get team total score [Obsolete]'], ['api-19-107', 'Set team current round score [Obsolete]'],
  ['api-19-108', 'Obtain player round score [Obsolete]'], ['api-19-109', 'Get team round score [Obsolete]'],
  ['api-19-110', 'Get Player Rank [Obsolete]'], ['api-19-112', 'Get Team Rank [Obsolete]'],
  ['api-19-114', 'Get Player Round Rank [Obsolete]'], ['api-19-115', 'Get Team Round Rank [Obsolete]'],
  ['api-19-451', 'Upload battle result [Obsolete]'], ['api-31-463', 'Read Table Value [Obsolete]'],
  ['api-31-464', 'Write Table Value [Obsolete]'], ['api-31-465', 'Remove From Database [Obsolete]'],
  ['api-31-466', 'Read Leaderboard Value [Obsolete]'], ['api-31-467', 'Write Leaderboard Value [Obsolete]'],
  ['api-31-468', 'Remove From Leadboard Database By Key [Obsolete]'], ['api-31-469', 'Remove From Leadboard Database By Rank [Obsolete]'],
  ['api-31-470', 'Read By Rank Range [Obsolete]'], ['api-31-603', 'Read accumulated database [Obsolete]'],
  ['api-31-604', 'Write accumulated database offset [Obsolete]'], ['api-31-661', 'Read Table Value [Obsolete]'],
  ['api-31-662', 'Write Table Value [Obsolete]'], ['api-31-663', 'Remove From Database [Obsolete]'],
  ['api-31-664', 'Read Leaderboard Value [Obsolete]'], ['api-31-665', 'Write Leaderboard Value [Obsolete]'],
  ['api-31-666', 'Remove From Leadboard Database By Key [Obsolete]'], ['api-31-667', 'Remove From Leadboard Database By Rank [Obsolete]'],
  ['api-31-668', 'Read By Rank Range [Obsolete]'], ['api-31-669', 'Read accumulated database [Obsolete]'],
  ['api-31-670', 'Write accumulated database offset [Obsolete]'], ['api-31-792', 'Write To Data Store [Obsolete]'],
  ['api-31-795', 'Write To Leadboard Data Store [Obsolete]'], ['api-31-800', 'Write To Accumulated Data Store [Obsolete]'],
  ['api-31-802', 'Write To Data Store [Obsolete]'], ['api-31-805', 'Write To Leadboard Data Store [Obsolete]'],
  ['api-31-810', 'Write To Accumulated Data Store [Obsolete]'], ['api-31-812', 'Remove From Data Store [Obsolete]'],
  ['api-31-813', 'Remove From Leadboard Data Store By Key [Obsolete]'], ['api-31-814', 'Remove From Leadboard Data Store By Rank [Obsolete]'],
  ['api-31-815', 'Remove From Data Store [Obsolete]'], ['api-31-816', 'Remove From Leadboard Data Store By Key [Obsolete]'],
  ['api-31-817', 'Remove From Leadboard Data Store By Rank [Obsolete]'],
  ['api-31-958', 'Write Database Leaderboard Association Value [Obsolete]'],
  ['api-31-965', 'Write Database Leaderboard Association Value [Obsolete]'],
];

function decodeEmbedded(value) {
  return value
    .replaceAll('\\u003C', '<')
    .replaceAll('\\u003E', '>')
    .replaceAll('\\u0026', '&')
    .replaceAll('\\n', '\n')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

function plainText(value) {
  return decodeEmbedded(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function readTableRows(segment, heading) {
  const normalized = decodeEmbedded(segment);
  const section = normalized.match(
    new RegExp(`<h2>${heading}</h2>[\\s\\S]*?<tbody>([\\s\\S]*?)</tbody>`, 'i'),
  )?.[1];
  if (!section) return [];
  return [...section.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/gi)].map((cell) => plainText(cell[1])))
    .filter((cells) => cells.length >= 3)
    .map(([name, type, description]) => ({ name, type, description }));
}

function parsePage(html, id, title) {
  const declarationAt = html.lastIndexOf('\\u003Ch1>Declaration');
  const signatureStart = html.lastIndexOf('class=\\"language-go\\">');
  if (declarationAt < 0 || signatureStart < 0 || signatureStart >= declarationAt + 1000) {
    return { id, title, missing: true };
  }

  const signatureEnd = html.indexOf('\\n\\u003C/code>', signatureStart);
  const signature = signatureEnd > signatureStart
    ? plainText(html.slice(signatureStart + 'class=\\"language-go\\">'.length, signatureEnd))
    : '';
  const descBoundary = html.lastIndexOf(',"', declarationAt);
  const description = descBoundary >= 0
    ? plainText(html.slice(descBoundary + 2, declarationAt - 2))
    : '';
  const paramsAt = html.indexOf('\\u003Ch1>Parameters', declarationAt);
  const params = paramsAt >= 0 ? html.slice(paramsAt, paramsAt + 18000) : '';
  const input = readTableRows(params, 'Input');
  const output = readTableRows(params, 'Out');

  return {
    id,
    title,
    description,
    signature,
    input,
    output,
    obsolete: /\[obsolete\]/i.test(title),
  };
}

async function fetchPage(url, attempt = 0) {
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'CraftlandKnowledgeIndexer/1.0' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    return fetchPage(url, attempt + 1);
  }
}

const indexHtml = await fetchPage(indexUrl);
const entries = [...indexHtml.matchAll(/"(api-(\d+)-(\d+))","([^"]+)"/g)];
const unique = new Map(entries.map(([, id, moduleId, , title]) => [id, { id, moduleId: Number(moduleId), title }]));
for (const [id, title] of obsoleteEntries) {
  const moduleId = Number(id.match(/^api-(\d+)-/)?.[1]);
  unique.set(id, { id, moduleId, title });
}
const pages = [...unique.values()];
if (pages.length < 500) throw new Error(`Official API catalog extraction looked incomplete (${pages.length} pages).`);

const results = new Array(pages.length);
let next = 0;
const workers = Array.from({ length: 10 }, async () => {
  while (true) {
    const index = next++;
    if (index >= pages.length) return;
    const page = pages[index];
    const url = `${origin}/en/docs/${page.id}/`;
    try {
      results[index] = {
        ...parsePage(await fetchPage(url), page.id, page.title),
        module: moduleNames.get(page.moduleId) ?? `Module ${page.moduleId}`,
        url,
      };
    } catch (error) {
      results[index] = {
        ...page,
        module: moduleNames.get(page.moduleId) ?? `Module ${page.moduleId}`,
        url,
        missing: true,
        error: String(error),
      };
    }
  }
});
await Promise.all(workers);

const lines = [
  '# Garena Craftland API Pages (generated)',
  '',
  `Source: ${origin}/en/docs/api/`,
  `Generated: ${new Date().toISOString().slice(0, 10)}. Catalog pages found: ${pages.length}.`,
  '',
  'This is a searchable reference cache. Open each cited official page for current support/scope badges; the page parser does not infer Mobile/PC or client/server support. Entries marked obsolete are historical and should not be recommended as current APIs.',
  '',
];

for (const page of results) {
  lines.push(`## [${page.module}] ${page.title} — ${page.id}${page.obsolete ? ' — OBSOLETE' : ''}`);
  lines.push(`Official page: ${page.url}`);
  if (page.missing) {
    lines.push('Page details were not extracted; open the official page before answering.');
    lines.push('');
    continue;
  }
  if (page.description) lines.push(`Description: ${page.description}`);
  if (page.signature) lines.push(`Declaration: ${page.signature}`);
  if (page.input.length) {
    lines.push('Inputs:');
    for (const row of page.input) lines.push(`- ${row.name} (${row.type}): ${row.description}`);
  }
  if (page.output.length) {
    lines.push('Outputs:');
    for (const row of page.output) lines.push(`- ${row.name} (${row.type}): ${row.description}`);
  }
  if (!page.description && !page.signature && !page.input.length && !page.output.length) {
    lines.push('No parameter details were extracted; open the official page before answering.');
  }
  lines.push('');
}

await writeFile(outputPath, lines.join('\n'), 'utf8');
const extracted = results.filter((page) => !page.missing).length;
const parameterized = results.filter((page) => page.input?.length || page.output?.length).length;
console.log(`Saved ${pages.length} catalog entries; extracted ${extracted} pages and parameter tables for ${parameterized}.`);
