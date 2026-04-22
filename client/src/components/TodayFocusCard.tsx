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
    <div className="rounded-lg bg-dark-card p-4">
      <h3 className="text-sm font-semibold text-white mb-2">Today's Focus</h3>
      <p className="text-sm text-gray-300">
        Focus on 1-2 high impact tasks to make meaningful progress.
      </p>
    </div>
  );
}
