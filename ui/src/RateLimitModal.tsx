import './RateLimitModal.css';

interface RateLimitModalProps {
  retryAfterSeconds: number | null;
  onClose: () => void;
}

export default function RateLimitModal({ retryAfterSeconds, onClose }: RateLimitModalProps) {
  const formatRetryTime = (seconds: number | null): string => {
    if (!seconds || seconds <= 0) return 'soon';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes} minutes`;
  };

  return (
    <div className="rate-limit-overlay" onClick={onClose}>
      <div className="rate-limit-modal" onClick={(e) => e.stopPropagation()}>
        <header className="rate-limit-modal__header">
          <div className="rate-limit-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2>Chat Limit Reached</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            &times;
          </button>
        </header>

        <div className="rate-limit-modal__body">
          <p>
            You have reached the daily chat limit for this trial interface. Your limit will reset
            in <strong>{formatRetryTime(retryAfterSeconds)}</strong>.
          </p>

          <div className="rate-limit-cta">
            <p className="eyebrow">Want unlimited access?</p>
            <a
              href="https://hosted.hyperware.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="cta-button"
            >
              Sign up at hosted.hyperware.ai
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
