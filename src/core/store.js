import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";

// Local development store: one Node process per data directory. Production uses D1 CAS.
const locks = new Map();
export class JsonStore {
  constructor(dir = "./data") {
    this.dir = path.resolve(dir);
  }
  async #path(name) {
    if (!/^[a-zA-Z0-9:_-]+$/.test(name)) throw new Error("Invalid storage key");
    await mkdir(this.dir, { recursive: true });
    return path.join(this.dir, `${name}.json`);
  }
  async read(name, fallback = null) {
    try {
      return JSON.parse(await readFile(await this.#path(name), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return fallback;
      throw e;
    }
  }
  async #atomicWrite(name, value) {
    const target = await this.#path(name);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temporary, target);
    return value;
  }
  async update(name, fallback, mutate) {
    const key = await this.#path(name);
    const prior = locks.get(key) ?? Promise.resolve();
    const operation = prior
      .catch(() => {})
      .then(async () =>
        this.#atomicWrite(name, mutate(await this.read(name, fallback))),
      );
    locks.set(key, operation);
    try {
      return await operation;
    } finally {
      if (locks.get(key) === operation) locks.delete(key);
    }
  }
  async write(name, value) {
    return this.update(name, null, () => value);
  }
  async claimPublish(draftId) {
    let claimed = false;
    await this.update(`draft-${draftId}`, null, (draft) => {
      if (draft?.status !== "draft") return draft;
      claimed = true;
      return {
        ...draft,
        status: "publishing",
        publishingStartedAt: new Date().toISOString(),
      };
    });
    return claimed;
  }
}
