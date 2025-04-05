import { eq, lt, and, sql } from "drizzle-orm";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointTuple,
  type SerializerProtocol,
  type PendingWrite,
  type CheckpointMetadata,
  TASKS,
  copyCheckpoint,
} from "@langchain/langgraph-checkpoint";

import { checkpoints, writes } from "@/server/db/schema";
import { LibSQLDatabase } from "drizzle-orm/libsql";
import type { SQL } from "drizzle-orm";
import { client } from "@/server/db";

// In the `DrizzleSaver.list` method, we need to sanitize the `options.filter` argument to ensure it only contains keys
// that are part of the `CheckpointMetadata` type.
const checkpointMetadataKeys = ["source", "step", "writes", "parents"] as const;

type CheckKeys<T, K extends readonly (keyof T)[]> = [K[number]] extends [
  keyof T
]
  ? [keyof T] extends [K[number]]
    ? K
    : never
  : never;

function validateKeys<T, K extends readonly (keyof T)[]>(
  keys: CheckKeys<T, K>
): K {
  return keys;
}

const validCheckpointMetadataKeys = validateKeys<
  CheckpointMetadata,
  typeof checkpointMetadataKeys
>(checkpointMetadataKeys);

interface PendingWriteColumn {
  task_id: string;
  channel: string;
  type: string;
  value: string | Buffer;
}

interface PendingSendColumn {
  type: string;
  value: string | Buffer;
}

export class DrizzleSaver extends BaseCheckpointSaver {
  db: LibSQLDatabase;
  protected isSetup: boolean;

  constructor(db: LibSQLDatabase, serde?: SerializerProtocol) {
    super(serde);
    this.db = db;
    this.isSetup = false;
  }

  protected setup(): void {
    if (this.isSetup) {
      return;
    }
    
    // We're using a client-side library, so we need to make sure the tables exist
    // These should match the tables in schema.ts but using raw SQL to ensure consistency
    client.execute({
      sql: `
CREATE TABLE IF NOT EXISTS roast_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint BLOB,
  metadata BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);`,
      args: []
    });
    
    client.execute({
      sql: `
CREATE TABLE IF NOT EXISTS roast_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  value BLOB,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);`,
      args: []
    });
    
    this.isSetup = true;
  }
  
  private formatPendingWrites(pendingWrites: PendingWriteColumn[]): Promise<[string, string, unknown][]> {
    return Promise.all(
      pendingWrites.map(async (write) => {
        return [
          write.task_id,
          write.channel,
          await this.serde.loadsTyped(
            write.type ?? "json",
            typeof write.value === 'string' ? write.value : write.value.toString()
          ),
        ] as [string, string, unknown];
      })
    );
  }

