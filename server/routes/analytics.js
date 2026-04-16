import express from 'express';
import db from '../database.js';

const router = express.Router();
const REPEAT_OFFENDER_THRESHOLD = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildPreviousMonthWindow(currentStart, currentEndExclusive) {
  const prevStart = new Date(currentStart);
  prevStart.setMonth(prevStart.getMonth() - 1);

  const prevEndExclusive = new Date(currentEndExclusive);
  prevEndExclusive.setMonth(prevEndExclusive.getMonth() - 1);

  // Keep comparison range length identical even around month boundaries.
  const durationMs = currentEndExclusive.getTime() - currentStart.getTime();
  if (prevEndExclusive.getTime() - prevStart.getTime() !== durationMs) {
    prevEndExclusive.setTime(prevStart.getTime() + durationMs);
  }

  return {
    startIso: prevStart.toISOString(),
    endIso: prevEndExclusive.toISOString()
  };
}

function buildPreviousWindow(currentStart, currentEndExclusive) {
  const durationMs = Math.max(currentEndExclusive.getTime() - currentStart.getTime(), 0);
  const previousEndExclusive = new Date(currentStart);
  const previousStart = new Date(previousEndExclusive.getTime() - durationMs);
  return {
    startIso: previousStart.toISOString(),
    endIso: previousEndExclusive.toISOString()
  };
}

function computeTrend(currentTotal, previousTotal) {
  const delta = currentTotal - previousTotal;
  const deltaPct = previousTotal > 0
    ? Number(((delta / previousTotal) * 100).toFixed(2))
    : (currentTotal > 0 ? 100 : 0);
  return { currentTotal, previousTotal, delta, deltaPct };
}

function buildDescriptiveNarrative(payload) {
  const trend = payload?.trends?.violations7d;
  const topLocation = payload?.topLocation?.cameraLocationId || 'the monitored area';
  const topVehicleType = payload?.topVehicleType?.vehicleType || 'unknown';
  const topVehicleTypeCount = Number(payload?.topVehicleType?.count || 0);
  const warnings = Number(payload?.totals?.warnings || 0);
  const recurringPct = Number(payload?.repeatOffenders?.recurringPct || 0);
  const delta = Number(trend?.delta || 0);
  const deltaPct = Number(trend?.deltaPct || 0);

  const trendLine = delta > 0
    ? `- Violation volume is increasing (+${delta} / +${deltaPct}% over the last 7-day comparison window).`
    : delta < 0
      ? `- Violation volume is decreasing (${delta} / ${deltaPct}% over the last 7-day comparison window).`
      : '- Violation volume is flat versus the previous 7-day comparison window.';

  const riskLine = `- Highest concentration remains around ${topLocation}, with ${topVehicleType} leading violation type (${topVehicleTypeCount}).`;

  const actionLine = warnings > 0
    ? `- Immediate action: prioritize active warning follow-ups (${warnings} open) and enforce repeat-offender checks (${recurringPct.toFixed(2)}% recurring).`
    : `- Recommended action: focus patrols in ${topLocation} and monitor repeat-offender share (${recurringPct.toFixed(2)}%) to prevent warning buildup.`;

  return [trendLine, riskLine, actionLine].join('\n');
}

