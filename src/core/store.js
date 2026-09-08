import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  constructor(dir = './data') { this.dir = dir; }
  async #path(name) { await mkdir(this.dir, { recursive: true }); return path.join(this.dir, `${name}.json`); }
  async read(name, fallback = null) {
    try { return JSON.parse(await readFile(await this.#path(name), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  }
  async write(name, value) {
    const target = await this.#path(name);
    await writeFile(target, JSON.stringify(value, null, 2));
    return value;
  }
}
