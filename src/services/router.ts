export type ServiceMethod = (payload: any) => Promise<any>;

export interface Service {
  [methodName: string]: ServiceMethod;
}

export class OffscreenRouter {
  private services: Map<string, Service> = new Map();

  registerService(name: string, service: Service) {
    if (this.services.has(name)) {
      throw new Error(`Service "${name}" is already registered.`);
    }
    this.services.set(name, service);
    console.log(`Service registered: ${name}`);
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
