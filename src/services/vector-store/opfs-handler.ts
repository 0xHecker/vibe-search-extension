// Low-level OPFS file I/O
export class OpfsHandler {
  private fileHandle: FileSystemFileHandle | null = null;
  private accessHandle: FileSystemSyncAccessHandle | null = null;

  async open(fileName: string) {
    if (!self.navigator || !("storage" in self.navigator)) {
      throw new Error("OPFS is not available in this context.");
    }
    const root = await self.navigator.storage.getDirectory();
    this.fileHandle = await root.getFileHandle(fileName, { create: true });
    this.accessHandle = await this.fileHandle.createSyncAccessHandle();
  }

  getSize(): number {
    if (!this.accessHandle) {
      throw new Error("File not open");
    }
    return this.accessHandle.getSize();
  }

  read(buffer: ArrayBuffer | SharedArrayBuffer, offset: number) {
    if (!this.accessHandle) {
      throw new Error("File not open");
    }
    // OPFS only works with ArrayBuffer, so we might need to copy
    if (buffer instanceof SharedArrayBuffer) {
      const tempBuffer = new ArrayBuffer(buffer.byteLength);
      this.accessHandle.read(tempBuffer, { at: offset });
      const tempView = new Uint8Array(tempBuffer);
      const sharedView = new Uint8Array(buffer);
      sharedView.set(tempView);
    } else {
      this.accessHandle.read(buffer, { at: offset });
    }
  }

  write(buffer: ArrayBuffer | SharedArrayBuffer, offset: number) {
    if (!this.accessHandle) {
      throw new Error("File not open");
    }
    if (buffer instanceof SharedArrayBuffer) {
      // Create a non-shared copy for writing
      const writeBuffer = new ArrayBuffer(buffer.byteLength);
      new Uint8Array(writeBuffer).set(new Uint8Array(buffer));
      this.accessHandle.write(writeBuffer, { at: offset });
    } else {
      this.accessHandle.write(buffer, { at: offset });
    }
  }

  flush() {
    if (!this.accessHandle) {
      throw new Error("File not open");
    }
    this.accessHandle.flush();
  }

  close() {
    if (this.accessHandle) {
      this.accessHandle.close();
      this.accessHandle = null;
      this.fileHandle = null;
    }
  }
}
