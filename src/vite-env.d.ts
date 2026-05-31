/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_IMPORT_MEDIA_UPLOAD_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
