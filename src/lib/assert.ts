export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertUnreachable(value: never, message: string): never {
  throw new Error(`${message}: ${String(value)}`);
}
