import * as vscode from 'vscode';

export class InMemoryEditFileSystemProvider implements vscode.FileSystemProvider {
  private readonly files = new Map<string, Uint8Array>();

  private readonly onDidChangeFileEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.onDidChangeFileEmitter.event;

  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }

  stat(uri: vscode.Uri): vscode.FileStat {
    const data = this.files.get(uri.toString());
    if (!data) { throw vscode.FileSystemError.FileNotFound(uri); }
    return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: data.byteLength };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const data = this.files.get(uri.toString());
    if (!data) { throw vscode.FileSystemError.FileNotFound(uri); }
    return data;
  }

  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    this.files.set(uri.toString(), content);
    this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  delete(uri: vscode.Uri): void {
    this.files.delete(uri.toString());
    this.onDidChangeFileEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  readDirectory(): [string, vscode.FileType][] { return []; }
  createDirectory(): void {}
  rename(): void {}

  hasFile(uri: vscode.Uri): boolean {
    return this.files.has(uri.toString());
  }

  getContent(uri: vscode.Uri): string | undefined {
    const data = this.files.get(uri.toString());
    if (!data) { return undefined; }
    return Buffer.from(data).toString('utf8');
  }

  setContent(uri: vscode.Uri, text: string): void {
    this.writeFile(uri, Buffer.from(text, 'utf8'));
  }
}
