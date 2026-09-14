const { execFile, execFileSync } = require('child_process');
const iconv = require('iconv-lite');

// Use PowerShell instead of deprecated WMIC
// Prefer PowerShell 7+ (pwsh) but fall back to Windows PowerShell (powershell.exe)
// Allow override via POWERSHELL_PATH environment variable
const powershell = process.env.POWERSHELL_PATH || 'pwsh.exe';
const fallbackPowershell = 'powershell.exe';

// Get list of CIM classes available
const getClassList = () => {
  return new Promise((resolve, reject) => {
    const psCommand = "Get-CimClass -Namespace 'root\\cimv2' | Select-Object -ExpandProperty CimClassName | ConvertTo-Json";
    
    execFile(powershell, ['-NoProfile', '-Command', psCommand], (err, stdout, stderr) => {
      // If pwsh.exe fails, try fallback to powershell.exe
      if (err && powershell === 'pwsh.exe') {
        execFile(fallbackPowershell, ['-NoProfile', '-Command', psCommand], (err2, stdout2, stderr2) => {
          if (err2 || stderr2) {
            reject(err2 || stderr2);
            return;
          }
          parseClassList(stdout2, resolve, reject);
        });
        return;
      }

      if (err || stderr) {
        reject(err || stderr);
        return;
      }

      parseClassList(stdout, resolve, reject);
    });
  });
};

const parseClassList = (stdout, resolve, reject) => {
  try {
    const classes = JSON.parse(stdout.trim());
    resolve(Array.isArray(classes) ? classes : [classes]);
  } catch (e) {
    reject(e);
  }
};

const data = {};

// Build async wrapper for each CIM class
getClassList().then(classList => {
  for (let className of classList) {
    data[className] = () =>
      new Promise((resolve, reject) => {
        const psCommand = `Get-CimInstance -ClassName '${className}' | ConvertTo-Json -Depth 10`;
        
        execFile(powershell, ['-NoProfile', '-Command', psCommand], (err, stdout, stderr) => {
          // If pwsh.exe fails, try fallback to powershell.exe
          if (err && powershell === 'pwsh.exe') {
            execFile(fallbackPowershell, ['-NoProfile', '-Command', psCommand], (err2, stdout2, stderr2) => {
              if (err2 || stderr2) {
                reject(err2 || stderr2);
                return;
              }
              parseCimInstance(stdout2, resolve, reject);
            });
            return;
          }

          if (err || stderr) {
            reject(err || stderr);
            return;
          }

          parseCimInstance(stdout, resolve, reject);
        });
      });
  }
}).catch(err => {
  console.error('Failed to initialize CIM classes:', err);
});

const parseCimInstance = (stdout, resolve, reject) => {
  try {
    const result = JSON.parse(stdout.trim());
    // Normalize to array format for consistency with original
    const jsonGroup = Array.isArray(result) ? result : [result];
    resolve(jsonGroup);
  } catch (e) {
    reject(e);
  }
};

module.exports = data;
