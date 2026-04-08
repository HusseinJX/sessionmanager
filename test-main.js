const electron = require('electron');
console.log('electron type:', typeof electron);
if (typeof electron === 'object') {
  console.log('app:', typeof electron.app);
  const { app } = electron;
  app.whenReady().then(() => { 
    console.log('isPackaged:', app.isPackaged); 
    app.quit(); 
  });
} else {
  console.log('electron is NOT a module, it is:', String(electron).slice(0,80));
  process.exit(1);
}
