/**
 * Server entry point — initializes the database, creates service instances,
 * and starts the Express server.
 */

import "dotenv/config";
import { getDb } from "./db/connection.js";
import { createApp } from "./app.js";
import { TaskInputParser } from "./services/task-input-parser.js";
import { TaskAnalyzer } from "./services/task-analyzer.js";
import { AdaptiveLearningEngine } from "./services/adaptive-learning-engine.js";
import { AnalyticsAggregator } from "./services/analytics-aggregator.js";
import { PreferenceProfileStore } from "./services/preference-profile-store.js";

const PORT = process.env.PORT || 3001;

// Initialize database
const db = getDb();

// Create service instances
const learningEngine = new AdaptiveLearningEngine(db);
const parser = new TaskInputParser();
const analyzer = new TaskAnalyzer(learningEngine);
const analytics = new AnalyticsAggregator(db);
const preferenceStore = new PreferenceProfileStore(db);

// Create and start the Express app
const app = createApp({
  db,
  parser,
  analyzer,
  learningEngine,
  analytics,
  preferenceStore,
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
