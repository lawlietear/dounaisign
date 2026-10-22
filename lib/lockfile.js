const fs = require('node:fs');

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readLock(lockFile) {
  try {
    return JSON.parse(fs.readFileSync(lockFile, 'utf8'));
  } catch {
    return null;
  }
}

function removeLock(lockFile) {
  try {
    fs.unlinkSync(lockFile);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

function tryAcquireLock(lockFile) {
  try {
    const fd = fs.openSync(lockFile, 'wx');
    const payload = JSON.stringify(
      {
        pid: process.pid,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    );

    fs.writeFileSync(fd, payload);

    return () => {
      fs.closeSync(fd);
      removeLock(lockFile);
    };
  } catch (error) {
    if (error.code === 'EEXIST') {
      return null;
    }

    throw error;
  }
}

function acquireLock(lockFile) {
  const release = tryAcquireLock(lockFile);

  if (release) {
    return release;
  }

  const current = readLock(lockFile);

  if (current && isProcessAlive(current.pid)) {
    return null;
  }

  removeLock(lockFile);
  return tryAcquireLock(lockFile);
}

async function withExclusiveLock(lockFile, work) {
  const release = acquireLock(lockFile);

  if (!release) {
    return { locked: true };
  }

  try {
    return {
      locked: false,
      value: await work(),
    };
  } finally {
    release();
  }
}

module.exports = {
  acquireLock,
  isProcessAlive,
  withExclusiveLock,
};
