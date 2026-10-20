import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseStudyConfig } from '../src/parser/parser';

const root = process.cwd();
globalThis.fetch = async (input) => {
  const pathname = new URL(String(input), 'http://localhost').pathname;
  return new Response(fs.readFileSync(path.join(root, 'public', pathname)));
};

const configs: Record<string, { hash: string; content: string }> = {};
for (let part = 1; part <= 4; part += 1) {
  const study = `HAIC_part_${part}`;
  const parsed = await parseStudyConfig(fs.readFileSync(path.join(root, 'public', study, 'config.json'), 'utf8'));
  if (parsed.errors.length) throw new Error(JSON.stringify(parsed.errors));
  const content = JSON.stringify(parsed);
  configs[study] = { hash: createHash('sha256').update(content).digest('hex'), content };
}
fs.writeFileSync(path.join(root, 'services/haic_api/study_configs.json'), `${JSON.stringify(configs)}\n`);
