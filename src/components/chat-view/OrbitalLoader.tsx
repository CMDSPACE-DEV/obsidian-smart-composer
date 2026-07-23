export function OrbitalLoader({ label }: { label: string }) {
  return (
    <span className="smtcmp-orbital-status" role="status">
      <span className="smtcmp-orbital-loader" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>{label}</span>
    </span>
  )
}
