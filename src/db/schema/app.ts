import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { user } from "./auth";

export const classStatusEnum = pgEnum("class_status", [
  "active",
  "inactive",
  "archived",
]);

const timestamps = {
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const departments = pgTable("departments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: varchar("description", { length: 255 }),
  ...timestamps,
});

export const subjects = pgTable("subjects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  departmentId: integer("department_id")
    .notNull()
    .references(() => departments.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: varchar("description", { length: 255 }),
  ...timestamps,
});

export const classes = pgTable(
  "classes",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    subjectId: integer("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    teacherId: text("teacher_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    inviteCode: text("invite_code").notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    bannerCldPubId: text("banner_cld_pub_id"),
    bannerUrl: text("banner_url"),
    description: text("description"),
    capacity: integer("capacity").default(50).notNull(),
    status: classStatusEnum("status").default("active").notNull(),
    schedules: jsonb("schedules").$type<any[]>().default([]).notNull(),
    ...timestamps,
  },
  (table) => [
    index("classes_subject_id_idx").on(table.subjectId),
    index("classes_teacher_id_idx").on(table.teacherId),
  ],
);

export const enrollments = pgTable(
  "enrollments",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.studentId, table.classId] }),
    unique("enrollments_student_id_class_id_unique").on(
      table.studentId,
      table.classId,
    ),
    index("enrollments_student_id_idx").on(table.studentId),
    index("enrollments_class_id_idx").on(table.classId),
  ],
);

export const classSessions = pgTable(
  "class_sessions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    classId: integer("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    meetUrl: text("meet_url"),
    recordingUrl: text("recording_url"),
    status: text("status")
      .$type<"scheduled" | "live" | "completed" | "cancelled">()
      .default("scheduled")
      .notNull(),
    ...timestamps,
  },
  (table) => [
    index("idx_class_sessions_class_id").on(table.classId),
    index("idx_class_sessions_start_at").on(table.startAt),
  ],
);

export const sessionMaterials = pgTable(
  "session_materials",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => classSessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type")
      .$type<"pdf" | "doc" | "ppt" | "link" | "video" | "other">()
      .default("other")
      .notNull(),
    url: text("url").notNull(),
    filePublicId: text("file_public_id"),
    position: integer("position").default(0).notNull(),
    ...timestamps,
  },
  (table) => [
    index("idx_session_materials_session_id").on(table.sessionId),
    index("idx_session_materials_position").on(table.position),
  ],
);

export const departmentRelations = relations(departments, ({ many }) => ({
  subjects: many(subjects),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  department: one(departments, {
    fields: [subjects.departmentId],
    references: [departments.id],
  }),
  classes: many(classes),
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  subject: one(subjects, {
    fields: [classes.subjectId],
    references: [subjects.id],
  }),
  teacher: one(user, {
    fields: [classes.teacherId],
    references: [user.id],
  }),
  enrollments: many(enrollments),
  sessions: many(classSessions),
}));

export const enrollmentsRelations = relations(enrollments, ({ one }) => ({
  student: one(user, {
    fields: [enrollments.studentId],
    references: [user.id],
  }),
  class: one(classes, {
    fields: [enrollments.classId],
    references: [classes.id],
  }),
}));

export const classSessionsRelations = relations(
  classSessions,
  ({ one, many }) => ({
    class: one(classes, {
      fields: [classSessions.classId],
      references: [classes.id],
    }),
    materials: many(sessionMaterials),
  }),
);

export const sessionMaterialsRelations = relations(
  sessionMaterials,
  ({ one }) => ({
    session: one(classSessions, {
      fields: [sessionMaterials.sessionId],
      references: [classSessions.id],
    }),
  }),
);

export type Department = typeof departments.$inferSelect;
export type NewDepartment = typeof departments.$inferInsert;

export type Subject = typeof subjects.$inferSelect;
export type NewSubject = typeof subjects.$inferInsert;

export type Class = typeof classes.$inferSelect;
export type NewClass = typeof classes.$inferInsert;

export type Enrollment = typeof enrollments.$inferSelect;
export type NewEnrollment = typeof enrollments.$inferInsert;

export type ClassSession = typeof classSessions.$inferSelect;
export type NewClassSession = typeof classSessions.$inferInsert;

export type SessionMaterial = typeof sessionMaterials.$inferSelect;
export type NewSessionMaterial = typeof sessionMaterials.$inferInsert;
