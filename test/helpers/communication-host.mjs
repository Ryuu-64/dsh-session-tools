const installed = new WeakSet();

function storageDomain() {
  const records = new Map();
  const table = {
    get(id) {
      const value = records.get(id);
      return value === undefined ? undefined : structuredClone(value);
    },
    async put(id, value) { records.set(id, structuredClone(value)); },
  };
  return { open: async () => ({ table: () => table }) };
}

/** Add the public services required by the 0.8 communication layer to a test host. */
export function withCommunicationHost(ctx) {
  if (installed.has(ctx)) return ctx;
  const storage = storageDomain();
  if (typeof ctx.provide === 'function') {
    ctx.provide('storageDomain', storage);
  } else {
    const get = typeof ctx.get === 'function' ? ctx.get.bind(ctx) : () => undefined;
    ctx.get = name => name === 'storageDomain' ? storage : get(name);
  }
  if (typeof ctx.inject !== 'function') ctx.inject = () => undefined;
  installed.add(ctx);
  return ctx;
}
