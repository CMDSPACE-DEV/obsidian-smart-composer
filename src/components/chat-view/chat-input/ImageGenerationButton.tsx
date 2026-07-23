import { ImagePlus } from 'lucide-react'

export function ImageGenerationButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="smtcmp-chat-user-input-submit-button"
      onClick={onClick}
      type="button"
      aria-label="Generate image with GPT Plan"
    >
      <ImagePlus size={12} />
      <span>Generate</span>
    </button>
  )
}
