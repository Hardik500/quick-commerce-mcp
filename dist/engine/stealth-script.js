/**
 * JavaScript runtime stealth patches for Playwright
 * Makes browser appear as real user browser, not automation
 */
export const stealthScript = `
(() => {
  // Override navigator.webdriver
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });

  // Override navigator.plugins to appear legit
  Object.defineProperty(navigator, 'plugins', {
    get: () => [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Native Client', filename: 'native_client.dll' },
    ],
  });

  // Override navigator.languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['en-US', 'en', 'hi'],
  });

  // Override permissions API
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (parameters) => (
    parameters.name === 'notifications' 
      ? Promise.resolve({ state: Notification.permission })
      : originalQuery(parameters)
  );

  // Hide Playwright-specific properties
  delete window.__playwright;
  delete window.__pw_manual;
  delete window.__PW_inspect;

  // Patch navigator.connection
  Object.defineProperty(navigator, 'connection', {
    get: () => ({
      effectiveType: '4g',
      downlink: 10,
      rtt: 50,
      saveData: false,
    }),
  });

  // Override chrome.runtime
  window.chrome = {
    runtime: {
      OnInstalledReason: { CHROME_UPDATE: 'chrome_update', UPDATE: 'update', INSTALL: 'install' },
      OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', MIPS64EL: 'mips64el', MIPSel: 'mipsel', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', MIPS64EL: 'mips64el', MIPSel: 'mipsel', MIPSEB: 'mipsel', MIPSEB64: 'mips64el', X86_32: 'x86-32', X86_64: 'x86-64' },
      PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
      RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
    },
  };

  // Add missing chrome APIs
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    };
  }

  // Override notification permission
  const originalNotification = window.Notification;
  Object.defineProperty(window, 'Notification', {
    value: function(title, options) {
      return originalNotification.apply(this, arguments);
    },
    writable: true,
    configurable: true,
  });
  Object.defineProperty(Notification, 'permission', {
    get: () => 'default',
    writable: true,
    configurable: true,
  });

  // Patch window.outerWidth/Height to match viewport
  Object.defineProperty(window, 'outerWidth', {
    get: () => window.innerWidth,
  });
  Object.defineProperty(window, 'outerHeight', {
    get: () => window.innerHeight,
  });

  // Add device memory
  Object.defineProperty(navigator, 'deviceMemory', {
    get: () => 8,
  });

  // Add hardware concurrency
  Object.defineProperty(navigator, 'hardwareConcurrency', {
    get: () => 4,
  });

  // Override max touch points
  Object.defineProperty(navigator, 'maxTouchPoints', {
    get: () => 5,
  });

  // Add vendor
  Object.defineProperty(navigator, 'vendor', {
    get: () => 'Google Inc.',
  });

  // Add productSub
  Object.defineProperty(navigator, 'productSub', {
    get: () => '20030107',
  });

  // Patch console to hide automation warnings
  const originalConsoleLog = console.log;
  console.log = function(...args) {
    if (args.length > 0 && typeof args[0] === 'string') {
      if (args[0].includes('playwright') || args[0].includes('automation')) {
        return;
      }
    }
    return originalConsoleLog.apply(this, args);
  };

  // Override eval length (fingerprinting technique)
  const originalEval = window.eval;
  window.eval = function(...args) {
    return originalEval.apply(this, args);
  };
  Object.defineProperty(window.eval, 'length', {
    get: () => 1,
  });

  // Add WebGL vendor/renderer
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function(parameter) {
    if (parameter === 37445) {
      return 'Intel Inc.';
    }
    if (parameter === 37446) {
      return 'Intel Iris OpenGL Engine';
    }
    return getParameter(parameter);
  };

  // Patch toString to hide native code
  function patchToString(obj, prop, value) {
    Object.defineProperty(obj[prop], 'toString', {
      value: () => \`function \${prop}() { [native code] }\`,
      writable: false,
    });
  }

  // Add iframe contentWindow stealth
  const originalIFrame = HTMLIFrameElement.prototype.contentWindow;
  Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
    get: function() {
      const frame = originalIFrame.call(this);
      if (frame) {
        // Apply patches to iframe
        try {
          Object.defineProperty(frame.navigator, 'webdriver', {
            get: () => undefined,
          });
        } catch (e) {}
      }
      return frame;
    },
  });

  // Add screen orientation
  Object.defineProperty(window.screen, 'orientation', {
    get: () => ({ angle: 0, type: 'portrait-primary' }),
  });

  console.log('🥷 Stealth mode activated');
})();
`;
//# sourceMappingURL=stealth-script.js.map