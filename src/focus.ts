/**
 * Focuses the first view that is registered in this window. After an
 * in-place update VS Code restarts only the extension host, so new code can
 * run while the window still has the old view layout; `<id>.focus` then
 * throws "command not found" for views the old manifest did not declare.
 */
export async function focusFirst(viewIds: string[], exec: (command: string) => Thenable<unknown>): Promise<string | undefined> {
  for (const id of viewIds) {
    try {
      await exec(`${id}.focus`);
      return id;
    } catch {
      // not registered in this window; try the next one
    }
  }
  return undefined;
}
