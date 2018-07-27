# Common Module for Stackdriver Debugger Proxies

**This is not an official Google product.** This library may be changed in
backwards-incompatible ways and is not subject to any SLA or deprecation policy.

This project is a common module for developers of Stackdriver Debugger proxies.
[Stackdriver Debugger][debug] is a feature of [Google Cloud Platform][gcp] that
lets users debug their applications in production, in real-time, without
stopping or pausing their apps. The Stackdriver Debugger proxies interface
between Stackdriver Debugger and various IDES, allowing users to debug using
Stackdriver Debugger from their favourite environment. You can use this
common module as a base to develop your own Stackdriver Debugger proxy.

### List of Stackdriver Debugger Proxies

- [Stackdriver Debugger to Chrome DevTools proxy][devtools]

### Sample Usage

Please check out some of the above Stackdriver Debugger proxies to see their
actual implementations. A high-level summary of features is provided below:

```js
stackdriver = require('cloud-debug-proxy-common');

class CustomDebugProxy {
  constructor() {
    this.debugProxy = new stackdriver.DebugProxy({
      debuggerId: 'debuggerId',
      sourceDirectory: './',
    });
  }

  // Call this to initialize your proxy.
  async initialize() {
    // Prompt the user to choose a keyFile, or leave blank to use the default.
    await this.debugProxy.setProjectByKeyFile();

    // Prompt the user to select a debuggee from the list.
    const debuggeeList = await this.debugProxy.getDebuggees();
    console.log(debuggeeList);
    this.debugProxy.setDebuggeeId(debuggeeList[0].id);

    // Listen for breakpoint changes.
    this.debugProxy.on('breakpointHit', () => {
      console.log('hit a breakpoint!');
    });
  }

  // Call this after your proxy is fully initialized.
  async pollForPendingBreakpoints() {
    while (true) {
      await this.debugProxy.updatePendingBreakpoints(true);
   }
  }

  // Call this when the user adds a breakpoint in the IDE.
  // This sample breakpoint has path, line, and condition properties.
  async setBreakpoint(breakpoint) {
    const stackdriverBreakpoint = await this.debugProxy.setBreakpoint({
      action: stackdriver.Action.CAPTURE,
      location: {
        path: breakpoint.path,
        line: breakpoint.line,
      },
      condition: breakpoint.condition,
    });
    return {
      path: stackdriverBreakpoint.location.path,
      line: stackdriverBreakpoint.location.line,
      condition: stackdriverBreakpoint.condition,
    };
  }
}
```

[debug]:    https://cloud.google.com/debugger/
[gcp]:      https://cloud.google.com/
[devtools]: https://github.com/GoogleCloudPlatform/cloud-debug-proxy-chrome-devtools
