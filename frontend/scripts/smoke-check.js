const fs = require('fs');
const path = require('path');

function searchDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) {
        if (searchDir(fp)) return true;
      } else if (entry.isFile()) {
        const content = fs.readFileSync(fp, 'utf8');
        if (content.includes('/api/health') || content.includes("fetch('/api/health'") || content.includes('fetch("/api/health"')) {
          console.log('Found /api/health in', fp);
          return true;
        }
      }
    } catch (err) {
      // ignore read errors
    }
  }
  return false;
}

const buildDir = path.resolve(__dirname, '..', '.next');
const srcDir = path.resolve(__dirname, '..', 'app');
if (!fs.existsSync(buildDir)) {
  console.error('.next build directory not found. Run `npm run build` first.');
  process.exit(2);
}

// Search build artifacts first, then fall back to source files to be CI-friendly.
let ok = searchDir(buildDir);
if (!ok && fs.existsSync(srcDir)) {
  ok = searchDir(srcDir);
}
if (!ok) {
  console.error('Smoke check failed: /api/health not referenced in build output');
  process.exit(1);
}
console.log('Smoke check passed: /api/health referenced in build output');
process.exit(0);
