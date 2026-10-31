import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(repoRoot, 'elhelb-llm');
const deployRoot = path.join(repoRoot, 'my-agent');

const directories = ['api', 'company-data', 'server', 'shared', 'src', 'static', 'tests'];
const files = ['index.html', 'package.json', 'package-lock.json', 'vercel.json', 'vite.config.js'];
const staleFiles = [
  'assets',
  'elhelb-ai-app-logo.png',
  'favicon.png',
  'logo.png',
  'website-demo.html',
  'widget.js',
];

for (const entry of [...directories, ...files]) {
  const source = path.join(sourceRoot, entry);
  const target = path.join(deployRoot, entry);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing canonical LLM deployment source: ${path.relative(repoRoot, source)}`);
  }

  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
}

for (const entry of staleFiles) {
  fs.rmSync(path.join(deployRoot, entry), { recursive: true, force: true });
}

const mirrorReadme = [
  '# Vercel deployment mirror for ELHELB LLM',
  '',
  'This directory is the Vercel deployment root for the existing `elhelb-my-agent` project.',
  'The canonical application source is in [../elhelb-llm](../elhelb-llm).',
  '',
  'After changing the canonical LLM application, refresh this deployment mirror from the repository root with:',
  '',
  '```sh',
  'node scripts/sync-llm-vercel.mjs',
  '```',
  '',
  'Vercel builds this directory with `npm run build`, serves the generated `public/` directory,',
  'and uses `api/index.js` for serverless API routes.',
  '',
].join('\n');

fs.writeFileSync(path.join(deployRoot, 'README.md'), mirrorReadme, 'utf8');

console.log('Synced elhelb-llm deployment sources into my-agent/.');
