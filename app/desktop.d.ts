export {};

declare global {
  interface Window {
    sbsDesktop?: {
      isDesktop: true;
      getApiKeyStatus: () => Promise<{
        configured: boolean;
        encryptionAvailable: boolean;
        storage: string;
        appVersion: string;
      }>;
      saveOpenAiApiKey: (apiKey: string) => Promise<{ configured: boolean }>;
      clearOpenAiApiKey: () => Promise<{ configured: boolean }>;
    };
  }
}
