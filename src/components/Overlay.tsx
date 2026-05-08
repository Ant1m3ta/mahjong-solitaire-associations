interface Props {
  title: string;
  subtitle?: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function Overlay({ title, subtitle, primaryLabel, onPrimary, secondaryLabel, onSecondary }: Props) {
  return (
    <div className="overlay">
      <div className="overlay-card">
        <h1>{title}</h1>
        {subtitle && <p className="overlay-subtitle">{subtitle}</p>}
        <div className="overlay-buttons">
          <button className="primary" onClick={onPrimary}>{primaryLabel}</button>
          {secondaryLabel && onSecondary && (
            <button onClick={onSecondary}>{secondaryLabel}</button>
          )}
        </div>
      </div>
    </div>
  );
}
