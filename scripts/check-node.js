if (process.platform !== 'win32' || process.arch !== 'x64' ||
    Number(process.versions.node.split('.')[0]) !== 24) {
  console.error('Windows x64 Node.js 24 is required.');
  process.exitCode = 1;
}
