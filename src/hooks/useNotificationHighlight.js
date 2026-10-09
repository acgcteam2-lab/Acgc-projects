import { useEffect, useState } from "react";

const HIGHLIGHT_DURATION_MS = 3500;

export default function useNotificationHighlight(location) {
  const requestedRecordId = location?.state?.notificationHighlight?.recordId;
  const requestedRecordType = location?.state?.notificationHighlight?.recordType;
  const [highlightedRecordId, setHighlightedRecordId] = useState(null);

  useEffect(() => {
    if (!requestedRecordId) {
      setHighlightedRecordId(null);
      return undefined;
    }

    const recordId = String(requestedRecordId);
    setHighlightedRecordId(null);
    const activateFrame = window.requestAnimationFrame(() => setHighlightedRecordId(recordId));
    let targetFound = false;
    let scrollFrame = null;

    const scrollToRecord = () => {
      if (targetFound) return;
      const candidates = Array.from(document.querySelectorAll("[data-notification-record-id]"))
        .filter((element) => element.dataset.notificationRecordId === recordId);
      const visibleCandidates = candidates.filter((element) => element.getClientRects().length > 0);
      const preferredCandidates = requestedRecordType
        ? visibleCandidates.filter((element) => element.dataset.notificationTarget === requestedRecordType)
        : [];
      const target = visibleCandidates.find((element) => element.closest('[role="dialog"]'))
        || preferredCandidates[0]
        || candidates.find((element) => element.closest('[role="dialog"]'))
        || visibleCandidates[0]
        || candidates[0];

      if (target) {
        targetFound = true;
        observer.disconnect();
        scrollFrame = window.requestAnimationFrame(() => {
          target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        });
      }
    };

    const observer = new MutationObserver(scrollToRecord);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    scrollToRecord();
    const timeoutId = window.setTimeout(() => {
      setHighlightedRecordId((current) => current === recordId ? null : current);
    }, HIGHLIGHT_DURATION_MS);

    return () => {
      window.cancelAnimationFrame(activateFrame);
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
      observer.disconnect();
      window.clearTimeout(timeoutId);
    };
  }, [location?.key, requestedRecordId, requestedRecordType]);

  return highlightedRecordId;
}