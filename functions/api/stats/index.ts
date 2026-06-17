// GET /api/stats?token=...&days=30&os=all&version=all
//
// 全部指标直接从 pings 表派生(而非 daily_summary 缓存),这样:
//   1) 支持 os / version 筛选,把整张看板切到任意子群体;
//   2) 窗口锚定到"数据里的最新日期",而不是服务器 UTC,消除跨时区偏移;
//   3) 新增 returning_users(DAU = 新增 + 回访)、rolling retention(全量活跃留存)、
//      累计增长曲线等更专业的指标。
// 保留所有旧字段,旧版看板照常工作;新版看板用新增字段。
export const onRequest = async (context) => {
  const url = new URL(context.request.url);
  const DB = context.env.DB;
  const days = Math.min(parseInt(url.searchParams.get("days") ?? "30", 10), 365);
  const osFilter = (url.searchParams.get("os") ?? "all").toLowerCase(); // all|win|linux|mac
  const verFilter = url.searchParams.get("version") ?? "all";

  // 公共筛选片段:所有聚合共用,保证整页看板一致地切到同一子群体。
  const filters = [];
  if (osFilter !== "all") filters.push({ sql: "os = ?", val: osFilter });
  if (verFilter !== "all") filters.push({ sql: "version = ?", val: verFilter });
  const filterSql = filters.map((f) => f.sql).join(" AND ");
  const filterBinds = filters.map((f) => f.val);
  const filterAnd = filterSql ? " AND " + filterSql : "";      // 用于已有 WHERE 的拼接
  const filterWhere = filterSql ? " WHERE " + filterSql : "";  // 用于尚无 WHERE 的整段查询

  try {
    // 数据域内的最新日期——用数据本身而非服务器 UTC,避免 WAU/MAU 窗口被时区推移。
    const latestRow = await DB.prepare(
      "SELECT MAX(date) AS d FROM pings" + filterWhere
    ).bind(...filterBinds).first();
    const today = latestRow?.d ?? new Date().toISOString().slice(0, 10);

    // ── 日趋势:直接 GROUP BY date(支持筛选 + returning_users)──
    const startDate = addDays(today, -(days - 1));
    const trendsQ = await DB.prepare(
      "SELECT date, " +
        "COUNT(*) AS dau, " +
        "SUM(CASE WHEN msg_count > 0 THEN 1 ELSE 0 END) AS eff_dau, " +
        "SUM(CASE WHEN first_seen THEN 1 ELSE 0 END) AS new_users, " +
        "SUM(CASE WHEN first_seen = 0 THEN 1 ELSE 0 END) AS returning_users, " +
        "SUM(msg_count) AS total_msgs, " +
        "SUM(CASE WHEN os = 'win'   THEN 1 ELSE 0 END) AS win_users, " +
        "SUM(CASE WHEN os = 'linux' THEN 1 ELSE 0 END) AS linux_users, " +
        "SUM(CASE WHEN os = 'mac'   THEN 1 ELSE 0 END) AS mac_users " +
        "FROM pings WHERE date BETWEEN ? AND ? " + filterAnd + " " +
        "GROUP BY date ORDER BY date"
    ).bind(startDate, today, ...filterBinds).all();
    const trends = trendsQ.results ?? [];

    const todayRow = trends[trends.length - 1] ?? {};
    const yesterday = trends[trends.length - 2] ?? {};
    const dau = todayRow?.dau ?? 0;

    // ── WAU / MAU(窗口锚定到数据最新日期)──
    const wau = await uniqueDevices(DB, today, 7, filterAnd, filterBinds);
    const mau = await uniqueDevices(DB, today, 30, filterAnd, filterBinds);
    const stickinessMau = mau > 0 ? Math.round((dau / mau) * 100) : 0;
    const stickinessWau = wau > 0 ? Math.round((dau / wau) * 100) : 0;

    // ── 累计用户(筛选后)──
    const totalRow = await DB.prepare(
      "SELECT COUNT(DISTINCT device_id) AS cnt FROM pings" + filterWhere
    ).bind(...filterBinds).first();
    const totalUsers = totalRow?.cnt ?? 0;

    // ── 历史峰值 DAU(SQLite 裸列随 MAX 取峰值所在行,得到 peakDate)──
    const peakRow = await DB.prepare(
      "SELECT MAX(dau) AS peak, date FROM (" +
        "SELECT date, COUNT(*) AS dau FROM pings WHERE 1=1 " + filterAnd + " GROUP BY date" +
      ")"
    ).bind(...filterBinds).first();
    const peakDau = peakRow?.peak ?? 0;
    const peakDate = peakRow?.date ?? null;

    // ── 当日有效用户平均消息数 ──
    const avgMsgs = await DB.prepare(
      "SELECT AVG(msg_count) AS avg FROM pings WHERE date = ? AND msg_count > 0 " + filterAnd
    ).bind(today, ...filterBinds).first();

    // ── 会话深度分布(过去 7 天)──
    const sevenDaysAgo = addDays(today, -6);
    const buckets = await DB.prepare(
      "SELECT " +
        "SUM(CASE WHEN msg_count = 0 THEN 1 ELSE 0 END) AS b0, " +
        "SUM(CASE WHEN msg_count BETWEEN 1 AND 5 THEN 1 ELSE 0 END) AS b1_5, " +
        "SUM(CASE WHEN msg_count BETWEEN 6 AND 20 THEN 1 ELSE 0 END) AS b6_20, " +
        "SUM(CASE WHEN msg_count > 20 THEN 1 ELSE 0 END) AS b20p " +
        "FROM pings WHERE date >= ? " + filterAnd
    ).bind(sevenDaysAgo, ...filterBinds).first();

    // ── 版本分布(最新日;版本筛选下只剩一项,无妨)──
    const versions = await DB.prepare(
      "SELECT version, COUNT(*) AS count FROM pings WHERE date = ? " + filterAnd + " GROUP BY version ORDER BY count DESC"
    ).bind(today, ...filterBinds).all();

    // ── 累计用户增长曲线(全期,按首次出现日累计 distinct 设备)──
    const growth = await computeGrowth(DB, filterAnd, filterBinds);

    // ── 留存:新用户 cohort + 全量滚动留存 ──
    const retention = await computeRetention(DB, today, 60, filterAnd, filterBinds);
    const rollingRetention = await computeRollingRetention(DB, today, 14, filterAnd, filterBinds);
    const avgRetention = computeAvgRetention(retention.cohorts);

    // ── 最近活跃设备列表(version/os 取该设备最新一条,与本次筛选无关)──
    const recentUsers = await DB.prepare(
      "SELECT device_id, " +
        "MIN(date) AS first_date, MAX(date) AS last_date, " +
        "SUM(msg_count) AS total_msgs, COUNT(*) AS active_days, " +
        "(SELECT version FROM pings p2 WHERE p2.device_id = p.device_id ORDER BY date DESC LIMIT 1) AS version, " +
        "(SELECT os FROM pings p2 WHERE p2.device_id = p.device_id ORDER BY date DESC LIMIT 1) AS os " +
        "FROM pings p WHERE 1=1 " + filterAnd + " " +
        "GROUP BY device_id ORDER BY last_date DESC, total_msgs DESC LIMIT 50"
    ).bind(...filterBinds).all();

    return new Response(JSON.stringify({
      trends,
      wau, mau,
      stickiness: stickinessMau,         // 兼容老字段
      stickinessMau, stickinessWau,
      totalUsers,
      peakDau, peakDate,
      avgMsgsPerActive: Math.round((avgMsgs?.avg ?? 0) * 10) / 10,
      depth: {
        b0: buckets?.b0 ?? 0,
        b1_5: buckets?.b1_5 ?? 0,
        b6_20: buckets?.b6_20 ?? 0,
        b20p: buckets?.b20p ?? 0,
      },
      avgRetention,
      versions: versions.results ?? [],
      retention,
      rollingRetention,
      growth,
      recentUsers: recentUsers.results ?? [],
      filter: { os: osFilter, version: verFilter, asOf: today },
    }), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("stats error:", err);
    return new Response(JSON.stringify({ error: String(err?.message ?? err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
};

// 日期字符串加减天数(全程 UTC,避免本地时区污染 "YYYY-MM-DD")。
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function uniqueDevices(DB, endDate, windowDays, filterAnd, filterBinds) {
  const startDate = addDays(endDate, -(windowDays - 1));
  const row = await DB.prepare(
    "SELECT COUNT(DISTINCT device_id) AS cnt FROM pings WHERE date BETWEEN ? AND ? " + filterAnd
  ).bind(startDate, endDate, ...filterBinds).first();
  return row?.cnt ?? 0;
}

// 全期累计用户增长:按每个 first_seen 日累计,得到一条单调上升曲线。
async function computeGrowth(DB, filterAnd, filterBinds) {
  const rows = await DB.prepare(
    "SELECT date, COUNT(*) AS new_on_day FROM pings WHERE first_seen = 1 " + filterAnd + " GROUP BY date ORDER BY date"
  ).bind(...filterBinds).all();
  const out = [];
  let cum = 0;
  for (const r of rows.results ?? []) {
    cum += r.new_on_day ?? 0;
    out.push({ date: r.date, total: cum, new: r.new_on_day ?? 0 });
  }
  return out;
}

// 新用户 cohort 留存:每个"首次出现日"的设备,在 D+N 日的回访率。
async function computeRetention(DB, asOf, cohortDays, filterAnd, filterBinds) {
  try {
    const since = addDays(asOf, -cohortDays);
    const cohorts = await DB.prepare(
      "SELECT date, COUNT(*) AS size FROM pings " +
        "WHERE first_seen = 1 AND date >= ? " + filterAnd + " " +
        "GROUP BY date ORDER BY date DESC LIMIT 30"
    ).bind(since, ...filterBinds).all();

    const result = [];
    const offsets = [1, 3, 7, 14, 30];
    for (const cohort of cohorts.results ?? []) {
      const retention = {};
      for (const offset of offsets) {
        const target = addDays(cohort.date, offset);
        if (target > asOf) continue;
        const row = await DB.prepare(
          "SELECT COUNT(*) AS cnt FROM pings " +
            "WHERE device_id IN (SELECT device_id FROM pings WHERE date = ? AND first_seen = 1 " + filterAnd + ") " +
            "AND date = ? " + filterAnd
        ).bind(cohort.date, ...filterBinds, target, ...filterBinds).first();
        retention[offset] = cohort.size > 0 ? Math.round(((row?.cnt ?? 0) / cohort.size) * 100) : 0;
      }
      result.push({ date: cohort.date, size: cohort.size, retention });
    }
    return { cohorts: result };
  } catch (err) {
    console.error("retention error:", err);
    return { cohorts: [] };
  }
}

// 全量滚动留存:以"某天所有活跃设备"为 cohort(不限新用户),看 D+N 回访率。
// 衡量产品对存量用户的整体粘性,与新用户 cohort 互补。
async function computeRollingRetention(DB, asOf, baseDays, filterAnd, filterBinds) {
  try {
    const since = addDays(asOf, -(baseDays - 1));
    const bases = await DB.prepare(
      "SELECT date, COUNT(*) AS size FROM pings WHERE date >= ? " + filterAnd + " GROUP BY date ORDER BY date DESC LIMIT ?"
    ).bind(since, ...filterBinds, baseDays).all();

    const result = [];
    const offsets = [1, 3, 7, 14];
    for (const base of bases.results ?? []) {
      const retention = {};
      for (const offset of offsets) {
        const target = addDays(base.date, offset);
        if (target > asOf) continue;
        const row = await DB.prepare(
          "SELECT COUNT(*) AS cnt FROM pings " +
            "WHERE device_id IN (SELECT device_id FROM pings WHERE date = ? " + filterAnd + ") " +
            "AND date = ? " + filterAnd
        ).bind(base.date, ...filterBinds, target, ...filterBinds).first();
        retention[offset] = base.size > 0 ? Math.round(((row?.cnt ?? 0) / base.size) * 100) : 0;
      }
      result.push({ date: base.date, size: base.size, retention });
    }
    return { cohorts: result };
  } catch (err) {
    console.error("rolling retention error:", err);
    return { cohorts: [] };
  }
}

// 聚合新用户 cohort 的 D1/D7/D30 加权平均(只取已"满龄"的 cohort,避免新日拉低均值)。
function computeAvgRetention(cohorts) {
  const result = { d1: null, d7: null, d30: null };
  if (!cohorts?.length) return result;
  for (const [key, offset] of [["d1", 1], ["d7", 7], ["d30", 30]]) {
    const valid = cohorts.filter((c) => c.retention[offset] != null);
    if (!valid.length) continue;
    const totalUsers = valid.reduce((s, c) => s + c.size, 0);
    const weighted = valid.reduce((s, c) => s + c.retention[offset] * c.size, 0);
    result[key] = totalUsers > 0 ? Math.round(weighted / totalUsers) : null;
  }
  return result;
}
