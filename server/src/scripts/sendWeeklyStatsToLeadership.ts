import { runWeeklyKenStats } from "../scheduler/weeklyKenStats.js";
import pool from "../db.js";

const RECIPIENTS = [
  "ken@catacap.org",
  "tim@catacap.org",
  "ale@catacap.org",
  "heidi@catacap.org",
  "jenny@catacap.org",
];

(async () => {
  try {
    console.log(`[ONE-OFF] Sending CataCap Weekly Stats to: ${RECIPIENTS.join(", ")}`);
    await runWeeklyKenStats({ recipients: RECIPIENTS });
    console.log("[ONE-OFF] Done.");
  } catch (err) {
    console.error("[ONE-OFF] Failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
