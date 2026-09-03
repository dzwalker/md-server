interface ResultItemProps {
  path: string;
  title: string;
  subtitle?: string;
  onClick: () => void;
}

export function ResultItem({ path, title, subtitle, onClick }: ResultItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full border-b px-3 py-2 text-left hover:bg-accent"
    >
      <div className="truncate text-sm font-medium text-foreground">{title || path}</div>
      <div className="truncate text-xs text-muted-foreground">{path}</div>
      {subtitle ? (
        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{subtitle}</div>
      ) : null}
    </button>
  );
}
