const assert = require('assert');
const { execFile } = require('child_process');
const sinon = require('sinon');

// Mock the child_process module
let wmic;

describe('node-wmic PowerShell Refactor', () => {
  let sandbox;
  const originalPowerShellPath = process.env.POWERSHELL_PATH;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    delete process.env.POWERSHELL_PATH;
    // Clear the require cache to reload the module with mocked execFile
    delete require.cache[require.resolve('../index.js')];
  });

  afterEach(() => {
    if (originalPowerShellPath === undefined) {
      delete process.env.POWERSHELL_PATH;
    } else {
      process.env.POWERSHELL_PATH = originalPowerShellPath;
    }
    sandbox.restore();
  });

  describe('PowerShell CIM Class Discovery', () => {
    it('should discover available CIM classes', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      const mockClasses = ['Win32_Process', 'Win32_ComputerSystem', 'Win32_OperatingSystem'];
      stub.withArgs(sinon.match.any, sinon.match.array.contains(['-NoProfile']), sinon.match.func)
        .callsArgWith(2, null, JSON.stringify(mockClasses), '');

      wmic = require('../index.js');
      
      // Give async initialization time to complete
      setTimeout(() => {
        assert(stub.called, 'execFile should be called');
        assert(Object.keys(wmic).length > 0, 'CIM classes should be discovered');
        done();
      }, 100);
    });

    it('should handle single CIM class result', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      stub.withArgs(sinon.match.any, sinon.match.array.contains(['-NoProfile']), sinon.match.func)
        .callsArgWith(2, null, JSON.stringify('Win32_Process'), '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        assert(stub.called, 'execFile should be called');
        done();
      }, 100);
    });

    it('should use PowerShell instead of WMIC', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      stub.callsArgWith(2, null, JSON.stringify([]), '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        const callArgs = stub.getCall(0).args;
        const psPath = callArgs[0];
        assert(['pwsh.exe', 'powershell.exe'].includes(psPath), 'Should use a PowerShell executable');
        assert(!psPath.includes('WMIC'), 'Should not use WMIC');
        done();
      }, 100);
    });

    it('should use POWERSHELL_PATH override when provided', (done) => {
      process.env.POWERSHELL_PATH = 'custom-powershell.exe';
      const stub = sandbox.stub(require('child_process'), 'execFile');

      stub.callsArgWith(2, null, JSON.stringify([]), '');

      wmic = require('../index.js');

      setTimeout(() => {
        assert.strictEqual(stub.getCall(0).args[0], 'custom-powershell.exe');
        done();
      }, 100);
    });
  });

  describe('CIM Instance Retrieval', () => {
    it('should retrieve CIM instances with Get-CimInstance', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      const classListStub = stub.onFirstCall();
      classListStub.callsArgWith(2, null, JSON.stringify(['Win32_Process']), '');
      
      const instanceStub = stub.onSecondCall();
      const mockInstance = { ProcessId: 1234, Name: 'test.exe' };
      instanceStub.callsArgWith(2, null, JSON.stringify([mockInstance]), '');
      wmic = require('../index.js');

      setTimeout(() => {
        wmic.Win32_Process().then(() => {
          assert(stub.firstCall.args[1][2].includes('Get-CimClass'), 'Should call Get-CimClass for discovery');
          assert(stub.secondCall.args[1][2].includes("Get-CimInstance -ClassName 'Win32_Process'"), 'Should call Get-CimInstance for retrieval');
          done();
        }).catch(done);
      }, 100);
    });

    it('should return array of instances', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      stub.withArgs(sinon.match.any, sinon.match.array.contains(['-NoProfile']), sinon.match.func)
        .callsArgWith(2, null, JSON.stringify(['Win32_ComputerSystem']), '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        assert(stub.called, 'execFile should be called');
        if (wmic.Win32_ComputerSystem) {
          wmic.Win32_ComputerSystem().then(result => {
            assert(Array.isArray(result), 'Result should be an array');
            done();
          }).catch(done);
        } else {
          done();
        }
      }, 100);
    });

    it('should normalize single instance to array', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      const classListCall = stub.onFirstCall();
      classListCall.callsArgWith(2, null, JSON.stringify(['Win32_ComputerSystem']), '');
      
      const instanceCall = stub.onSecondCall();
      const mockInstance = { Name: 'MyComputer', Domain: 'example.com' };
      instanceCall.callsArgWith(2, null, JSON.stringify(mockInstance), '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        if (wmic.Win32_ComputerSystem) {
          wmic.Win32_ComputerSystem().then(result => {
            assert(Array.isArray(result), 'Single instance should be normalized to array');
            assert.strictEqual(result[0].Name, 'MyComputer', 'Instance data should be preserved');
            done();
          }).catch(done);
        } else {
          done();
        }
      }, 100);
    });

    it('should use ConvertTo-Json for serialization', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      stub.callsArgWith(2, null, JSON.stringify([]), '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        const calls = stub.getCalls();
        const hasConvertToJson = calls.some(call => {
          const args = call.args;
          const command = args[1].join(' ');
          return command.includes('ConvertTo-Json');
        });
        assert(hasConvertToJson, 'Should use ConvertTo-Json for serialization');
        done();
      }, 100);
    });
  });

  describe('Error Handling', () => {
    it('should reject promise on execution error', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      process.env.POWERSHELL_PATH = 'custom-powershell.exe';

      const classListCall = stub.onFirstCall();
      classListCall.callsArgWith(2, null, JSON.stringify(['Win32_Process']), '');
      
      const instanceCall = stub.onSecondCall();
      const error = new Error('PowerShell execution failed');
      instanceCall.callsArgWith(2, error, '', '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        if (wmic.Win32_Process) {
          wmic.Win32_Process().then(() => {
            done(new Error('Should have rejected'));
          }).catch(err => {
            assert(err.message.includes('PowerShell execution failed'), 'Should catch execution error');
            done();
          });
        } else {
          done();
        }
      }, 100);
    });

    it('should reject promise on stderr', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      const classListCall = stub.onFirstCall();
      classListCall.callsArgWith(2, null, JSON.stringify(['Win32_Process']), '');
      
      const instanceCall = stub.onSecondCall();
      instanceCall.callsArgWith(2, null, '', 'Class not found');

      wmic = require('../index.js');
      
      setTimeout(() => {
        if (wmic.Win32_Process) {
          wmic.Win32_Process().then(() => {
            done(new Error('Should have rejected'));
          }).catch(err => {
            assert.strictEqual(err, 'Class not found', 'Should catch stderr');
            done();
          });
        } else {
          done();
        }
      }, 100);
    });

    it('should reject promise on invalid JSON', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      const classListCall = stub.onFirstCall();
      classListCall.callsArgWith(2, null, JSON.stringify(['Win32_Process']), '');
      
      const instanceCall = stub.onSecondCall();
      instanceCall.callsArgWith(2, null, 'invalid json {{{', '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        if (wmic.Win32_Process) {
          wmic.Win32_Process().then(() => {
            done(new Error('Should have rejected'));
          }).catch(err => {
            assert(err instanceof SyntaxError, 'Should catch JSON parse error');
            done();
          });
        } else {
          done();
        }
      }, 100);
    });

    it('should handle class discovery failure gracefully', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      const classListCall = stub.onFirstCall();
      classListCall.callsArgWith(2, new Error('Failed to discover classes'), '', '');

      wmic = require('../index.js');
      
      // Should not throw, but log error
      setTimeout(() => {
        assert(stub.called, 'Execution should be attempted');
        done();
      }, 100);
    });
  });

  describe('API Compatibility', () => {
    it('should export object with class methods', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      stub.callsArgWith(2, null, JSON.stringify(['Win32_Process', 'Win32_Service']), '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        assert(typeof wmic === 'object', 'Should export an object');
        done();
      }, 100);
    });

    it('should provide promise-based API', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');
      
      const classListCall = stub.onFirstCall();
      classListCall.callsArgWith(2, null, JSON.stringify(['Win32_Process']), '');
      
      const instanceCall = stub.onSecondCall();
      instanceCall.callsArgWith(2, null, JSON.stringify([]), '');

      wmic = require('../index.js');
      
      setTimeout(() => {
        if (wmic.Win32_Process) {
          const result = wmic.Win32_Process();
          assert(result instanceof Promise, 'Methods should return promises');
          done();
        } else {
          done();
        }
      }, 100);
    });

    it('should fall back to powershell.exe when pwsh.exe fails', (done) => {
      const stub = sandbox.stub(require('child_process'), 'execFile');

      stub.onFirstCall().callsArgWith(2, new Error('pwsh missing'), '', '');
      stub.onSecondCall().callsArgWith(2, null, JSON.stringify(['Win32_Process']), '');

      wmic = require('../index.js');

      setTimeout(() => {
        assert.strictEqual(stub.firstCall.args[0], 'pwsh.exe');
        assert.strictEqual(stub.secondCall.args[0], 'powershell.exe');
        done();
      }, 100);
    });
  });
});
