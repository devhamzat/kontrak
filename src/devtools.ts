import { setupNetworkListener } from './core/network';

chrome.devtools.panels.create(
  "Kontrak",
  "",
  "panel.html",
  (panel: chrome.devtools.panels.ExtensionPanel) => {
    console.log("Kontrak panel created", panel);
  }
);

setupNetworkListener();
