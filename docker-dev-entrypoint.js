const { execSync, spawn } = require('child_process');

function run(label, cmd) {
  console.log(`==> ${label}...`);
  execSync(cmd, { stdio: 'inherit' });
}

run('Installing dependencies', 'npm install --prefer-offline');
run('Generating Prisma client', 'npx prisma generate');
run('Pushing schema to database', 'npx prisma db push --skip-generate');
run('Seeding database', 'npx --yes tsx prisma/seed.ts');

console.log('==> Starting Next.js dev server...');
const child = spawn('node', ['node_modules/next/dist/bin/next', 'dev', '--hostname', '0.0.0.0', '--port', '3000'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  console.log(`next dev parent exited (code ${code}), worker still serving on :3000`);
});

// Keep this process alive forever so the container doesn't stop
setInterval(() => {}, 1 << 30);

process.on('SIGTERM', () => { process.exit(0); });
process.on('SIGINT', () => { process.exit(0); });
