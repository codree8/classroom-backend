import express from "express";
import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";

import { db } from "../db/index.js";
import {
  classes,
  classSessions,
  sessionMaterials,
  subjects,
} from "../db/schema/index.js";

type SessionMaterialType = "pdf" | "doc" | "ppt" | "link" | "video" | "other";

type SessionMaterialCreateBody = {
  sessionId?: unknown;
  title?: unknown;
  description?: unknown;
  type?: unknown;
  url?: unknown;
  filePublicId?: unknown;
  position?: unknown;
};

type SessionMaterialUpdateBody = Partial<SessionMaterialCreateBody>;

const router = express.Router();

const MATERIAL_TYPES: readonly SessionMaterialType[] = [
  "pdf",
  "doc",
  "ppt",
  "link",
  "video",
  "other",
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

const parseNonNegativeInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return parsed >= 0 ? parsed : null;
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

const parseMaterialType = (value: unknown): SessionMaterialType | undefined => {
  if (value === undefined || value === null || value === "") return undefined;

  if (
    typeof value === "string" &&
    MATERIAL_TYPES.includes(value as SessionMaterialType)
  ) {
    return value as SessionMaterialType;
  }

  throw new Error("type must be one of: pdf, doc, ppt, link, video, other");
};

const parseRequiredUrl = (value: unknown): string => {
  const url = parseRequiredText(value, "url", 2048);

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Invalid URL protocol");
    }
  } catch {
    throw new Error("url must be a valid http or https URL");
  }

  return url;
};

const ensureSessionExists = async (sessionId: number) => {
  const [sessionRecord] = await db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
    .limit(1);

  return Boolean(sessionRecord);
};

const resolveMaterialPosition = async (
  sessionId: number,
  requestedPosition: unknown,
): Promise<number> => {
  if (
    requestedPosition !== undefined &&
    requestedPosition !== null &&
    requestedPosition !== ""
  ) {
    const position = parseNonNegativeInteger(requestedPosition);

    if (position === null) {
      throw new Error("position must be a non-negative integer");
    }

    return position;
  }

  const [positionResult] = await db
    .select({
      nextPosition: sql<number>`coalesce(max(${sessionMaterials.position}), -1) + 1`,
    })
    .from(sessionMaterials)
    .where(eq(sessionMaterials.sessionId, sessionId));

  return Number(positionResult?.nextPosition ?? 0);
};

const readMaterialById = async (materialId: number) => {
  const [material] = await db
    .select({
      ...getTableColumns(sessionMaterials),
      session: {
        id: classSessions.id,
        classId: classSessions.classId,
        title: classSessions.title,
        startAt: classSessions.startAt,
        endAt: classSessions.endAt,
        status: classSessions.status,
      },
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
    })
    .from(sessionMaterials)
    .leftJoin(classSessions, eq(sessionMaterials.sessionId, classSessions.id))
    .leftJoin(classes, eq(classSessions.classId, classes.id))
    .leftJoin(subjects, eq(classes.subjectId, subjects.id))
    .where(eq(sessionMaterials.id, materialId))
    .limit(1);

  return material;
};

