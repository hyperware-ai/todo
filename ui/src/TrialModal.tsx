import { useEffect, useRef, useState } from 'react';
import './TrialModal.css';

const HUBSPOT_FORM_SCRIPT_SRC = "https://js.hsforms.net/forms/embed/developer/46995186.js";
const HUBSPOT_FORM_PORTAL_ID = "46995186";
const HUBSPOT_FORM_REGION = "na1";
const SPIDER_FORM_ID = "e56bbc27-0fa5-4fd7-8f6f-67ec258c5f8d";

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
  const formContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFormLoading, setIsFormLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const container = formContainerRef.current;

    const checkFormLoaded = () => {
      if (!isMounted) return;
      if (container && container.querySelector("form, iframe")) {
        setIsFormLoading(false);
      } else {
        requestAnimationFrame(checkFormLoaded);
      }
    };

    // Check if script already exists
    let script: HTMLScriptElement | null = document.querySelector(
      `script[src="${HUBSPOT_FORM_SCRIPT_SRC}"]`
    );

    if (!script) {
      // First time: add the script, it will auto-scan for hs-form-html elements
      script = document.createElement("script");
      script.src = HUBSPOT_FORM_SCRIPT_SRC;
      script.defer = true;
      document.body.appendChild(script);
      script.addEventListener("load", checkFormLoaded);
    } else {
      // Script already loaded - need to re-add it to trigger a new scan
      // Remove and re-add the script to force HubSpot to scan for new form containers
      script.remove();
      const newScript = document.createElement("script");
      newScript.src = HUBSPOT_FORM_SCRIPT_SRC;
      newScript.defer = true;
      document.body.appendChild(newScript);
      newScript.addEventListener("load", checkFormLoaded);
    }

    const fallbackTimeout = window.setTimeout(() => {
      if (isMounted) {
        setIsFormLoading(false);
      }
    }, 5000);

    return () => {
      isMounted = false;
      window.clearTimeout(fallbackTimeout);
    };
  }, []);

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
            <p className="cta-header">Sign up for Beta Information</p>
            <p className="cta-text">Drop your email to hear when we open the private beta.</p>
            <div className="hubspot-form-wrapper">
              <div
                ref={formContainerRef}
                className={`hs-form-html hubspot-form-container${isFormLoading ? ' loading' : ''}`}
                data-region={HUBSPOT_FORM_REGION}
                data-form-id={SPIDER_FORM_ID}
                data-portal-id={HUBSPOT_FORM_PORTAL_ID}
              />
              {isFormLoading && (
                <div className="hubspot-loading">
                  <svg className="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10" />
                  </svg>
                </div>
              )}
            </div>
          </div>

          <div className="trial-share">
            <p className="share-text">or spread the word</p>
            <a
              href="https://x.com/intent/post?text=Meet+Spider%2C+your+new+personal+assistant%2E%0ASmarter+tasks%2E+Cleaner+days%2E+Zero+chaos%2E%0A%0ACheck+it+out%3A%0Ahttps%3A%2F%2Fspider%2Ehyperware%2Eai%2Ftodo%3Atodo%3Aware%2Ehypr%0A%0AIncubated+by+%40Hyperware%5Fai"
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
