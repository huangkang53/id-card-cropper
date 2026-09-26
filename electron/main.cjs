const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const net = require('net');

let backend;
let win;
let PORT = 38421;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function startBackend() {
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'server', 'index.mjs')
    : path.join(app.getAppPath(), 'server', 'index.mjs');

  const env = { ...process.env, PORT: String(PORT), ELECTRON_RUN_AS_NODE: '1' };
  if (app.isPackaged) {
    env.NODE_PATH = path.join(process.resourcesPath, 'server', 'node_modules');
  }

  backend = spawn(process.execPath, [serverPath], {
    env,
    stdio: 'inherit',
  });
}

function waitForBackend(retries = 60) {
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      http.get(`http://127.0.0.1:${PORT}/openapi/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else retry();
      }).on('error', retry);
    };
    const retry = () => {
      if (retries-- <= 0) return reject(new Error('Backend failed to start'));
      setTimeout(tryConnect, 500);
    };
    tryConnect();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: '图片批量透视裁剪工具',
    autoHideMenuBar: true,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'build', 'icon.png')
      : path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);
}

ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: '选择身份证照片（可多选）',
    filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'tiff', 'webp'] }],
    properties: ['openFile', 'multiSelections'],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: '选择身份证照片文件夹',
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

app.whenReady().then(async () => {
  PORT = await getFreePort();
  startBackend();
  try {
    await waitForBackend();
  } catch (e) {
    console.error(e);
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (backend) backend.kill();
  app.quit();
});
