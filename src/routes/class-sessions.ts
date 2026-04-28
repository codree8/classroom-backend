import express from "express";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  lte,
  sql,
} from "drizzle-orm";

import { db } from "../db/index.js";
import {
  classes,
  classSessions,
  sessionMaterials,
  subjects,
  user,
} from "../db/schema/index.js";

type ClassSessionStatus = "scheduled" | "live" | "completed" | "cancelled";

type ClassSessionCreateBody = {
  classId?: unknown;
  title?: unknown;
  description?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  meetUrl?: unknown;
  recordingUrl?: unknown;
  status?: unknown;
};

type ClassSessionUpdateBody = Partial<ClassSessionCreateBody>;

const router = express.Router();

const SESSION_STATUSES: readonly ClassSessionStatus[] = [
  "scheduled",
  "live",
  "completed",
  "cancelled",
];

const MAX_PAGE_SIZE = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parsePositiveInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : null;
  }

  return null;
};

const parsePagination = (query: Record<string, unknown>) => {
  const page = parsePositiveInteger(query.page) ?? 1;
  const requestedLimit = parsePositiveInteger(query.limit) ?? 10;
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
};

const parseOptionalText = (
  value: unknown,
  fieldName: string,
): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;

  if (typeof value !== "string") {
    throw new Error(fieldName + " must be a string");
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseRequiredText = (
  value: unknown,
  fieldName: string,
  maxLength = 255,
): string => {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} is required`);
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} is required`);
  }

  if (trimmed.length > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} characters`);
  }

  return trimmed;
};

const parseDate = (value: unknown, fieldName: string): Date => {
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date`);
  }

  return date;
};

const parseOptionalDate = (
  value: unknown,
  fieldName: string,
): Date | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  return parseDate(value, fieldName);
};

const parseStatus = (value: unknown): ClassSessionStatus | undefined => {
  if (value === undefined || value === null || value === "") return undefined;

  if (
    typeof value === "string" &&
    SESSION_STATUSES.includes(value as ClassSessionStatus)
  ) {
    return value as ClassSessionStatus;
  }

  throw new Error(
    "status must be one of: scheduled, live, completed, cancelled",
  );
};

const assertValidDateRange = (startAt: Date, endAt: Date) => {
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error("endAt must be after startAt");
  }
};

const ensureClassExists = async (classId: number) => {
  const [classRecord] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);

  return Boolean(classRecord);
};

const readSessionById = async (sessionId: number) => {
  const [session] = await db
    .select({
      ...getTableColumns(classSessions),
      class: {
        ...getTableColumns(classes),
      },
      subject: {
        ...getTableColumns(subjects),
      },
      teacher: {
        ...getTableColumns(user),
      },
    })
    .from(classSessions)
    .leftJoin(classes, eq(classSessions.classId, classes.id))
    .leftJoin(subjects, eq(classes.subjectId, subjects.id))
    .leftJoin(user, eq(classes.teacherId, user.id))
    .where(eq(classSessions.id, sessionId))
    .limit(1);

  return session;
};

