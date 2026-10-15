export function resolve(specifier, context, nextResolve) {
  if (specifier === "obsidian") {
    return {
      format: "module",
      shortCircuit: true,
      url: new URL("./obsidian.ts", import.meta.url).href,
    };
  }
  return nextResolve(specifier, context);
}
