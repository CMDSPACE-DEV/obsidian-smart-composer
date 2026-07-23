export function OrbitalLoader({
  label,
  showLabel = true,
}: {
  label: string
  showLabel?: boolean
}) {
  return (
    <span className="smtcmp-orbital-status" role="status" aria-label={label}>
      <span className="smtcmp-orbital-loader" aria-hidden="true">
        <span className="smtcmp-orbital-loader__ring" />
        <span className="smtcmp-orbital-loader__dots">
          <i />
          <i />
          <i />
        </span>
      </span>
      {showLabel && <span>{label}</span>}
    </span>
  )
}
