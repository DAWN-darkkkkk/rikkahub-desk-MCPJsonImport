interface Env {
  DB: D1Database;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const DB = context.env.DB;
  const days = Math.min(parseInt(url.searchParams.get("days") ?? "30", 10), 180);

  const trends = await DB.prepare(
    `SELECT date, dau, eff_dau, new_users, total_msgs, win_users, linux_users
     FROM daily_summary ORDER BY date DESC LIMIT ?`
  ).bind(days).all<any>();

  const today = new Date().toISOString().slice(0, 10);
  const wau = await uniqueDevices(DB, today, 7);
  const mau = await uniqueDevices(DB, today, 30);

  const todayRow = trends.rows?.[0];
  const dau = todayRow?.dau ?? 0;
  const stickiness = mau > 0 ? Math.round((dau / mau) * 100) : 0;

  const avgMsgs = await DB.prepare(
    `SELECT AVG(msg_count) AS avg FROM pings WHERE date = ? AND msg_count > 0`
  ).bind(today).first<any>();

  const versions = await DB.prepare(
    `SELECT version, count FROM version_dist
     WHERE date = (SELECT MAX(date) FROM version_dist)
     ORDER BY count DESC`
  ).all<any>();

  const retention = await computeRetention(DB, 30);

  return new Response(JSON.stringify({
    trends: (trends.rows ?? []).reverse(),
    wau, mau, stickiness,
    avgMsgsPerActive: Math.round((avgMsgs?.avg ?? 0) * 10) / 10,
    versions: versions.rows ?? [],
    retention,
  }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
};

async function uniqueDevices(DB: D1Database, endDate: string, windowDays: number): Promise<number> {
  const start = new Date(endDate);
  start.setDate(start.getDate() - windowDays + 1);
  const startDate = start.toISOString().slice(0, 10);
  const row = await DB.prepare(
    `SELECT COUNT(DISTINCT device_id) AS cnt FROM pings WHERE date BETWEEN ? AND ?`
  ).bind(startDate, endDate).first<any>();
  return row?.cnt ?? 0;
}

async function computeRetention(DB: D1Database, cohortDays: number) {
  const cohorts = await DB.prepare(
    `SELECT date, COUNT(*) AS size FROM pings
     WHERE first_seen = TRUE AND date >= date('now', ?)
     GROUP BY date ORDER BY date DESC LIMIT 30`
  ).bind(`-${cohortDays} days`).all<any>();

  if (!cohorts.rows?.length) return { cohorts: [] };

  const result = [];
  const offsets = [1, 3, 7, 14, 30];

  for (const cohort of cohorts.rows) {
    const retention: Record<number, number> = {};
    for (const offset of offsets) {
      const targetDate = new Date(cohort.date + "T00:00:00Z");
      targetDate.setUTCDate(targetDate.getUTCDate() + offset);
      const target = targetDate.toISOString().slice(0, 10);
      if (target > new Date().toISOString().slice(0, 10)) continue;

      const row = await DB.prepare(
        `SELECT COUNT(*) AS cnt FROM pings
         WHERE device_id IN (SELECT device_id FROM pings WHERE date = ? AND first_seen = TRUE)
         AND date = ?`
      ).bind(cohort.date, target).first<any>();

      retention[offset] = cohort.size > 0 ? Math.round(((row?.cnt ?? 0) / cohort.size) * 100) : 0;
    }
    result.push({ date: cohort.date, size: cohort.size, retention });
  }
  return { cohorts: result };
}
