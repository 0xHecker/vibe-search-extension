// Low-level OPFS file I/O using ASYNCHRONOUS methods
export class OpfsHandler {
  private fileHandle: FileSystemFileHandle | null = null;
  private fileName: string | null = null;

  async open(fileName: string, truncate = false, create = true): Promise<void> {
    if (!self.navigator || !("storage" in self.navigator)) {
      throw new Error("OPFS is not available in this context.");
    }
    this.fileName = fileName;
    const root = await self.navigator.storage.getDirectory();
    this.fileHandle = await root.getFileHandle(fileName, { create });

    if (truncate) {
      await this.truncate();
    }
  }

  async getSize(): Promise<number> {
    if (!this.fileHandle) {
      throw new Error("File not open");
    }
    const file = await this.fileHandle.getFile();
    return file.size;
  }

  async read(buffer: ArrayBuffer, offset: number): Promise<void> {
    if (!this.fileHandle) {
      throw new Error("File not open");
    }
    const file = await this.fileHandle.getFile();
    const slice = file.slice(offset, offset + buffer.byteLength);
    const readBuffer = await slice.arrayBuffer();
    if (readBuffer.byteLength !== buffer.byteLength) {
      throw new Error(
        `Read out of bounds for ${this.fileName ?? "unknown file"}: requested ${buffer.byteLength} bytes at offset ${offset}, got ${readBuffer.byteLength}.`
      );
    }
    new Uint8Array(buffer).set(new Uint8Array(readBuffer));
  }

  async write(buffer: ArrayBuffer, offset: number): Promise<void> {
    if (!this.fileHandle) {
      throw new Error("File not open");
    }
    const writable = await this.fileHandle.createWritable({ keepExistingData: true });
    await writable.write({ type: "write", position: offset, data: buffer });
    await writable.close();
  }

  async truncate(size = 0): Promise<void> {
    if (!this.fileHandle) {
      throw new Error("File not open");
    }
    const writable = await this.fileHandle.createWritable();
    await writable.truncate(size);
    await writable.close();
  }

  async deleteSelf(): Promise<void> {
    if (!this.fileHandle || !this.fileName) {
      // If there's no handle, there's nothing to do.
      return;
    }
    // Store the name, then release the handle FIRST.
    const fileNameToDelete = this.fileName;
    this.fileHandle = null;
    this.fileName = null;

    const root = await self.navigator.storage.getDirectory();
    await root.removeEntry(fileNameToDelete);
  }

  close(): void {
    this.fileHandle = null;
    this.fileName = null;
  }
}