router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const sessionId = parsePositiveInteger(req.query.sessionId);
    const type = parseMaterialType(req.query.type);

    if (req.query.sessionId !== undefined && sessionId === null) {
      return res.status(400).json({ error: "Invalid sessionId" });
    }

    const filters = [];

    if (sessionId !== null) {
      filters.push(eq(sessionMaterials.sessionId, sessionId));
    }

    if (type) {
      filters.push(eq(sessionMaterials.type, type));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(sessionMaterials)
      .where(whereClause);

    const totalCount = Number(countResult[0]?.count ?? 0);

    const materials = await db
      .select({
        ...getTableColumns(sessionMaterials),
        session: {
          id: classSessions.id,
          classId: classSessions.classId,
          title: classSessions.title,
          startAt: classSessions.startAt,
          endAt: classSessions.endAt,
          status: classSessions.status,
        },
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
      })
      .from(sessionMaterials)
      .leftJoin(classSessions, eq(sessionMaterials.sessionId, classSessions.id))
      .leftJoin(classes, eq(classSessions.classId, classes.id))
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .where(whereClause)
      .orderBy(asc(sessionMaterials.position), desc(sessionMaterials.createdAt))
      .limit(limit)
      .offset(offset);

    res.status(200).json({
      data: materials,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to fetch session materials";
    console.error("GET /session-materials error:", error);
    res.status(400).json({ error: message });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!isRecord(req.body)) {
      return res.status(400).json({ error: "Request body must be an object" });
    }

    const body = req.body as SessionMaterialCreateBody;
    const sessionId = parsePositiveInteger(body.sessionId);

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const sessionExists = await ensureSessionExists(sessionId);

    if (!sessionExists) {
      return res.status(404).json({ error: "Class session not found" });
    }

    const title = parseRequiredText(body.title, "title");
    const description = parseOptionalText(body.description, "description");
    const type = parseMaterialType(body.type) ?? "other";
    const url = parseRequiredUrl(body.url);
    const filePublicId = parseOptionalText(body.filePublicId, "filePublicId");
    const position = await resolveMaterialPosition(sessionId, body.position);

    const [createdMaterial] = await db
      .insert(sessionMaterials)
      .values({
        sessionId,
        title,
        description,
        type,
        url,
        filePublicId,
        position,
      })
      .returning({ id: sessionMaterials.id });

    if (!createdMaterial) {
      return res
        .status(500)
        .json({ error: "Failed to create session material" });
    }

    const material = await readMaterialById(createdMaterial.id);

    res.status(201).json({ data: material });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create session material";
    console.error("POST /session-materials error:", error);
    res.status(400).json({ error: message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const materialId = parsePositiveInteger(req.params.id);

    if (!materialId) {
      return res.status(400).json({ error: "Invalid material id" });
    }

    const material = await readMaterialById(materialId);

    if (!material) {
      return res.status(404).json({ error: "Session material not found" });
    }

    res.status(200).json({ data: material });
  } catch (error) {
    console.error("GET /session-materials/:id error:", error);
    res.status(500).json({ error: "Failed to fetch session material" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const materialId = parsePositiveInteger(req.params.id);

    if (!materialId) {
      return res.status(400).json({ error: "Invalid material id" });
    }

    if (!isRecord(req.body)) {
      return res.status(400).json({ error: "Request body must be an object" });
    }

    const [existingMaterial] = await db
      .select()
      .from(sessionMaterials)
      .where(eq(sessionMaterials.id, materialId))
      .limit(1);

    if (!existingMaterial) {
      return res.status(404).json({ error: "Session material not found" });
    }

    const body = req.body as SessionMaterialUpdateBody;
    const updates: Partial<typeof sessionMaterials.$inferInsert> = {};

    if (body.sessionId !== undefined) {
      const sessionId = parsePositiveInteger(body.sessionId);

      if (!sessionId) {
        return res.status(400).json({ error: "Invalid sessionId" });
      }

      const sessionExists = await ensureSessionExists(sessionId);

      if (!sessionExists) {
        return res.status(404).json({ error: "Class session not found" });
      }

      updates.sessionId = sessionId;
    }

    if (body.title !== undefined) {
      updates.title = parseRequiredText(body.title, "title");
    }

    if (body.description !== undefined) {
      updates.description =
        parseOptionalText(body.description, "description") ?? null;
    }

    if (body.type !== undefined) {
      const type = parseMaterialType(body.type);

      if (!type) {
        return res.status(400).json({ error: "Invalid type" });
      }

      updates.type = type;
    }

    if (body.url !== undefined) {
      updates.url = parseRequiredUrl(body.url);
    }

    if (body.filePublicId !== undefined) {
      updates.filePublicId =
        parseOptionalText(body.filePublicId, "filePublicId") ?? null;
    }

    if (body.position !== undefined) {
      const position = parseNonNegativeInteger(body.position);

      if (position === null) {
        return res.status(400).json({
          error: "position must be a non-negative integer",
        });
      }

      updates.position = position;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid fields provided" });
    }

    const [updatedMaterial] = await db
      .update(sessionMaterials)
      .set(updates)
      .where(eq(sessionMaterials.id, materialId))
      .returning({ id: sessionMaterials.id });

    if (!updatedMaterial) {
      return res
        .status(500)
        .json({ error: "Failed to update session material" });
    }

    const material = await readMaterialById(updatedMaterial.id);

    res.status(200).json({ data: material });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update session material";
    console.error("PUT /session-materials/:id error:", error);
    res.status(400).json({ error: message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const materialId = parsePositiveInteger(req.params.id);

    if (!materialId) {
      return res.status(400).json({ error: "Invalid material id" });
    }

    const [deletedMaterial] = await db
      .delete(sessionMaterials)
      .where(eq(sessionMaterials.id, materialId))
      .returning({ id: sessionMaterials.id });

    if (!deletedMaterial) {
      return res.status(404).json({ error: "Session material not found" });
    }

    res.status(200).json({ data: deletedMaterial });
  } catch (error) {
    console.error("DELETE /session-materials/:id error:", error);
    res.status(500).json({ error: "Failed to delete session material" });
  }
});

export default router;
