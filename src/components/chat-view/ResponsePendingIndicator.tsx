import { OrbitalLoader } from './OrbitalLoader'

export function ResponsePendingIndicator() {
  return (
    <div className="smtcmp-response-pending">
      <OrbitalLoader label="Thinking" showLabel={false} />
    </div>
  )
}
