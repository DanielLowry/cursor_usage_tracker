let PrismaClient;
try {
  PrismaClient = require('@prisma/client').PrismaClient;
} catch (err) {
  console.error('Prisma Client is not installed. Please run:');
  console.error('  pnpm --filter @cursor-usage/db install');
  process.exit(1);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();

    // Encourage index usage in EXPLAIN by disabling sequential scan
    await prisma.$executeRawUnsafe('SET enable_seqscan TO off');

    const explain = async (sql) => {
      const rows = await prisma.$queryRawUnsafe(`EXPLAIN ${sql}`);
      // In pg, EXPLAIN returns an array of objects like { "QUERY PLAN": "Index Scan using ..." }
      const text = rows.map((r) => Object.values(r)[0]).join('\n');
      return text;
    };

    // 1) usage_event by billing period composite
    const planUsageEvents = await explain(
      "SELECT * FROM usage_event WHERE billing_period_start IS NULL AND billing_period_end IS NULL ORDER BY last_seen_at DESC LIMIT 1",
    );
    if (!/Index/i.test(planUsageEvents)) {
      console.error('Expected index usage for usage_event(billing_period_start, billing_period_end). Plan:', planUsageEvents);
      process.exit(1);
    }

    // 2) ingestion by ingested_at index
    const planIngestion = await explain(
      "SELECT * FROM ingestion WHERE ingested_at > now() - interval '1 day' ORDER BY ingested_at DESC LIMIT 1",
    );
    if (!/Index/i.test(planIngestion)) {
      console.error('Expected index usage for ingestion(ingested_at). Plan:', planIngestion);
      process.exit(1);
    }

    // 3) alerts(triggered_at)
    const planAlerts = await explain("SELECT * FROM alerts WHERE triggered_at > now() - interval '1 day' ORDER BY triggered_at DESC LIMIT 1");
    if (!/Index/i.test(planAlerts)) {
      console.error('Expected index usage for alerts(triggered_at). Plan:', planAlerts);
      process.exit(1);
    }

    // 4) metric_hourly(metric_key, ts_hour)
    const planMetricHourly = await explain("SELECT * FROM metric_hourly WHERE metric_key = '' AND ts_hour > now() - interval '1 day' ORDER BY ts_hour DESC LIMIT 1");
    if (!/Index/i.test(planMetricHourly)) {
      console.error('Expected index usage for metric_hourly(metric_key, ts_hour). Plan:', planMetricHourly);
      process.exit(1);
    }

    // 5) metric_daily(metric_key, date)
    const planMetricDaily = await explain("SELECT * FROM metric_daily WHERE metric_key = '' AND date > now()::date - 7 ORDER BY date DESC LIMIT 1");
    if (!/Index/i.test(planMetricDaily)) {
      console.error('Expected index usage for metric_daily(metric_key, date). Plan:', planMetricDaily);
      process.exit(1);
    }

    console.log('Index usage plans look good.');
    process.exit(0);
  } catch (e) {
    console.error('Index usage test failed:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();