router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, locationId } = req.query;
    
    // Build violation date filter (violations table uses timeDetected, not timestamp)
    let dateFilter = '';
    const params = [];
    
    if (startDate) {
      dateFilter += ' AND timeDetected >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      dateFilter += ' AND timeDetected < ?';
      params.push(endDateObj.toISOString());
    }
    
    // Build location filter for violations
    let violationLocationFilter = '';
    const violationParams = [...params];
    
    if (locationId) {
      violationLocationFilter = ' AND cameraLocationId = ?';
      violationParams.push(locationId);
    }

    // 1. USER / RESIDENT ANALYTICS
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const totalResidents = db.prepare('SELECT COUNT(*) as count FROM residents').get();
    const usersByRole = db.prepare(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role
    `).all();
    
    // 2. VEHICLE ANALYTICS
    const totalVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles').get();
    const vehiclesBySource = db.prepare(`
      SELECT dataSource, COUNT(*) as count 
      FROM vehicles 
      GROUP BY dataSource
    `).all();
    
    // Vehicle registration trends (by date)
    const vehicleRegistrations = db.prepare(`
      SELECT DATE(registeredAt) as date, COUNT(*) as count 
      FROM vehicles 
      WHERE registeredAt IS NOT NULL
      GROUP BY DATE(registeredAt)
      ORDER BY date DESC
      LIMIT 30
    `).all();
    
    // 3. VIOLATION ANALYTICS
    const violationWhere = `WHERE 1=1${dateFilter}${violationLocationFilter}`;
    
    const totalViolations = db.prepare(`SELECT COUNT(*) as count FROM violations ${violationWhere}`).get(...violationParams);
    const violationsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY status
    `).all(...violationParams);
    
    const violationsByLocation = db.prepare(`
      SELECT cameraLocationId, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY cameraLocationId
      ORDER BY count DESC
    `).all(...violationParams);

    const violationsByVehicleType = db.prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(v.vehicleType), ''), 'unknown') as vehicleType,
        COUNT(*) as count
      FROM violations viol
      LEFT JOIN vehicles v ON UPPER(TRIM(v.plateNumber)) = UPPER(TRIM(viol.plateNumber))
      ${violationWhere.replace('WHERE', 'WHERE 1=1 AND')}
      GROUP BY COALESCE(NULLIF(TRIM(v.vehicleType), ''), 'unknown')
      ORDER BY count DESC
    `).all(...violationParams);
    
    // Violations over time (daily)
    const violationsOverTime = db.prepare(`
      SELECT DATE(timeDetected) as date, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY DATE(timeDetected)
      ORDER BY date DESC
      LIMIT 30
    `).all(...violationParams);
    
    // Violations by hour of day
    const violationsByHour = db.prepare(`
      SELECT CAST(strftime('%H', timeDetected) AS INTEGER) as hour, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY hour
      ORDER BY hour
    `).all(...violationParams);

    const hourCountMap = violationsByHour.reduce((acc, item) => {
      acc[item.hour] = item.count;
      return acc;
    }, {});
    const hourHeatmap = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hourCountMap[hour] || 0
    }));

    const avgInfractionDuration = db.prepare(`
      SELECT AVG((julianday(warningExpiresAt) - julianday(timeDetected)) * 24 * 60) as avgMinutes
      FROM violations
      ${violationWhere}
      AND warningExpiresAt IS NOT NULL
      AND timeDetected IS NOT NULL
      AND warningExpiresAt > timeDetected
    `).get(...violationParams);
    const avgInfractionDurationMinutes = avgInfractionDuration?.avgMinutes != null
      ? Number(avgInfractionDuration.avgMinutes.toFixed(2))
      : null;

    const avgIssuanceDuration = db.prepare(`
      SELECT AVG((julianday(COALESCE(timeIssued, warningExpiresAt)) - julianday(timeDetected)) * 24 * 60) as avgMinutes
      FROM violations
      ${violationWhere}
      AND timeDetected IS NOT NULL
      AND COALESCE(timeIssued, warningExpiresAt) IS NOT NULL
      AND COALESCE(timeIssued, warningExpiresAt) > timeDetected
    `).get(...violationParams);
    const avgInfractionToActionMinutes = avgIssuanceDuration?.avgMinutes != null
      ? Number(avgIssuanceDuration.avgMinutes.toFixed(2))
      : null;
    const avgInfractionToActionLabel = 'Average time from first detection to issuance (fallback: warning expiry when issuance is unavailable)';

    const vehicleTotals = db.prepare(`
      SELECT
        COUNT(DISTINCT plateNumber) as uniqueVehicles,
        SUM(CASE WHEN violationCount >= ? THEN 1 ELSE 0 END) as recurringVehicles
      FROM (
        SELECT plateNumber, COUNT(*) as violationCount
        FROM violations
        ${violationWhere}
        AND plateNumber IS NOT NULL
        AND TRIM(plateNumber) != ''
        GROUP BY plateNumber
      )
    `).get(REPEAT_OFFENDER_THRESHOLD, ...violationParams);
    const uniqueVehicles = Number(vehicleTotals?.uniqueVehicles || 0);
    const recurringVehicles = Number(vehicleTotals?.recurringVehicles || 0);
    const recurringPct = uniqueVehicles > 0
      ? Number(((recurringVehicles / uniqueVehicles) * 100).toFixed(2))
      : 0;
    const topVehicleType = violationsByVehicleType[0] || null;

    const now = new Date();
    const currentEndExclusive = endDate
      ? (() => {
          const endDateObj = new Date(endDate);
          endDateObj.setDate(endDateObj.getDate() + 1);
          return endDateObj;
        })()
      : now;
    const currentStart = startDate
      ? new Date(startDate)
      : new Date(currentEndExclusive.getTime() - (30 * 24 * 60 * 60 * 1000));

    const previousWindow = buildPreviousMonthWindow(currentStart, currentEndExclusive);
    const previousParams = [previousWindow.startIso, previousWindow.endIso];
    if (locationId) {
      previousParams.push(locationId);
    }
    const previousLocationFilter = locationId ? ' AND cameraLocationId = ?' : '';
    const previousTotalViolations = db.prepare(`
      SELECT COUNT(*) as count
      FROM violations
      WHERE timeDetected >= ?
      AND timeDetected < ?
      ${previousLocationFilter}
    `).get(...previousParams);
    const previousTotal = Number(previousTotalViolations?.count || 0);
    const currentTotal = Number(totalViolations.count || 0);
    const delta = currentTotal - previousTotal;
    const deltaPct = previousTotal > 0
      ? Number(((delta / previousTotal) * 100).toFixed(2))
      : (currentTotal > 0 ? 100 : 0);

    const trendCurrentStartCandidate = new Date(currentEndExclusive.getTime() - (7 * DAY_MS));
    const trendCurrentStart = startDate
      ? new Date(Math.max(new Date(startDate).getTime(), trendCurrentStartCandidate.getTime()))
      : trendCurrentStartCandidate;
    const trendWindow = buildPreviousWindow(trendCurrentStart, currentEndExclusive);
    const trendParamsBase = [trendCurrentStart.toISOString(), currentEndExclusive.toISOString()];
    const previousTrendParamsBase = [trendWindow.startIso, trendWindow.endIso];
    const trendLocationFilter = locationId ? ' AND cameraLocationId = ?' : '';
    const trendParams = locationId ? [...trendParamsBase, locationId] : trendParamsBase;
    const previousTrendParams = locationId ? [...previousTrendParamsBase, locationId] : previousTrendParamsBase;

    const currentTrendViolations = db.prepare(`
      SELECT COUNT(*) as count
      FROM violations
      WHERE timeDetected >= ?
      AND timeDetected < ?
      ${trendLocationFilter}
    `).get(...trendParams);
    const previousTrendViolations = db.prepare(`
      SELECT COUNT(*) as count
      FROM violations
      WHERE timeDetected >= ?
      AND timeDetected < ?
      ${trendLocationFilter}
    `).get(...previousTrendParams);
    const violationsTrend = computeTrend(
      Number(currentTrendViolations?.count || 0),
      Number(previousTrendViolations?.count || 0)
    );
    
    // 4. WARNING ANALYTICS
    const totalWarnings = db.prepare(`
      SELECT COUNT(*) as count 
      FROM violations 
      ${violationWhere} AND status = 'warning'
    `).get(...violationParams);
    
    const warningsOverTime = db.prepare(`
      SELECT DATE(timeDetected) as date, COUNT(*) as count 
      FROM violations 
      ${violationWhere} AND status = 'warning'
      GROUP BY DATE(timeDetected)
      ORDER BY date DESC
      LIMIT 30
    `).all(...violationParams);
    
    // Warning conversion (warnings that became tickets)
    const warningsConverted = db.prepare(`
      SELECT COUNT(*) as count 
      FROM violations 
      ${violationWhere} AND status IN ('issued', 'cleared')
    `).get(...violationParams);

    const currentTrendWarnings = db.prepare(`
      SELECT COUNT(*) as count
      FROM violations
      WHERE timeDetected >= ?
      AND timeDetected < ?
      AND status = 'warning'
      ${trendLocationFilter}
    `).get(...trendParams);
    const previousTrendWarnings = db.prepare(`
      SELECT COUNT(*) as count
      FROM violations
      WHERE timeDetected >= ?
      AND timeDetected < ?
      AND status = 'warning'
      ${trendLocationFilter}
    `).get(...previousTrendParams);
    const warningsTrend = computeTrend(
      Number(currentTrendWarnings?.count || 0),
      Number(previousTrendWarnings?.count || 0)
    );
    
    // 5. DETECTION ANALYTICS
    let detectionWhere = `WHERE 1=1`;
    const detectionParams = [];
    
    if (startDate) {
      detectionWhere += ' AND timestamp >= ?';
      detectionParams.push(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      detectionWhere += ' AND timestamp < ?';
      detectionParams.push(endDateObj.toISOString());
    }
    
    const totalDetections = db.prepare(`SELECT COUNT(*) as count FROM detections ${detectionWhere}`).get(...detectionParams);
    const detectionsByClass = db.prepare(`
      SELECT class_name, COUNT(*) as count 
      FROM detections 
      ${detectionWhere}
      GROUP BY class_name
    `).all(...detectionParams);
    
    const detectionsOverTime = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count 
      FROM detections 
      ${detectionWhere}
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
      LIMIT 30
    `).all(...detectionParams);

    const detectionsByHour = db.prepare(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as count 
      FROM detections 
      ${detectionWhere}
      AND (class_name IS NULL OR LOWER(TRIM(class_name)) != 'none')
      GROUP BY hour
      ORDER BY hour
    `).all(...detectionParams);
    
    // 6. SMS ANALYTICS
    let smsWhere = `WHERE 1=1`;
    const smsParams = [];
    
    if (startDate) {
      smsWhere += ' AND sentAt >= ?';
      smsParams.push(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      smsWhere += ' AND sentAt < ?';
      smsParams.push(endDateObj.toISOString());
    }
    
    const totalSMS = db.prepare(`SELECT COUNT(*) as count FROM sms_logs ${smsWhere}`).get(...smsParams);
    const smsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM sms_logs 
      ${smsWhere}
      GROUP BY status
    `).all(...smsParams);
    
    // 7. INCIDENT ANALYTICS
    let incidentWhere = `WHERE 1=1`;
    const incidentParams = [];
    
    if (startDate) {
      incidentWhere += ' AND timestamp >= ?';
      incidentParams.push(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      incidentWhere += ' AND timestamp < ?';
      incidentParams.push(endDateObj.toISOString());
    }
    
    const totalIncidents = db.prepare(`SELECT COUNT(*) as count FROM incidents ${incidentWhere}`).get(...incidentParams);
    const incidentsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM incidents 
      ${incidentWhere}
      GROUP BY status
    `).all(...incidentParams);
    
    // 8. CAMERA ANALYTICS
    const totalCameras = db.prepare('SELECT COUNT(*) as count FROM cameras').get();
    const camerasByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM cameras 
      GROUP BY status
    `).all();
    
    // 9. RECENT ACTIVITY (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentViolations = db.prepare(`
      SELECT COUNT(*) as count 
      FROM violations 
      WHERE timeDetected >= ?
    `).get(sevenDaysAgo.toISOString());
    
    const recentVehicles = db.prepare(`
      SELECT COUNT(*) as count 
      FROM vehicles 
      WHERE registeredAt >= ?
    `).get(sevenDaysAgo.toISOString());
    
    const recentDetections = db.prepare(`
      SELECT COUNT(*) as count 
      FROM detections 
      WHERE timestamp >= ? AND class_name != 'none'
    `).get(sevenDaysAgo.toISOString());

    const topResidents = db.prepare(`
      SELECT r.name as name, COUNT(*) as count
      FROM violations v
      INNER JOIN vehicles veh ON UPPER(TRIM(COALESCE(v.plateNumber, ''))) = UPPER(TRIM(COALESCE(veh.plateNumber, '')))
        AND veh.residentId IS NOT NULL AND LENGTH(TRIM(veh.residentId)) > 0
      INNER JOIN residents r ON r.id = veh.residentId
      ${violationWhere}
      AND v.plateNumber IS NOT NULL AND LENGTH(TRIM(v.plateNumber)) > 0
      AND UPPER(TRIM(v.plateNumber)) NOT IN ('NONE', 'BLUR')
      GROUP BY r.id, r.name
      ORDER BY count DESC
      LIMIT 8
    `).all(...violationParams);

    const topVisitors = db.prepare(`
      SELECT v.plateNumber as plateNumber, COUNT(*) as count
      FROM violations v
      WHERE 1=1
      AND NOT EXISTS (
        SELECT 1 FROM vehicles veh
        WHERE UPPER(TRIM(COALESCE(veh.plateNumber, ''))) = UPPER(TRIM(COALESCE(v.plateNumber, '')))
        AND veh.residentId IS NOT NULL AND LENGTH(TRIM(veh.residentId)) > 0
      )
      ${dateFilter}${violationLocationFilter}
      AND v.plateNumber IS NOT NULL AND LENGTH(TRIM(v.plateNumber)) > 0
      AND UPPER(TRIM(v.plateNumber)) NOT IN ('NONE', 'BLUR')
      GROUP BY UPPER(TRIM(v.plateNumber))
      ORDER BY count DESC
      LIMIT 8
    `).all(...violationParams);

    const aiNarrative = buildDescriptiveNarrative({
      period: {
        startDate: startDate || null,
        endDate: endDate || null,
        locationId: locationId || null,
      },
      totals: {
        violations: Number(totalViolations.count || 0),
        warnings: Number(totalWarnings.count || 0),
        detections: Number(totalDetections.count || 0),
      },
      trends: {
        violations7d: violationsTrend,
        warnings7d: warningsTrend,
      },
      topLocation: violationsByLocation[0] || null,
      topVehicleType,
      repeatOffenders: {
        uniqueVehicles,
        recurringVehicles,
        recurringPct,
      },
    });

    res.json({
      users: {
        total: totalUsers.count,
        byRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = item.count;
          return acc;
        }, {})
      },
      residents: {
        total: totalResidents.count,
      },
      vehicles: {
        total: totalVehicles.count,
        bySource: vehiclesBySource.reduce((acc, item) => {
          acc[item.dataSource || 'unknown'] = item.count;
          return acc;
        }, {}),
        registrationTrends: vehicleRegistrations
      },
      violations: {
        total: totalViolations.count,
        byStatus: violationsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {}),
        byLocation: violationsByLocation,
        overTime: violationsOverTime,
        byHour: violationsByHour,
        descriptive: {
          hourHeatmap,
          avgInfractionDurationMinutes,
          avgInfractionToActionMinutes,
          avgInfractionToActionLabel,
          repeatOffenders: {
            uniqueVehicles,
            recurringVehicles,
            recurringPct,
            threshold: REPEAT_OFFENDER_THRESHOLD
          },
          sevenDayComparison: {
            ...violationsTrend,
            basis: 'previous_7_day_period'
          },
          periodComparison: {
            currentTotal,
            previousTotal,
            delta,
            deltaPct,
            basis: 'previous_month_same_span'
          },
          byVehicleType: violationsByVehicleType,
          topVehicleType,
          aiNarrative
        },
        topResidents: topResidents.map((row) => ({ name: row.name, count: row.count })),
        topVisitors: topVisitors.map((row) => ({ plateNumber: row.plateNumber, count: row.count }))
      },
      warnings: {
        total: totalWarnings.count,
        overTime: warningsOverTime,
        converted: warningsConverted.count,
        conversionRate: totalWarnings.count > 0 
          ? ((warningsConverted.count / totalWarnings.count) * 100).toFixed(2)
          : '0.00',
        sevenDayComparison: {
          ...warningsTrend,
          basis: 'previous_7_day_period'
        }
      },
      detections: {
        total: totalDetections.count,
        byClass: detectionsByClass.reduce((acc, item) => {
          acc[item.class_name || 'none'] = item.count;
          return acc;
        }, {}),
        overTime: detectionsOverTime,
        byHour: detectionsByHour
      },
      sms: {
        total: totalSMS.count,
        byStatus: smsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {})
      },
      incidents: {
        total: totalIncidents.count,
        byStatus: incidentsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {})
      },
      cameras: {
        total: totalCameras.count,
        byStatus: camerasByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {})
      },
      recent: {
        violations: recentViolations.count,
        vehicles: recentVehicles.count,
        detections: recentDetections.count
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

