const assert = require('assert');
const sinon = require('sinon');

let wmic;

describe('node-wmic PowerShell Refactor', () => {
  let sandbox;
  let childProcess;
  const originalPowerShellPath = process.env.POWERSHELL_PATH;
  const originalCimNamespace = process.env.POWERSHELL_CIM_NAMESPACE;

  const clearModule = () => {
    delete require.cache[require.resolve('../index.js')];
  };

  const loadModule = classList => {
    clearModule();
    wmic = require('../index.js');
    return wmic;
  };

  const stubDiscovery = classList => sandbox.stub(childProcess, 'execFileSync').returns(JSON.stringify(classList));

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    childProcess = require('child_process');
    delete process.env.POWERSHELL_PATH;
    delete process.env.POWERSHELL_CIM_NAMESPACE;
    clearModule();
  });

  afterEach(() => {
    if (originalPowerShellPath === undefined) {
      delete process.env.POWERSHELL_PATH;
    } else {
      process.env.POWERSHELL_PATH = originalPowerShellPath;
    }

    if (originalCimNamespace === undefined) {
      delete process.env.POWERSHELL_CIM_NAMESPACE;
    } else {
      process.env.POWERSHELL_CIM_NAMESPACE = originalCimNamespace;
    }

    sandbox.restore();
    clearModule();
  });

  describe('PowerShell CIM Class Discovery', () => {
    it('should discover available CIM classes', () => {
      const execFileSyncStub = stubDiscovery(['Win32_Process', 'Win32_ComputerSystem', 'Win32_OperatingSystem']);
      sandbox.stub(childProcess, 'execFile');

      loadModule();

      assert(execFileSyncStub.calledOnce, 'execFileSync should be called');
      assert.strictEqual(typeof wmic.Win32_Process, 'function');
      assert.strictEqual(typeof wmic.Win32_ComputerSystem, 'function');
    });

    it('should handle single CIM class result', () => {
      stubDiscovery('Win32_Process');
      sandbox.stub(childProcess, 'execFile');

      loadModule();

      assert.strictEqual(typeof wmic.Win32_Process, 'function');
    });

    it('should use PowerShell instead of WMIC', () => {
      const execFileSyncStub = stubDiscovery([]);
      sandbox.stub(childProcess, 'execFile');

      loadModule();

      assert(['pwsh.exe', 'powershell.exe'].includes(execFileSyncStub.firstCall.args[0]), 'Should use a PowerShell executable');
      assert(!execFileSyncStub.firstCall.args[0].includes('WMIC'), 'Should not use WMIC');
    });

    it('should use POWERSHELL_PATH override when provided', () => {
      process.env.POWERSHELL_PATH = 'custom-powershell.exe';
      const execFileSyncStub = stubDiscovery([]);
      sandbox.stub(childProcess, 'execFile');

      loadModule();

      assert.strictEqual(execFileSyncStub.firstCall.args[0], 'custom-powershell.exe');
    });

    it('should use configured CIM namespace for discovery', () => {
      process.env.POWERSHELL_CIM_NAMESPACE = 'root\\custom';
      const execFileSyncStub = stubDiscovery([]);
      sandbox.stub(childProcess, 'execFile');

      loadModule();

      assert(execFileSyncStub.firstCall.args[1][2].includes("Get-CimClass -Namespace 'root\\custom'"));
    });

    it('should fall back to powershell.exe when pwsh.exe discovery fails', () => {
      const execFileSyncStub = sandbox.stub(childProcess, 'execFileSync');
      execFileSyncStub.onFirstCall().throws(new Error('pwsh missing'));
      execFileSyncStub.onSecondCall().returns(JSON.stringify(['Win32_Process']));
      sandbox.stub(childProcess, 'execFile');

      loadModule();

      assert.strictEqual(execFileSyncStub.firstCall.args[0], 'pwsh.exe');
      assert.strictEqual(execFileSyncStub.secondCall.args[0], 'powershell.exe');
      assert.strictEqual(typeof wmic.Win32_Process, 'function');
    });
  });

  describe('CIM Instance Retrieval', () => {
    it('should retrieve CIM instances with Get-CimInstance', async () => {
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      const mockInstance = { ProcessId: 1234, Name: 'test.exe' };
      execFileStub.onFirstCall().callsArgWith(2, null, JSON.stringify([mockInstance]), '');

      loadModule();
      await wmic.Win32_Process();

      assert(execFileStub.firstCall.args[1][2].includes("Get-CimInstance -Namespace 'root\\cimv2' -ClassName 'Win32_Process'"));
    });

    it('should return array of instances', async () => {
      stubDiscovery(['Win32_ComputerSystem']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, JSON.stringify([{ Name: 'MyComputer' }]), '');

      loadModule();
      const result = await wmic.Win32_ComputerSystem();

      assert(Array.isArray(result), 'Result should be an array');
    });

    it('should normalize single instance to array', async () => {
      stubDiscovery(['Win32_ComputerSystem']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, JSON.stringify({ Name: 'MyComputer', Domain: 'example.com' }), '');

      loadModule();
      const result = await wmic.Win32_ComputerSystem();

      assert(Array.isArray(result), 'Single instance should be normalized to array');
      assert.strictEqual(result[0].Name, 'MyComputer', 'Instance data should be preserved');
    });

    it('should use ConvertTo-Json for serialization', async () => {
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, JSON.stringify([]), '');

      loadModule();
      await wmic.Win32_Process();

      assert(execFileStub.firstCall.args[1][2].includes('ConvertTo-Json'));
    });

    it('should escape class names in the PowerShell command', async () => {
      stubDiscovery(["Win32_O'Brien"]);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, JSON.stringify([]), '');

      loadModule();
      await wmic["Win32_O'Brien"]();

      assert(execFileStub.firstCall.args[1][2].includes("-ClassName 'Win32_O''Brien'"));
    });

    it('should fall back to powershell.exe when pwsh.exe instance query fails', async () => {
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, new Error('pwsh missing'), '', '');
      execFileStub.onSecondCall().callsArgWith(2, null, JSON.stringify([]), '');

      loadModule();
      await wmic.Win32_Process();

      assert.strictEqual(execFileStub.firstCall.args[0], 'pwsh.exe');
      assert.strictEqual(execFileStub.secondCall.args[0], 'powershell.exe');
    });

    it('should fall back to powershell.exe when pwsh.exe returns only stderr', async () => {
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, '', 'pwsh failed');
      execFileStub.onSecondCall().callsArgWith(2, null, JSON.stringify([]), '');

      loadModule();
      await wmic.Win32_Process();

      assert.strictEqual(execFileStub.firstCall.args[0], 'pwsh.exe');
      assert.strictEqual(execFileStub.secondCall.args[0], 'powershell.exe');
    });
  });

  describe('Error Handling', () => {
    it('should reject promise on execution error', async () => {
      process.env.POWERSHELL_PATH = 'custom-powershell.exe';
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      const error = new Error('PowerShell execution failed');
      execFileStub.onFirstCall().callsArgWith(2, error, '', '');

      loadModule();

      await assert.rejects(wmic.Win32_Process(), /PowerShell execution failed/);
    });

    it('should reject promise on stderr', async () => {
      process.env.POWERSHELL_PATH = 'custom-powershell.exe';
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, '', 'Class not found');

      loadModule();

      await assert.rejects(wmic.Win32_Process(), err => err === 'Class not found');
    });

    it('should reject promise on invalid JSON', async () => {
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, 'invalid json {{{', '');

      loadModule();

      await assert.rejects(wmic.Win32_Process(), SyntaxError);
    });

    it('should return empty array when PowerShell returns no results', async () => {
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, '', '');

      loadModule();

      assert.deepStrictEqual(await wmic.Win32_Process(), []);
    });

    it('should handle class discovery failure by throwing during require', () => {
      sandbox.stub(childProcess, 'execFileSync').throws(new Error('Failed to discover classes'));
      sandbox.stub(childProcess, 'execFile');

      assert.throws(() => loadModule(), /Failed to discover classes/);
    });
  });

  describe('API Compatibility', () => {
    it('should export object with class methods ready synchronously', () => {
      stubDiscovery(['Win32_Process', 'Win32_Service']);
      sandbox.stub(childProcess, 'execFile');

      loadModule();

      assert.strictEqual(typeof wmic, 'object', 'Should export an object');
      assert.strictEqual(typeof wmic.Win32_Process, 'function');
      assert.strictEqual(typeof wmic.Win32_Service, 'function');
    });

    it('should provide promise-based API', () => {
      stubDiscovery(['Win32_Process']);
      const execFileStub = sandbox.stub(childProcess, 'execFile');
      execFileStub.onFirstCall().callsArgWith(2, null, JSON.stringify([]), '');

      loadModule();

      const result = wmic.Win32_Process();
      assert(result instanceof Promise, 'Methods should return promises');
      return result;
    });
  });
});
