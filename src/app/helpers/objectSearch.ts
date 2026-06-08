export function findObjectKey(input: unknown, targetKey: string = "metasysType"): unknown | undefined {

  function search(value: unknown): unknown | undefined {
    if (value === null || typeof value !== "object") {
      return undefined;
    }

    // If it's an array, search each element
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = search(item);
        if (result !== undefined) return result;
      }
      return undefined;
    }

    // It's a plain object
    for (const [key, val] of Object.entries(value)) {
      // Found the key!
      if (key === targetKey) {
        return val;
      }

      // Recursively search deeper
      const result = search(val);
      if (result !== undefined) {
        return result;
      }
    }

    return undefined;
  }

  return search(input);
}