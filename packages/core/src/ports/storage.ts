export interface StoragePort {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(dir: string): Promise<readonly string[]>;
  exists(path: string): Promise<boolean>;
}
