// Imported first by every script so .env.local / .env apply like they do for `next dev`.
// Variables already set in the shell win.
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // File not present.
  }
}
