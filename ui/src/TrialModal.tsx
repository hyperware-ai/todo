import './TrialModal.css';

interface TrialModalProps {
  usedCount: number;
  maxCount: number;
  isLimitReached: boolean;
  retryAfterSeconds?: number | null;
  onClose: () => void;
}

export default function TrialModal({
  usedCount,
  maxCount,
  isLimitReached,
  retryAfterSeconds,
  onClose,
}: TrialModalProps) {
  const formatRetryTime = (seconds: number | null | undefined): string => {
    if (!seconds || seconds <= 0) return 'soon';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes} minutes`;
  };

  return (
    <div className="trial-modal-overlay" onClick={onClose}>
      <div className="trial-modal" onClick={(e) => e.stopPropagation()}>
        <header className="trial-modal__header">
          <div className="trial-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2>Trial mode</h2>
          <button type="button" className="modal-close" onClick={onClose}>
            &times;
          </button>
        </header>

        <div className="trial-modal__body">
          <p className="trial-count">
            {Math.min(usedCount, maxCount)}/{maxCount} trial requests used
          </p>

          {isLimitReached && retryAfterSeconds && (
            <p className="trial-retry">
              Your limit will reset in <strong>{formatRetryTime(retryAfterSeconds)}</strong>.
            </p>
          )}

          <div className="trial-cta">
            <a
              href="https://hosted.hyperware.ai/?installApp=todo:ware.hypr"
              target="_blank"
              rel="noopener noreferrer"
              className="cta-button"
            >
              Sign Up
            </a>
            <p className="cta-text">to get started with Spider, your own personal agent</p>
          </div>

          <div className="trial-share">
            <p className="share-text">or spread the word</p>
            <a
              href="https://x.com/intent/post?text=Check+out+Spider%2C+the+new+personal+assistant&via=Hyperware_ai&url=https://spider.hyperware.ai/todo:todo:ware.hypr"
              target="_blank"
              rel="noopener noreferrer"
              className="share-button twitter"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
              Share on X
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
