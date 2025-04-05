import { index, primaryKey, sqliteTableCreator } from "drizzle-orm/sqlite-core";

export const createTable = sqliteTableCreator((name) => `llamag_${name}`);

export const checkpoints = createTable(
  "checkpoints",
  (d) => ({
    threadId: d.text("thread_id").notNull(),
    checkpointNs: d.text("checkpoint_ns").notNull().default(""),
    checkpointId: d.text("checkpoint_id").notNull(),
    parentCheckpointId: d.text("parent_checkpoint_id"),
    type: d.text("type"),
    checkpoint: d.blob("checkpoint"),
    metadata: d.blob("metadata"),
  }),
  (t) => ({
    pk: primaryKey(t.threadId, t.checkpointNs, t.checkpointId),
  })
)

export const writes = createTable(
  "writes",
  (d) => ({
    threadId: d.text("thread_id").notNull(),
    checkpointNs: d.text("checkpoint_ns").notNull().default(""),
    checkpointId: d.text("checkpoint_id").notNull(),
    taskId: d.text("task_id").notNull(),
    idx: d.integer("idx").notNull(),
    channel: d.text("channel").notNull(),
    type: d.text("type").notNull(),
    value: d.blob("value"),
  }),
  (t) => ({
    pk: primaryKey(t.threadId, t.checkpointNs, t.checkpointId, t.taskId, t.idx),
  })
)

export const chats = createTable(
  "chats",
  (d) => ({
    threadId: d.text("threadId").notNull().primaryKey(),
    createdAt: d.integer("created_at").notNull().default(Date.now()),
    updatedAt: d.integer("updated_at").notNull().default(Date.now()),
    title: d.text("title").notNull(),
    starred: d.integer("starred").notNull().default(0),
  }),
  (t) => ({
    pk: primaryKey(t.threadId),
  })
)

export const projects = createTable(
  "projects",
  (d) => ({
    projectId: d.text("project_id").notNull().primaryKey(),
    createdAt: d.integer("created_at").notNull().default(Date.now()),
    updatedAt: d.integer("updated_at").notNull().default(Date.now()),
    name: d.text("name").notNull(),
    description: d.text("description"),
    starred: d.integer("starred").notNull().default(0),
    sources: d.text("sources").notNull().default("[]"),
  }),
  (t) => ({
    pk: primaryKey(t.projectId),
  })
)