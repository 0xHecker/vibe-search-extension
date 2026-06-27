/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMPORT_MEDIA_UPLOAD_TOKEN?: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
