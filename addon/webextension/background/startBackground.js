/* globals browser, main, communication */
/* This file handles:
     clicks on the Photon page action
     browser.contextMenus.onClicked
     browser.runtime.onMessage
   and loads the rest of the background page in response to those events, forwarding
   the events to main.onClicked, main.onClickedContextMenu, or communication.onMessage
*/
const startTime = Date.now();

this.startBackground = (function() {
  let exports = {startTime};

  const backgroundScripts = [
    "log.js",
    "makeUuid.js",
    "catcher.js",
    "blobConverters.js",
    "background/selectorLoader.js",
    "background/communication.js",
    "background/auth.js",
    "background/senderror.js",
    "build/raven.js",
    "build/shot.js",
    "build/thumbnailGenerator.js",
    "background/analytics.js",
    "background/deviceInfo.js",
    "background/takeshot.js",
    "background/main.js"
  ];

  // Maximum milliseconds to wait before checking for migration possibility
  const CHECK_MIGRATION_DELAY = 2000;

  browser.contextMenus.create({
    id: "create-screenshot",
    title: browser.i18n.getMessage("contextMenuLabel"),
    contexts: ["page"],
    documentUrlPatterns: ["<all_urls>"]
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    loadIfNecessary().then(() => {
      main.onClickedContextMenu(info, tab);
    }).catch((error) => {
      console.error("Error loading Screenshots:", error);
    });
  });

  browser.runtime.onMessage.addListener((req, sender, sendResponse) => {
    loadIfNecessary().then(() => {
      return communication.onMessage(req, sender, sendResponse);
    }).catch((error) => {
      console.error("Error loading Screenshots:", error);
    });
    return true;
  });

  let photonPageActionPort = null;
  initPhotonPageAction();

  // We delay this check (by CHECK_MIGRATION_DELAY) just to avoid piling too
  // many things onto browser/add-on startup
  requestIdleCallback(() => {
    browser.runtime.sendMessage({funcName: "getOldDeviceInfo"}).then((result) => {
      if (result && result.type == "success" && result.value) {
        // There is a possible migration to run, so we'll load the entire background
        // page and continue the process
        return loadIfNecessary();
      }
      if (!result) {
        throw new Error("Got no result from getOldDeviceInfo");
      }
      if (result.type == "error") {
        throw new Error(`Error from getOldDeviceInfo: ${result.name}`);
      }
    }).catch((error) => {
      if (error && error.message == "Could not establish connection. Receiving end does not exist") {
        // Just a missing bootstrap.js, ignore
      } else {
        console.error("Screenshots error checking for Page Shot migration:", error);
      }
    });
  }, {timeout: CHECK_MIGRATION_DELAY});

  let loadedPromise;

  function loadIfNecessary() {
    if (loadedPromise) {
      return loadedPromise;
    }
    loadedPromise = Promise.resolve();
    backgroundScripts.forEach((script) => {
      loadedPromise = loadedPromise.then(() => {
        return new Promise((resolve, reject) => {
          let tag = document.createElement("script");
          tag.src = browser.extension.getURL(script);
          tag.onload = () => {
            resolve();
          };
          tag.onerror = (error) => {
            let exc = new Error(`Error loading script: ${error.message}`);
            exc.scriptName = script;
            reject(exc);
          };
          document.head.appendChild(tag);
        });
      });
    });
    return loadedPromise;
  }

  function initPhotonPageAction() {
    // Set up this side of the Photon page action port.  The other side is in
    // bootstrap.js.  Ideally, in the future, WebExtension page actions and
    // Photon page actions would be one in the same, but they aren't right now.
    photonPageActionPort = browser.runtime.connect({ name: "photonPageActionPort" });
    photonPageActionPort.onMessage.addListener((message) => {
      switch (message.type) {
      case "click":
        loadIfNecessary().then(() => {
          return browser.tabs.get(message.tab.id);
        }).then((tab) => {
          main.onClicked(tab);
        }).catch((error) => {
          console.error("Error loading Screenshots:", error);
        });
        break;
      default:
        console.error("Unrecognized message:", message);
        break;
      }
    });
    photonPageActionPort.postMessage({
      type: "setProperties",
      title: browser.i18n.getMessage("contextMenuLabel")
    });

    // Export these so that main.js can use them.
    Object.defineProperties(exports, {
      "photonPageActionPort": {
        enumerable: true,
        get() {
          return photonPageActionPort;
        }
      }
    });
  }

  return exports;
})();
