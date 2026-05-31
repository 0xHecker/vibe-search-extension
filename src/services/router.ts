export type ServiceMethod = (payload: any) => Promise<any>;

export interface Service {
  [methodName: string]: ServiceMethod;
}

export class OffscreenRouter {
  private services: Map<string, Service> = new Map();
  private serviceAllowList: Map<string, Set<string>> = new Map();

  registerService(name: string, service: Service, options?: { methods?: string[] }) {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered.`);
    }
    this.services.set(name, service);
    if (options?.methods && options.methods.length > 0) {
      this.serviceAllowList.set(name, new Set(options.methods));
    }
    console.log(`Service registered: ${name}`);
  }

  private isTrustedForwarder(sender: chrome.runtime.MessageSender): boolean {
    if (!sender || sender.id !== chrome.runtime.id) {
      return false;
    }
    // UI pages (search/popup/options/etc.) should never directly forward privileged calls.
    if (sender.tab) {
      return false;
    }

    const senderUrl = typeof sender.url === "string" ? sender.url : "";
    if (!senderUrl) {
      // Service worker senders commonly do not expose a URL.
      return true;
    }

    try {
      const parsed = new URL(senderUrl);
      const path = parsed.pathname || "";
      if (path.includes("/src/pages/")) return false;
      if (path.endsWith(".html") && !path.endsWith("/_generated_background_page.html")) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  listen() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const { service, type, payload, target } = message;

      if (target !== "offscreen") {
        return;
      }

      // This is a forwarded message that the offscreen document should handle.
      if (!message.isForwarded) {
        return;
      }

      if (!this.isTrustedForwarder(sender)) {
        sendResponse({ success: false, error: "UNAUTHORIZED_FORWARDER" });
        return true;
      }

      // Allow non-service messages to be handled by dedicated listeners.
      if (!service || typeof service !== "string") {
        return;
      }

      (async () => {
        const targetService = this.services.get(service);
        if (!targetService) {
          const error = `Service "${service}" not found.`;
          console.error(error);
          sendResponse({ success: false, error });
          return;
        }

        const method = targetService[type];
        if (typeof method !== "function") {
          const error = `Method "${type}" not found in service "${service}".`;
          console.error(error);
          sendResponse({ success: false, error });
          return;
        }

        const allowList = this.serviceAllowList.get(service);
        if (allowList && !allowList.has(type)) {
          const error = `Method "${type}" is not exposed for service "${service}".`;
          console.error(error);
          sendResponse({ success: false, error });
          return;
        }

        try {
          // Use .call() to ensure the 'this' context is correctly bound to the service instance
          const result = await method.call(targetService, payload);
          sendResponse({ success: true, type: `${service}_${type}_COMPLETE`, payload: result });
        } catch (e) {
          const error = e instanceof Error ? e.message : "An unknown error occurred";
          console.error(`Error in service "${service}", method "${type}":`, e);
          sendResponse({ success: false, error });
        }
      })();

      return true; // Indicates async response
    });
  }
}
