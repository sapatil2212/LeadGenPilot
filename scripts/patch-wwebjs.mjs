import fs from "fs";
import path from "path";

const clientPath = path.join(process.cwd(), "node_modules", "whatsapp-web.js", "src", "Client.js");
const authStorePath = path.join(process.cwd(), "node_modules", "whatsapp-web.js", "src", "util", "Injected", "AuthStore", "AuthStore.js");

if (fs.existsSync(authStorePath)) {
  let content = fs.readFileSync(authStorePath, "utf-8");
  if (!content.includes("const req = (name)")) {
    content = `'use strict';

exports.ExposeAuthStore = () => {
    window.AuthStore = {};
    const req = (name) => {
        try {
            return window.require ? window.require(name) : null;
        } catch {
            return null;
        }
    };
    window.AuthStore.AppState = req('WAWebSocketModel')?.Socket;
    window.AuthStore.Cmd = req('WAWebCmd')?.Cmd;
    window.AuthStore.Conn = req('WAWebConnModel')?.Conn;
    window.AuthStore.OfflineMessageHandler = req(
        'WAWebOfflineHandler',
    )?.OfflineMessageHandler;
    window.AuthStore.PairingCodeLinkUtils = req(
        'WAWebAltDeviceLinkingApi',
    );
    window.AuthStore.Base64Tools = req('WABase64');
    window.AuthStore.RegistrationUtils = {
        ...(req('WAWebCompanionRegClientUtils') || {}),
        ...(req('WAWebAdvSignatureApi') || {}),
        ...(req('WAWebUserPrefsInfoStore') || {}),
        ...(req('WAWebSignalStoreApi') || {}),
    };
};
`;
    fs.writeFileSync(authStorePath, content, "utf-8");
    console.log("[patch-wwebjs] Patched AuthStore.js for null safety.");
  }
}

if (fs.existsSync(clientPath)) {
  let content = fs.readFileSync(clientPath, "utf-8");
  if (!content.includes("const getModel = () =>")) {
    const target = "const needAuthentication = await this.pupPage.evaluate(async () => {\n            let state = window.require('WAWebSocketModel').Socket.state;";
    const replacement = `const needAuthentication = await this.pupPage.evaluate(async () => {
            const getModel = () => {
                try {
                    return window.require ? window.require('WAWebSocketModel') : null;
                } catch {
                    return null;
                }
            };
            let model = getModel();
            if (!model || !model.Socket) {
                for (let i = 0; i < 15; i++) {
                    await new Promise((r) => setTimeout(r, 200));
                    model = getModel();
                    if (model && model.Socket) break;
                }
            }
            if (!model || !model.Socket) return true;
            let state = model.Socket.state;`;
    if (content.includes(target)) {
      content = content.replace(target, replacement);
      fs.writeFileSync(clientPath, content, "utf-8");
      console.log("[patch-wwebjs] Patched Client.js for null safety.");
    }
  }
}
