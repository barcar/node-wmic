const { execFile, execFileSync } = require('child_process');
const iconv = require('iconv-lite');

// Use PowerShell instead of deprecated WMIC
const powershell = process.env.SystemRoot ? 
  `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 
  'powershell.exe';

// Get list of CIM classes available
const getClassList = () => {
  return new Promise((resolve, reject) => {
    const psCommand = "Get-CimClass -Namespace 'root\\cimv2' | Select-Object -ExpandProperty CimClassName | ConvertTo-Json";
    execFile(powershell, ['-NoProfile', '-Command', psCommand], (err, stdout, stderr) => {
      if (err || stderr) {
        reject(err || stderr);
      }

      try {
        const classes = JSON.parse(stdout.trim());
        resolve(Array.isArray(classes) ? classes : [classes]);
      } catch (e) {
        reject(e);
      }
    });
  });
};

const data = {};

// Build async wrapper for each CIM class
getClassList().then(classList => {
  for (let className of classList) {
    data[className] = () =>
      new Promise((resolve, reject) => {
        const psCommand = `Get-CimInstance -ClassName '${className}' | ConvertTo-Json -Depth 10`;
        execFile(powershell, ['-NoProfile', '-Command', psCommand], (err, stdout, stderr) => {
          if (err || stderr) {
            reject(err || stderr);
            return;
          }

          try {
            const result = JSON.parse(stdout.trim());
            // Normalize to array format for consistency with original
            const jsonGroup = Array.isArray(result) ? result : [result];
            resolve(jsonGroup);
          } catch (e) {
            reject(e);
          }
        });
      });
  }
}).catch(err => {
  console.error('Failed to initialize CIM classes:', err);
});

module.exports = data;
