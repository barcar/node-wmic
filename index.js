const { execFile, execFileSync } = require('child_process');

const defaultPowershell = process.env.POWERSHELL_PATH || 'pwsh.exe';
const fallbackPowershell = 'powershell.exe';
const cimNamespace = process.env.POWERSHELL_CIM_NAMESPACE || 'root\\cimv2';

const escapePowerShellString = value => String(value).replace(/'/g, "''");

const parseClassList = stdout => {
  const output = String(stdout).trim();
  if (!output) {
    return [];
  }

  const classes = JSON.parse(output);
  return Array.isArray(classes) ? classes : [classes];
};

const parseCimInstance = stdout => {
  const output = String(stdout).trim();
  if (!output) {
    return [];
  }

  const result = JSON.parse(output);
  return Array.isArray(result) ? result : [result];
};

const buildPowershellArgs = command => ['-NoProfile', '-Command', command];

const runPowerShellSync = command => {
  try {
    return execFileSync(defaultPowershell, buildPowershellArgs(command), { encoding: 'utf8' });
  } catch (err) {
    if (defaultPowershell !== 'pwsh.exe') {
      throw err;
    }

    return execFileSync(fallbackPowershell, buildPowershellArgs(command), { encoding: 'utf8' });
  }
};

const runPowerShell = (command, callback) => {
  execFile(defaultPowershell, buildPowershellArgs(command), (err, stdout, stderr) => {
    if (defaultPowershell === 'pwsh.exe' && (err || (stderr && !String(stdout).trim()))) {
      execFile(fallbackPowershell, buildPowershellArgs(command), callback);
      return;
    }

    callback(err, stdout, stderr);
  });
};

const getClassList = () =>
  parseClassList(
    runPowerShellSync(
      `Get-CimClass -Namespace '${escapePowerShellString(cimNamespace)}' | Select-Object -ExpandProperty CimClassName | ConvertTo-Json -Compress`
    )
  );

const data = {};

for (const className of getClassList()) {
  data[className] = () =>
    new Promise((resolve, reject) => {
      const psCommand =
        `Get-CimInstance -Namespace '${escapePowerShellString(cimNamespace)}' ` +
        `-ClassName '${escapePowerShellString(className)}' | ConvertTo-Json -Depth 10 -Compress`;

      runPowerShell(psCommand, (err, stdout, stderr) => {
        if (err || stderr) {
          reject(err || stderr);
          return;
        }

        try {
          resolve(parseCimInstance(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      });
    });
}

module.exports = data;
