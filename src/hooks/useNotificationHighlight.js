import { useEffect, useState } from "react";

const HIGHLIGHT_DURATION_MS = 5000;

export default function useNotificationHighlight(location) {
  const requestedRecordId = location?.state?.notificationHighlight?.recordId;
  const [highlightedRecordId, setHighlightedRecordId] = useState(null);

  useEffect(() => {
    if (!requestedRecordId) {
      setHighlightedRecordId(null);
      return undefined;
    }

    const recordId = String(requestedRecordId);
    let attempts = 0;
    setHighlightedRecordId(recordId);

    const scrollToRecord = () => {
      const target = Array.from(document.querySelectorAll("[data-notification-record-id]"))
        .find((element) => element.dataset.notificationRecordId === recordId);
      if (target) {
        window.clearInterval(scrollInterval);
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      } else if (attempts >= 20) {
        window.clearInterval(scrollInterval);
      }
      attempts += 1;
    };

    const scrollInterval = window.setInterval(scrollToRecord, 100);
    const timeoutId = window.setTimeout(() => {
      setHighlightedRecordId((current) => current === recordId ? null : current);
    }, HIGHLIGHT_DURATION_MS);

    return () => {
      window.clearInterval(scrollInterval);
      window.clearTimeout(timeoutId);
    };
  }, [location?.key, requestedRecordId]);

  return highlightedRecordId;
}