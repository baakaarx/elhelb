const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function resolveWritableDataDir() {
  if (process.env.ELHELB_DATA_DIR) {
    fs.mkdirSync(process.env.ELHELB_DATA_DIR, { recursive: true });
    return process.env.ELHELB_DATA_DIR;
  }

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const tmpDir = path.join(os.tmpdir(), 'elhelb-llm-data');
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }

  const localDataDir = path.join(__dirname, '..', 'data');
  try {
    fs.mkdirSync(localDataDir, { recursive: true });
    fs.accessSync(localDataDir, fs.constants.W_OK);
    return localDataDir;
  } catch {
    const tmpDir = path.join(os.tmpdir(), 'elhelb-llm-data');
    fs.mkdirSync(tmpDir, { recursive: true });
    return tmpDir;
  }
}

const DATA_DIR = resolveWritableDataDir();

module.exports = {
  DATA_DIR,
};
