/**
 * TodayFocusCard component.
 *
 * Static motivational card displayed in the right sidebar encouraging
 * the user to focus on high-impact tasks.
 *
 * Requirements: 7.1
 */
export default function TodayFocusCard() {
  return (
    <div className="rounded-lg bg-dark-card border border-dark-border p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-2">
        Today's Focus
      </h3>
      <p className="text-sm text-text-secondary">
        Focus on 1-2 high impact tasks to make meaningful progress.
      </p>
    </div>
  );
}
