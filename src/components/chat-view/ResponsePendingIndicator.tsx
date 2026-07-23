export function ResponsePendingIndicator() {
  return (
    <div
      className="smtcmp-response-pending"
      role="status"
      aria-label="Thinking"
    >
      <span className="smtcmp-response-pending__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  )
}
