# Vercel deployment mirror for ELHELB LLM

This directory is the Vercel deployment root for the existing `elhelb-my-agent` project.
The canonical application source is in [../elhelb-llm](../elhelb-llm).

After changing the canonical LLM application, refresh this deployment mirror from the repository root with:

```sh
node scripts/sync-llm-vercel.mjs
```

Vercel builds this directory with `npm run build`, serves the generated `public/` directory,
and uses `api/index.js` for serverless API routes.
