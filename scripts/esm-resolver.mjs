const installedDependency = new URL("../dmicher-generics/scripts/api.js", import.meta.url).href;
const workspaceDependency = new URL("../../dmicher-generics/dmicher-generics/scripts/api.js", import.meta.url).href;

export function resolve(specifier, context, nextResolve) {
  if (context.parentURL && specifier.startsWith(".") && new URL(specifier, context.parentURL).href === installedDependency) {
    return nextResolve(workspaceDependency, context);
  }
  return nextResolve(specifier, context);
}