  private formatPendingSends(pendingSends: PendingSendColumn[]): Promise<unknown[]> {
    return Promise.all(
      pendingSends.map(async (send) => {
        return this.serde.loadsTyped(
          send.type ?? "json", 
          typeof send.value === 'string' ? send.value : send.value.toString()
        );
      })
    );
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.setup();
    const {
      thread_id,
      checkpoint_ns = "",
      checkpoint_id,
    } = config.configurable ?? {};

    let conditions: SQL[] = [
      eq(checkpoints.threadId, thread_id as string),
      eq(checkpoints.checkpointNs, checkpoint_ns as string)
    ];

    if (checkpoint_id) {
      conditions.push(eq(checkpoints.checkpointId, checkpoint_id as string));
    }

    const row = await this.db.select()
      .from(checkpoints)
      .where(and(...conditions))
      .orderBy(checkpoint_id ? checkpoints.checkpointId : sql`1`)
      .limit(checkpoint_id ? 1 : 1)
      .get();
    
    if (!row) {
      return undefined;
    }

    let finalConfig = config;
    if (!checkpoint_id) {
      finalConfig = {
        configurable: {
          thread_id: row.threadId,
          checkpoint_ns,
          checkpoint_id: row.checkpointId,
        },
      };
    }
    
    if (
      finalConfig.configurable?.thread_id === undefined ||
      finalConfig.configurable?.checkpoint_id === undefined
    ) {
      throw new Error("Missing thread_id or checkpoint_id");
    }

    // Get pending writes
    const pendingWritesRows = await this.db.select()
      .from(writes)
      .where(and(
        eq(writes.threadId, row.threadId),
        eq(writes.checkpointNs, row.checkpointNs),
        eq(writes.checkpointId, row.checkpointId)
      ))
      .all();

    const pendingWrites = await this.formatPendingWrites(
      pendingWritesRows.map(w => ({
        task_id: w.taskId,
        channel: w.channel,
        type: w.type || "json",
        value: (w.value as string | Buffer) || Buffer.from("")
      }))
    );

    // Get pending sends
    const pendingSendsRows = await this.db.select()
      .from(writes)
      .where(and(
        eq(writes.threadId, row.threadId),
        eq(writes.checkpointNs, row.checkpointNs),
        eq(writes.checkpointId, row.parentCheckpointId || ""),
        eq(writes.channel, TASKS)
      ))
      .orderBy(writes.idx)
      .all();

    const pending_sends = await this.formatPendingSends(
      pendingSendsRows.map(s => ({
        type: s.type || "json",
        value: (s.value as string | Buffer) || Buffer.from("")
      }))
    );

    const checkpoint = {
      ...(await this.serde.loadsTyped(
        row.type || "json", 
        row.checkpoint ? (row.checkpoint instanceof Buffer ? 
          row.checkpoint.toString() : 
          row.checkpoint as string) : 
        ""
      )),
      pending_sends,
    } as Checkpoint;

    return {
      checkpoint,
      config: finalConfig,
      metadata: (await this.serde.loadsTyped(
        row.type || "json",
        row.metadata ? (row.metadata instanceof Buffer ? 
          row.metadata.toString() : 
          row.metadata as string) : 
        ""
      )) as CheckpointMetadata,
      parentConfig: row.parentCheckpointId
        ? {
            configurable: {
              thread_id: row.threadId,
              checkpoint_ns: row.checkpointNs,
              checkpoint_id: row.parentCheckpointId,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    this.setup();
    const { limit, before, filter } = options ?? {};
    
    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns;
    
    const conditions: SQL[] = [];
    
    if (thread_id) {
      conditions.push(eq(checkpoints.threadId, thread_id as string));
    }
    
    if (checkpoint_ns !== undefined && checkpoint_ns !== null) {
      conditions.push(eq(checkpoints.checkpointNs, checkpoint_ns as string));
    }
    
    if (before?.configurable?.checkpoint_id !== undefined) {
      conditions.push(lt(checkpoints.checkpointId, before.configurable.checkpoint_id as string));
    }
    
    // Apply filters based on validCheckpointMetadataKeys
    // Note: Drizzle doesn't have built-in JSON filtering for SQLite, so we'll need to handle this in-memory
    
    const query = this.db.select()
      .from(checkpoints)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(checkpoints.checkpointId)
      .limit(limit ? Number(limit) : 1000);
    
    const rows = await query.all();
    
    const sanitizedFilter = Object.fromEntries(
      Object.entries(filter ?? {}).filter(
        ([key, value]) =>
          value !== undefined &&
          validCheckpointMetadataKeys.includes(key as keyof CheckpointMetadata)
      )
    );
    
    for (const row of rows) {
      // Parse metadata to check against filters
      const rawMetadata = row.metadata ? 
        (row.metadata instanceof Buffer ? row.metadata.toString() : row.metadata as string) : 
        "{}";
      const parsedMetadata = JSON.parse(rawMetadata);
      
      // Check each filter condition
      const filterMatch = Object.entries(sanitizedFilter).every(
        ([key, value]) => {
          const keyPath = key.split('.');
          let current = parsedMetadata;
          for (const part of keyPath) {
            if (current === undefined || current === null) return false;
            current = current[part];
          }
          return JSON.stringify(current) === JSON.stringify(value);
        }
      );
      
      if (!filterMatch) continue;
      
      // Get pending writes
      const pendingWritesRows = await this.db.select()
        .from(writes)
        .where(and(
          eq(writes.threadId, row.threadId),
          eq(writes.checkpointNs, row.checkpointNs),
          eq(writes.checkpointId, row.checkpointId)
        ))
        .all();
  
      const pendingWrites = await this.formatPendingWrites(
        pendingWritesRows.map(w => ({
          task_id: w.taskId,
          channel: w.channel,
          type: w.type || "json",
          value: (w.value as string | Buffer) || Buffer.from("")
        }))
      );
  
      // Get pending sends
      const pendingSendsRows = await this.db.select()
        .from(writes)
        .where(and(
          eq(writes.threadId, row.threadId),
          eq(writes.checkpointNs, row.checkpointNs),
          eq(writes.checkpointId, row.parentCheckpointId || ""),
          eq(writes.channel, TASKS)
        ))
        .orderBy(writes.idx)
        .all();
  
      const pending_sends = await this.formatPendingSends(
        pendingSendsRows.map(s => ({
          type: s.type || "json",
          value: (s.value as string | Buffer) || Buffer.from("")
        }))
      );
  
      const checkpoint = {
        ...(await this.serde.loadsTyped(
          row.type || "json", 
          row.checkpoint ? (row.checkpoint instanceof Buffer ? 
            row.checkpoint.toString() : 
            row.checkpoint as string) : 
          ""
        )),
        pending_sends,
      } as Checkpoint;
  
      yield {
        checkpoint,
        config: {
          configurable: {
            thread_id: row.threadId,
            checkpoint_ns: row.checkpointNs,
            checkpoint_id: row.checkpointId,
          },
        },
        metadata: parsedMetadata as CheckpointMetadata,
        parentConfig: row.parentCheckpointId
          ? {
              configurable: {
                thread_id: row.threadId,
                checkpoint_ns: row.checkpointNs,
                checkpoint_id: row.parentCheckpointId,
              },
            }
          : undefined,
        pendingWrites,
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata
  ): Promise<RunnableConfig> {
    this.setup();

    if (!config.configurable) {
      throw new Error("Empty configuration supplied.");
    }

    const thread_id = config.configurable?.thread_id;
    const checkpoint_ns = config.configurable?.checkpoint_ns ?? "";
    const parent_checkpoint_id = config.configurable?.checkpoint_id;

    if (!thread_id) {
      throw new Error(
        `Missing "thread_id" field in passed "config.configurable".`
      );
    }

    const preparedCheckpoint: Partial<Checkpoint> = copyCheckpoint(checkpoint);
    delete preparedCheckpoint.pending_sends;

    const [type1, serializedCheckpoint] = this.serde.dumpsTyped(preparedCheckpoint);
    const [type2, serializedMetadata] = this.serde.dumpsTyped(metadata);
    
    if (type1 !== type2) {
      throw new Error(
        "Failed to serialized checkpoint and metadata to the same type."
      );
    }

    // Use raw SQL INSERT OR REPLACE instead of Drizzle's ORM
    // Ensure no undefined values are passed to the database
    await client.execute({
      sql: `INSERT OR REPLACE INTO roast_checkpoints 
            (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        thread_id as string,
        checkpoint_ns as string,
        checkpoint.id,
        parent_checkpoint_id || null,  // Use null instead of undefined
        type1,
        serializedCheckpoint,
        serializedMetadata,
      ]
    });

    return {
      configurable: {
        thread_id,
        checkpoint_ns,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes_data: PendingWrite[],
    taskId: string
  ): Promise<void> {
    this.setup();

    if (!config.configurable) {
      throw new Error("Empty configuration supplied.");
    }

    if (!config.configurable?.thread_id) {
      throw new Error("Missing thread_id field in config.configurable.");
    }

    if (!config.configurable?.checkpoint_id) {
      throw new Error("Missing checkpoint_id field in config.configurable.");
    }

    const thread_id = config.configurable.thread_id as string;
    const checkpoint_ns = config.configurable.checkpoint_ns as string || "";
    const checkpoint_id = config.configurable.checkpoint_id as string;

    // Prepare all the write statements
    const stmt = `INSERT OR REPLACE INTO roast_writes 
      (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      
    // Execute each write individually
    for (let idx = 0; idx < writes_data.length; idx++) {
      const write = writes_data[idx];
      if (!write) continue;
      
      const [type, serializedWrite] = this.serde.dumpsTyped(write[1]);
      
      // Ensure all arguments are defined
      await client.execute({
        sql: stmt,
        args: [
          thread_id,
          checkpoint_ns,
          checkpoint_id,
          taskId,
          idx,
          write[0] || "",
          type || "json",
          serializedWrite || null
        ]
      });
    }
  }
}