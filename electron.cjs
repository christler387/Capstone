const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

let apiProcess;

function startApi() {
  apiProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true,
  });

  apiProcess.on('error', (error) => {
    dialog.showErrorBox('Autosupply could not start', error.message);
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#C5C4BF',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.loadURL('http://localhost:3001/?desktop=1');
}

async function waitForApi() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://localhost:3001/');
      if (response.ok) return;
    } catch {
      // The API may still be initializing its database.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('The local API did not become ready within 15 seconds.');
}

app.whenReady().then(async () => {
  startApi();
  try {
    await waitForApi();
    createWindow();
  } catch (error) {
    dialog.showErrorBox('Autosupply could not start', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (apiProcess) apiProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (apiProcess) apiProcess.kill();
});