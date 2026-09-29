export function createToaster({ doc }) {
  return {
    show(message, { kind = "info", ms = 2600 } = {}) { throw new Error("not implemented"); },
    dispose() { throw new Error("not implemented"); },
  };
}
