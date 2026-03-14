import { Router } from "express";
import { pool } from "../config/database.js";
import type { Report } from "../types/index.js";

const router = Router();

// GET /api/sessions/:id/report — Get report (200 if ready, 202 if generating)
router.get("/:id/report", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check session exists
    const sessionResult = await pool.query(
      `SELECT status FROM sessions WHERE id = $1`,
      [id],
    );
    if (sessionResult.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const status = sessionResult.rows[0].status;
    if (status === "active") {
      res.status(400).json({ error: "Session is still active" });
      return;
    }

    // Check if report exists
    const reportResult = await pool.query<Report>(
      `SELECT * FROM reports WHERE session_id = $1`,
      [id],
    );

    if (reportResult.rows.length === 0) {
      res.status(202).json({ status: "generating" });
      return;
    }

    res.json({ report: reportResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
