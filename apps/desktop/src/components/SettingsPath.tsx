/** Format file paths for display only; never use this value for filesystem access. */
export function formatSettingsPath(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`;
  if (/^\\\\\?\\[a-z]:\\/i.test(path)) return path.slice(4);
  return path;
}

export function SettingsPath({ path, id }: { path: string; id?: string }) {
  const displayPath = formatSettingsPath(path);
  return (
    <span className="settings-path" id={id} title={displayPath}>
      {displayPath}
    </span>
  );
}