router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const classId = parsePositiveInteger(req.query.classId);
    const status = parseStatus(req.query.status);
    const from = parseOptionalDate(req.query.from, "from");
    const to = parseOptionalDate(req.query.to, "to");

    const filters = [];

    if (req.query.classId !== undefined && classId === null) {
      return res.status(400).json({ error: "Invalid classId" });
    }

    if (classId !== null) {
      filters.push(eq(classSessions.classId, classId));
    }

    if (status) {
      filters.push(eq(classSessions.status, status));
    }

    if (from) {
      filters.push(gte(classSessions.startAt, from));
    }

    if (to) {
      filters.push(lte(classSessions.startAt, to));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(classSessions)
      .where(whereClause);

    const totalCount = Number(countResult[0]?.count ?? 0);

    const sessions = await db
      .select({
        ...getTableColumns(classSessions),
        class: {
          id: classes.id,
          name: classes.name,
          inviteCode: classes.inviteCode,
          status: classes.status,
        },
        subject: {
          id: subjects.id,
          name: subjects.name,
          code: subjects.code,
        },
        teacher: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        totalMaterials: sql<number>`count(${sessionMaterials.id})`,
      })
      .from(classSessions)
      .leftJoin(classes, eq(classSessions.classId, classes.id))
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .leftJoin(
        sessionMaterials,
        eq(sessionMaterials.sessionId, classSessions.id),
      )
      .where(whereClause)
      .groupBy(
        classSessions.id,
        classes.id,
        classes.name,
        classes.inviteCode,
        classes.status,
        subjects.id,
        subjects.name,
        subjects.code,
        user.id,
        user.name,
        user.email,
      )
      .orderBy(asc(classSessions.startAt), desc(classSessions.createdAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json({
      data: sessions,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch class sessions";
    console.error("GET /class-sessions error:", error);
    res.status(400).json({ error: message });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!isRecord(req.body)) {
      return res.status(400).json({ error: "Request body must be an object" });
    }

    const body = req.body as ClassSessionCreateBody;
    const classId = parsePositiveInteger(body.classId);

    if (!classId) {
      return res.status(400).json({ error: "classId is required" });
    }

    const title = parseRequiredText(body.title, "title");
    const description = parseOptionalText(body.description, "description");
    const startAt = parseDate(body.startAt, "startAt");
    const endAt = parseDate(body.endAt, "endAt");
    const meetUrl = parseOptionalText(body.meetUrl, "meetUrl");
    const recordingUrl = parseOptionalText(body.recordingUrl, "recordingUrl");
    const status = parseStatus(body.status) ?? "scheduled";

    assertValidDateRange(startAt, endAt);

    const classExists = await ensureClassExists(classId);

    if (!classExists) {
      return res.status(404).json({ error: "Class not found" });
    }

    const [createdSession] = await db
      .insert(classSessions)
      .values({
        classId,
        title,
        description,
        startAt,
        endAt,
        meetUrl,
        recordingUrl,
        status,
      })
      .returning({ id: classSessions.id });

    if (!createdSession) {
      return res.status(500).json({ error: "Failed to create class session" });
    }

    const session = await readSessionById(createdSession.id);

    res.status(201).json({ data: session });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create class session";
    console.error("POST /class-sessions error:", error);
    res.status(400).json({ error: message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const sessionId = parsePositiveInteger(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const session = await readSessionById(sessionId);

    if (!session) {
      return res.status(404).json({ error: "Class session not found" });
    }

    const materials = await db
      .select()
      .from(sessionMaterials)
      .where(eq(sessionMaterials.sessionId, sessionId))
      .orderBy(
        asc(sessionMaterials.position),
        desc(sessionMaterials.createdAt),
      );

    res.status(200).json({
      data: {
        ...session,
        materials,
      },
    });
  } catch (error) {
    console.error("GET /class-sessions/:id error:", error);
    res.status(500).json({ error: "Failed to fetch class session" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const sessionId = parsePositiveInteger(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    if (!isRecord(req.body)) {
      return res.status(400).json({ error: "Request body must be an object" });
    }

    const [existingSession] = await db
      .select()
      .from(classSessions)
      .where(eq(classSessions.id, sessionId))
      .limit(1);

    if (!existingSession) {
      return res.status(404).json({ error: "Class session not found" });
    }

    const body = req.body as ClassSessionUpdateBody;
    const updates: Partial<typeof classSessions.$inferInsert> = {};

    if (body.classId !== undefined) {
      const classId = parsePositiveInteger(body.classId);

      if (!classId) {
        return res.status(400).json({ error: "Invalid classId" });
      }

      const classExists = await ensureClassExists(classId);

      if (!classExists) {
        return res.status(404).json({ error: "Class not found" });
      }

      updates.classId = classId;
    }

    if (body.title !== undefined) {
      updates.title = parseRequiredText(body.title, "title");
    }

    if (body.description !== undefined) {
      updates.description =
        parseOptionalText(body.description, "description") ?? null;
    }

    if (body.startAt !== undefined) {
      updates.startAt = parseDate(body.startAt, "startAt");
    }

    if (body.endAt !== undefined) {
      updates.endAt = parseDate(body.endAt, "endAt");
    }

    if (body.meetUrl !== undefined) {
      updates.meetUrl = parseOptionalText(body.meetUrl, "meetUrl") ?? null;
    }

    if (body.recordingUrl !== undefined) {
      updates.recordingUrl =
        parseOptionalText(body.recordingUrl, "recordingUrl") ?? null;
    }

    if (body.status !== undefined) {
      const status = parseStatus(body.status);

      if (!status) {
        return res.status(400).json({ error: "Invalid status" });
      }

      updates.status = status;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }

    const nextStartAt = updates.startAt ?? existingSession.startAt;
    const nextEndAt = updates.endAt ?? existingSession.endAt;

    assertValidDateRange(nextStartAt, nextEndAt);

    const [updatedSession] = await db
      .update(classSessions)
      .set(updates)
      .where(eq(classSessions.id, sessionId))
      .returning({ id: classSessions.id });

    if (!updatedSession) {
      return res.status(500).json({ error: "Failed to update class session" });
    }

    const session = await readSessionById(updatedSession.id);

    res.status(200).json({ data: session });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update class session";
    console.error("PUT /class-sessions/:id error:", error);
    res.status(400).json({ error: message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const sessionId = parsePositiveInteger(req.params.id);

    if (!sessionId) {
      return res.status(400).json({ error: "Invalid session id" });
    }

    const [deletedSession] = await db
      .delete(classSessions)
      .where(eq(classSessions.id, sessionId))
      .returning({ id: classSessions.id });

    if (!deletedSession) {
      return res.status(404).json({ error: "Class session not found" });
    }

    res.status(200).json({ data: deletedSession });
  } catch (error) {
    console.error("DELETE /class-sessions/:id error:", error);
    res.status(500).json({ error: "Failed to delete class session" });
  }
});

export default router;
